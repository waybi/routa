---
title: "Rust 桌面端 Codex MCP 会话起初看似未暴露任何可用的 Routa 工具"
date: "2026-04-10"
status: resolved
resolved_at: "2026-04-10"
severity: high
area: "desktop"
tags: [rust, desktop, codex, mcp, kanban, protocol, tauri]
reported_by: "Codex"
related_issues:
  - "2026-04-10-rust-codex-mcp-config-not-injected-on-launch.md"
---

# Rust 桌面端 Codex MCP 会话起初看似未暴露任何可用的 Routa 工具

## 发生了什么

在 Rust 桌面端的看板流程中，Codex 会话现在可以在已配置 Routa MCP 服务器的情况下启动，但 Agent 的行为仍然表现得好像没有任何可用的看板规划工具。

观察到的行为：

- Codex 对话尝试发起通用的 MCP 发现调用，例如 `list_mcp_resources` 和 `list_mcp_resource_templates`。
- 随后 Codex 报告称 `create_card`、`decompose_tasks` 和 `search_cards` 等工具在会话中未被暴露。
- Rust 后端日志显示 Codex 确实向 Routa 发送了 MCP 请求，包括：
  - `initialize`
  - `notifications/initialized`
  - `tools/list`
  - `resources/list`
  - `resources/templates/list`
- `codex app-server` 运行时检查显示 MCP 服务器条目以 `routa-coordination` 的形式存在，但从 Codex 的视角看，其工具清单仍然为空。

当时，这让人觉得故障已经越过了配置注入阶段。Codex 能看到 MCP 服务器，但似乎没有将 Routa 工具列表物化（materialize）到活动会话中。

## 预期行为

- Rust 桌面端的 Codex 会话应当暴露与 Next.js 流程中相同且可用的 Routa MCP 工具。
- 使用 `mcpProfile=kanban-planning` 的看板规划会话应当呈现 `create_card`、`decompose_tasks`、`search_cards`、`list_cards_by_column`、`update_task`、`update_card`、`move_card`、`request_previous_lane_handoff` 和 `submit_lane_handoff`。
- 当服务器已经收到 `tools/list` 时，Codex 不应退回到"工具缺失"的推断逻辑。

## 复现上下文

- 环境：desktop
- 触发方式：打开 Rust/Tauri 看板面板，选择 Codex，提交一个规划请求（例如 `create a js hello world`），然后检查 Codex 会话记录和 MCP 服务器状态。

## 为什么看起来像是坏了

- 最初的工作假设是 Rust 的 `/api/mcp` 端点偏离了 SDK 的 streamable-HTTP 语义。
- 这个假设方向上是有用的：手写的 Rust MCP 传输层确实在一些细微但重要的方面偏离了官方的 streamable-HTTP 生命周期。
- 与此同时，有一个诊断信号具有误导性：即便实际的端到端看板流程比探针所暗示的更接近正常工作，`codex app-server` 的 `mcpServerStatus/list` 仍可能显示 `tools: {}`。
- 实际上，这是一个分层叠加的故障：
  - Codex 启动需要可靠的 MCP 注入。
  - 桌面端 MCP 路由需要匹配官方 `rmcp` 的 streamable-HTTP 生命周期语义。
  - 单点状态探针不足以证明真实的看板卡片创建路径是损坏的还是健康的。

## 解决方案

最终的桌面端恢复来自于同时应用这两个层面的修复：

1. Routa 不再依赖用户全局的 Codex 配置，现在通过以下方式注入 Routa MCP：
   - 位于 `~/.routa/codex/config.toml` 的 Routa 私有覆盖文件
   - CLI `-c key=value` 覆盖项
   - 针对 `codex-acp` 的 ACP `mcpServers` 载荷
2. Rust 的 `/api/mcp` 从手写的传输层封装迁移到了官方的 `rmcp::transport::StreamableHttpService`。

在这些改动之后，最初的端到端需求被再次验证：

- 在桌面端看板页面上，选择 `Codex` 并发送规划请求，可以通过实时的 ACP/MCP 会话创建一张卡片。

## 我们学到了什么

- `mcpServerStatus/list` 是一个参考性信号，而非最终结论。
- 实时的看板 ACP 会话比孤立的 MCP 状态探针更能反映真相。
- 如果 Codex 已启动并打开了会话，但面板没有变化，请始终区分：
  - 启动/配置注入失败
  - MCP 协议/会话生命周期失败
  - UI 刷新或面板状态持久化失败

## 相关文件

- `crates/routa-server/src/api/mcp_routes.rs`
- `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`
- `crates/routa-server/tests/rust_api_mcp_routes.rs`
- `src/app/api/mcp/route.ts`
- `crates/routa-core/src/acp/process.rs`
- `/Users/phodal/ai/codex/codex-rs/codex-mcp/src/mcp_connection_manager.rs`
- `/Users/phodal/ai/codex/codex-rs/rmcp-client/src/rmcp_client.rs`

## 关键观察

- 来自 `codex app-server` 的 `config/read` 确认 `mcp_servers.routa-coordination` 处于活动状态，来源为 `sessionFlags`。
- 来自 `codex app-server` 的 `mcpServerStatus/list` 报告了 `routa-coordination`，但在诊断过程中 `tools` 始终为空。
- 在 Rust 路由中识别出了一个具体的协议缺陷：`notifications/initialized` 错误地返回了一个 JSON-RPC 响应体。
- Rust 的 `/api/mcp` 被迁移到官方的 `rmcp` `StreamableHttpService`，并且 Rust MCP 契约测试在 SSE initialize + initialized-notification 流程下通过。
- 用户后来验证了原本的看板 + Codex 卡片创建路径再次可用，这意味着在传输层/配置修复落地后，之前的空工具探针不足以判定该端到端功能已损坏。

## 类似故障的推荐排查顺序

1. 首先确认真实的症状。
   问题究竟是"Codex 会话启动失败"、"会话已启动但看不到工具"，还是"会话已运行但面板状态没有变化"？

2. 验证启动时的 MCP 注入。
   检查 Routa 是否通过私有覆盖文件 + CLI 覆盖项 + ACP `mcpServers` 传递 MCP，且没有改动 `~/.codex/config.toml`。

3. 验证服务器端的 MCP 生命周期。
   确认 `initialize`、`notifications/initialized` 和 `tools/list` 都按官方 streamable-HTTP 语义处理。

4. 测试真实的用户流程，而不仅仅是探针。
   使用看板页面，选择 `Codex`，提交一个规划请求，并检查是否创建了卡片。

5. 将 `codex app-server` 的状态仅视为佐证。
   如果 `mcpServerStatus/list` 显示 `tools: {}`，不要就此止步。将其与实时的 ACP 会话行为和服务器日志进行对比。

6. 如果会话已运行但没有卡片出现，请检查两侧。
   检查 `/api/sessions` 中的最新会话以及工作区的任务/卡片状态，以区分 MCP/工具问题与 UI 刷新或持久化问题。

## 参考资料

- `docs/issues/2026-04-10-rust-codex-mcp-config-not-injected-on-launch.md`
