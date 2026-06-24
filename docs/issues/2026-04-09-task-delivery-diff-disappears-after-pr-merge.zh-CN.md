---
title: "任务交付 diff 在 PR、合并或基线分支同步后消失"
date: "2026-04-09"
status: resolved
severity: high
area: "kanban"
tags: ["kanban", "task-changes", "git", "pull-request", "delivery-evidence"]
reported_by: "human"
related_issues:
  - "docs/issues/2026-04-07-task-changes-api-performance.md"
  - "docs/issues/2026-04-09-next-task-api-head-of-line-blocking.md"
resolved_at: "2026-04-28"
resolution: "任务交付快照现在会持久化不可变的交付证据，并且当实时 diff 范围变空时，changes API 会回退到快照。"
---

# 任务交付 diff 在 PR、合并或基线分支同步后消失

## 发生了什么

看板卡片详情的 `Changes` 标签页在交付前能够正确显示已提交的任务变更。在观察到的卡片中，该标签页显示了：

- 一个已提交的实现 commit，
- 5 个变更文件，
- 相对于 `origin/main` 的已提交变更摘要，
- 以及没有本地 worktree 变更。

当实现通过 PR 提交、合并、快进（fast-forward），或以其他方式与基线分支同步后，同一个任务可能不再显示变更文件。尽管该任务有已交付的 commit 和可供评审的实现，工作看起来却像是“没有 diff”。

## 预期行为

一个已完成或可评审的任务应当持续显示为该任务交付的代码证据。

卡片应当区分：

- **任务交付变更**：实现该任务的、被冻结的 commit / PR / 基线到 head 的范围。
- **当前 worktree 变更**：任务 worktree 中实时的已暂存、未暂存或领先于基线的状态。

合并 PR 或更新 `origin/main` 不应从卡片详情中抹去任务的交付证据。

## 复现上下文

- 环境：Web 端 / 桌面端
- 触发步骤：
  1. 让一个任务经历开发流程，并在其 worktree 或特性分支上提交实现。
  2. 打开卡片详情的 `Changes` 标签页，观察已提交的变更列表。
  3. 创建 / 提交 PR、合并它、同步基线分支、对 worktree 执行快进，或清理 worktree。
  4. 重新打开同一个卡片详情。

2026-04-09 观察到的截图上下文：

- 卡片标题：`[Sub-issue] 为 GATE-first 专家提示注入单次 trace 状态摘要`
- UI 显示了已提交的 commit `e3e5fe67`
- 在提出该问题之前，UI 显示了 5 个变更文件

## 为何可能发生

当前的任务变更端点是从任务的**当前仓库状态**派生已提交的变更。

`GET /api/tasks/[taskId]/changes` 会先构建交付就绪状态（delivery readiness），然后向 Git 查询某个移动范围内的 commit：

```text
<deliveryReadiness.baseRef>..HEAD
```

这对于回答“分支当前是否领先于基线？”是合适的，但它不是一份稳定的交付记录。

可能导致 diff 消失的路径：

- 任务的实现 commit 被合并到 `origin/main`，于是 `origin/main..HEAD` 变为空。
- 任务 worktree 在 PR 工作之后被重置、移除、切换或快进。
- 在基线已前进到包含任务 commit 之后，`deliveryReadiness.baseRef` 被重新解析。
- UI 只持有实时 `/changes` 响应返回的 commit 行，因此没有持久化的 commit SHA 列表可供回退。
- 当 SHA 已知时，单个 commit 的 diff 端点仍能加载 `git show <sha>`，但在实时范围变空后，卡片不再列出该 SHA。

## 建议的产品方向

当任务进入评审、到达完成、开始 PR 交接，或成功开启 PR 时，持久化一份任务级别的交付快照。

该快照应使用不可变的 Git 标识符，例如：

```ts
interface TaskDeliverySnapshot {
  baseRef?: string;
  baseSha: string;
  headSha: string;
  commitShas: string[];
  prUrl?: string;
  prNumber?: number;
  changedFiles?: Array<{
    path: string;
    previousPath?: string;
    status?: string;
    additions?: number;
    deletions?: number;
  }>;
  capturedAt: string;
}
```

`Changes` 标签页应优先使用快照来呈现“任务交付变更”部分，然后单独显示实时的 worktree / 已暂存 / 未暂存 / 领先于基线的状态。

## 相关文件

- `src/app/api/tasks/[taskId]/changes/route.ts`
- `src/app/api/tasks/[taskId]/changes/commit/route.ts`
- `src/app/workspace/[workspaceId]/kanban/components/kanban-task-changes-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-diff-preview.tsx`
- `src/core/git/git-utils.ts`
- `src/core/kanban/task-delivery-readiness.ts`
- `src/core/models/task.ts`
- `src/app/workspace/[workspaceId]/types.ts`

## 观察

相关的当前实现：

- `src/app/api/tasks/[taskId]/changes/route.ts` 调用 `buildTaskDeliveryReadiness(task, system)`。
- 仅当 `deliveryReadiness.hasCommitsSinceBase` 与 `deliveryReadiness.baseRef` 为真值时，它才返回已提交的变更。
- `src/core/git/git-utils.ts` 将 `getRepoCommitChanges()` 实现为 `git log <baseRef>..HEAD`。
- `src/app/api/tasks/[taskId]/changes/commit/route.ts` 通过显式 SHA 加载所选 commit 的 diff。

这意味着，如果卡片存储或能够恢复 SHA，现有 UI 已经具备渲染稳定 commit 所需的机制。

## 参考

- 来自 2026-04-09 dogfood 截图的用户报告。

## Issue 卫生

- 2026-04-28：在确认 `TaskDeliverySnapshot`、在评审/完成/PR 交接时的捕获、快照持久化，以及 `/api/tasks/[taskId]/changes` 快照回退均已实现后，标记为已解决。
