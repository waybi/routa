---
title: "Next.js ACP CLI 会话被绑定到单个 Web 实例"
date: "2026-03-21"
status: resolved
severity: high
area: "acp"
tags: ["acp", "nextjs", "multi-instance", "session-routing", "sse"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/222"]
github_issue: 222
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/222"
resolved_at: "2026-03-27"
---

# Next.js ACP CLI 会话被绑定到单个 Web 实例

## 发生了什么

从 Next.js 运行时创建的 ACP CLI 会话，其执行与实时更新都依赖于进程本地状态。被拉起的 ACP 进程存储在内存中的 `AcpProcessManager` 里，而浏览器的 SSE 流则挂接到内存中的 `HttpSessionStore`。

当针对同一会话的后续请求落到另一个 Next.js 实例时，第二个实例虽然可以从持久化中加载会话元数据，但并不拥有运行中的 CLI 进程或原始的 SSE 控制器状态。这就在持久化的会话元数据与非持久化的实时执行状态之间形成了割裂。

## 预期行为

无论后续请求落到哪个 Next.js 实例，ACP CLI 会话都应保持可路由、可观测。会话所有权应当是显式且可续约的，实时更新不应依赖某个 Web 实例持续保有其进程本地映射表。

## 复现上下文

- 环境：Web 端
- 触发方式：在一个 Next.js 实例上创建 ACP CLI 会话，然后从另一个实例发送 prompt 或挂接 SSE

## 可能的原因

- 会话执行被内嵌在 Next.js API 运行时中，而非隔离在专用的执行服务之后。
- 会话元数据已被持久化，但运行中进程的所有权与 SSE 投递仅在进程本地内存中被跟踪。
- 当前的 API 契约未持久化显式的 owner 或租约（lease）元数据，使得后续请求无法据此决定是代理转发还是拒绝处理。

## 相关文件

- `src/app/api/acp/route.ts`
- `src/core/acp/acp-process-manager.ts`
- `src/core/acp/http-session-store.ts`
- `src/core/acp/session-db-persister.ts`
- `src/core/db/schema.ts`
- `src/core/db/sqlite-schema.ts`

## 观察

- `getAcpProcessManager()` 与 `getHttpSessionStore()` 都使用 `globalThis`，它能在 HMR 后存活，但仍然是进程本地的。
- 针对 SDK Provider 已存在 serverless 专用的适配器重建逻辑，但通用的 CLI 进程路径仍假设由本地实例持有所有权。
- 会话元数据能够在重启后存活，但运行中的 CLI 路由无法存活。

## 参考

- `docs/ARCHITECTURE.md`

## 进展

- 会话所有权元数据现已在 Next.js ACP 路由中被主动强制执行，而不再只是被动持久化。
- 当某个 `embedded` 会话仍被租约给另一个 `ownerInstanceId` 时，`src/app/api/acp/route.ts` 现在会拒绝 SSE 挂接以及 prompt 类的 ACP JSON-RPC 请求。
- `src/core/acp/execution-backend.ts` 现在暴露了可复用的租约/所有权辅助方法，使得内嵌会话路由能够基于持久化元数据做出显式决策。
- 当前活跃的 owner 实例现在会在 SSE 挂接以及会话方法流量期间续约内嵌会话租约，从而让所有权变为显式且可续约，而不再只是在创建时打上一次标记。
- 在 `src/app/api/acp/__tests__/route.test.ts` 中新增了针对外部 owner 拒绝场景的 ACP 路由回归覆盖。

## 遗留缺口

- 这一改动通过把错误实例的访问转化为显式的协议错误，关闭了静默的脑裂（split-brain）失败模式。
- 它**尚未**为内嵌的 CLI 会话提供完整的跨实例续接或代理转发能力；后续阶段仍需要以下二者之一：
  - 一个专用于 CLI 支撑的 ACP 会话的执行服务 / runner，或
  - 显式的 owner 移交 / 租约接管，并具备可恢复的实时进程语义。

## 验证

- `npx vitest run src/app/api/acp/__tests__/route.test.ts src/core/acp/__tests__/execution-backend.test.ts`
- 2026-03-28 执行 `entrix run --tier normal`：整体 `PASS`，最终得分 `100.0%`
