---
title: "Rust 桌面端 Codex 会话在启动时未注入 Routa MCP 配置"
date: "2026-04-10"
status: resolved
resolved_at: "2026-04-10"
severity: high
area: "acp"
tags: [rust, desktop, codex, mcp, config, tauri]
reported_by: "Codex"
related_issues: []
---

# Rust 桌面端 Codex 会话在启动时未注入 Routa MCP 配置

## 发生了什么

从 Rust 桌面端后端创建的看板 Codex 会话能够成功启动，但在 Codex 对话内部，内置的 Routa MCP 工具却缺失了。

会话 Trace 显示 Codex 退而求其次地调用通用 MCP 发现逻辑，随后报告没有暴露任何看板工具，例如 `create_card`。

## 预期行为

- 当 Routa 为某个工作区会话启动 Provider 时，Codex 桌面端会话应始终能看到 `routa-coordination` MCP 服务器。
- 看板规划 Agent 应能够立即创建 backlog 卡片，而不是因工具未暴露而卡住。

## 为什么会发生

- Rust 桌面端在 setup 阶段会把 Codex MCP 配置写入项目作用域的 `.codex/config.toml`。
- 而实际的 Codex 启动路径只注入了一个 CLI 覆盖项：项目信任（project trust）。
- 这意味着启动过程依赖于 Codex 在该运行时路径中正确发现并加载项目配置文件。
- 在发生故障的 Tauri/WebView 流程中，这一假设不够可靠，因此 Codex 启动时并没有激活 `mcp_servers.routa-coordination` 条目。

这偏离了 Codex 所记录的、更强的优先级模型：

1. CLI 标志与 `--config` 覆盖
2. profile 取值
3. 项目配置文件
4. 用户配置
5. 系统配置
6. 内置默认值

## 解决方案

Rust 桌面端后端现在将 Codex MCP 覆盖数据保存在一个 Routa 私有文件中：

- `~/.routa/codex/config.toml`

Routa 不会修改用户的全局 `~/.codex/config.toml`。

在启动时，Routa 读取其私有覆盖文件，并将其展开为 Codex CLI 配置覆盖项：

- `projects."<cwd>".trust_level="trusted"`
- `mcp_servers.routa-coordination.url="..."`
- `mcp_servers.routa-coordination.enabled=true`

此外，Routa 现在还会通过 ACP 的 `session/new` / `session/load` `mcpServers` 负载，使用标准的 Streamable HTTP 形态，将同一 MCP 服务器直接注入 `codex-acp`：

- `type: "http"`
- `name: "routa-coordination"`
- `url: "http://127.0.0.1:3210/api/mcp?..."`

这在不改动用户共享 Codex 配置的前提下，保留了 Codex 最高优先级的 `-c/--config` 行为，同时也避免了依赖 Codex 在启动链路后段去发现配置文件。

这修复了第一层故障：Codex 会话现在在桌面端流程中启动时就带有 Routa MCP 配置。

这是必要的，但仅靠它本身还不足以打通端到端的看板卡片创建路径。最终可用的路径还要求 Rust 桌面端 MCP 路由使用官方的 `rmcp` streamable-HTTP 服务，从而让 Codex 的实时 MCP 会话能够干净地完成初始化。

## 相关文件

- `crates/routa-core/src/acp/mcp_setup.rs`
- `crates/routa-core/src/acp/mod.rs`

## 验证

- `cargo test -p routa-core codex_cli_overrides_include_trust_and_mcp_server`
- `cargo test -p routa-core codex_provider_writes_private_overlay_config`
- `cargo test -p routa-core acp_http_mcp_servers_use_streamable_http_shape`
- 端到端桌面端验证：选择 `Codex` 的看板页面能够再次通过实时 ACP/MCP 会话创建卡片
