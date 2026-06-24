---
title: "CLI 聊天与团队流程可能在 Codex 产生可见输出之前就结束流式传输"
date: "2026-04-06"
status: resolved
severity: high
area: cli
tags: ["cli", "chat", "team", "acp", "codex", "streaming", "timeout"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/363"]
github_issue: 363
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/363"
resolved_at: "2026-04-07"
---

# CLI 聊天与团队流程可能在 Codex 产生可见输出之前就结束流式传输

## 发生了什么

`routa chat --provider codex` 可以成功创建一个 Codex ACP 会话、接受用户输入，但仍然会在任何助手文本变得可见之前就返回到 CLI 提示符。

这一隐蔽的故障模式是：

1. `codex-acp` 正确启动并完成初始化。
2. 用户提示词成功提交。
3. 在第一条用户可见的 `agent_message_chunk` 之前，Codex 发出了许多内部 `process_output` 日志行。
4. CLI 把这些后台日志当作活动，随后施加了一个较短的空闲超时。
5. 在第一个可见 token 到达之前，`routa chat` 就返回到了 `>`，尽管会话历史稍后包含了完整的助手回复。

同样的结构性问题也适用于 `routa team`，它在 `prompt()` 之后使用了相同的流式排空（stream-drain）模式。

## 预期行为

- `routa chat --provider codex` 应当持续流式传输，直到出现以下情况之一：
  - 一个可见的助手/工具更新到达，并且该轮次随后进入空闲状态，
  - 观察到一个 `turn_complete` 事件，
  - 底层进程退出，或
  - 触发了显式的长超时。
- 隐藏的 Provider 日志不应导致 CLI 误判为一个用户可见的轮次已经开始。
- `routa team` 应当使用相同的健壮流式行为。

## 复现环境

- 环境：Linux 上的本地 CLI
- 触发步骤：
  1. 安装一个可正常工作的 `codex-acp` 适配器。
  2. 运行 `routa chat --provider codex`。
  3. 发送一个简单的提示词，例如 `hello, please reply with exactly: ROUTA CODEX CHAT OK`。
  4. 观察到在任何可见的助手输出出现之前，CLI 就返回到了 `>`。
  5. 检查已持久化的会话历史，确认助手最终确实进行了回复。

## 为什么会发生

- `chat.rs` 先 await `state.acp_manager.prompt(...)`，然后才去排空广播流，这对那些可见输出到达较晚的较慢 Provider 来说并不适配。
- 空闲策略使用了一个较短的活动后超时，而没有区分可见输出与被过滤的 Provider 日志。
- `tui.rs` 正确地把 Codex 内部日志从终端中隐藏起来，但 `chat.rs` / `team.rs` 仍然允许这些被隐藏的事件影响空闲状态的判定。

## 相关文件

- `crates/routa-cli/src/commands/chat.rs`
- `crates/routa-cli/src/commands/team.rs`
- `crates/routa-cli/src/commands/tui.rs`
- `crates/routa-core/src/acp/mod.rs`
- `crates/routa-core/src/acp/process.rs`

## 观察记录

- 从 `routa chat --provider codex` 创建的一个已持久化会话显示：
  - ACP 会话创建成功，
  - 提交提示词的日志，
  - 来自 Codex 内部的许多 `process_output` 条目，
  - 稍后的 `agent_message_chunk` 条目，
  - 最终的助手文本 `ROUTA CODEX CHAT OK`。
- 在这些 `agent_message_chunk` 条目被渲染出来之前，用户可见的 CLI 就已经返回到了提示符。
- 一个本地候选修复方案在流式处理改为并发处理 prompt 与 update、且只有可见的终端活动才会重置较短的空闲预算之后，成功复现了预期的可见输出。
