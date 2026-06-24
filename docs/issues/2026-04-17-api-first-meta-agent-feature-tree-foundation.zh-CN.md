---
title: "面向跨框架 FEATURE_TREE 生成的 API 优先 Meta Agent 基础"
date: "2026-04-17"
kind: issue
status: resolved
resolved_at: "2026-04-18"
severity: medium
area: "feature-tree"
tags: ["feature-tree", "meta-agent", "openapi", "spring-boot", "eggjs", "specialists"]
reported_by: "codex"
related_issues:
  - "https://github.com/phodal/routa/issues/481"
  - "https://github.com/phodal/routa/issues/483"
github_issue: 483
github_state: closed
github_url: "https://github.com/phodal/routa/issues/483"
---

# 面向跨框架 FEATURE_TREE 生成的 API 优先 Meta Agent 基础

## 发生了什么

Routa 当前的 `FEATURE_TREE` 生成路径与现有 Routa/Next.js 仓库形态紧密耦合：

- 前端路由从 `src/app/**/page.tsx` 派生
- 契约 API 从 `api-contract.yaml` 派生
- 实现层 API 从 Next.js 路由处理器和 Rust Axum 路由器派生
- 功能元数据围绕这些 Routa 特有的页面/API 表面进行归一化

这对当前仓库是可行的，但无法泛化到诸如 Spring Boot 或 Egg.js 之类的其他框架。

与此同时，GitHub issue #481 提出了一个以功能为范围的恢复与文件浏览体验，它假设在会话、任务、文件和 API 之间存在一个稳定的功能/表面基础。

## 期望行为

Routa 应当具备一个可复用的分析基础，能够：

- 将 API 契约发现作为主要的中间产物
- 在可用时复用已有的 OpenAPI / Swagger / 契约文件
- 在仓库没有预先编写的 OpenAPI 时，能够推断出一份可用的内存 API 契约
- 为 Spring Boot 和 Egg.js 等非 Routa 仓库支持框架适配器
- 持续产出兼容的 `docs/product-specs/FEATURE_TREE.md` 和 `feature-tree.index.json`
- 在确定性提取之后，为 AI 专家（specialists）留出填补空缺的空间

## 为何重要

如果没有这个基础：

- `#481` 只能依赖 Routa 特有的假设，而无法消费一个可移植的功能/表面模型
- 以功能为范围的恢复在当前仓库布局之外仍将脆弱不堪
- 跨框架的功能归因将被阻塞在临时脚本上，而非建立在稳定的运行时能力之上

## 提议方向

- 引入一条由 Meta Agent 驱动的分析流水线
- 将 API 优先的契约发现作为规范的中间表示
- 优先支持确定性框架适配器，仅在填补空缺时才使用 AI 专家
- 增加一个校验步骤，强制执行 schema、去重、源文件可追溯性以及所产出产物的兼容性

## 相关文件

- `scripts/docs/feature-tree-generator.ts`
- `src/core/spec/feature-surface-index.ts`
- `src/core/spec/feature-surface-metadata.ts`
- `src/app/api/spec/surface-index/route.ts`
- `api-contract.yaml`

## 参考

- https://github.com/phodal/routa/issues/481
- https://github.com/phodal/routa/issues/483

## 解决进展更新（2026-04-21）

- 将本地跟踪记录同步至已关闭的 GitHub issue `#483`。
- 将上游解决日期记录为 `2026-04-18`；唯一遗留的差异是本地跟踪状态漂移。
