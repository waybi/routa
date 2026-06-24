---
title: 架构决策记录
---

# 架构决策记录

塑造 Routa.js 边界、协议与演进的决策的轻量级记录。

## 发现

```bash
claude -p "What ADRs exist in docs/adr/ and what do they decide?"
claude -p "Which ADR governs how agent providers are integrated?"
claude -p "Read ADR 0004 and explain the kanban automation boundary"
```

## 当前的 ADR

| ADR | 决策 | 来源 |
|---|---|---|
| [0001](./0001-dual-backend-semantic-parity.md) | Web 端与桌面端通过 api-contract.yaml 共享领域语义 | 代码结构 |
| [0002](./0002-provider-normalization-via-acp.md) | 所有 Agent 运行时通过适配器层规范化到 ACP | [issue #33](https://github.com/phodal/routa/issues/33) |
| [0003](./0003-workspace-first-scope.md) | 工作区是顶层的协调边界 | [design-doc](../design-docs/workspace-centric-redesign.md) |
| [0004](./0004-kanban-driven-automation.md) | 看板泳道以排队并发触发 ACP 会话 | [issue #96](https://github.com/phodal/routa/issues/96), [issue #148](https://github.com/phodal/routa/issues/148) |
| [0005](./0005-specialist-externalization.md) | 专家以 Markdown+YAML 形式存在并按优先级加载 | [issue #1](https://github.com/phodal/routa/issues/1) |
| [0006](./0006-orchestration-shell-pattern.md) | 复杂文件采用薄壳 + 领域 hooks 结构 | 编码规范 |
| [0007](./0007-kanban-delivery-transition-policies.md) | 看板流转交付门禁作为列策略，在 UI 与 MCP 端统一强制执行 | 本地设计后续跟进 |

## 规则

- ADR 记录那些影响结构、边界或长期演进的决策。
- 不要为琐碎的实现细节或缺陷修复创建 ADR。
- 状态取值：`accepted`、`superseded`、`deprecated`。
- 当某项决策发生变化时，更新现有 ADR 的状态，并创建一个引用它的新 ADR。
