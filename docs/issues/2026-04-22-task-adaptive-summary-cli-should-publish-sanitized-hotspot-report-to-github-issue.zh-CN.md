---
title: "Task-Adaptive 摘要 CLI 应将脱敏后的热点报告发布到 GitHub issue"
date: "2026-04-22"
kind: issue
status: resolved
severity: medium
area: "devops"
tags:
  - task-adaptive
  - github
  - issue-enricher
  - cli
  - friction-profile
  - summary
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-feature-explorer-hotspot-auto-retro-for-task-adaptive-memory.md"
  - "docs/issues/2026-03-12-gh-128-feedback-sync-github-issues-to-local-docs-issues-for-duplicate-detection.md"
github_issue: 525
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/525"
---

# Task-Adaptive 摘要 CLI 应将脱敏后的热点报告发布到 GitHub issue

## 发生了什么

`task-adaptive` 已经可以从 Trace 历史、可复用的摩擦画像（friction profile）以及 feature-tree 提示中恢复出丰富的本地上下文，但目前没有一种轻量方式可以把这些上下文的一份可供人工审阅的快照发布到 GitHub。

这导致当前状态被割裂在以下几处：

- 本地的 `task-adaptive` 分析和摩擦画像存储
- 在仓库或 UI 中临时手工查看
- 尚未承载稳定、可刷新的本地摘要的 GitHub issue

结果是，没有一个单独的 issue 讨论串可以被刷新为最新的本地热点证据，以供后续判断。

## 期望行为

应当有一个本地 CLI，能够：

1. 基于当前仓库以及本地由 Trace 派生的摩擦画像，计算出一份脱敏后的 task-adaptive 热点摘要
2. 将该摘要格式化为一份稳定、适配 GitHub 的报告
3. 在目标 GitHub issue 上创建或更新一条带标记的评论，使得重复运行会替换上一次的摘要，而不是不断刷新增加新评论

发布的报告应当可以安全地在 GitHub 上分享：

- 不含原始 session id
- 不含原始 prompt 片段
- 不含原始命令文本
- 不含本地绝对路径

## 可能的原因

- 当前 task-adaptive 的输出是为本地运行时消费而设计的，而非用于 GitHub 发布
- 摩擦画像保留了有用的信号，但缺少一个面向 issue 报告的脱敏聚合层
- 现有的 GitHub issue 辅助工具覆盖了 issue 的创建/更新，但没有用于可刷新本地摘要面板的评论 upsert 能力
- `issue-enricher` 目前会分析 issue，但没有从本地到 issue 反向报告 task-adaptive 数据的路径

## 建议方向

- 新增一个纯粹的摘要构建器，将摩擦画像转换为脱敏后的热点报告
- 新增 GitHub issue 评论的 list/create/update 辅助方法，以便对带标记的摘要评论进行 upsert
- 在 `scripts/harness/` 下新增一个本地 CLI，用于刷新或加载 task-adaptive 数据并将报告发布到目标 issue
- 创建一个详细的 GitHub issue，作为该能力的审阅讨论串，并接收第一份发布的摘要

## 相关文件

- `src/core/harness/task-adaptive.ts`
- `src/core/kanban/github-issues.ts`
- `scripts/harness/inspect-transcript-turns.ts`
- `.github/scripts/issue-enricher.ts`

## 参考

- 本地相关 issue：`docs/issues/2026-04-21-feature-explorer-hotspot-auto-retro-for-task-adaptive-memory.md`
- 本地相关 issue：`docs/issues/2026-03-12-gh-128-feedback-sync-github-issues-to-local-docs-issues-for-duplicate-detection.md`
- 本地后续 issue：`docs/issues/2026-04-24-task-adaptive-issue-summary-should-rank-product-hotspots-and-recommend-follow-up-files.md`
- GitHub issue：`https://github.com/phodal/routa/issues/525`
- GitHub 后续 issue：`https://github.com/phodal/routa/issues/534`
- 第一份发布的摘要评论：`https://github.com/phodal/routa/issues/525#issuecomment-4298046542`

## 解决方案

- 2026-04-22：在 `src/core/harness/task-adaptive-issue-summary.ts` 中实现了专用的 issue 摘要构建器
- 2026-04-22：在 `src/core/kanban/github-issues.ts` 中新增了 issue 评论的 list/create/update 辅助方法
- 2026-04-22：新增了本地 CLI `scripts/harness/publish-task-adaptive-issue-summary.ts`，并通过 `npm run harness:publish-issue-summary` 暴露
- 2026-04-22：将第一条带标记的摘要评论发布到 GitHub issue `#525`
- 2026-04-24：重新验证核心 CLI 的 publish/upsert 测试仍然通过
- 2026-04-24：将剩余工作收窄为摘要相关性以及后续文件推荐质量；该工作现已单独跟踪
