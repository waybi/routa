---
title: "定义工作区交付记忆（Workspace Delivery Memory）架构并解决 /api/memory API 边界冲突"
date: "2026-04-28"
kind: issue
status: open
severity: high
area: "agent-memory"
tags:
  - agent-memory
  - workspace-memory
  - task-adaptive-harness
  - role-memory
  - api-boundary
  - architecture
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md"
  - "docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md"
  - "docs/issues/2026-04-25-reasoning-bank-style-agent-experience-memory.md"
github_issue: 538
github_state: open
github_url: "https://github.com/phodal/routa/pull/538"
references:
  - "https://github.com/phodal/routa/issues/301"
  - "https://github.com/phodal/routa/issues/535"
  - "https://github.com/phodal/routa/issues/515"
  - "https://github.com/phodal/routa/issues/516"
  - "https://github.com/phodal/routa/blob/main/docs/ARCHITECTURE.md"
  - "https://github.com/phodal/routa/blob/main/docs/product-specs/FEATURE_TREE.md"
  - "https://docs.langchain.com/oss/python/concepts/memory"
  - "https://docs.mem0.ai/core-concepts/memory-types"
  - "https://docs.letta.com/guides/core-concepts/stateful-agents/"
  - "https://help.getzep.com/graph-overview"
  - "https://arxiv.org/abs/2507.05257"
---

# 定义工作区交付记忆（Workspace Delivery Memory）架构并解决 /api/memory API 边界冲突

## 发生了什么

Routa 已经积累了一套强大的任务/会话/Trace/评审编排原语，近期的若干 issue 也已经指向了角色记忆外置化与任务自适应历史水合（hydration）。

然而，对于作为产品概念的 **工作区交付记忆（Workspace Delivery Memory）**，目前仍然没有一套统一、明确的架构来覆盖以下各层：

- 会话工作记忆（session working memory）
- 角色范围记忆（ROUTA / CRAFTER / GATE）
- 跨会话交付记忆记录
- 任务启动上下文注入包

围绕 `/api/memory` 还存在命名/语义冲突：

- 产品文档/功能树描述的是工作区记忆记录
- 现有实现把这个接口用于运行时/进程记忆监控以及清理/调试端点

这种冲突会在 API 契约、UI 标签以及跨后端一致性方面带来长期的混乱风险。

## 当前进展 - 2026-04-30

P0 级别的 API 边界拆分已经落地：

- `/api/system/memory` 现在是 Next.js 与桌面端 Axum 中规范的运行时/进程记忆监控路由。
- `/api/memory` 保留为运行时记忆监控的已弃用兼容别名，并返回弃用（deprecation）响应头。
- 设置页的系统信息页脚现在调用 `/api/system/memory`。
- `api-contract.yaml`、`docs/ARCHITECTURE.md` 和 `docs/product-specs/FEATURE_TREE.md` 已将运行时诊断路由与工作区交付记忆分开描述。

此跟踪记录仍保持开启状态，用于尚未实现的产品域层：`/api/workspace-memory`、`/api/agent-memory` 和 `/api/memory-pack`。

## 去重背景

- #301 覆盖了角色记忆的基线工作，应保持关闭状态。
- #535 跟踪推理策略/经验记忆，是一个更窄的子轨道。
- 本 PR 跟踪更广义的工作区交付记忆架构，以及此前阻碍清晰实现的 API 边界冲突。

## 预期行为

Routa 应将记忆正式定义为 **工作区范围的交付上下文**，而不是通用的聊天历史持久化。

该架构应定义四层：

1. `Session Working Memory` — 会话内交接状态
2. `Role Memory` — 文件支撑的 ROUTA/CRAFTER/GATE 记忆
3. `Workspace Delivery Memory` — 跨会话的、有证据支撑的持久记录
4. `Task-Adaptive Memory Pack` — 面向新任务的最小化即时上下文包

Routa 还应拆分 API 接口以消除歧义：

