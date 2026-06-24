---
title: "看板页面首次打开时触发初始刷新风暴"
date: "2026-03-19"
status: resolved
severity: high
area: "kanban"
tags: [kanban, refresh, sse, performance, ui]
reported_by: "Codex"
related_issues: [
  "docs/issues/2026-03-16-kanban-workspace-events-refresh-gap.md",
  "docs/issues/2026-03-19-kanban-card-detail-session-state-stalls.md"
]
resolution_status: "fixed locally"
---

# 看板页面首次打开时触发初始刷新风暴

## 发生了什么

打开 `http://localhost:3000/workspace/default/kanban` 时，甚至在用户与页面发生任何交互之前，就可能立即触发一连串重复的 API 请求。

本地复现观察到的请求模式：

1. 初始页面加载会拉取看板（boards）、任务、会话、specialists、工作区和 codebases。
2. 随后页面立即发出一个 `PATCH /api/kanban/boards/{boardId}`，即便用户并未更改任何看板设置。
3. 该看板更新触发了一条工作区失效（invalidation）路径，从而再次刷新看板数据。
4. 该失效路径还安排了额外的延迟刷新，使得重复的 `GET /api/kanban/boards`、`GET /api/tasks`、`GET /api/sessions` 和 `GET /api/workspaces/{workspaceId}/codebases` 请求数量成倍增加。

## 预期行为

- 打开看板页面应执行一次有界的初始数据加载。
- 只有在用户显式更改看板设置时才应持久化这些设置。
- 工作区失效应避免为单次初始加载的变更堆叠多次全量刷新风暴。

## 复现上下文

- 环境：本地 Next.js 开发服务器
- URL：`http://localhost:3000/workspace/default/kanban`
- 触发方式：打开页面并等待，不进行任何交互

## 为什么会发生

三条刷新路径相互叠加：

1. `kanban-tab.tsx` 在 hydration 之后自动将 `specialistLanguage` 持久化回看板，导致一次非用户主动触发的看板 `PATCH`。
2. `kanban-page-client.tsx` 将看板失效处理为一次立即刷新外加一连串安排好的刷新风暴。
3. 初始仓库自动同步路径最后又执行了一次整页刷新，而非更窄范围的 codebase 刷新。

## 相关文件

- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-agent-input.ts`
- `src/client/hooks/use-kanban-events.ts`

## 解决说明

2026-03-19 应用的本地修复对刷新行为做了如下更改：

1. 移除了 hydration 时对 `specialistLanguage` 的自动持久化；看板持久化现在仅在显式更改语言时发生。
2. 将看板 SSE 失效处理从风暴式刷新行为收敛为针对该页面路径的单次刷新。
3. 将仓库自动同步的后续工作收窄为仅刷新 codebases，而不再重新加载所有看板集合。

## 验证

- 修复后在本地开发环境打开 `/workspace/default/kanban`。
- 确认首次打开时不再立即触发看板 `PATCH`。
- 运行：
  - `npm run lint -- 'src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx' 'src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx'`
  - `npm run test:run -- 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-agent-input.test.ts' 'src/client/hooks/__tests__/use-kanban-events.test.tsx'`
