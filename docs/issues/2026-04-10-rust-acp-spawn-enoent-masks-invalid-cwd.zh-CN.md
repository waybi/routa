---
title: "Rust ACP spawn ENOENT 将无效 cwd 误判为缺失的 Provider 二进制文件"
date: "2026-04-10"
status: resolved
resolved_at: "2026-04-10"
severity: high
area: "acp"
tags: [rust, acp, desktop, spawn, cwd, path, provider]
reported_by: "Codex"
related_issues: []
---

# Rust ACP spawn ENOENT 将无效 cwd 误判为缺失的 Provider 二进制文件

## 发生了什么

桌面端 ACP 会话创建失败，报错信息类似：

- `Failed to spawn '/opt/homebrew/bin/codex-acp' (resolved: '/opt/homebrew/bin/codex-acp'): No such file or directory (os error 2)`
- `Failed to spawn '/opt/homebrew/bin/opencode' (resolved: '/opt/homebrew/bin/opencode'): No such file or directory (os error 2)`

与此同时，UI 还显示了与仓库路径相关的失败：

- `GET /api/clone/branches?repoPath=...` 返回 `400 Bad Request`
- `GET /api/skills/clone?repoPath=...` 返回 `404 Not Found`

同一台机器在有效的工作目录下可以成功执行这两个 Provider 二进制文件：

- `/opt/homebrew/bin/opencode --version` 成功
- `/opt/homebrew/bin/codex-acp --help` 成功

这意味着仅凭 Rust 的错误文本并不足以断定 Provider 二进制文件确实缺失。

## 预期行为

- ACP 会话创建应当区分以下情况：
  - 未找到 Provider 二进制文件
  - Provider wrapper 目标／解释器缺失
  - 会话 `cwd` 不存在或无效
- 如果请求的仓库／worktree 路径无效，API 应当尽早以清晰的 `cwd`／`repoPath` 校验错误失败，而不是把失败归因于 ACP 二进制文件。

## 复现上下文

- 环境：桌面端（`http://127.0.0.1:3210`）
- 触发条件：在所选仓库／worktree 路径无效或已不存在时创建 ACP 会话

对相同症状形态的最小本地复现：

```bash
node -e "const {spawn}=require('child_process'); const p=spawn('/opt/homebrew/bin/opencode',['--version'],{cwd:'/definitely/missing'}); p.on('error',e=>{console.error(e.code,e.message); process.exit(0);});"
```

观察到的输出：

```text
ENOENT spawn /opt/homebrew/bin/opencode ENOENT
```

因此，一个有效的可执行文件加上一个无效的 `cwd`，仍可能呈现为当前被渲染成 “Is it installed and in PATH?” 的那个相同的 ENOENT。

## 为什么会出现这种情况

- `crates/routa-core/src/acp/process.rs` 用一条以二进制文件为中心的错误信息包裹了 `Command::spawn()` 的失败，但当 `.current_dir(cwd)` 指向一个不存在的目录时，`spawn()` 同样会失败。
- `crates/routa-server/src/api/acp_routes.rs` 从请求／工作区／代码库状态中解析 `cwd`，但在调用 `acp_manager.create_session(...)` 之前并未校验最终目录是否存在。
- 并发出现的 `repoPath` 400/404 错误强烈表明前端此前已经选中了一个无效的仓库路径，这使得 `cwd` 漂移比 CLI 安装缺失更可能是根因。
- 诸如 `crates/routa-server/src/api/providers.rs` 这类静态 Provider 可用性路径直接检查 `shell_env::which(&preset.command)`，而非走 preset 感知的 `resolve_preset_command(...)`，因此在使用 env 覆盖时，诊断结果可能与实际启动路径产生分歧。

## 相关文件

- `crates/routa-core/src/acp/process.rs`
- `crates/routa-core/src/acp/mod.rs`
- `crates/routa-server/src/api/acp_routes.rs`
- `crates/routa-server/src/api/clone_branches.rs`
- `crates/routa-server/src/api/skills_clone.rs`
- `crates/routa-server/src/api/providers.rs`
- `crates/routa-core/src/shell_env.rs`

## 观察记录

- 在这台机器上，`command -v opencode` 解析到 `/Users/phodal/.opencode/bin/opencode`。
- 在这台机器上，`command -v codex-acp` 解析到 `/opt/homebrew/bin/codex-acp`。
- `/opt/homebrew/bin/opencode` 和 `/opt/homebrew/bin/codex-acp` 都存在且可执行。
- 两个 wrapper 都使用 `#!/usr/bin/env node`，且 `node` 位于 `/opt/homebrew/bin/node` 可用。
- 截图显示在 ACP 创建失败之前紧接着出现了 `repoPath` 相关的 API 失败，这与无效 `cwd` 的假设相吻合。

## 解决方案

该问题已在当前代码库中解决。

修复收紧了 Rust 后端的 ACP 启动校验：

- 在 `AcpManager` 中新增共享的 `cwd` 校验，使 create/load 流程在 Provider 启动前拒绝缺失或非目录的工作目录。
- 在 `AcpProcess::spawn(...)` 中新增防御性的 `cwd` 检查，使未来任何直接调用方都能得到同样明确的失败。
- 改进了 `spawn()` 的错误分类，使 ENOENT 不再总是意味着 “not installed and in PATH”；当解析出的二进制文件存在时，错误现在会指向缺失的解释器／wrapper 目标类别。
- 为核心 `cwd` 校验器和桌面端 `session/new` 路由都新增了回归测试。

## 验证

- `cargo test -p routa-core validate_session_cwd_rejects_missing_or_non_directory_paths`
- `cargo test -p routa-server session_new_rejects_invalid_explicit_cwd_before_spawn`

## 参考

- 类似但不完全相同的先前案例类别：围绕 wrapper／路径处理的 Windows ACP 运行时启动修复（`fix: prefer spawnable Windows wrapper commands for ACP runtimes`，提交 `ac5545c4`）
