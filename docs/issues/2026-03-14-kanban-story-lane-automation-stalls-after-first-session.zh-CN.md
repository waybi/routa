---
title: "看板 story/lane 自动化在第一个 ACP 会话后停滞，且缺少 story 级别的工作流状态"
date: "2026-03-14"
status: resolved
resolved_at: "2026-03-15"
severity: high
area: "kanban"
tags: ["kanban", "automation", "session", "workflow", "story", "lane", "acp"]
reported_by: "codex"
github_issue: 163
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/163"
related_issues:
  - "docs/issues/2026-03-12-gh-124-kanban-column-automation-does-not-start-sessions-manual-issue-modal-cras.md"
  - "docs/issues/2026-03-14-kanban-session-concurrency-queue.md"
  - "https://github.com/phodal/routa/issues/163"
---

# 看板 story/lane 自动化在第一个 ACP 会话后停滞，且缺少 story 级别的工作流状态

## 发生了什么

在 `http://localhost:3000/workspace/default/kanban` 上，KanbanTask 输入框可以在右侧打开一个 ACP 会话并开始 backlog 规划工作。当前默认看板在每条 lane 上都配置了自动化，包括：

- `backlog` => `Issue Enricher`，`transitionType: entry`，`autoAdvanceOnSuccess: true`
- `todo` => 已自动启用，`transitionType: entry`，`autoAdvanceOnSuccess: true`
- `dev`、`review`、`blocked`、`done` => 同样已自动启用

调查期间观察到的行为：

- 在输入框中输入 `create a hello world` 会立即打开一个规划 ACP 会话。
- 当前默认看板 API 显示每条工作流 lane 都启用了自动化：
  - `backlog` => `Issue Enricher`（`providerId: claude`，`role: DEVELOPER`，`specialistId: issue-enricher`）
  - `todo` => `providerId: codex`，`role: ROUTA`
  - `dev` => `providerId: claude`，`specialistId: pr-reviewer`
  - `review` => `providerId: claude`，`role: GATE`，`specialistId: desk-check`
  - `blocked` => `providerId: codex`，`specialistId: claude-code`
  - `done` => `providerId: codex`，`role: GATE`，`specialistId: gate`
- 现有的 backlog 卡片已经可以持有 `triggerSessionId`，这确认了至少第一次 transition 可以为某条 lane 创建会话。
- 一个已经位于 `todo` 的任务可能仍然没有 `triggerSessionId`，这意味着即使 `todo` 自动化已启用，进入 lane 也不会可靠地触发一个新会话。
- 在第一个会话完成后，自动化链条没有继续贯通已配置的各条 lane。

当前实现将自动化建模为"每次列转换对应一个 ACP 会话"，并且只在任务上存储单个 `triggerSessionId`。不存在能够表示一个 story 跨多个 lane 会话推进的持久化 story 级别执行记录。

## 预期行为

- KanbanTask 输入框应创建规划会话，并在规划完成后创建或细化对应的 story 卡片。
- 当 backlog 自动化启用时，一个 backlog story 应推进到下一个工作流状态，并启动所分配 lane 的自动化。
- 当一个 lane 会话成功完成且 `autoAdvanceOnSuccess` 启用时，卡片应推进到下一条 lane 并启动该 lane 的会话。
- 一个 story 应能够在 backlog、todo、dev、review、blocked 和 done 之间累积多个 lane 会话，而不是把所有内容塞进单个 `triggerSessionId`。

## 复现环境

- 环境：Web 端
- 触发方式：打开 `/workspace/default/kanban`，提交 `create a hello world`，等待规划会话运行，然后观察工作流没有在自动化的各条 lane 之间继续推进

调查期间捕获的额外运行时上下文：

- 看板 id：`d63b96f5-b40b-4a77-a4fd-84978fd316c0`
- 看板会话并发上限：`3`
- 当前队列快照已经显示 lane 级别的运行状态，但没有 story 级别的工作流状态

## 可能的原因

- 看板自动化的启动与看板自动化的完成似乎依赖不同的事件通道。进入列由全局 `EventBus` 上的 `COLUMN_TRANSITION` 驱动，但会话完成首先在 `HttpSessionStore` 内被转换为 `WorkspaceAgentEvent`，对于普通的看板任务会话，并没有明显地桥接回全局 `EventBus`。
- `KanbanWorkflowOrchestrator` 和 `KanbanSessionQueue` 都在全局 `EventBus` 上等待 `AGENT_COMPLETED` / `REPORT_SUBMITTED` / `AGENT_FAILED` / `AGENT_TIMEOUT`，但普通的看板 ACP 会话似乎主要由 `HttpSessionStore` 中的每会话状态来跟踪。
- `HttpSessionStore.subscribeToAgentEvents()` 存在，但当前代码检索显示没有任何看板侧的订阅者把每会话的 `agent_completed` / `agent_failed` 语义事件转换回 `EventBus.AgentEventType.AGENT_COMPLETED` 或相关事件。
- `Task.triggerSessionId` 只能表示一个会话，这与"一个 story 应跨多个 lane 会话推进，并可能存在回滚/重试分支"的预期模型不匹配。
- 当前数据模型是面向 lane 的而非面向 story 的：lane 转换触发会话创建，但没有附加到 story 上的持久化工作流图或 lane 会话历史。

