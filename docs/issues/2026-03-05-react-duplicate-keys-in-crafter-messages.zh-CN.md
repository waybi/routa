---
title: "CRAFTER 消息中的 React 重复 key 问题"
date: 2026-03-05
status: resolved
severity: medium
area: frontend
reported_by: QoderAI
---

## What Happened

控制台中出现了 React 警告：
```
Encountered two children with the same key, `call_f7408eaaa5de48faa542fa38`. Keys should be unique so that components maintain their identity across updates. Non-unique keys may cause children to be duplicated and/or omitted — the behavior is unsupported and could change in a future version.
```

位置：`src/client/components/task-panel.tsx` 第 425 行

该错误发生在聊天历史视图中渲染 CRAFTER 消息气泡时。

## Why This Might Happen

该问题是由历史加载逻辑中生成了重复的消息 ID 引起的。在 `CraftersView` 组件中，当从 API 加载会话历史并将其转换为 `CrafterMessage` 对象时：

1. 消息的 ID 是使用 `crypto.randomUUID()` 创建的
2. 然而，当合并相同类型（assistant/thought）的连续消息时，会保留原始消息的 ID
3. 如果生成了相同的随机 UUID 模式，或者合并逻辑存在边界情况，这可能会导致 ID 重复
4. React 的 key 属性直接使用了 `msg.id`，从而引发了重复 key 警告

具体存在问题的代码位于历史加载的 useEffect 中（第 261-341 行），该处从会话历史构造消息。

## Relevant Files

- `src/client/components/task-panel.tsx`（第 261-341、424-426 行）
- `src/client/components/task-panel.tsx`（第 296-302、312-318、322-329 行）

## Solution Applied

通过为消息 ID 添加按角色区分的前缀来确保全局唯一性，从而修复了该问题：
- Assistant 消息：`assistant-${crypto.randomUUID()}`
- Thought 消息：`thought-${crypto.randomUUID()}`
- Tool 消息：`tool-${crypto.randomUUID()}`

这样可以确保即使 `crypto.randomUUID()` 以某种方式生成了相同的值，角色前缀也能使完整的 ID 保持唯一。
