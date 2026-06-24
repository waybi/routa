---
title: "ACP Provider 清单可能在不存在可运行适配器时仍报告 Provider 已安装"
date: "2026-04-06"
status: resolved
severity: medium
area: cli
tags: ["cli", "acp", "provider", "inventory", "installation", "codex"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/364"]
github_issue: 364
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/364"
resolved_at: "2026-04-15"
resolution: "在 2026-04-28 的 issue 整理过程中，确认 GitHub issue #364 已关闭后同步。"
---

# ACP Provider 清单可能在不存在可运行适配器时仍报告 Provider 已安装

## 发生了什么

即使机器上没有 `codex-acp` 可执行文件、且 `routa chat --provider codex` 无法启动，`routa acp list` 仍将 Codex 报告为 `"installed": true`。

观察到的状态：

- `routa acp list` 中包含 `codex-acp` / `Codex CLI`，且 `"installed": true`
- `routa acp installed` 返回空列表
- `which codex-acp` 没有任何返回
- `routa chat --provider codex` 失败，报错 `Failed to spawn 'codex-acp'`

## 预期行为

- 只有当 Routa 能够真正解析出该 Provider 的可运行适配器时，才应将其标记为已安装：
  - 一个被跟踪记录的二进制路径，
  - 一条已记录的受管安装，或
  - 一个经过验证的可运行包装/适配器命令。
- 仅仅是 `PATH` 上存在 `npx` 或 `uvx`，不应将某个特定 Provider 标记为已安装。

## 复现场景

- 环境：Linux 上的本地 CLI
- 触发步骤：
  1. 确保 `npx` 在 `PATH` 上可用。
  2. 不要安装 `codex-acp`。
  3. 运行 `routa acp list` 并检查 Codex。
  4. 与 `which codex-acp`、`routa acp installed` 以及 `routa chat --provider codex` 的结果进行对比。

## 为什么会发生

- `quick_check_installed(...)` 会将任何带有 `npx` 分发方式的 Provider，在系统存在 `npx` 时一律视为已安装。
- 该检查并未验证特定的包、适配器命令或二进制文件是否真的可以执行。
- 由此产生的清单视图夸大了就绪程度，可能误导用户，把一个不可用的 Provider 当作可运行状态对待。

## 相关文件

- `crates/routa-cli/src/commands/acp.rs`
- `crates/routa-core/src/acp/mod.rs`
- `crates/routa-core/src/acp/installation_state.rs`
- `crates/routa-core/src/acp/runtime_manager.rs`

## 观察记录

- 当前，只要 `dist.get("npx").is_some()` 且 `PATH` 上存在 `npx`，`quick_check_installed(...)` 就会返回 true，而不考虑该 Provider 是否真正可用。
- 这在 `codex-acp` 尚未存在时，就将 Codex 误分类为已安装。
- 之后安装 `@zed-industries/codex-acp` 确实让该 Provider 变得可运行，但最初的清单结果仍然是一个误报。
