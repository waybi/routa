---
title: "看板名额满时列内下一步被记失败、排队条目被删成孤儿，重新运行覆盖新 lane 记录且停在第一步"
date: "2026-10-23"
kind: issue
status: resolved
severity: high
area: "kanban"
tags:
  - kanban-session-queue
  - workflow-orchestrator
  - retry-trigger
  - lane-automation
reported_by: "dsh"
related_issues:
  - "2026-09-20-kanban-design-retrospective-topbi-run.md"
github_issue: null
github_state: null
github_url: null
---

# 看板名额满时列内下一步被记失败，重新运行救不回来

## What Happened

- 2026-10-23 13:01，卡 1e7dd356 的 Todo 第一步正常结束，第二步没起来，卡上报 `ACP session did not complete successfully.`，之后 17 分钟没动；13:05 才建的卡 c908dc70 反而正常排上。当时看板并发上限 5，正好占满。
- 同批卡 7a25276b、6ad2df9d 同样卡住；`POST /api/kanban/boards/{id}/revive` 两次都没拉起，队列快照 `queued=[]`。
- 13:20 对 1e7dd356 点「重新运行」：`trigger_session_id` 变成 406b91a7，但 `lane_sessions` 里没有这条，看板卡片仍显示上次失败；406b91a7 跑完第一步后第二步没有启动。
- 卡 25afcd82 重跑 Done 后推送员跑完，完成汇报员没跑。

## Expected Behavior

名额满时卡显示排队中，名额空出后下一步自动启动并继续推进；重新运行后卡片显示新运行，并跑完列内剩下的步骤。

## Reproduction Context

- Environment: web（pm2 routa-prod）
- Trigger: 列内多步骤（Todo / Review / Done）的卡在看板名额满时走到下一步；或对这类卡点「重新运行」。

## Why This Might Happen

- `createAutomationSession` 把队列返回的 `{queued:true}` 丢成 `null`，`startNextAutomationStep` 把它当失败，`handleAgentCompletion` 写兜底报错。
- `drainQueue` 在 `await start()` 前拿了队列数组，收尾时用它覆盖 map，删掉等待期间新入队的条目；条目留在 `jobsByCardId` 成为 queued 孤儿，之后 `enqueue` 一律回「已排队」。
- PATCH retryTrigger 用请求开头复制的旧卡整卡保存，覆盖了 `startKanbanTaskSession` 刚写入的新 lane 记录。
- retryTrigger 不带步骤，总从第一步重来；编排器对这张卡的自动化已是 failed，不接手这次运行。

## Resolution

四个问题按问题分提交修复，详见 `docs/learning/02-kanban-automation-deep-dive.zh-CN.md` 第 3 节、5b、5c 与变更记录。队列仍只在内存里，Routa 重启会清空（未改）。

## Relevant Files

- `src/core/kanban/kanban-session-queue.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/core/kanban/lane-automation-state.ts`
- `src/app/api/tasks/[taskId]/route.ts`
