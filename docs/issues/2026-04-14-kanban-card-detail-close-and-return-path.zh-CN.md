---
title: "看板卡片详情缺少明确的关闭操作与稳定的返回路径"
date: "2026-04-14"
status: resolved
resolved_at: "2026-04-14"
severity: medium
area: "kanban"
tags: [kanban, card-detail, navigation, url-state, ui]
reported_by: "xpsuper"
github_issue: 445
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/445"
related_issues: [
  "docs/issues/2026-04-08-kanban-detail-information-architecture-and-session-pane-friction.md"
]
---

# 看板卡片详情缺少明确的关闭操作与稳定的返回路径

## 发生了什么

打开看板卡片详情时，用户可能被困在详情浮层内：

1. 详情头部没有明确的关闭操作。
2. 关闭主要依赖 `Escape` 键，这种方式不易被发现且容易被忽略。
3. 当前卡片详情状态仅为本地 UI 状态，因此浏览器的前进/后退无法可靠地映射到“返回看板”。
4. 看板选择与任务详情状态无法一起被深链接（deep-link）。

## 预期行为

- 卡片详情应提供一个可见的关闭操作。
- 返回看板应能通过常规的浏览器历史语义实现。
- 深链接应能同时恢复所选看板与所选任务。

## 复现环境

- 环境：Web 端 / 桌面端
- 触发方式：打开 `workspace/.../kanban`，打开某张卡片详情，然后尝试在不依赖纯键盘快捷键的情况下返回看板列表

## 为什么会发生

- 关闭行为仅作为 `kanban-tab.tsx` 中父组件的状态重置存在。
- 详情头部没有接收明确的 `onClose` 交互入口。
- `activeTaskId` / `selectedBoardId` 仅在本地管理，未反映到 URL 状态中。

## 相关文件

- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab-panels.tsx`
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx`
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-url-state.test.tsx`

## 解决方案

该问题已在当前代码库中解决。

已实施的改动：

- 在卡片详情头部新增了明确的 `Close card detail` 操作。
- 将卡片详情的可见性与 URL 查询字符串中的 `taskId` 同步。
- 将看板选择与 URL 查询字符串中的 `boardId` 同步。
- 从诸如 `?boardId=...&taskId=...` 的深链接中恢复看板/任务详情状态。
- 确保在切换看板时，若当前活动卡片属于另一块看板，则清除任务详情。

## 验证

- `npx vitest run 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx'`
- `npx vitest run 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-url-state.test.tsx'`

## 同步说明

- 已推送到 `main` 的修复提交：
  - `46c5c610 fix(kanban): add explicit card detail close action (#445)`
  - `1713fbf9 fix(kanban): sync card detail with task url state (#445)`
  - `002305a5 fix(kanban): sync board selection with url state (#445)`
  - `b3300252 fix(kanban): correct url state helper typing (#445)`
