---
title: "Feature Explorer 热点自动复盘应为任务自适应提示编译可复用的摩擦画像"
date: "2026-04-21"
kind: issue
status: open
severity: medium
area: "feature-explorer"
tags:
  - feature-explorer
  - task-adaptive
  - jit-context
  - retro
  - friction-profile
  - kanban
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-jit-context-needs-repo-root-context-discovery.md"
---

# Feature Explorer 热点自动复盘应为任务自适应提示编译可复用的摩擦画像

## 发生了什么

当前 `feature-explorer` 的会话分析仍然主要是针对所选会话的一次性复盘。

`task-adaptive` 已经能够从 Trace 中提取摩擦信号，但这些信号尚未被持久化为可复用的热点画像。其结果是，高频变更的文件和经常被反复访问的功能，在每个新任务上仍然必须从零重新发现。

这意味着 Routa 可能会反复支付相同的探索成本：

- 反复阅读相同的热点文件
- 反复运行相同的发现命令
- 反复遭遇相同的路径解析或文件选择错误
- 反复从原始会话历史中重新推导出相同的本地失败模式

## 期望行为

当某个文件或功能成为热点时，`Feature Explorer` 应自动排队一次异步复盘，编译出结构化的 `friction profile`，而不仅仅是又一份自然语言分析产物。

随后，当当前任务针对相同的文件或功能时，`task-adaptive` 应能够注入该画像，从而让提示装配可以从持久化的既往摩擦记忆出发，而不是从原始 Trace 回放开始。

预期的检索顺序为：

1. 当目标文件已知时，使用文件级 `friction profile`
2. 当只知道功能面时，回退到功能级 `friction profile`
3. 仅当没有可复用画像时，才回退到更宽泛的历史会话分析

## 为何可能发生

- 会话分析的输出尚未被持久化为结构化、可匹配的对象
- 没有一个按 `workspace + repo + file/feature` 聚合的长期摩擦记忆模型
- 没有后台机制为热点排队生成或刷新复盘
- 当前 `task-adaptive` 的装配仍依赖于每次请求的 Trace 解读，而非持久化的热点记忆

## 建议方向

- 新增工作区级别的设置，用于控制热点自动复盘的启用与阈值
- 仅为热点目标排队异步复盘任务，而非所有被触及的文件/功能
- 同时持久化文件级和功能级的 `friction profile` 记录
- 让 `task-adaptive` 优先使用文件级画像，再回退到功能级画像
- 将该画像视为用于提示/运行时装配的结构化记忆，而不仅仅是一份可供人阅读的报告

## 相关文件

- `src/app/workspace/[workspaceId]/feature-explorer/session-analysis.ts`
- `src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx`
- `src/core/harness/task-adaptive.ts`
- `src/core/store/background-task-store.ts`

## 参考

- 本地相关 issue：`docs/issues/2026-04-21-jit-context-needs-repo-root-context-discovery.md`

## Issue 卫生

- 2026-04-28：复审确认仍处于活跃状态。可复用的摩擦画像存储、刷新以及 task-adaptive 消费已经存在，但本文所述的自动异步热点复盘队列尚未确认已实现。
