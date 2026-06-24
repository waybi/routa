---
title: "Next.js ACP 桥接层未能解析 Codex 权限请求，并将提示词失败统一折叠为 Internal error"
date: "2026-04-08"
status: resolved
severity: high
area: acp
tags: ["acp", "codex", "nextjs", "permission", "parity", "observability"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/399"]
github_issue: 399
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/399"
resolved_at: "2026-04-08"
---

# Next.js ACP 桥接层未能解析 Codex 权限请求，并将提示词失败统一折叠为 Internal error

## 发生了什么

在 Next.js 运行时中，基于 Codex 的会话可以接受一次提示词、发出 `session/request_permission`，随后却以通用的 `Internal error` 使该提示词失败。

观察到的浏览器/运行时症状：

- `POST /api/acp` 在长时间等待后返回 HTTP 200，但 JSON-RPC 负载中包含错误
- 前端显示 `AcpClientError`，其 `code: -32000`、`message: "Internal error"`
- 日志在提示词失败前立即出现 `"[AcpProcess:Codex] Agent request: session/request_permission"`

## 预期行为

- Codex 权限请求在 Next.js 与 Rust 运行时中应当以相同方式处理
- 如果 Rust 运行时会自动批准 Codex 权限请求，那么 Web 运行时在面对相同形态的请求时不应停滞或失败
- 如果下游适配器失败，对用户可见的错误应保留真实原因，而不是折叠为 `Internal error`

## 为什么会发生

- Rust ACP 后端会为兼容 Codex 的会话自动批准 `session/request_permission`。
- Next.js ACP 桥接层仅在 `autoApprovePermissions === true` 时才自动批准这些请求。
- 正常的 Web 聊天流程不会设置该标志，因此 Codex 权限请求会变成待处理的交互式请求，而不是被立即解析。
- `codex-acp` 随后将一个通用的内部错误沿提示词路径回传，而 Routa 进一步将其包装为通用的 `-32000` 响应。

## 相关文件

- `src/core/acp/acp-process.ts`
- `src/app/api/acp/acp-session-create.ts`
- `src/core/acp/session-prompt.ts`
- `crates/routa-core/src/acp/process.rs`
- `/Users/phodal/ai/codex-acp/src/thread.rs`

## 复现环境

1. 在本地启动 Next.js 应用。
2. 在 Web UI 中创建或复用一个 Codex ACP 会话。
3. 发送一个会导致 Codex 请求额外权限的提示词。
4. 在服务器日志中观察到 `session/request_permission`。
5. 观察到该提示词以 `Internal error` 失败，而不是继续执行。

## 备注

- 这是一个 Web 与 Rust 之间的语义对等性缺陷，而不仅仅是 Codex 适配器的缺陷。
- `codex-acp` 还会将内部失败缩减为通用的 `Internal error`，这使得 Web 端的症状更难诊断。
