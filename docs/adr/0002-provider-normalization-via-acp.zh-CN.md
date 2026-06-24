# ADR 0002: 通过 ACP 实现 Provider 归一化

- Status: accepted
- Date: 2026-02-28
- Derived from: [issue #33](https://github.com/phodal/routa/issues/33)

## Context

Routa.js 编排多种 Agent 运行时：Claude Code SDK（stream-json）、OpenCode（ACP 原生）以及未来可能的其他运行时。每个 Provider 发出的事件形态各不相同，进程管理方式各异，并且有各自不同的安装/预热要求。

问题在于：是让 Provider 特定的协议细节贯穿整个系统（新增 Provider 更快），还是把一切都归一化到单一协议层之后（单个 Provider 更难接入，但领域代码和 UI 代码更简单）。

## Decision

所有 Agent 运行时都通过各 Provider 的适配层归一化到 ACP（Agent Client Protocol）：

```
Provider process or bridge
  → provider-specific output / notifications
  → adapter normalization
  → unified session updates
  → persistence, traces, UI streaming
```

关键实现：
- ACP 是 Agent CLI 的主要执行传输层
- Claude Code SDK 的 stream-json 通过 `claude-code-sdk-adapter.ts` 被翻译为类 ACP 的更新
- Docker 支撑的 Provider 通过 `src/core/acp/docker/` 使用同样的适配器模式
- 按会话的模型配置取代了全局环境变量的模型选择（issue #33）
- `src/core/acp/provider-registry.ts` 中的 Provider 注册表抽象了发现与实例化

## Consequences

- 新 Provider 必须实现一个适配器，将其输出归一化为统一的会话更新。领域层永远不会看到原始的 Provider 事件。
- 会话持久化、Trace 与 UI 流式代码只需针对归一化接口编写一次。
- Rust 后端在 `crates/routa-core/src/acp/` 中以其自有的一套适配器镜像了这一点。
- 模型分层选择（每个 Agent 角色用哪个模型）是 Provider 层的关注点，而非领域层的关注点。

## Code References

- `src/core/acp/provider-registry.ts` — Provider 发现与注册
- `src/core/acp/claude-code-sdk-adapter.ts` — Claude Code SDK → ACP 归一化
- `src/core/acp/acp-session-manager.ts` — 会话生命周期管理
- `src/core/acp/provider-adapter/` — 各 Provider 的适配器
- `crates/routa-core/src/acp/` — Rust ACP 子系统
