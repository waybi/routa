---
date: 2026-03-16
title: 看板工作区事件刷新缺口
status: resolved
area: kanban
labels: [bug, kanban, realtime, sse, architecture]
---

# 看板工作区事件刷新缺口

## 问题

在 `http://localhost:3000/workspace/default/kanban` 上，当某个 ACP Provider 或 Agent 调用诸如 `move_card` 之类的看板工具后，卡片状态无法可靠地刷新。

当前页面仅通过以下两种方式刷新：

1. 页面初次加载或显式调用 `onRefresh()`
2. 看板 Agent 输入框启动一个会话后的一段短时突发计时器

当卡片变更发生得较晚、来自不同的会话，或者用户已经关闭了详情/会话面板时，这就会留下一个缺口。即便 Store 已经更新，看板也可能保持陈旧状态，直到手动重新加载。

## 成因

- 看板 UI 通过 REST 获取看板/任务/会话，并将其存储在本地 React 状态中。
- ACP 会话更新仅限于单个会话的 SSE 流，并未覆盖工作区级别的看板状态。
- 后端已经具备 `EventBus`，并且看板自动化会发出诸如 `COLUMN_TRANSITION` 之类的领域事件，但浏览器看板页面并未订阅工作区范围的事件流。
- 这违背了 `README.md` 和 `docs/ARCHITECTURE.md` 中描述的架构，那里将 `Store + EventBus -> UI Update (SSE)` 作为首选的实时路径。

## 期望的架构

使用一个工作区范围的看板 SSE 通道，复刻 Notes 的实时模式：

1. 后端变更和看板工作流事件发布一个轻量级的看板 UI 事件
2. 一个广播器将该事件扇出给该工作区的所有浏览器订阅者
3. 看板页面在工作区范围内订阅一次，并触发一段短时刷新突发

这样可使 UI 与现有的 Routa 架构保持一致：

`Store + EventBus -> UI Update (SSE)`

## 拟议范围

- 在 core 中新增一个 `KanbanEventBroadcaster` 单例
- 新增 `GET /api/kanban/events?workspaceId=...` SSE 端点
- 在以下场景广播看板工作区变更事件：
  - 看板工具变更（`create_card`、`move_card`、`update_card`、`delete_card`，以及看板/列变更）
  - 绕过看板工具的 REST 任务/看板变更
- 新增一个客户端看板事件 hook，按工作区订阅一次
- 在每个事件上触发一段有界的刷新突发，以便也能观察到异步队列/会话的副作用

## 非目标

- 不通过 SSE 流式传输完整的看板状态
- 不将看板页面的新鲜度绑定到某一个 ACP 会话流
- 不将后台轮询作为主要修复手段

## 预期结果

- 即使相关的 ACP 面板已关闭，看板页面也能在 Agent 工具调用后不久完成更新
- 同一工作区中的多个浏览器标签页保持同步
- 实时行为遵循 Notes 已经采用的相同架构风格

## 解决方案

- 日期：2026-03-26
- 状态：已解决
- 备注：
  - `src/core/kanban/kanban-event-broadcaster.ts` 现在提供工作区范围的 SSE 广播，并带有 `kanban:changed`。
  - `src/app/api/kanban/events/route.ts` 将客户端订阅到广播器流，并保留实时连接语义。
  - `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx` 挂载了 `useKanbanEvents`，用于在工作区事件上触发刷新失效。
  - `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx` 具备显式的会话/任务刷新突发与回填同步处理。
  - `src/client/hooks/use-kanban-events.ts` 同时消费初始的 `connected` 和 `kanban:changed` 事件类型以进行刷新。
