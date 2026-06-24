---
title: "Dev 泳道的 ACP 会话可能在没有 watchdog 检测或自动恢复的情况下静默进入空闲或失败状态"
date: "2026-03-17"
status: resolved
severity: high
area: "acp"
tags: ["acp", "kanban", "dev-lane", "watchdog", "session", "recovery", "agent", "ralph-loop"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-03-13-gh-137-implement-automatic-agent-lifecycle-notifications-permission-delegation.md"
  - "docs/issues/2026-03-14-gh-148-feat-add-session-queueing-and-concurrency-limits-for-kanban-acp-automati.md"
  - "docs/issues/2026-03-14-kanban-story-lane-automation-stalls-after-first-session.md"
  - "https://github.com/phodal/routa/issues/185"
github_issue: 190
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/190"
---

# Dev 泳道的 ACP 会话可能在没有 watchdog 检测或自动恢复的情况下静默进入空闲或失败状态

## 发生了什么

当一个 story 进入 `dev` 泳道并为实现工作启动一个 ACP 会话时，该会话可能会变为不活跃、断开连接或失败，而系统层面却没有明确的响应。在这种状态下，story 看起来仍然停留在进行中，但没有可靠的机制能够检测到 Agent 在某个超时窗口（例如 10 分钟）之后已经停止推进进度。

当前的工作流在"会话已创建"和"会话仍然健康且在推进"之间留下了一个空档。如果 ACP Provider 断开连接、worker 崩溃，或者会话在没有被工作流协调器处理的情况下进入失败的终止状态，那么这条泳道实际上就会陷入停滞。

## 预期行为

当一个 `dev` 泳道的 ACP 会话不再活跃，或者在配置的时间内没有推进进度时，Routa 应该能够检测到该状态并明确地将其暴露出来。

预期结果：

- 一个不活跃时间超过可配置阈值的会话，应被标记为可疑、空闲、超时或失败，而不是静默地保持"运行中"。
- 应有一个 watcher 能够观察会话健康状况，而不仅仅是会话的创建。
- 工作流层应能够决定是发出告警、重试、重新入队，还是创建一个替代的 Agent/会话。
- 恢复时应保留原始的任务目标和完成标准，而不是盲目地重启。

## 复现上下文

- 环境：web / kanban 自动化
- 触发条件：一个 story 进入 `dev`，ACP 会话启动，然后 Provider 会话断开、挂起，或在较长一段时间内停止产生进度/事件

## 为什么可能发生

- 会话生命周期跟踪似乎更侧重于开始/结束事件，而不是执行期间"缺乏进度推进"的情况。
- 当前的自动化模型可能没有一个专门的 watchdog，用于检查活跃 ACP 会话的心跳、事件新鲜度或最后活动时间戳。
- 当会话在执行中途消失时，恢复行为并不明确：系统可能知道如何启动一个 Agent，却不知道如何对其进行持续监督。
- 现有的协调原语可能依赖于 worker 的显式上报，这意味着一个死掉或断开的 worker 可能会静默失败。
- 可能缺少一个类似 Ralph Loop 的可复用循环机制：一个停止/退出拦截层，能够在 Agent 过早停止时重新注入原始任务和完成标准。

## 相关文件

- `src/core/acp/`
- `src/core/acp/http-session-store.ts`
- `src/core/acp/agent-event-bridge/agent-event-bridge.ts`
- `src/core/events/event-bus.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/kanban-session-queue.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/app/api/tasks/route.ts`

## 观察

- 所需的机制更接近于监督（supervision），而不是简单的排队。
- 超时阈值很可能需要可配置，例如 10 分钟无活动，而不是硬编码。
- 当前的代码上下文显示，生命周期信息产生的位置与 Kanban 自动化等待该信息的位置之间存在不匹配：
  - `KanbanWorkflowOrchestrator` 在全局 `EventBus` 上监听 `AGENT_COMPLETED`、`REPORT_SUBMITTED`、`AGENT_FAILED` 和 `AGENT_TIMEOUT`。
  - `HttpSessionStore` 已经接收规范化的 Provider 更新，并按会话发出语义化的工作区事件。
  - 会话监督似乎仍然面向开始/结束语义，而不是"N 分钟内没有进度推进"。
- 代码库中已经有跟踪进度新鲜度的先例：
  - `HttpSessionStore.pushNotification(...)` 是更新 `lastActivity` 或心跳式元数据的天然位置。
  - 后台任务笔记中已经讨论了 `lastActivity`、`currentActivity` 以及基于工具调用的进度跟踪。
- 该问题应被定位为一个执行循环（execution-loop）的设计问题，而不仅仅是一个超时标志。

## 设计原则

基于 Ralph Loop 文章和当前的 Routa 架构，该设计应保留以下原则：

- 监督必须是外部的且确定性的。不应信任 worker 能够可靠地自我上报完成或失败。
- 进度状态应被外部化为持久化的元数据，例如 `lastActivityAt`、`lastMeaningfulEventAt`、重试次数、停止原因和恢复策略。
- 完成必须是机器可验证的。系统应区分`会话已停止`与`工作确实满足了完成条件`。
- 恢复循环必须是有界的。任何重试 / 重建策略都需要最大迭代次数或重试预算。
- 该设计应将以下几方面分离：
  - 存活性检测（liveness detection）
  - 完成验证（completion verification）
  - 恢复策略（recovery policy）
  - 泳道/工作流转换（lane/workflow transition）

## 设计选项

### 选项 A：仅被动 Watchdog

围绕 ACP 会话添加一个轻量的不活跃 watcher：

- 每当一个规范化的 ACP 更新到达时记录 `lastActivityAt`
- 周期性地扫描活跃的 `dev` 泳道会话
- 如果在配置的阈值（例如 10 分钟）内未见任何活动，则将会话标记为 `idle`、`timed_out` 或 `unhealthy`
- 通知工作流/UI，但不自动恢复

优点：

- 实现风险最低
- 易于引入，无需改变 Agent 语义
- 让运维人员能够看到静默停滞

缺点：

- 只检测，不恢复
- 运维人员仍需自行决定下一步怎么做
- 无法解决"会话在满足完成标准前就退出"的问题

### 选项 B：Watchdog + 基于策略的自动恢复

在选项 A 的基础上扩展有界的恢复规则：

- 在不活跃/失败时，执行策略：
  - 仅通知
  - 将当前会话重试一次
  - 重新入队泳道工作
  - 从原始的泳道提示词创建一个新的 ACP 会话
- 按 story 泳道持久化重试次数 / 恢复尝试次数
- 要求设置最大重试预算和冷却窗口

优点：

- 与当前 Routa 架构务实契合
- 显著改善无人值守的 Kanban 流程
- 可复用现有的会话创建路径

缺点：

- 如果完成检查较弱，可能导致重复工作
- 仍可能从一个糟糕的提示词或损坏的本地状态重启
- 需要在 story/泳道层面制定幂等性规则

### 选项 C：Ralph-Lite 监督循环

将泳道自动化视为一个有界的外部执行循环：

- 明确定义泳道目标和完成条件
- 将循环状态持久化在 Agent 会话之外
- 当一个会话停止时，监督者评估：
  - 已完成
  - 终止失败
  - 在未满足完成标准的情况下停止
- 如果发生第三种情况，则携带原始任务、当前外部状态和有界的迭代次数，生成一个全新的 Agent/会话

这更直接地遵循了 Ralph Loop 的理念：

- 不信任上下文会无限累积
- 循环由外部状态和机器检查驱动
- 停止由监督者策略拦截，而不是由 Agent 自我判断

优点：

- 比临时性重试有更强的概念模型
- 更适合不稳定/断连的会话场景
- 减少对长生命周期的会话内记忆的依赖

缺点：

- 需要为每条泳道明确完成标准
- 需要新增持久化的循环元数据
- 比简单的 watchdog 更具侵入性

### 选项 D：Actor-Critic 恢复循环

在选项 C 的基础上构建，并在自动推进或重启之前增加一个验证/评审阶段：

- Actor 会话尝试实现
- Critic/reviewer 会话或验证器检查泳道完成条件是否真正满足
- 只有满足时才将泳道标记为完成；否则修订/重试/重建

优点：

- 对误报（false positive）的防护最强
- 与文章中跨模型评审 / 确定性验证的方向一致
- 减少会话"完成"但工作实际未完成的情况

缺点：

- 复杂度和成本最高
- 作为当前 bug 的第一步可能过度设计
- 依赖清晰的评审标准和额外的编排

## 推荐路径

推荐采用分阶段推进，而不是选定单一的一步到位设计：

1. 首先实现选项 A，作为最小可观测性基线。
2. 增加选项 B，作为 `dev` 泳道自动化的首个生产恢复策略。
3. 如果无人值守的自主流程是核心产品目标，则朝选项 C 设计为持久架构。
4. 待完成标准和 reviewer 语义稳定后，将选项 D 作为后续演进保留。

这为 Routa 提供了多条可行路径：

- 短期：检测停滞的会话
- 中期：安全地自动恢复停滞的会话
- 长期：采用有界的 Ralph 风格外部循环架构

## 待解决问题

- 什么算作"活动"：任何 Provider 事件、token 输出、工具调用、计划更新，还是只算有意义的进度事件？
- watchdog 元数据应持久化在 `HttpSessionStore`、任务泳道历史，还是一个专门的泳道执行记录中？
- 恢复应以 `session`、`lane` 还是 `story` 作为主要单元来运作？
- 我们如何在瞬时断连之后防止出现重复的 dev 会话？
- 应由什么完成条件来把关自动重建：
  - Agent 轮次完成
  - 显式上报
  - 检测到文件变更
  - 测试通过
  - reviewer 批准
- 第一个版本应该只支持 `dev`，还是支持所有自动化泳道？

## 参考资料

- Ralph Loop 概念，来自 2026-03-17 的用户报告
- 本地文章：`/Users/phodal/Downloads/Understanding Agent Execution Loops.md`
- GitHub issue：`phodal/routa#185`
- 相关 GitHub issue：`#137` 生命周期通知与协调器感知
- 相关 GitHub issue：`#148` 会话排队与并发限制

## 实现更新（2026-03-18）

- 在共享的 board 元数据中添加/确认了监督模式和重试配置：
  - `mode`：`disabled | watchdog_retry | ralph_loop`
  - `inactivityTimeoutMinutes`
  - `maxRecoveryAttempts`
  - `completionRequirement`（由 Ralph Loop 使用）
- 在工作流协调器中实现了有界的恢复触发流程：
  - `scanForInactiveSessions()` 扫描运行中的 dev 自动化以检测超时/错误，
  发出 `AGENT_TIMEOUT`/`AGENT_FAILED`，并将会话标记为终止状态。
  - `handleAgentCompletion()` 分支为：
    - 非循环模式下的直接失败/完成行为，
    - `watchdog_retry` 和 `ralph_loop` 下的有界重试行为。
  - `recoverAutomation()` 创建一个全新的 ACP 会话，并在任务历史中保留尝试元数据。
- 添加了一个有针对性的 watchdog 消息提示词：
  - `hi，这里有一个 Agent（acp session id = ...）很久没动了，你看看怎么回事，要不要继续？`
  - 在可重试的模式下，在有界恢复之前通过 `send_prompt` 发送。
- 为缺失/陈旧的会话元数据添加了行为：
  - 如果源会话记录缺失或已处于错误状态，则跳过用户提示并继续恢复路径。
- 扩展了 watchdog 重试/重跑的信号路径：
  - `workflow-orchestrator-singleton` 现在会首先尝试通过 `read_agent_conversation` + `send_message_to_agent` 将恢复提示词投递给活跃 ACP 会话的 Routa Agent。
  - 当 Agent 消息传递不可用或失败时，同一负载会通过 `session/prompt` 作为回退重新使用。
- 添加/更新了测试：
  - `src/core/kanban/__tests__/workflow-orchestrator.test.ts`
  - `src/core/kanban/__tests__/board-session-supervision.test.ts`

## 验证更新（2026-03-18）

- 重新运行了有针对性的协调器覆盖测试：
  - `npm run test -- src/core/kanban/__tests__/workflow-orchestrator.test.ts src/core/kanban/__tests__/workflow-orchestrator-singleton.test.ts`
  - 结果：9/9 测试通过
- 对改动涉及的编排文件和测试重新运行了 lint：
  - `npm run lint -- src/core/kanban/workflow-orchestrator.ts src/core/kanban/workflow-orchestrator-singleton.ts src/core/kanban/__tests__/workflow-orchestrator.test.ts src/core/kanban/__tests__/workflow-orchestrator-singleton.test.ts`
  - 结果：通过
- 验证了实时的 dev board 仍在 UI 中暴露此前的 watchdog 恢复证据：
  - `/workspace/default/kanban` 当前显示与 watchdog 相关的卡片，其最新状态包含
    `Dev automation recovered after session inactive too long. Attempt 2/2.`
- 为实时的 watchdog 恢复流程捕获了手动 UI 证据：
  - `docs/issues/assets/2026-03-18-watchdog-e2e/01-kanban-watchdog-board.png`
  - `docs/issues/assets/2026-03-18-watchdog-e2e/02-traces-session-list.png`
  - `docs/issues/assets/2026-03-18-watchdog-e2e/03-watchdog-session-detail.png`
- 基于当前的代码、测试和实时 board 状态，该问题作为一条未处理的静默停滞路径已不再可复现。
