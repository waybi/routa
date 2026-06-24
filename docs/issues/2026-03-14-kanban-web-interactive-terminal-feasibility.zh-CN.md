---
title: "看板 ACP 会话不支持浏览器内嵌的交互式终端控制"
date: "2026-03-14"
status: resolved
resolved_at: "2026-03-19"
severity: medium
area: "kanban"
tags: ["kanban", "acp", "terminal", "xterm", "web", "session-ui"]
reported_by: "codex"
github_issue: 156
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/156"
related_issues:
  - "docs/issues/2026-03-07-opencode-bridge-terminal-requests.md"
  - "docs/issues/2026-03-06-session-layout-and-sidebar-friction.md"
  - "https://github.com/phodal/routa/issues/156"
---

# 看板 ACP 会话不支持浏览器内嵌的交互式终端控制

## 发生了什么

`/workspace/[workspaceId]/kanban` 体验可以在看板 UI 内打开 ACP 会话，但会话区域仍然是一个以聊天为中心的面板。来自 ACP agent 操作的终端输出已经可以在 xterm.js 中渲染，但 Web 端 UI 并没有提供启用真正交互式终端、并从浏览器把键盘输入回传到正在运行的 shell 的方式。

## 期望行为

当 Provider 和运行时支持时，看板应当能够为 ACP 会话提供一个显式的浏览器侧交互式终端模式，使用户可以直接在同一个模态框/面板中检查或继续工作，而不必切换到单独的会话页面或仅限桌面端的 PTY 流程。

## 复现上下文

- 环境：Web 端
- 触发步骤：
  1. 打开 `/workspace/<workspaceId>/kanban`
  2. 从看板卡片或 KanbanTask Agent 面板启动或打开一个 ACP 会话
  3. 观察到会话 UI 内嵌了 `ChatPanel`
  4. 观察到终端渲染是只输出的，并且没有面向浏览器的 shell stdin 控制路径

## 为什么可能发生

- 看板 UI 当前复用了现有的会话 `ChatPanel`，并没有定义一个以终端为先的交互模式。
- Web 端终端渲染器被有意设计为只读，而唯一的交互式终端组件绑定在桌面端 PTY 命令上。
- 服务端的 ACP 终端支持是面向 agent 发起的终端生命周期设计的（`terminal/create`、`terminal/output`、`terminal/wait_for_exit`、`terminal/kill`、`terminal/release`），而非用户驱动的 shell 输入。
- 浏览器 ACP 客户端和 `/api/acp` 路由暴露了 prompt 和取消流程，但没有专门的浏览器到终端的输入 API。

## 相关文件

- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/client/hooks/use-acp.ts`
- `src/client/acp-client.ts`
- `src/client/components/message-bubble.tsx`
- `src/client/components/terminal/terminal-bubble.tsx`
- `src/client/components/terminal/pty-terminal.tsx`
- `src/core/acp/acp-process.ts`
- `src/core/acp/terminal-manager.ts`
- `src/app/api/acp/route.ts`

## 观察

- `kanban-page-client.tsx` 创建 ACP 会话并立即发送 prompt，这使得看板的会话启动路径很直接，但偏向聊天导向。
- `kanban-tab.tsx` 通过 `ChatPanel` 就地渲染 ACP 会话，既用于 KanbanTask Agent 侧边面板，也用于任务详情模态框。
- `terminal-bubble.tsx` 已经使用 xterm.js，但设置了 `disableStdin: true`，因此浏览器用户无法在其中输入。
- `pty-terminal.tsx` 是交互式的，但仅限 Tauri，并且只能通过 `pty_create` 和 `pty_write` 等桌面桥接命令实现。
- `terminal-manager.ts` 已经管理着长期存活的服务端 shell 进程，并通过 ACP `session/update` 流式输出，因此部分后端基础已经存在。
- `/api/acp` 目前处理 `session/new`、`session/prompt`、`session/respond_user_input` 和 `session/cancel`，但没有面向浏览器会话的、面向用户的终端输入通道。

## 参考

- `resources/specialists/issue-enricher.md`

## 解决方案

该问题在当前代码库中已解决，对应的上游 GitHub 问题也已关闭。

当前实现中的证据：

- `src/app/workspace/[workspaceId]/kanban/kanban-tab-panels.tsx` 通过 `ChatPanel`
  渲染 ACP 任务会话，因此看板的会话面板现在复用了与主会话 UI 相同的浏览器终端交互路径。
- `src/client/components/message-bubble.tsx` 将
  `interactive={Boolean(message.terminalInteractive) ...}` 传入
  `TerminalBubble`，并同时传入 `onInput` 和 `onResize` 处理器。
- `src/client/components/terminal/terminal-bubble.tsx` 在 `interactive` 为 true 时
  启用浏览器 stdin，接入 `terminal.onData(...)` 和
  `terminal.onResize(...)`，在该模式下不再表现为只输出。
- `src/client/hooks/use-acp.ts` 暴露了 `writeTerminal(...)` 和
  `resizeTerminal(...)`，`src/client/components/chat-panel.tsx` 调用了这些
  hook，而 `src/app/api/acp/route.ts` 实现了 `terminal/write` 和 `terminal/resize`
  RPC 方法。

当前范围说明：

- 这条浏览器交互式终端路径适用于 ACP 聊天/会话面板。A2A 任务面板仍使用一个不同的、
  以元数据为导向的界面，因此交互式终端能力在每一种看板会话传输方式上并非通用。
