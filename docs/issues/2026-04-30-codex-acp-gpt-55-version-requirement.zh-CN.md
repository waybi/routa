---
title: "codex-acp 因已安装的 Codex 版本过旧而拒绝 gpt-5.5"
date: "2026-04-30"
kind: issue
status: resolved
severity: medium
area: "acp"
tags:
  - codex-acp
  - codex
  - acp
  - kanban
  - external-dependency
reported_by: "phodal"
github_issue: 540
github_state: closed
github_url: "https://github.com/phodal/routa/issues/540"
---

# codex-acp 因已安装的 Codex 版本过旧而拒绝 gpt-5.5

## 发生了什么

为看板 ACP 任务会话自动发送提示词（auto-prompt）时失败，UI 层只显示了一个笼统的内部错误：

```text
Internal error
```

服务端日志显示真正的上游失败来自 `codex-acp`：

```text
[AcpProcess:Codex stderr] ERROR codex_acp::thread: Unhandled error during turn:
{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}}
```

随后 Routa 通过 ACP 提示词路径暴露出该 Provider 失败：

```text
[kanban] Failed to auto-prompt ACP task session: Error: Internal error: acp: -32603
    at consumeAcpPromptResponse (src/core/acp/prompt-response.ts:148:13)
    at async dispatchSessionPrompt (src/core/acp/session-prompt.ts:1086:3)
    at async (src/core/kanban/agent-trigger.ts:654:5)
```

## 复现上下文

- 触发条件：使用 Codex Provider 进行看板自动提示 ACP 任务会话。
- 邻近请求：`GET /api/clone/branches?repoPath=.../.routa/repos/phodal--routa` 成功返回 `200`。
- Provider stderr：`gpt-5.5` 需要更新版本的 Codex 应用或 CLI。

## 根因

这是一个外部适配器/运行时兼容性问题，而非 Routa 的路由失败。

`codex-acp` 接受了该会话回合，但已安装的 Codex 应用/CLI 版本过旧，无法支持所请求的 `gpt-5.5` 模型。可行的修复方式是更新 `@zed-industries/codex-acp` 以及该适配器底层所用的 Codex 应用/CLI。

Routa 当前的行为仍值得追踪，因为 UI 只显示了一个笼统的 ACP 内部错误，而有用的根因却停留在 Provider 的 stderr 中。

## 解决方案

作为外部依赖/版本追踪问题关闭。

建议运维操作：

```bash
npm install -g @zed-industries/codex-acp@latest
```

如果重新安装适配器后 `codex-acp` 仍报告相同的模型兼容性错误，也请升级 Codex 应用/CLI。

## 后续跟进

Routa 后续可能改进 Provider 错误的传播方式，在安全可暴露的前提下，让 ACP 提示词失败时一并包含 Provider stderr 中的根因。
