---
title: "任务自适应 issue 摘要应对产品热点排序并推荐后续检查文件"
date: "2026-04-24"
kind: issue
status: resolved
resolved_at: "2026-04-25"
severity: medium
area: harness
tags:
  - task-adaptive
  - github
  - summary
  - hotspot
  - ranking
  - relevance
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-22-task-adaptive-summary-cli-should-publish-sanitized-hotspot-report-to-github-issue.md"
github_issue: 534
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/534"
---

# 任务自适应 issue 摘要应对产品热点排序并推荐后续检查文件

## 发生了什么

本地到 GitHub 的摘要流水线现已存在，并且已经在发布带标记的摘要评论，但面向 issue 的排序仍然过于字面化。

当前报告可能会把诸如以下的仓库元文件提升排名：

- `docs/fitness/README.md`
- `docs/issues/issue-gc-state.yaml`

使其排在更可能在分诊（triage）期间重要的产品文件之上。

这意味着摘要满足了发布契约，但作为面向评审者的强有力热点指南，它仍有不足。

## 预期行为

发布的摘要应优先呈现对人类最有用、最值得接下来检查的文件和功能。

实践上这意味着：

1. 当两者的 Trace 变动量（churn）相近时，将产品/领域热点排在仓库维护类噪声之上
2. 明确输出一个「推荐优先检查的后续文件」区块，而不是期望评审者从原始热点顺序中自行推断
3. 在提升相关性的同时保持输出经过脱敏处理

## 为何可能发生

- 当前的文件排序主要反映 Trace 频率和时近性，而非评审者效用
- 文档、issue 维护类和 Harness 治理类文件在面向 issue 的摘要层中没有被降权
- 格式化器直接暴露了顶部热点，但尚未派生出一个更聚焦的后续推荐列表

## 建议方向

- 增加 issue 摘要排序启发式规则：在证据大体相近时，优先选择面向产品的源文件而非文档和追踪类文件
- 基于失败严重程度、功能关联度和热点置信度，派生出一个独立的「推荐后续文件」区块
- 增加回归测试，证明对于混合快照，摘要会将产品文件排在仓库维护类文件之前

## 相关文件

- `src/core/harness/task-adaptive-issue-summary.ts`
- `src/core/harness/__tests__/task-adaptive-issue-summary.test.ts`
- `src/core/harness/task-adaptive.ts`

## 初步证据

- GitHub issue `#525` 已包含一条已发布的脱敏摘要评论
- 该摘要目前将 `docs/fitness/README.md` 和 `docs/issues/issue-gc-state.yaml` 列在顶部文件热点之中
- 这对于原始热点透明度而言是可以接受的，但作为面向人类后续跟进的「请先检查这些」推荐则较弱
- GitHub 后续 issue：`https://github.com/phodal/routa/issues/534`

## 解决说明

- 已确认面向 issue 的摘要现在将产品代码和支撑性代码热点排在仓库文档与 issue 追踪噪声之前。
- 已确认格式化器会输出一个专门的 `Recommended Follow-Up Files` 区块，该区块派生自经过排序的产品/支撑性代码候选项。
- 已确认诸如 `docs/issues/issue-gc-state.yaml` 这样的仓库维护类文件仍会出现在原始顶部文件热点中，但在存在更强产品候选项时会被排除在产品后续推荐之外。

## 验证说明

- `npx vitest run src/core/harness/__tests__/task-adaptive-issue-summary.test.ts`
  - PASS（`2 passed`）
