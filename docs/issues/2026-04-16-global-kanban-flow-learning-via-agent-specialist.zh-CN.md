---
title: "全局看板流学习应由 Agent 驱动并产出可执行的指导建议"
date: "2026-04-16"
kind: issue
status: resolved
resolved_at: "2026-04-20"
severity: medium
area: kanban
tags:
  - kanban
  - agent
  - specialist
  - trace-learning
  - observability
  - flow-analysis
reported_by: "codex"
related_issues:
  - "docs/issues/2026-03-19-kanban-flow-observability-and-control-gaps.md"
  - "https://github.com/phodal/routa/issues/294"
  - "https://github.com/phodal/routa/issues/466"
github_issue: 466
github_state: closed
github_url: "https://github.com/phodal/routa/issues/466"
---

# 全局看板流学习应由 Agent 驱动并产出可执行的指导建议

## 发生了什么

Routa 已经为看板任务记录了泳道维度（lane-scoped）的执行历史，包括：

- 带有泳道、尝试次数、恢复（recovery）和状态元数据的 `laneSessions`
- 相邻工作流运行之间的 `laneHandoffs`
- 诸如 `review -> dev` 之类的评审裁决收敛（review verdict convergence）
- 移动阻断（move-block）评论和契约门（contract-gate）失败说明
- 来自编排（orchestration）和护栏（guardrails）的 `lastSyncError` 消息

然而，产品仍然无法回答诸如此类的全局工作流问题：

- 为什么卡片频繁在 `backlog` 和 `todo` 之间来回反弹
- 为什么工作反复在 `dev` 和 `review` 之间循环
- 哪些流转反模式（flow anti-patterns）是系统性的，哪些是孤立的
- 在进入高风险泳道之前，下一个 Agent 应该收到什么建议

当前的 Trace 学习能力以 Harness 演进 playbook 为中心，而非看板工作流行为。

## 期望行为

Routa 应该能够在看板/工作区/全局层级分析看板流历史，识别重复出现的流转模式，并让一个 AI specialist 产出可执行的指导建议，例如：

- 针对反复出现的泳道反弹模式的可能根因类别
- 推荐的策略或看板变更
- 针对高风险泳道的 specialist prompt 调整
- 针对未来卡片运行的预警和预检（preflight）指导

学习产出的结果不应仅限于仪表盘或原始指标。它应当能够被另一个 Agent 作为结构化建议来消费。

## 复现上下文

- 环境：两端均涉及
- 触发条件：在审阅看板泳道历史和现有的 Trace 学习方向时发现，当前的学习被限定在 Harness 演进上，而非全局看板流行为

## 为何可能发生

- 看板当前持久化了泳道/会话历史，但没有一个一等公民（first-class）的、带有规范化原因码（normalized reason codes）的全局流转事件账本（flow event ledger）。
- 现有的失败证据分散在 `laneSessions`、`laneHandoffs`、`verificationVerdict`、任务评论和 `lastSyncError` 之间，这使得可靠地自动化更高层级的分析变得困难。
- 当前的 Trace 学习是任务类型专属的，且聚焦于 `harness_evolution`，因此 playbook 流水线尚未将看板工作流视为一个可学习的对象。
- 没有一个专门的 specialist 来聚合看板层级的流转历史，并将其转化为面向运维人员或下游 Agent 的建议。

## 相关文件

- `src/core/models/task.ts`
- `src/core/kanban/task-lane-history.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/review-lane-convergence.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/core/tools/kanban-tools.ts`
- `docs/issues/2026-03-19-kanban-flow-observability-and-control-gaps.md`
- `docs/features/harness-trace-learning.md`
- `crates/routa-cli/src/commands/harness/engineering/learning.rs`

## 观察

- `TaskLaneSession` 已经捕获了泳道级别的运行元数据，例如 `columnId`、`attempt`、`loopMode`、`completionRequirement` 和 `recoveryReason`。
- `workflow-orchestrator.ts` 已经能检测重复的非 dev 泳道循环并记录恢复/失败消息，但这些信号尚未被提升为可复用的诊断层。
- 任务评论已经持久化了移动阻断和契约门说明，但它们是纯文本，而非结构化的流转原因。
- 当前的 Trace 学习流水线为 `harness_evolution` 存储和加载 playbook，这展示了学习模式，但尚未应用于看板流分析。

## 参考

- 候选父 issue：`phodal/routa#294`
- 本地追踪记录：`docs/issues/2026-03-19-kanban-flow-observability-and-control-gaps.md`

## 解决更新（2026-04-21）

- 将本地追踪记录同步至已关闭的 GitHub issue `#466`。
- 记录上游解决日期为 `2026-04-20`；除状态清理外，此追踪记录无需进一步的本地实现。
