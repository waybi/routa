---
title: "Tauri 看板静态路由回归"
date: 2026-03-19
agent: Codex (GPT-5)
status: resolved
severity: high
area: desktop
component: tauri-frontend
---

# Tauri 看板静态路由回归

## 问题

在移除桌面端专属的首页 UI 并重新构建 Tauri 使用的静态前端后，桌面端流程仍可加载统一首页，但从首页导航到 `/workspace/{workspaceId}/kanban` 时无法成功渲染看板页面。

## 发生了什么

- `npm run build:static` 成功执行，并为工作区页面生成了预期的占位路由。
- `npm run tauri:build` 成功执行，产出了 `.app` 包和 `.dmg`。
- 桌面端首页能从 Rust 静态服务器在 `http://127.0.0.1:3210/` 正确加载。
- 首页 CTA 生成了有效的 `Open Kanban` 链接，例如 `/workspace/{workspaceId}/kanban`。
- 从桌面端静态服务器打开 `/workspace/default/kanban` 无法进入可用的看板面板。

## 当前症状

- 在首次回退修复之前，`/workspace/{id}/kanban` 渲染的是工作区概览页面，而非独立的看板页面。
- 在 Rust 回退逻辑中加入显式的 `/workspace/{id}/kanban -> workspace/__placeholder__/kanban.*` 映射后，该路由不再渲染工作区概览，但现在会因客户端应用错误而失败。
- 浏览器输出显示：
  - `Application error: a client-side exception has occurred while loading 127.0.0.1`
- `traces` 在桌面端静态服务器中仍能正常加载，这表明该回归特定于工作区深链接的静态路由，而非整个前端启动失败。

## 为什么重要

- 桌面端构建目前无法依赖首页启动器进入主要的看板界面。
- 产品意图明确看板是主要的执行界面，因此这阻断了首页本应引导用户进入的桌面端路径。
- 该回归很容易被忽略，因为构建成功且首页本身看起来正常。

## 证据

- 静态导出包含：
  - `workspace/__placeholder__.html`
  - `workspace/__placeholder__/kanban.html`
  - `workspace/__placeholder__/kanban.txt`
  - `workspace/__placeholder__/kanban/` 下嵌套的 RSC 负载文件
- 现有的 Playwright 检查结果：
  - 首页加载：通过
  - `Open Kanban` 链接生成：通过
  - 首页 -> 看板流程：失败，看板可见内容缺失 / 应用错误
- 正在排查的 Rust 回退逻辑：
  - `crates/routa-server/src/lib.rs`

## 相关文件

- `src/app/page.tsx`
- `crates/routa-server/src/lib.rs`
- `apps/desktop/src-tauri/frontend/workspace/__placeholder__/kanban.html`
- `apps/desktop/src-tauri/frontend/workspace/__placeholder__/kanban.txt`

## 解决方案

该回归有两个独立的成因：

- Rust 静态回退为 `/workspace/{id}/kanban` 提供了正确的占位文件，但导出的负载中仍包含 `__placeholder__` 路由值，因此桌面端深链接路径与实际 URL 不一致。
- Rust 的 `/api/kanban/boards` 接口返回的面板摘要只带有 `columnCount`，而看板 UI 期望的是带 `columns` 数组的完整面板。这导致在水合（hydration）期间客户端崩溃 `TypeError: r.columns is not iterable`。

## 修复

- 更新 `crates/routa-server/src/lib.rs`，使工作区和看板的静态响应将 `__placeholder__` 重写为真实的 `workspaceId`，以适配桌面端静态路由。
- 更新 `crates/routa-server/src/api/kanban.rs`，使 `GET /api/kanban/boards` 通过 `kanban.getBoard` 解析每个面板并保留运行时元数据，从而返回完整的面板负载。
- 在 `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx` 中加入防御性的 `board.columns ?? []` 守卫，避免不完整的面板负载再次导致页面白屏。

## 验证

- `npm run build:static`
- `cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --example standalone_server`
- `npx playwright test --config=playwright.tauri.config.ts e2e/homepage-open-board-tauri.spec.ts --project=chromium`

结果：

- 桌面端首页加载出统一的首页 UI。
- `Open Kanban` 导航到 `/workspace/{id}/kanban`。
- 看板列在桌面端静态模式下成功渲染。

## 后续验证：看板 + OpenCode 自动化回放

此回放用于验证 Rust 桌面端后端不仅能打开看板，还能通过 KanbanTask Agent 配合 OpenCode 驱动待办（backlog）规划。

### 前置条件

- 运行桌面端静态服务器：
  - `cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --example standalone_server`
- 使用桌面端静态 URL：
  - `http://127.0.0.1:3210/workspace/default/kanban`
- 本次回放中将 `Auggie` 排除在范围之外。使用 `OpenCode`。

### 回放步骤

