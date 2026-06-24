---
title: "Kanban 卡片详情会话面板在详情视图打开后 ACP 会话才出现时可能停滞"
date: "2026-03-19"
status: resolved
resolved_at: "2026-03-19"
severity: high
area: "kanban"
tags: [kanban, acp, session, ui, refresh, sse]
reported_by: "Codex"
github_state: null
github_url: null
related_issues: [
  "docs/issues/2026-03-12-kanban-column-automation-and-manual-issue-modal.md",
  "docs/issues/2026-03-14-kanban-story-lane-automation-stalls-after-first-session.md"
]
---

# Kanban 卡片详情会话面板在详情视图打开后 ACP 会话才出现时可能停滞

## 发生了什么

在使用看板卡片详情浮层时，如果在任务的 ACP 会话元数据尚未对前端完全可见之前就打开了卡片，右侧的 ACP 会话区域可能会卡在空白或陈旧状态。

当前 UI 中观察到的行为：

1. 卡片详情打开时，`task.triggerSessionId` 仍为空，或尚未反映到当前前端状态中。
2. 后端随后创建或持久化了 ACP 会话并更新了任务。
3. 看板详情浮层无法可靠地从空白会话面板切换到真实的会话面板。
4. 在某些运行中，任务其实已经完成且证据已存在，但详情面板仍显示陈旧的会话状态，直到用户手动离开并重新打开，或触发另一条刷新路径。

## 期望行为

- 如果卡片处于打开状态，且其 ACP 会话在不久后变得可用，详情浮层应自我修复并显示该会话，而无需用户关闭并重新打开卡片。
- 如果会话 id 已知，但完整的会话记录在当前会话列表中缺失，前端应直接拉取那一条会话，而不是等待未来的全量列表刷新。
- 详情视图应提供一个轻量的手动刷新控件，作为对用户可见的兜底手段。

## 复现环境

- 环境：工作区看板 UI 中的看板卡片详情浮层
- 触发条件：在 ACP 会话创建 / 任务持久化 / 会话列表刷新尚未收敛时打开卡片
- 证据：用户在聊天中提供的截图显示，一张处于阻塞-解决状态的卡片，其工作已经完成，而看板详情 / 会话状态却不一致

## 为什么可能发生

当前实现中有三个可能的成因：

1. `activeSessionId` 仅在卡片详情打开时初始化，当 `task.triggerSessionId` 稍后才出现时，不会被可靠地重新同步。
2. 详情面板仅从父级 `sessions` 集合渲染；当某个特定会话在该集合中缺失时，没有针对 `/api/sessions/[sessionId]` 的直接回填拉取。
3. 看板失效路径部分依赖于 SSE 语义，而该语义在 Next.js 路由和 Rust 路由之间并不等价。前端期望收到 `kanban:changed`，但 Rust 侧的 `/api/kanban/events` 目前仅发出 `connected` 加心跳注释。

## 相关文件

- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `src/client/hooks/use-kanban-events.ts`
- `src/app/api/sessions/[sessionId]/route.ts`
- `src/app/api/kanban/events/route.ts`
- `crates/routa-server/src/api/kanban.rs`

## 观察

- `openTaskDetail()` 仅在打开时一次性选择 `task.triggerSessionId` 或最近的历史会话。
- 详情渲染路径对 `sessionInfo` 和右侧活动会话都使用 `sessions.find(...)`。
- 没有针对性的拉取来按 id 回填缺失的活动会话记录。
- 当前的 `useKanbanEvents()` hook 在收到 `kanban:changed` 时失效，但 Rust 的 `/api/kanban/events` 路由目前并不发出该事件类型。

## 建议的修复方案

1. 在 `kanban-tab.tsx` 中增加活动卡片的会话同步：
   - 当当前打开的任务获得一个首选会话 id 时，如果用户仍停留在空白状态，自动填充 `activeSessionId`
   - 不要覆盖用户已选中且仍属于该任务的历史会话

2. 在 `kanban-tab.tsx` 中增加针对性的会话回填：
   - 如果活动会话 id 已知但在当前 sessions 数组中缺失，则拉取 `/api/sessions/[sessionId]`
   - 将拉取到的记录合并进本地的兜底会话映射中，以便 UI 可立即渲染

3. 为那些本应有自动化会话但尚未拥有会话的新打开卡片，增加一段短时的刷新爆发：
   - 这覆盖了任务更新、会话存储可见性与 UI 水合（hydration）之间的竞态

4. 在卡片详情 UI 中增加手动刷新按钮：
   - 即使自动路径漏掉了某次变更，也让用户能够显式恢复

## 解决方案

该问题在当前代码库中已解决。

当前实现中的证据：

- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx` 现在会让
  `activeSessionId` 与 `getPreferredTaskSessionId(activeTask)` 保持同步，
  但避免覆盖用户已选中且仍属于该卡片的历史会话。
- 同一文件维护了 `backfilledSessions`，并在首选活动会话已知但在当前会话列表中缺失时，
  执行针对 `/api/sessions/[sessionId]` 的有针对性拉取。
- 同一文件会为那些本应有自动化但仍处于空白会话状态的卡片触发
  `scheduleKanbanRefreshBurst(onRefresh)`，以覆盖任务 / 会话的收敛竞态。
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx` 现在在详情头部
  暴露了一个可见的 `Refresh` 按钮，作为手动恢复路径。
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx`
  包含一个聚焦的回归测试
  `recovers when the trigger session appears after the detail view is already open`，
  用于验证针对性的会话回填路径。

5. 之后，评估是否统一 Next.js 与 Rust 的看板 SSE 语义：
   - 让两个运行时都发出兼容的 `kanban:changed` 载荷
   - 让前端正确性独立于 SSE 投递，使 UI 在事件被延迟或缺失时不会停滞
