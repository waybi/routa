---
title: "看板会话历史仍缺少持久的泳道元数据"
date: "2026-03-15"
status: "resolved"
resolved_at: "2026-04-03"
area: kanban
labels: ["Agent", "Kanban", "UX"]
---

## 发生了什么

卡片详情可以再次显示历史会话 ID，但底层的任务数据仍然以扁平的 `sessionIds` 数组形式存储会话历史。

这意味着 UI 能够展示按时间排序的运行记录，但在更复杂的流程中，它并不总能为每一次历史会话重建出确切的泳道、专家或转换原因，例如：
- 卡片在 `dev` 和 `review` 之间来回移动
- 卡片进入 `blocked` 之后又恢复
- 在同一泳道内手动重新运行

## 为什么会发生

当前的任务模型追踪：
- `triggerSessionId`：当前活跃运行
- `sessionIds`：关联会话的有序历史

它**没有**持久化更丰富的每次运行的元数据，例如：
- 触发时所处的泳道 / 列
- Provider / 专家快照
- 独立于 ACP 会话拉取是否成功的运行时间戳
- 转换原因（进入自动化、重新运行、手动移动、从 blocked 恢复）

因此，UI 只能从当前看板顺序推断泳道历史，这在理想路径下能够工作，但对于非线性工作流并不具备权威性。

## 解决方案

该问题在当前代码库中已解决。原始报告现在已属于历史遗留、不再准确：任务历史不再局限于扁平的 `sessionIds` 数组。

当前实现中的证据：

- `src/core/models/task.ts` 现在在 `sessionIds` 之外还持久化了 `laneSessions` 和
  `laneHandoffs`。
- `src/core/kanban/task-lane-history.ts` 提供了持久化辅助方法，用于 upsert 泳道
  会话记录、标记完成状态，以及追踪泳道交接请求。
- `src/core/db/schema.ts` 和 `src/core/db/sqlite-schema.ts` 在 Postgres 和基于
  SQLite 的存储中都持久化了 `laneSessions` / `laneHandoffs`。
- `src/core/kanban/session-kanban-context.ts` 及相关测试会消费这些更丰富的历史
  来重建特定泳道的上下文。
