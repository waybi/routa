--- SOURCE START ---
---
title: "Harness 治理闭环构建阶段缺少实时构建元数据"
date: "2026-03-29"
status: resolved
severity: medium
area: "ui"
tags: ["harness", "governance-loop", "build", "metadata"]
reported_by: "codex"
related_issues: [
  "https://github.com/phodal/routa/issues/245",
  "docs/issues/2026-03-28-harness-governance-loop-semantic-drift.md",
  "docs/issues/2026-03-29-harness-governance-loop-panel-orchestration-gap.md",
  "docs/issues/2026-03-29-harness-build-test-yaml-driven-panels-and-density.md"
]
resolved_at: "2026-04-11"
resolution: "已并入更宽泛的构建/测试 Harness 问题，因为缺失构建元数据只是同一个缺失配置契约与紧凑 UI 问题的一个更狭窄的表征。"
---

# 治理闭环构建阶段仍是静态标签，而非实时仓库信号

## 发生了什么

在 `/settings/harness?workspaceId=default` 上，`Governance loop` 图已经由以下内容的实时数据支撑：

- fitness specs
- execution plan
- hook runtime
- instruction file
- GitHub Actions workflows

但 `构建` 节点仍然渲染一个固定备注 `本地集成 / 运行准备`，并未展示来自所选仓库或当前 Harness 快照的任何真实构建相关元数据。

在检查过程中，页面其实已经加载了包含诸如 `generatedAt` 等时间戳的实时载荷，而且周边系统在其他地方也已具备 version / revision 信号。这些目前都没有出现在治理闭环的页头、节点详情或构建阶段上下文中。

## 预期行为

当选定某个仓库时，`Governance loop` 应当让人一眼看出构建阶段展示的是新鲜的、特定于该仓库的状态，而非一个概念性的占位符。

至少，构建阶段应当暴露能回答如下问题的实时元数据：

- 该图所描述的是哪个仓库快照
- Harness 数据是何时生成的
- 所展示的构建上下文是新鲜还是陈旧
- 当前构建上下文属于哪个分支 / revision / version

## 复现上下文

- 环境：Web 端
- 触发方式：打开 `http://localhost:3000/settings/harness?workspaceId=default`
- 观察到的仓库：`phodal/routa`

## 可能的原因

- `HarnessGovernanceLoopGraph` 当前将传入的 API 载荷归约为粗粒度摘要和静态节点备注。
- 该图的页头只渲染仓库标签、tier 和聚合计数，因此传输层元数据在到达 UI 之前就被丢弃了。
- 构建阶段没有专属的数据契约；与 hooks、plan 或 workflows 不同，它在图中仅作为一个概念性步骤来表示。

## 相关文件

- `src/app/settings/harness/page.tsx`
- `src/client/hooks/use-harness-settings-data.ts`
- `src/client/components/harness-governance-loop-graph.tsx`
- `src/app/api/fitness/specs/route.ts`
- `src/app/api/fitness/plan/route.ts`
- `src/app/api/harness/hooks/route.ts`
- `src/app/api/harness/instructions/route.ts`
- `src/app/api/harness/github-actions/route.ts`
- `src/app/api/health/route.ts`
- `crates/routa-server/src/lib.rs`
- `crates/routa-core/src/trace/vcs.rs`

## 观察

- `useHarnessSettingsData` 已经抓取了五个实时端点，且所有响应类型都包含 `generatedAt`。
- 所选仓库在渲染该图之前就已携带仓库标识和分支上下文。
- 应用在 `/api/health` 中已有现成的 version 信号，并在 trace 工具中提供 git revision 辅助函数，因此缺失的主要是 UI 集成以及一个稳定的构建阶段数据形态。

## 去重说明

本记录作为证据保留，但不再作为独立的活跃 issue。权威的本地跟踪记录是
`docs/issues/2026-03-29-harness-build-test-yaml-driven-panels-and-density.md`。

--- SOURCE END ---