1. 从桌面端静态服务器打开 `/workspace/default/kanban`。
2. 确认 `KanbanTask Agent provider` 选择器可见，且已选中 `OpenCode`。
3. 在 `Describe work to plan in Kanban...` 输入框中发送一个唯一的提示词，例如：
   - `Create exactly one backlog card titled VERIFY-KANBAN-OPENCODE-20260320-B and stop after creation.`
4. 等待 KanbanTask Agent 会话面板打开，并等待面板刷新。
5. 确认新的唯一卡片出现在 `Backlog` 列中。
6. 确认聊天 / Trace 面板报告了成功的卡片创建消息。

### 在 Rust 日志中检查什么

- 会话创建：
  - `[ACP Route] Creating session: provider=Some("opencode")`
- MCP 注入：
  - `[AcpManager] opencode: wrote MCP config to /Users/phodal/.config/opencode/opencode.json`
- MCP 握手：
  - `[MCP Route] POST: method=initialize`
  - `[MCP Route] POST: method=tools/list`
- 实际的工具调用：
  - `[MCP Route] POST: method=tools/call`

### 预期证据

- `~/.config/opencode/opencode.json` 包含一个指向 Rust 桌面端服务器的 `routa-coordination` 条目：
  - `http://127.0.0.1:3210/api/mcp?...&toolMode=full&mcpProfile=kanban-planning`
- `Backlog` 计数增加。
- 唯一的验证卡片在面板中可见，例如：
  - `VERIFY-KANBAN-OPENCODE-20260320`
  - `VERIFY-KANBAN-OPENCODE-20260320-B`
- KanbanTask Agent 面板显示创建摘要，例如：
  - `Created backlog card ... in the backlog column.`

### 为什么这次回放重要

- 它验证了此前缺失的 Rust 能力：
  - `session/new` 必须保留 `toolMode=full` 和 `mcpProfile=kanban-planning`
- 它证明桌面端 Rust 后端不仅在提供看板服务，还能让 OpenCode 调用待办拆解和卡片创建所需的看板 MCP 工具。

## 后续验证：跨列泳道流转自动化

此回放验证了 Rust 桌面端看板自动化在卡片于泳道之间移动时同样有效，而不仅仅是在卡片直接创建于自动化泳道内时有效。

### 回放工作区

- 工作区：
  - `rust-fix-enabled-1773965081`
- 面板：
  - `shared-import-board`
- 泳道自动化：
  - `todo -> OpenCode / CRAFTER / entry`

### 回放步骤

1. 预置一张待办卡片：
   - `BROWSER-MOVE-VERIFY-1773965081`
2. 打开：
   - `http://127.0.0.1:3210/workspace/rust-fix-enabled-1773965081/kanban`
3. 确认面板初始显示：
   - `Backlog 1 cards`
   - `Todo 1 cards`
4. 通过 Rust 任务更新路径将预置卡片从 `backlog` 移动到 `todo`：
   - `PATCH /api/tasks/c569b0ee-5916-4d60-a41e-4ad05e9e7016`
   - body：
     - `{"columnId":"todo","boardId":"shared-import-board"}`
5. 刷新面板 UI 并检查任务 / 会话状态。

### 预期证据

- 被移动的卡片现在带有：
  - `assignedProvider = "opencode"`
  - `assignedRole = "CRAFTER"`
  - `triggerSessionId = "b71a5908-063e-49b5-9118-d8f696913017"`
- `GET /api/sessions?workspaceId=rust-fix-enabled-1773965081` 返回一个匹配的会话：
  - `provider = "opencode"`
  - `role = "CRAFTER"`
  - `sessionId = "b71a5908-063e-49b5-9118-d8f696913017"`
- 刷新后的浏览器输出显示了泳道流转：
  - `Backlog 0 cards`
  - `Todo 2 cards`
  - `BROWSER-MOVE-VERIFY-1773965081`

### 为什么这次回放重要

- 它证明当卡片在创建之后进入自动化泳道时，Rust 桌面端看板流转路径会触发自动化。
- 它弥合了「创建时入口自动化」与「泳道流转时入口自动化」之间的差距。

## 后续验证：从输入到开发的自动链路

此回放将前述检查扩展到一条更长的 Rust 桌面端路径：

- `Kanban input -> Backlog -> Todo -> Dev`

### 回放工作区

- 工作区：
  - `rust-auto-chain-import-1773967200`
- 面板：
  - `imported-auto-chain-board`

### 回放说明

- 先导入一份面板配置，然后确保导入的面板包含六列。
- 为 `todo` 和 `dev` 两者均配置：
  - `enabled = true`
  - `providerId = "opencode"`
  - `role = "CRAFTER"`
  - `transitionType = "entry"`
- 使用顶部的看板输入框创建一张待办卡片，然后将同一张卡片跨两个自动化泳道移动。

### 预期证据

- 输入规划后，卡片可见于 `Backlog`。
- 将其移动到 `Todo` 会创建一个全新的 `OpenCode` 会话。
- 再将其移动到 `Dev` 同样会创建一个全新的 `OpenCode` 会话，而不会因为先前的 `triggerSessionId` 而被抑制。
