---
title: 工作区中心化重构
---

# 工作区中心化重构

## 状态

权威设计文档。本文档取代了较早的 `.kiro/specs/workspace-centric-redesign/*` 文件，作为工作区优先架构的主要综述。

该重构已部分落地。工作区优先的路由、代码库建模以及工作区范围的会话视图已经成为现实。部分 API 和后端流程仍带有过渡性的 `default` 工作区假设。

## 为什么需要它

Routa 最初将 `workspace` 视为环绕单一默认上下文的、基本隐藏的容器。本次重构将工作区提升为顶层协调单元，从而使会话、笔记、任务、代码库以及 UI 导航都拥有明确的项目范围。

这带来了以下能力：
- 多个工作区，并支持显式切换
- 每个工作区可包含多个代码库
- 工作区范围的会话视图和看板视图
- Web 端与桌面端在范围上保持一致

## 权威决策

### 工作区是用户的主要上下文

用户首先按工作区导航，然后在该工作区内按会话、笔记、任务或看板进行导航。

### 代码库是一等记录

仓库路径和分支被建模为独立的代码库记录，而不是内嵌在工作区本身之上。

### 会话必须携带工作区范围

会话历史、Trace 视图和工作区详情页都假定会话归属于某个工作区，并按该范围进行过滤。

### Web 端与桌面端必须保持相同语义

Rust 桌面端后端与 Next.js 后端可以在实现上有所不同，但工作区和代码库的 API 语义应保持一致。

## 当前实现基线

### 已实现

- 工作区页面与导航存在于 `/workspace/[workspaceId]` 及相关路由。
- 通过 `WorkspaceSwitcher` 提供了工作区切换 UI。
- 在工作区范围的路由以及顶层代码库变更路由下提供了代码库的 CRUD API。
- 主 schema 包含 `codebases`、`workspace_skills`、工作区范围的 `acp_sessions` 以及工作区范围的 worktree。
- 客户端 hook 通过工作区范围的 API 拉取工作区和代码库。
- Tauri 静态导出路由支持占位的工作区路由，并在客户端进行解析。

代表性文件：
- `src/app/workspace/[workspaceId]/workspace-page-client.tsx`
- `src/client/components/workspace-switcher.tsx`
- `src/client/hooks/use-workspaces.ts`
- `src/app/api/workspaces/[workspaceId]/route.ts`
- `src/app/api/workspaces/[workspaceId]/codebases/route.ts`
- `src/core/db/schema.ts`

### 过渡性或未完成的部分

- 当缺少 `workspaceId` 时，部分 API 仍会回退到 `"default"`，尤其是任务和后台任务端点。
- 部分运行时和桌面端启动流程仍会确保或假定存在一个默认工作区。
- 会话重启和 MCP 服务器路径仍包含 `"default"` 回退行为。
- 彻底移除硬编码默认工作区行为的设计目标尚未完成。
- `workspace_skills` 已存在于 schema 中，但仓库仍需要一份清晰的权威文档，说明在技能范围划分方面哪些已完全实现、哪些仍属过渡阶段。

仍残留过渡逻辑的代表性文件：
- `src/app/api/tasks/route.ts`
- `src/app/api/background-tasks/route.ts`
- `src/app/api/acp/route.ts`
- `crates/routa-server/src/lib.rs`
- `crates/routa-cli/src/commands/prompt.rs`

## 需要保持的不变量

1. 每一个用户可见的工作区资源都必须具有明确的工作区范围。
2. 代码库归属于唯一一个工作区，并应通过该归属关系来寻址。
3. 会话和看板界面应反映当前所选的工作区，而不是一个全局混合列表。
4. 桌面端路由占位符是实现细节，而非领域概念。
5. 新增 API 应要求明确的工作区范围，除非有刻意为之的引导（bootstrap）例外。

## 来自旧规格的迁移说明

较早的 `.kiro/specs/workspace-centric-redesign/` 集合混合了三种不同的关注点：
- 产品需求
- 实现排期
- 目标架构

本权威文档仅保留持久化的架构与过渡状态。详细的排期应放在 `docs/exec-plans/` 下，历史规格文本则继续保留在 `.kiro/specs/` 中作为出处依据，直到逐项退役。

## 下一步清理目标

1. 从任务和后台任务 API 中移除剩余的 `"default"` 回退。
2. 收窄仅用于引导的默认工作区逻辑，使其不会渗入稳态运行时行为。
3. 记录技能范围划分的实际状态，弥合 schema 意图与产品语义之间的差距。
4. 为要求工作区范围的 API 以及无过渡逻辑的路由行为补充验证覆盖。

## 出处

归并进本文档的源材料：
- `.kiro/specs/workspace-centric-redesign/design.md`
- `.kiro/specs/workspace-centric-redesign/requirements.md`
- `.kiro/specs/workspace-centric-redesign/tasks.md`

相关文档：
- [ARCHITECTURE.md](../ARCHITECTURE.md)
