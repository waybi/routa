---
title: "Harness 治理循环语义漂移"
date: "2026-03-28"
status: resolved
severity: medium
area: "ui"
tags: ["harness", "governance-loop", "react-flow"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-03-29-harness-build-test-yaml-driven-panels-and-density.md"
resolved_at: "2026-04-11"
resolution: "已合并到更宽泛的 harness 构建/测试与治理循环界面跟踪记录中，因为图形语义漂移只是同一 UI 家族内一个更窄的呈现层症状。"
---

# 治理循环布局不再匹配 Harness 语义

## 发生了什么

`/settings/harness` 上的治理循环可视化在迭代式 UI 调优过程中偏离了预期的循环语义。

观察到的问题：

- `Execution Plan` 不再读起来像是 submit 反馈循环的一部分。
- `Evidence` 读起来像是本地或共享节点，而不是远程/外部的反馈节点。
- `CLAUDE.md` / `AGENTS.md`、`Fitness Files` 和 `Hook Runtime` 在各个循环之间的视觉分组不一致。
- GitHub Actions 自愈路径（`ci-red-fixer`）最初显示为独立卡片，后来又显示为自循环，但循环归属始终不清晰。

## 预期行为

图形应当清晰地传达各个 harness 层级：

- 内部循环：仓库规则手册 + 适应度函数定义
- submit 循环：hook runtime + execution plan
- 外部循环：GitHub Actions + evidence + CI 自愈

## 复现上下文

- 环境：web
- 触发条件：打开 `/settings/harness` 并将节点摆放与当前 harness 语义进行对比

## 可能的原因

- 环形叠加层使用了独立于 React Flow 节点布局的绝对定位。
- 节点的语义归属在视觉迭代过程中发生了变化，但环形边界和标签并未根据这些语义重新计算。
- 当前图形将用户顺序流、反馈循环归属和工作流恢复行为混合在一张固定的坐标映射中。

## 相关文件

- `src/client/components/harness-governance-loop-graph.tsx`
- `src/app/api/harness/github-actions/route.ts`
- `src/app/api/harness/hooks/route.ts`
- `src/core/github/ci-red-fixer.ts`
- `.github/workflows/ci-red-fixer.yml`

## 观察

- `ci-red-fixer` 是一条真实的 GitHub Actions 修复路径，而不仅仅是一个通用的远程工作流。
- 当前图形在视觉上已经很接近，但当节点移动时，语义分组仍会发生偏移。

## 去重说明

本记录作为治理循环图形症状的证据予以保留，但
不再作为独立的活跃 issue 进行跟踪。该 UI 家族的权威本地
跟踪记录为
`docs/issues/2026-03-29-harness-build-test-yaml-driven-panels-and-density.md`。
