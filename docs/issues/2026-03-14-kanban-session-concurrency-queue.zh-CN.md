---
title: "看板自动化在无队列的情况下可能超出有限的 ACP Provider 容量"
date: "2026-03-14"
status: resolved
resolved_at: "2026-03-15"
severity: high
area: "kanban"
tags: ["kanban", "automation", "queue", "concurrency", "acp"]
reported_by: "codex"
github_issue: 148
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/148"
related_issues:
  - https://github.com/phodal/routa/issues/148
---

# 看板自动化在无队列的情况下可能超出有限的 ACP Provider 容量

## 发生了什么

看板卡片创建和列自动化可以立即启动 ACP 编码会话，而没有任何看板级别的并发控制。当多个卡片在很短的时间内被创建或自动推进时，Routa 可能会尝试启动超出所配置 Provider 容量所能处理的 ACP 会话数量。

## 预期行为

看板应当提供一个显式的排队机制和一个可配置的并发上限，使得任意时刻只运行有限数量的 ACP 会话，而额外的卡片则在队列中等待并在之后启动。

## 复现上下文

- 环境：Web 端
- 触发条件：在为某个有限 ACP Provider 启用了列自动化的情况下，创建或自动推进多个看板卡片

## 可能的原因

- 看板自动化目前直接从 `triggerAssignedTaskAgent` 创建会话，没有队列协调器。
- 看板设置提供了列自动化规则，但没有看板级别的会话并发上限，也没有针对卡片的排队/运行状态。

## 相关文件

- `src/core/kanban/agent-trigger.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/core/models/kanban.ts`
- `src/core/models/task.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`

## 观察

- 会话详情页已经为 CRAFTER 执行实现了本地任务队列处理，因此顺序派发已有先例。
- 看板自动化目前会按卡片跟踪活动的自动化，但不跟踪 Provider 容量或待处理的队列顺序。

## 参考

- 用户于 2026-03-14 提出的本地实现任务

## 解决方案

该问题在当前代码库中已解决。本地状态已在 2026-04-03 的 issue 整理（issue hygiene）期间更新，此前已确认排队与并发控制均已实现。

当前实现中的证据：

- `src/core/kanban/kanban-session-queue.ts` 强制实施了按看板的会话队列，
  跟踪排队和运行中的卡片，并在槽位重新空出时排空排队的工作。
- `src/core/kanban/workflow-orchestrator-singleton.ts` 将看板自动化通过
  `enqueueKanbanTaskSession(...)` 路由，而不是无限制地启动 ACP 会话。
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx` 在设置 UI 中
  暴露了看板级别的 `Session queue` 上限。
- `src/core/kanban/__tests__/kanban-session-queue.test.ts` 覆盖了饱和、
  排空以及陈旧排队卡片清理行为。
