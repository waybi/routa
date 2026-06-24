---
title: "QA 裁定写入后评审泳道可能仍处于模糊状态"
date: "2026-04-13"
kind: issue
status: resolved
resolved_at: "2026-04-14"
severity: medium
area: "kanban"
tags: ["review-lane", "kanban", "dual-backend", "qa"]
reported_by: "codex"
related_issues: ["https://github.com/phodal/routa/issues/417"]
github_issue: 417
github_state: closed
github_url: "https://github.com/phodal/routa/issues/417"
---

# QA 裁定写入后评审泳道可能仍处于模糊状态

## 发生了什么

`review` 泳道中的卡片可能保留着有意义的 `verificationVerdict` / `verificationReport`，但仍停留在 `review` 中，使看板状态处于模糊状态。

## 预期行为

一旦最终评审步骤产出了持久化的裁定，任务就应当收敛到一个与该裁定相匹配的明确泳道结果。

## 复现上下文

- 环境：两者皆有
- 触发条件：多步评审泳道（`QA Frontend -> Review Guard`）写入了裁定证据，但没有显式成功的 `move_card`

## 为何可能发生

- 任务证据更新与看板泳道流转是分别建模的，因此裁定的持久化目前并不蕴含泳道收敛。
- 评审泳道是多步且不自动推进的，因此被拒绝或被跳过的 `move_card` 可能让证据与看板状态彼此不同步。

## 相关文件

- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/lane-automation-state.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/core/tools/agent-tools.ts`
- `crates/routa-server/src/application/tasks.rs`

## 观察

- 默认的 `review` 自动化是先 `QA Frontend`，随后 `Review Guard`，其中 `autoAdvanceOnSuccess: false`。
- Next.js 和 Rust 的任务更新路径都会持久化评审证据，但此前两者都未将最终裁定视为收敛信号。

## 参考

- https://github.com/phodal/routa/issues/417

## 解决进展更新（2026-04-21）

- 已将本地跟踪记录同步到已关闭的 GitHub issue `#417`。
- 将上游解决日期记录为 `2026-04-14`；此次清理仅修正本地与 GitHub 之间的状态漂移。
