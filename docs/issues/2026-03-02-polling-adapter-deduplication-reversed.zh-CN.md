---
title: "GitHub Polling Adapter 去重逻辑反了 —— 重复的 PENDING 任务挤满队列"
date: 2026-03-02
status: resolved
severity: high
area: polling / background-tasks
reported_by: copilot
github_issue: 23
github_state: closed
github_url: https://github.com/phodal/data-mesh-spike/issues/23
resolved_at: "2026-04-11"
fix_commit: "fix pollRepo() deduplication — break on lastEventId instead of skipping newer events"
---

## What Happened

`GET /api/background-tasks` 返回了 522 个任务，其中 **513 个为 PENDING** —— 全部带有 `triggerSource: "polling"`，在约 10 分钟的运行期间每隔约 30 秒创建一次。后台 worker（最多 2 个并发）无法消化队列；之后派发的合法手动任务被永久饿死。

## Why This Might Happen

`src/core/polling/github-polling-adapter.ts` 中的 `pollRepo()` 方法（约 185–220 行）以 `lastEventId` 作为哨兵，遍历 GitHub Events API 的结果（返回顺序为**最新优先**）：

```typescript
let foundLastEvent = !lastEventId; // true when no prior marker

for (const event of events) {
  if (event.id === lastEventId) { foundLastEvent = true; continue; }
  if (!foundLastEvent) continue;   // ← skips events NEWER than sentinel

  // reaches here only for events OLDER than lastEventId ← processed on every poll
  if (!result.newLastEventId) result.newLastEventId = event.id; // ← drifts back
  await this.processEvent(event, configs);
}
```

`if (!foundLastEvent) continue` 这个守卫会对哨兵**之前**的事件（即更新的那些）提前跳出，而处理哨兵**之后**的所有事件（更旧的那些）。其结果是：

- 每个轮询周期都会重放越来越旧的事件。
- `newLastEventId` 被设置为比上一个标记更旧的事件，因此去重窗口在历史中向后移动，而非向前推进。
- 每隔 30 秒触发一次：`N` 个新事件 → 处理 0 个（已见过），但 `M` 个旧事件 → 被重新处理。

`lastEventIds` 映射存于内存中（未持久化），因此服务器重启也会完全重置去重状态。

## Relevant Files

- `src/core/polling/github-polling-adapter.ts` —— `pollRepo()` 方法
- `src/app/api/polling/check/route.ts` —— 调用 `getPollingAdapter()` 和 `adapter.checkNow()`
- `src/core/background-worker/index.ts` —— `dispatchPending()` 使用 `listReadyToRun()`（FIFO，最多 2 个）
- `src/core/store/background-task-store.ts` —— `listPending()` / `listReadyToRun()`
