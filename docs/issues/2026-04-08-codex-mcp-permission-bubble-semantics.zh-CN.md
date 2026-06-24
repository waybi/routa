---
title: "Codex MCP 审批请求被渲染为通用命令权限卡片，而非基于选项的 MCP 审批"
date: "2026-04-08"
status: resolved
severity: medium
area: ui
tags: ["acp", "codex", "mcp", "permission", "ui", "kanban"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/401"]
github_issue: 401
github_state: closed
github_url: "https://github.com/phodal/routa/issues/401"
resolved_at: "2026-04-08"
resolution: "在确认 GitHub #401 已关闭、且权限气泡现已渲染基于 MCP 选项的审批后，于 issue 卫生整理期间同步。"
---

# Codex MCP 审批请求被渲染为通用命令权限卡片，而非基于选项的 MCP 审批

## 发生了什么

Codex MCP 审批请求当前通过通用的 `PermissionRequestBubble` 流程展示。

观察到的载荷结构：

- `toolCall.title = "Approve MCP tool call"`
- `toolCall.rawInput.server_name = "routa-coordination"`
- `toolCall.rawInput.request._meta.codex_approval_kind = "mcp_tool_call"`
- `options = ["approved", "approved-for-session", "approved-always", "cancel"]`

UI 仍然将其渲染为命令前缀类权限：

- 通用标题以及偏重原因（reason）的布局
- 作用域选择器加上 allow/deny 按钮
- 过大的技术细节区块
- 没有对 MCP 服务端、工具名称、工具描述或格式化参数进行一等公民式的渲染
- 无法直接选择明确的 `approved-always` 选项

## 期望行为

- 直接依据 `options[]` 契约渲染 MCP 审批请求
- 将 MCP 服务端和工具标识作为主标题展示
- 紧凑地展示工具描述和格式化后的参数
- 将每个明确的选项渲染为独立的操作按钮
- 避免用执行权限（exec-permission）作用域选择器 UI 来过度承载 MCP 审批

## 为什么会发生

`PermissionRequestBubble` 假定所有 ACP 权限请求都是同一内部模型的变体：

- approve 与 deny
- turn 与 session
- 可选的执行策略（exec-policy）修订细节

这一假定对命令执行审批成立，但对 Codex MCP 征询（elicitation）审批不成立——后者已由 `codex-acp` 归一化为一个离散的选项列表。

## 相关文件

- `src/client/components/message-bubble.tsx`
- `src/client/components/__tests__/message-bubble-permissions.test.tsx`
- `/Users/phodal/ai/codex-acp/src/thread.rs`

## 备注

- 本 issue 与尚未解决的 `failed to deserialize response` ACP bug 是相互独立的两个问题。
- 即使后端流程成功，当前 UI 仍然错误地呈现了 Codex 所发送的审批语义。

## 后续解决方向

UI 应当收敛到一种双状态模式，而不是把每个权限请求都渲染为一张大卡片：

- `waiting`：完整的可交互审批卡片，带有明确的选项按钮以及关键的 MCP/工具细节
- `completed` / `failed`：紧凑的单行摘要行，保留决策结果，并支持点击展开细节以便调试

这样既能保持会话记录（transcript）易于扫读，又仍可在需要时检视：

- MCP 服务端和工具标识
- 执行类审批的命令 / 原因
- 格式化后的参数细节
- 需要时查看原始请求的权限载荷

## Issue 卫生

- 2026-04-28：在确认 GitHub issue `#401` 已关闭、且 `PermissionRequestBubble` 已依据 `options[]` 契约渲染 MCP 审批元数据及明确的选项按钮后，标记为已解决。
