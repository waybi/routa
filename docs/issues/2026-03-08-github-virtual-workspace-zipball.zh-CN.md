---
title: "GitHub 虚拟工作区 —— 面向 Serverless 的基于 Zipball 的仓库浏览"
date: "2026-03-08"
status: resolved
severity: medium
area: "workspace"
tags: ["enhancement", "serverless", "github-integration", "vercel"]
reported_by: "Augment Agent"
related_issues: []
---

# GitHub 虚拟工作区 —— 基于 Zipball 的仓库浏览

## 发生了什么

目前，Routa 中的代码库需要磁盘上有一个本地的 `repoPath`。`/api/clone` 路由使用 `git clone`，这会引发以下几个问题：

1. **在 serverless（Vercel）上失败** —— 只读文件系统，没有可用的 `git` 二进制文件
2. **对只读场景而言很慢** —— 对于代码评审来说，带历史记录的完整克隆是过度的
3. **磁盘空间需求** —— 与仓库大小成正比，在 serverless 上存在问题

技能目录（skills catalog）在安装技能时已经会下载 GitHub zip，但这一模式尚未用于通用的代码库/工作区浏览。

## 预期行为

用户应当能够：
- 无需本地 git clone 即可直接导入 GitHub 仓库
- 在 serverless 部署（Vercel）上浏览和评审代码
- 在只读操作中使用极少的磁盘空间（或内存存储）
- 访问公开和私有仓库（配合 GITHUB_TOKEN）

## 复现上下文

- 环境：Web 端（Vercel serverless 部署）
- 触发条件：在 Vercel 上尝试通过 `/api/clone` 克隆仓库
- 结果：因只读文件系统和缺失 git 二进制文件而失败

## 可能的原因

- Serverless 环境（Vercel、AWS Lambda）除 `/tmp` 外文件系统均为只读
- 标准 Node.js 运行时容器中没有 git 二进制文件
- 当前架构假定有安装了 git 的本地文件系统
- 没有面向 serverless 的替代代码浏览机制

## 相关文件

- `src/app/api/clone/route.ts` —— 当前的 git clone 实现
- `src/app/api/skills/catalog/route.ts` —— 现有的 zipball 下载模式
- `src/core/models/codebase.ts` —— 代码库模型定义
- `src/core/db/schema.ts` —— 数据库 schema

## 观察

- 技能目录已经成功使用 GitHub zipball API：`https://api.github.com/repos/{owner}/{repo}/zipball/{ref}`
- 依赖中已包含 AdmZip 库用于 zip 解压
- 在大多数 serverless 平台上 `/tmp` 目录是可写的（有大小限制）

## 根因分析

当前实现硬性依赖于：
1. 具有写权限的本地文件系统
2. git 二进制文件的可用性
3. 完整的仓库历史记录（只读浏览并不需要）

这使其与上述假设不成立的 serverless 部署不兼容。

## 解决方案

### 提议的方案：GitHub 虚拟工作区

新增一项 **GitHub 虚拟工作区** 能力，下载仓库的 zipball 并提供一个用于浏览的虚拟文件系统。

#### 架构

```
POST /api/github/import { owner, repo, ref? }
  ↓
1. Download zipball from GitHub API
2. Extract to /tmp/routa-gh/{owner}--{repo}/ (or in-memory)
3. Build file index (VirtualFileTree)
4. Store index in memory/DB for fast lookup
5. Return workspace-compatible codebase entry

GET /api/github/tree?owner=X&repo=Y&ref=Z
  → { tree: VirtualFileEntry[] }

GET /api/github/file?owner=X&repo=Y&path=Z
  → { content: string, path: string }

GET /api/github/search?owner=X&repo=Y&q=Z
  → { files: FileMatch[] }
```

#### 关键设计决策

1. **双存储策略**：
   - 在 serverless 上解压到 `/tmp`
   - 在桌面端解压到 `.routa/repos/`
   - 若写入失败则回退到内存 `Map<path, Buffer>`

2. **代码库模型扩展**：
   - 新增 `sourceType?: "local" | "github"`
   - 新增 `sourceUrl?: string`
   - 对于 GitHub 来源，`repoPath` 变为解压后的临时路径

3. **复用现有模式**：
   - 沿用 `skills/catalog/route.ts` 中的 zip 下载 + AdmZip 解压

4. **用于性能的文件索引**：
   - 在导入时构建 `VirtualFileTree`
   - 避免每次操作都重新扫描文件系统

5. **基于 TTL 的清理**：
   - GitHub 工作区解压结果具有 TTL（默认 1h）
   - 清理函数在访问时运行，以驱逐过期条目

#### 所需改动

- `src/core/github/github-workspace.ts` —— 核心逻辑：下载、解压、索引
- `src/app/api/github/import/route.ts` —— 导入端点
- `src/app/api/github/tree/route.ts` —— 文件树端点
- `src/app/api/github/file/route.ts` —— 文件内容端点
- `src/app/api/github/search/route.ts` —— 文件搜索端点
- `src/core/models/codebase.ts` —— 新增 `sourceType` / `sourceUrl` 字段
- `codebases` 表的 schema 迁移（Postgres 和 SQLite 均需）

#### 非目标（v1）

- 写回 GitHub（PR、提交）
- 导入后切换分支（用不同的 ref 重新导入）
- 增量更新（始终完整重新下载）
- 无 token 的私有仓库支持（需要 GITHUB_TOKEN 环境变量）

## 参考资料

- 现有 zipball 模式：`src/app/api/skills/catalog/route.ts`
- GitHub API：https://docs.github.com/en/rest/repos/contents#download-a-repository-archive-zip

## 解决方案

已由后续的 GitHub 虚拟工作区实现解决。

当前仓库中的证据：

- `src/core/github/github-workspace.ts` 现已实现 zipball 下载、解压到 `/tmp`、内存注册表/缓存行为、文件索引、文件树浏览、文件读取、搜索以及 TTL 清理。
- `src/app/api/github/import/route.ts` 实现了 `POST /api/github/import`。
- 该仓库还暴露了：
  - `GET /api/github`
  - `GET /api/github/tree`
  - `GET /api/github/file`
  - `GET /api/github/search`
- `src/core/models/codebase.ts` 和各数据库 schema 现已包含 `sourceType` 和 `sourceUrl`。
- `src/app/api/clone/route.ts` 现在会在 `git clone` 不可用或失败时显式回退到 GitHub zipball 导入。
- `docs/product-specs/FEATURE_TREE.md` 已将 GitHub 虚拟工作区端点列为已交付的产品界面。

这意味着该问题不再只是一个停留在提案阶段的缺口。该能力已经存在，并已集成到 API 界面和代码库模型中。
