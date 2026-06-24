---
title: "任务自适应 Harness 应在恰当时机为当前任务注入历史会话上下文"
date: "2026-04-21"
kind: issue
status: resolved
severity: medium
area: harness
tags:
  - harness
  - kanban
  - sessions
  - context-hydration
  - just-in-time
  - task-adaptive-harness
  - mcp
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-16-global-kanban-flow-learning-via-agent-specialist.md"
  - "docs/issues/2026-04-17-generic-trace-learning-session-analysis-foundation.md"
github_issue: 515
github_state: closed
github_url: "https://github.com/phodal/routa/issues/515"
---

# 任务自适应 Harness 应在恰当时机为当前任务注入历史会话上下文

## 发生了什么

Routa 其实已经具备足够的本地证据，可以从既往会话中恢复出有用的任务上下文：

- 历史会话的 JSONL transcript 可以被规范化为变更文件、prompt 历史、工具使用情况和会话诊断信息
- Feature Explorer 已经能够将这些信号归因回选定的文件和 feature 面
- ACP 会话创建已经支持按会话设置 specialist prompt 以及收窄 MCP 工具 profile

然而，这一能力目前主要是作为一条分析路径暴露出来，而不是一条执行路径。

如今，当看板用户想要启动一个新需求并复用相关的既往工作上下文时，系统并没有提供一种一等公民式的方式来：

- 检索与当前任务最相关的历史会话
- 将这些信号编译成一个聚焦的上下文包
- 在会话启动时自动将该上下文包注入到新会话中
- 根据推断出的任务形态来适配可见的工具面

结果就是：上下文复用在各个零散环节中是可行的，但还没有被产品化为一种任务启动时的 Harness 体验。

## 期望行为

Routa 应当在 Harness 框架之下暴露一种一等公民式的 `Task-Adaptive Harness`（任务自适应 Harness）能力。

它的概念边界应当是：

- `Task-Adaptive Harness`：产品与架构概念
- `Just-in-time context hydration`：运行时实现机制

对于一个新的看板或面向任务的会话，系统应当能够：

- 从卡片、feature、文件或仓库上下文中识别当前任务范围
- 在恰当时机检索相关的历史会话证据
- 编译出一个最小化的任务范围上下文包，而不是直接加载原始 transcript
- 可选地为该任务适配 MCP 工具子集以及 Provider 原生工具访问权限
- 将编译好的上下文包注入到会话启动路径中

这应当同时支持两种形态：

- 一条用于任务执行的自动会话启动路径
- 一项显式的操作动作，可能通过类似 `assemble_task_adaptive_harness` 这样的 MCP 工具提供

## 复现上下文

- 环境：both
- 触发条件：在讨论看板用户如何能直接将相关的既往会话上下文加载进一个新的实现任务时，发现当前系统具备检索和分析原语，但还缺少一个一等公民式的任务启动 Harness 抽象

## 为何会发生

- 历史会话证据目前主要存在于 trace/会话分析流程中，而不是一条可复用的任务激活流水线里
- Feature Explorer 已经会执行上下文组装，但其输出是为回顾式分析设计的，而非通用的会话引导
- MCP 工具暴露目前是通过粗粒度的模式和静态 profile 来选择的，而不是依据任务本地证据
- 当前的产品术语区分了 harness、trace 学习和会话分析，但还没有一个统一的概念来描述任务范围的自适应启动
- AG-UI 和 ACP 的会话启动流程尚未消费一个由历史会话编译而成的结构化恰时上下文包

## 相关文件

- `crates/harness-monitor/AGENTS.md`
- `src/app/api/feature-explorer/shared.ts`
- `src/app/workspace/[workspaceId]/feature-explorer/session-analysis.ts`
- `src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx`
- `resources/specialists/tools/file-session-analyst.yaml`
- `src/app/api/acp/acp-session-create.ts`
- `src/core/acp/session-prompt.ts`
- `src/core/acp/mcp-config-generator.ts`
- `src/core/mcp/mcp-server-profiles.ts`
- `src/core/mcp/mcp-tool-executor.ts`
- `src/app/api/ag-ui/route.ts`

## 观察

- Feature Explorer 已经能从历史会话中构建出一个高信号的会话证据包，包括 prompt 历史、工具历史、变更文件和诊断信息。
- 当前的会话分析 prompt 明确告知 specialist 优先使用所提供的证据，仅在必要时才打开原始 transcript JSONL。
- ACP 会话创建已经支持按会话设置 `specialistId`、`systemPrompt`、`toolMode`、`mcpProfile` 和 `allowedNativeTools`。
- MCP 工具暴露已经支持基于 allowlist 的 profile，但这些 profile 目前是静态的，并非由任务本地证据编译而来。
- `AG-UI` 的输入契约中已经有一个 `context` 字段，但当前路由尚未将其转化为一条真正的任务启动上下文注入路径。
- 现有术语分散在 `trace learning`、`session analysis` 和 `harness` 之间；本 issue 提议引入 `Task-Adaptive Harness` 作为顶层概念，并将恰时注入视为其中一种实现策略。

## 参考

- 本地相关 issue：`docs/issues/2026-04-16-global-kanban-flow-learning-via-agent-specialist.md`
- 本地相关 issue：`docs/issues/2026-04-17-generic-trace-learning-session-analysis-foundation.md`

## 解决方案

- 2026-04-22：在实机验证确认 `Task-Adaptive Harness` 现在已是一项真正的执行能力，而非仅停留在分析层面的管道之后关闭。
- 已落地的实现现在覆盖了两条预期的激活路径：
  - 通过 `session/new` / `taskAdaptiveHarness` 实现的自动会话启动注入
  - 通过 `assemble_task_adaptive_harness` 提供的显式操作者/MCP 访问
- 后续的 UX 与检索优化被拆分到更聚焦的独立 issue：
  - `#516`：看板呈现与卡片详情可用性
  - `#517`：仓库根目录回退发现质量
  - `#519`：最小化的已保存历史记忆持久化
