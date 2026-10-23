---
title: "重启后 revive 起的列内下一步没交给编排器：跑完 lane 一直 running，再下一步不起"
date: "2026-10-23"
kind: issue
status: resolved
severity: high
area: "kanban"
tags:
  - restart-recovery
  - workflow-orchestrator
  - lane-automation
reported_by: "dsh"
related_issues:
  - "2026-10-23-kanban-queue-drops-lane-step-and-rerun-stalls.md"
  - "2026-10-23-acp-zombie-lanes-and-leaked-agent-processes.md"
github_issue: null
github_state: null
github_url: null
---

# 重启后 revive 起的列内下一步没人接管

## What Happened

- 2026-10-23 16:31 Routa 重启后，对两块看板 `POST /api/kanban/boards/{id}/revive`。
- 卡 25afcd82、e11cac2f、497ae435、730695da 的 Done Reporter（a1d9bffc、af7831a8、ae45c3c3、c780248d）16:32 已 turn_complete，汇报也写进了卡，但 lane 到 16:48 仍是 running；pm2 日志里这些会话只有建会话记录，没有完成处理。
- 卡 7a25276b 的 Flight Review Guard a53e3e2f 同样由这条路径拉起。
- 对照：同一时间 PATCH retryTrigger（走 resumeLane）拉起的 92744a50 High-Risk Reviewer 有编排器登记。

## Expected Behavior

revive 拉起的步骤结束后 lane 记 completed，列内还有步骤就自动起下一步，和列转移事件起的步骤一样。

## Why This Happened

`reviveMissingEntryAutomations` 在「本列上一步 completed/transitioned、还有下一步」时直接调 `enqueueKanbanTaskSession(step, stepIndex)`。编排器的 `adoptLaneRun` 只在 `resumeLane && !step` 分支里调用，所以这次运行不在 `activeAutomations` 里，`handleAgentCompletion` 匹配不到它的结束事件。

## Resolution

`enqueueKanbanTaskSession` 新增 `adoptLaneRun` 参数：起会话（或排队）后调用编排器 `adoptLaneRun`；排队的运行在队列拉起时按 triggerSessionId 接管。revive 的这条路径传 `adoptLaneRun: true`，重新运行（resumeLane）也改走同一参数。restart-recovery.ts 里其余两条起会话的路径（Review 收敛、无下一步）都走 `processKanbanColumnTransition`，本来就有编排器登记。测试：`src/core/kanban/__tests__/restart-recovery-adopt.test.ts`。设计说明见 `docs/learning/02-kanban-automation-deep-dive.zh-CN.md` 5d 节。

已经卡住的 lane（上面 5 张卡）不会因部署自动恢复，需另行处理。

## Relevant Files

- `src/core/kanban/restart-recovery.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/core/kanban/__tests__/restart-recovery-adopt.test.ts`