- `/api/system/memory` 用于运行时/进程监控
- `/api/memory` 作为迁移期间运行时/进程监控的已弃用兼容别名
- `/api/workspace-memory` 用于跨会话记忆记录
- `/api/agent-memory` 用于会话/角色工作记忆
- `/api/memory-pack` 用于任务自适应包的组装

## 复现背景

- 环境：两端（Web 端 + 桌面端语义）
- 触发：将功能树中的记忆语义与当前 `/api/memory` 的运行时监控行为进行对比，并审阅当前与记忆相关的 issue 待办（#301 / #515 / #516）

## 为什么可能会出现这种情况

- 记忆能力是从诊断与 Harness 特性中逐步演进而来的，没有一套规范的域契约。
- 现有原语（Trace/会话/评审/产物）已经很丰富，但晋升/分类/检索的生命周期尚未规范化。
- 产品命名在区分系统指标记忆与交付记忆域之前，复用了一个通用的 `/api/memory` 路由。

## 建议方向

### P0 — 域与命名契约

- 声明工作区交付记忆的范围与非目标（non-goals）。
- 明确将记忆监控与 Agent 记忆产品 API 区分开。

### P1 — 优先做角色工作记忆 + 记忆包

- 实现角色记忆的写入/读取接口。
- 从历史证据编译出最小化的任务自适应记忆包。
- 在卡片详情/精炼 UI 中展示记忆/Harness 摘要。
- 记录每个会话注入了哪些记忆项。

### P2 — 工作区记忆存储

- 引入 `MemoryRecord` 模型（语义/情节/程序性/评审/摩擦/决策）。
- 以可读文件 + 可查询索引（依运行时不同采用 SQLite/Postgres）作为存储后端。
- 要求带有证据引用（Trace/会话/文件/评审/产物/提交）。

### P3 — 晋升流水线与治理

- 捕获 → 分类 → 证据绑定 → 去重/矛盾检查 → 评分 → 晋升。
- 自动晋升低风险记忆；对高风险的程序性/策略性记忆设置门控。
- 增加检查/编辑/删除/弃用/TTL 的控制项，以及无记忆/不晋升模式。

### P4 — Harness 评估

将记忆质量指标纳入 Harness/适应度函数：

- 相关召回率
- 精确度/噪声
- 过期记忆使用率
- 证据覆盖率
- 上下文 token 节省量
- 阻塞/返工/评审失败影响
- 遗忘正确性

## 验收标准

- 记忆域术语与 API 边界在文档和实现中清晰无歧义。
- 通过明确的路由拆分与兼容性弃用元数据，消除 `/api/memory` 的语义冲突。
- 角色记忆与记忆包契约已定义且可追溯。
- 工作区记忆记录有证据支撑、可查询且具备生命周期管理。
- 程序性记忆的变更在影响 Specialist 行为之前需经 Gate/人工审批。
- 记忆质量出现在 Harness/适应度评估流程中。

## 相关文件

- `docs/ARCHITECTURE.md`
- `docs/product-specs/FEATURE_TREE.md`
- `api-contract.yaml`
- `src/app/api/system/memory/route.ts`
- `src/app/api/memory/route.ts`
- `crates/routa-server/src/api/memory.rs`
- `crates/routa-server/src/api/mod.rs`
- `src/client/components/settings-panel.tsx`
- `src/core/kanban/context-preload.ts`
- `src/core/trace/`
- `src/core/orchestration/`

## 参考资料

- https://github.com/phodal/routa/issues/301
- https://github.com/phodal/routa/issues/535
- https://github.com/phodal/routa/issues/515
- https://github.com/phodal/routa/issues/516
- https://docs.langchain.com/oss/python/concepts/memory
- https://docs.mem0.ai/core-concepts/memory-types
- https://docs.letta.com/guides/core-concepts/stateful-agents/
- https://help.getzep.com/graph-overview
- https://arxiv.org/abs/2507.05257
