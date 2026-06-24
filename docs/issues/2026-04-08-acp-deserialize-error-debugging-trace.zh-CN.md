---
title: "Codex 权限流程中 ACP failed to deserialize response 错误的根因是终端响应 schema 漂移"
date: "2026-04-08"
status: resolved
severity: high
area: acp
tags: ["acp", "codex", "debugging", "terminal", "schema", "observability"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/399", "https://github.com/phodal/routa/issues/401"]
resolved_at: "2026-04-08"
---

# Codex 权限流程中 ACP failed to deserialize response 错误的根因是终端响应 schema 漂移

## 发生了什么

在早先的权限请求修复合入后，Codex 会话不再以一个笼统的应用侧 `Internal error` 失败。

可见的失败转变为一个 ACP 侧的反序列化错误：

```text
POST /api/acp 200 in 12.9s
[browser] Failed to send prompt {
  code: -32000,
  data: {
    code: -32603,
    data: "failed to deserialize response",
    source: "acp"
  },
  message: "Internal error"
}
```

时序模式是稳定的：

1. `session/request_permission` 从 `codex-acp` 抵达
2. 权限响应迅速返回
3. 原始的 `session/prompt` 保持打开 10 秒以上
4. 该 prompt 随后以 `source: "acp"` 和 `failed to deserialize response` 失败

## 为什么这让人困惑

最初的工作假设是权限响应的结构仍然有误。

这之所以看似合理，是因为：

- 早期构建返回的是非标准的权限载荷
- `codex-acp` 期望 ACP 标准的 `RequestPermissionResponse`
- 失败的那一轮在最终错误之前总是包含一个权限请求

然而，一旦权限响应被规范化为 ACP 的 `selected/cancelled`，反序列化错误仍然能复现。

这意味着出问题的响应很可能是后续的某个客户端 RPC 响应，而不是权限响应本身。

## 调试 Trace

### 阶段 1：移除笼统的包装层

最初的症状只是：

- `code: -32000`
- `message: "Internal error"`
- `source: "app"`

可观测性得到了改进，使得前端保留了嵌套的 ACP 错误载荷，并在聊天记录中暴露出 `acp_status:error` 更新。

这把错误从一个笼统的应用失败变成了：

- `source: "acp"`
- `code: -32603`
- `data: "failed to deserialize response"`

### 阶段 2：核实权限响应 schema

直接检查了 `codex-acp` 和 ACP schema：

- `/Users/phodal/ai/codex-acp/src/thread.rs`
- `/Users/phodal/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/agent-client-protocol-schema-0.10.8/src/client.rs`

确认了期望的响应结构：

```json
{
  "outcome": {
    "outcome": "selected",
    "optionId": "approved"
  }
}
```

以及取消的情况：

```json
{
  "outcome": {
    "outcome": "cancelled"
  }
}
```

Routa 已更新，使所有 `session/request_permission` 响应都使用这一结构。

反序列化错误仍然存在。

### 阶段 3：重新评估批准之后会发生什么

剩下的线索是时序：

- 权限响应几乎立即就完成了
- prompt 只有在更多 Agent 工作发生之后才失败

这强烈暗示问题载荷属于后续的某个 ACP 客户端方法，例如：

- `terminal/create`
- `terminal/output`
- `terminal/wait_for_exit`
- `fs/*`

### 阶段 4：将终端响应结构与 ACP schema 对比

在以下位置检查了终端方法的 ACP schema：

- `/Users/phodal/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/agent-client-protocol-schema-0.10.8/src/client.rs`

相关发现：

- `CreateTerminalResponse` 需要 `terminalId`
- `TerminalOutputResponse` 需要 `output`、`truncated`，以及可选的 `exitStatus`
- `WaitForTerminalExitResponse` 展平了 `exitCode` 和 `signal`

Routa 在 `src/core/acp/terminal-manager.ts` 中的实现返回的是简化后的结构：

- `terminal/output` 只返回 `{ output }`
- `terminal/wait_for_exit` 只返回 `{ exitCode }`

这些对于 Routa 的内部消费方是有效的，但对于 ACP 生成的 Rust 类型而言是无效的。

## 根本原因

剩余的 Codex 失败是由 ACP 终端响应 schema 漂移导致的，而不是权限响应本身。

在权限被授予后，`codex-acp` 继续其轮次，并触发了响应不符合 ACP schema 的终端 RPC。Rust 客户端随后无法反序列化 JSON-RPC 的 `result`，并暴露出：

```text
failed to deserialize response
```

## 修复

`src/core/acp/terminal-manager.ts` 已更新，使 ACP 终端响应符合 schema：

- `getOutput()` 现在在可用时返回 `output`、`truncated` 和 `exitStatus`
- `waitForExit()` 现在返回 `exitCode` 和 `signal`
- 终端退出状态现在同时跟踪退出码和信号
- 在启动进程之前，会先规范化 ACP 风格的 `env: [{ name, value }]` 数组

回归覆盖已添加在：

- `src/core/acp/__tests__/terminal-manager.test.ts`

## 相关文件

- `src/core/acp/terminal-manager.ts`
- `src/core/acp/__tests__/terminal-manager.test.ts`
- `src/core/acp/acp-process.ts`
- `src/client/hooks/use-acp.ts`
- `src/client/components/chat-panel/hooks/message-processor.ts`
- `/Users/phodal/ai/codex-acp/src/thread.rs`
- `/Users/phodal/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/agent-client-protocol-schema-0.10.8/src/client.rs`

## 为什么这很重要

本次事件并非单个 bug。它是一个分层的 ACP 集成失败：

1. Next.js 与 Rust 之间的权限处理一致性存在差异
2. UI 渲染隐藏了真实的权限载荷
3. 错误传播把下游失败坍缩成了 `Internal error`
4. 剩余的协议不匹配存在于终端 RPC 响应中

如果不保留中间的 ACP 错误细节，终端 schema 这个 bug 会一直伪装成权限失败。

## 额外发现：陈旧的嵌入式会话被静默重建

后来在看板卡片 `chore(deps): update sha2 requirement from 0.10 to 0.11` 上的复现，暴露出了第二种失败模式，它让早先的调试更加嘈杂：

- `GET /api/acp` 正确地以租约 / 所有者错误拒绝了陈旧的嵌入式会话
- 而 `session/prompt` 的 `POST /api/acp` 在内存中进程已消失时仍可能落入 prompt 自动创建
- 这为同一个 `sessionId` 重建了一个全新的 Codex 进程
- 重建出的进程可能以已恢复或回退的元数据运行，而这些元数据已不再匹配原始的活动执行上下文

观察到的效果：

- 同一个 `sessionId` 看起来在“持续失败”，尽管底层进程已经改变
- prompt 重试可能从绑定 worktree 的上下文漂移回仓库根目录
- 记录历史把旧的失败证据与新的进程事件混在一起，使得协议诊断显得前后不一致

这意味着在调查过程中存在两类截然不同的问题：

1. 真正的 ACP 响应结构 bug
2. 陈旧嵌入式会话恢复的缺口，它静默地重建会话，而不是暴露出一个硬性的所有权错误

prompt 自动创建路径现在需要与 SSE 挂载路径相同的嵌入式所有权守卫，否则跨实例重启将继续产生误导性的复现。

## 复现期间观察到的 UI 影响

同一次复现还暴露出一个记录工效学问题：

- 已完成的权限请求被折叠成视觉上很大的卡片
- 折叠状态常常只显示 `Request permissions`
- 除非原始的待处理载荷保持可见，否则有用的 MCP / 命令上下文会被完全隐藏

这使得陈旧会话和协议调试更加困难，因为已完成的批准看起来像是空白的占位符。

针对已完成权限请求的 UI 方向现在是：

- 默认渲染为紧凑的单行摘要
- 保持结果标签可见（`Allow`、`Allow for this session` 等）
- 提供点击展开的详情，而不是占用整个记录的高度