## 相关文件

- `src/app/workspace/[workspaceId]/kanban/kanban-agent-input.ts`
- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/core/kanban/kanban-session-queue.ts`
- `src/core/kanban/column-transition.ts`
- `src/core/kanban/agent-trigger.ts`
- `src/core/acp/http-session-store.ts`
- `src/core/acp/agent-event-bridge/agent-event-bridge.ts`
- `src/core/events/event-bus.ts`

## 观察

- `src/app/api/tasks/route.ts` 在任务创建后，当目标列启用了自动化时立即发出 `COLUMN_TRANSITION`。
- `src/app/api/tasks/[taskId]/route.ts` 在卡片移动后也会发出 `COLUMN_TRANSITION`，但对 `dev` / 重试逻辑而言，仍存在编排器之外直接触发 ACP 的特例处理。
- `src/core/kanban/workflow-orchestrator.ts` 仅在收到来自全局 `EventBus` 的生命周期事件后才自动推进。
- `src/core/acp/http-session-store.ts` 把 Provider 更新转换为 `WorkspaceAgentEvent`，并仅通过 `subscribeToAgentEvents()` 分发给每会话订阅者。
- `src/core/acp/agent-event-bridge/agent-event-bridge.ts` 确实会产生 `agent_completed` / `agent_failed` 语义事件，但这些与 `EventBus` 的 `AgentEventType.AGENT_COMPLETED` / `AGENT_FAILED` 并非相同的对象。
- `src/core/kanban/workflow-orchestrator-singleton.ts` 和 `src/core/kanban/kanban-session-queue.ts` 都会在 `task.triggerSessionId` 上短路，因此一旦任务保留了之前的会话 id，除了清空并覆盖那个单一字段之外，就没有内建机制来表示"下一个 lane 会话"。
- `default` 工作区中的当前任务数据显示出混合状态：部分 backlog 卡片有 `triggerSessionId`，另一张位于 `todo` 的卡片没有 `triggerSessionId`，而新的 KanbanTask 输入会话可以在不产生持久化多 lane 工作流状态的情况下运行。

## 当前分析

这看起来像是两个相互叠加的独立问题：

1. 即时执行缺陷：
   lane 自动化从 `COLUMN_TRANSITION` 启动，但完成/队列排空逻辑等待的是全局生命周期事件，而普通的看板 ACP 会话并没有明确地把这些事件回发到同一个 `EventBus`。这解释了为什么第一条 lane 可以启动，但工作流随后停滞而不是自动推进。

2. 底层模型缺陷：
   任务 schema 只有一个 `triggerSessionId`，所以即便修复了生命周期桥接，当前模型仍然无法表示单个 story 累积 backlog/todo/dev/review/done 会话或回滚分支。它只能覆盖或复用一个会话指针。

用户的假设"每个 Todo/Backend lane 创建一个会话之后就无法继续自动运行"在方向上是正确的，但更有力的结论是：

- 每条 lane 创建一个会话本身并没有错；
- 当前实现既缺少可靠的生命周期桥接，也缺少 story 级别的会话/工作流记录，因此"每 lane 一会话"的设计无法安全地端到端运行。

## 参考资料

- GitHub issue：`phodal/routa#163`
- 2026-03-14 用户报告所描述的预期流程：输入 -> ACP 会话 -> story 创建 -> backlog 自动化 -> todo 自动化 -> 持续的 lane 推进
- `docs/issues/2026-03-12-gh-124-kanban-column-automation-does-not-start-sessions-manual-issue-modal-cras.md`
- `docs/issues/2026-03-14-kanban-session-concurrency-queue.md`

## 解决方案

该问题已在当前代码库中解决，上游 GitHub issue 也已关闭。

当前实现中的证据：

- `src/core/acp/http-session-store.ts` 现在会把 ACP 语义生命周期事件桥接回全局
  `EventBus`，为看板跟踪的会话发出 `AGENT_COMPLETED` 和 `AGENT_FAILED`。
- `src/core/models/task.ts` 现在通过 `sessionIds`、`laneSessions` 和 `laneHandoffs`
  持久化 story 级别的 lane 执行状态，而不再只依赖单个 `triggerSessionId`。
- `src/core/kanban/workflow-orchestrator-singleton.ts` 通过 `upsertTaskLaneSession(...)`
  记录每个被触发的 lane 会话，`src/core/kanban/workflow-orchestrator.ts` 会标记
  lane 会话状态、在多步自动化内推进，并在 `autoAdvanceOnSuccess` 启用时把卡片
  自动推进到下一个自动化的 lane。
- `src/app/workspace/[workspaceId]/kanban/kanban-tab-helpers.tsx` 及相关的看板详情
  界面现在在解析活跃运行时优先采用最新的 `laneSessions` 条目，而不是假设只有一个
  持久化会话指针。
- `src/core/kanban/__tests__/workflow-orchestrator.test.ts` 包含有针对性的链式 lane
  回归用例，例如
  `clears the previous lane session before auto-advancing into the next automation`
  和
  `does not let the previous lane cleanup timer delete the next lane automation`。
