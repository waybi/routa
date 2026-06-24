---
title: "Rust 桌面端看板输入规划流程"
date: 2026-03-20
agent: Codex (GPT-5)
status: resolved
severity: medium
area: kanban
component: rust-kanban
---

# Rust 桌面端看板输入规划流程

## 问题

Rust 桌面端看板输入框可以为 OpenCode 创建 ACP 会话，但提交规划提示词后，并不能可靠地在当前工作区中创建待办（backlog）卡片。

## 发生了什么

- 看板输入框创建了一个 OpenCode 会话，参数为 `toolMode=full` 和 `mcpProfile=kanban-planning`。
- Rust `/api/mcp` 忽略了 MCP URL 中的 `wsId` 和 `mcpProfile`。
- `tools/list` 返回了完整的工具集，而不是看板规划子集。
- 当 Agent 省略 `workspaceId` 时，`tools/call` 没有继承当前工作区。
- 结果是：会话被创建、提示词被发送，但规划流程并未稳定地把待办卡片写入目标看板。

## 为什么重要

- 顶部的看板输入框是 Rust 桌面端应用中主要的待办规划入口。
- 如果它无法可靠地在当前工作区中创建卡片，那么即便泳道（lane）自动化本身可以工作，桌面端的自动化能力也仍然是不完整的。

## 修复

- 更新 `crates/routa-server/src/api/mcp_routes.rs`，从查询参数中持久化 MCP 会话作用域。
- `initialize` 现在会在 Rust MCP 会话状态中捕获 `wsId` 和 `mcpProfile`。
- 当 `mcpProfile=kanban-planning` 时，`tools/list` 现在会过滤为看板规划允许列表（allowlist）。
- `tools/call` 现在会将当前工作区注入到工具参数中，并拒绝允许的 Profile 之外的工具。

## 验证

### 输入回放

1. 运行桌面端 Rust 服务：
   - `cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --example standalone_server`
2. 打开：
   - `http://127.0.0.1:3210/workspace/rust-fix-enabled-1773965081/kanban`
3. 确保 `KanbanTask Agent provider` 为 `OpenCode`。
4. 在顶部输入框中提交一个唯一的提示词：
   - `create a js hello world 1773966400`
5. 等待 ACP 会话启动并刷新看板。

### 预期证据

- Rust 日志中显示：
  - `session/prompt`
  - `tools/call`
- `GET /api/tasks?workspaceId=rust-fix-enabled-1773965081` 返回一张新的待办卡片：
  - `title = "js hello world 1773966400"`
  - `columnId = "backlog"`
- 浏览器输出显示：
  - `Kanban Board(3 tasks)`
  - `Backlog 2 cards`
  - `js hello world 1773966400`

## 结果

Rust 桌面端看板输入流程现在已按预期用于待办规划：

- `看板输入 -> OpenCode 会话 -> kanban-planning MCP 工具 -> create_card -> 待办卡片`

该入口有意仅限于待办（backlog）。它会创建规划卡片并止步于此；它不会直接执行实现工作。

## 后续验证：完整自动链路

后来使用同一套 Rust 桌面端配置验证了一条更长的链路：

- `input -> backlog -> todo -> dev`

### 回放工作区

- 工作区：
  - `rust-auto-chain-import-1773967200`
- 看板：
  - `imported-auto-chain-board`
- 泳道自动化：
  - `todo -> OpenCode / CRAFTER / entry`
  - `dev -> OpenCode / CRAFTER / entry`

### 回放步骤

1. 将一份看板配置导入到 Rust 设置中。
2. 更新导入的看板，使其拥有六列，并在 `todo` 和 `dev` 上都启用自动化。
3. 打开：
   - `http://localhost:3210/workspace/rust-auto-chain-import-1773967200/kanban`
4. 提交一个唯一的顶部输入提示词：
   - `auto chain browser 1773967200`
5. 确认新卡片落入 `Backlog`。
6. 将该任务移动到 `todo`。
7. 再次将该任务移动到 `dev`。

### 预期证据

- 输入创建了一张待办卡片：
  - `title = "auto chain browser 1773967200"`
  - `columnId = "backlog"`
- 进入 `todo` 会创建一个新的自动化会话并更新：
  - `assignedProvider = "opencode"`
  - `assignedRole = "CRAFTER"`
  - `triggerSessionId = <todo-session>`
- 进入 `dev` 会再创建一个全新的自动化会话，即便该任务此前已有 `triggerSessionId`。

### 为什么重要

- 它弥合了待办规划与 Rust 多泳道执行之间剩余的缺口。
- 它验证了较早的泳道会话不会抑制同一任务后续的自动化流转。
