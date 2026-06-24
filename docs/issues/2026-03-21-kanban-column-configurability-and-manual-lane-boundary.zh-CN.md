---
title: "看板列不是一等可配置对象，且手动泳道缺乏清晰的产品边界"
date: "2026-03-21"
status: resolved
resolved_at: "2026-03-22"
severity: high
area: "kanban"
tags: ["kanban", "columns", "ux", "automation", "workflow"]
reported_by: "OpenAI Codex"
github_issue: 219
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/219"
related_issues:
  - "2026-03-19-kanban-flow-observability-and-control-gaps.md"
  - "https://github.com/phodal/routa/issues/219"
---

# 看板列不是一等可配置对象，且手动泳道缺乏清晰的产品边界

## 发生了什么

在 `http://localhost:3000/workspace/default/kanban` 审阅实时看板时发现，列的表现更像是固定的展示槽位，而不是可配置的工作流对象。

观察到的特征：

- 看板列采用固定宽度布局，因此根据可见列的数量，看板会在大片未使用的空白与强制横向滚动之间来回切换
- 可见的列控件只暴露了可见性与自动化开关，而没有更广泛的列级配置
- 每一列的主看板表头只呈现名称、卡片数量，以及一段被截断的自动化摘要
- 设置体验以自动化配置为中心，使得「配置列」与「配置 Agent 自动化」几乎无法区分

这还暴露出一个重要的产品边界问题：某些列，尤其是 `blocked`，本就是有意设计的手动泳道，不应被当作自动化尚未完成的泳道来对待。

## 期望行为

看板列应当表现为一等可配置的工作流单元。

这意味着产品应当清晰地区分：

- 结构性列设置，例如可见性、顺序、宽度或密度、泳道角色以及呈现方式
- 针对应触发 ACP 行为的列的可选自动化设置
- 明确的手动列，包括 `blocked` 这类泳道，其中「不自动化」是预期行为，而非配置缺失

## 复现上下文

- 环境：Web 端
- 触发方式：打开 `http://localhost:3000/workspace/default/kanban`，检查可见的看板布局，然后打开看板的 `Settings` 弹窗，查看左侧的 `Stages` 映射与右侧的阶段配置工作区

## 为何可能发生

- 当前的列模型只存储了一组很窄的属性（`id`、`name`、`color`、`position`、`stage`、可选的 `visible`、可选的 `automation`），因此 UI 几乎没有空间去表达更丰富的列行为。
- 当前的设置信息架构围绕泳道自动化做了优化，这使得结构性的列设计显得次要。
- 该产品模型似乎把「列可以拥有自动化」与「列应当具备自动化感知」混为一谈，从而削弱了普通执行泳道与诸如 `blocked` 这类有意手动的泳道之间的区分。

## 相关文件

- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx`
- `src/core/models/kanban.ts`
- `src/app/workspace/[workspaceId]/types.ts`
- `crates/routa-core/src/models/kanban.rs`

## 观察

- 浏览器审阅是针对 `http://localhost:3000/workspace/default/kanban` 这一实时本地页面进行的。
- 当前看板实现将每一列固定为 `18rem` 宽度，并根据可见列数量推导出看板的最小宽度。
- 当前的设置弹窗主要把阶段配置当作自动化配置来处理。
- 像 `blocked` 这样的列即使完全不带自动化，也需要保持为一个有效的一等列。

## 参考资料

- 审阅期间捕获的本地浏览器截图：`/tmp/kanban-review-fresh.png`
- GitHub issue：`https://github.com/phodal/routa/issues/219`

## 解决方案

该问题已在当前代码库中解决，对应的上游 GitHub issue 也已关闭。

当前实现中的证据：

- `src/core/models/kanban.ts` 现在使用包含 `visible` 和 `width` 等结构性属性
  （以及自动化）来建模列。
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx` 定义了
  `MANUAL_ONLY_STAGES`，将 `blocked` 视为仅手动泳道，并将工作流模式与自动化状态分离。
- 同一个设置弹窗现在暴露了列级控件，用于配置阶段、宽度、看板可见性，并为 `blocked`
  提供仅手动徽标，而不再把该界面当作仅自动化的配置。
- `crates/routa-core/src/models/kanban.rs` 为 Rust 侧看板数据携带了匹配的结构性字段，
  包括 `visible` 和 `width`。
