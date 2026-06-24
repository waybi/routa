---
title: "Backlog 卡片在精炼确认上下文之前不应持久化或消费推测性的历史记忆"
date: "2026-04-22"
kind: issue
status: resolved
severity: medium
area: "kanban"
tags: ["kanban", "backlog", "history-memory", "task-adaptive-harness"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md"
  - "docs/issues/2026-04-22-save-jit-context-minimal-result-persistence.md"
github_issue: 521
github_state: closed
github_url: "https://github.com/phodal/routa/issues/521"
---

# Backlog 卡片在精炼确认上下文之前不应持久化或消费推测性的历史记忆

## 发生了什么

新建的 backlog 卡片可能会累积 `jitContextSnapshot`，并在 backlog 精炼器尚未确认任何特性归属或文件级提示之前，就开始消费 `taskAdaptiveHarness`。

这会在新的 backlog 卡片上产生误导性的「History Memory」：

- 任务本身仍然没有 `contextSearchSpec`
- 该卡片尚未被 backlog 专家精炼
- 但打开历史记忆面板仍然可以填充并持久化一个 `jitContextSnapshot`
- 后续的 backlog 会话可能会把这个推测性快照当作已确认的任务上下文来消费

实际上，这可能会把一个新的 story 锚定到错误的特性家族上。

## 示例

卡片：

- `5f27533f-cc82-4c91-89b0-bb62427bd8db`
- 标题：`[Feature]Add Superpowers skill/spec import support`

观察到的状态：

- `contextSearchSpec` 为 `null`
- `jitContextSnapshot.featureId` 被持久化为 `feature-explorer`
- `jitContextSnapshot.recommendedContextSearchSpec.featureCandidates` 包含 `feature-explorer`
- `History Memory` 显示的是来自 Feature Explorer / fitness / github 工作的重复读取和会话，而不是 Superpowers 导入相关的工作

之所以发生这种情况，是因为卡片标题和单个关联的 backlog 会话就足以触发推测性的任务自适应推断，而其结果随后又被保存回任务上。

## 期望行为

Backlog 生命周期应当更加严格：

1. 新建的 backlog 卡片初始状态应没有 `contextSearchSpec`，也没有持久化的 `jitContextSnapshot`。
2. Backlog 精炼器可以在其自身会话期间使用临时的特性/历史预加载，但该预加载是会话级作用域的，不会自动写回任务。
3. 只有在精炼器明确确认特性/文件提示，并通过 `update_task.contextSearchSpec` 将其写入之后，后续的 backlog/todo/dev 会话才可以消费任务自适应的历史记忆。
4. 对于仍然缺少已确认提示的 backlog 卡片，不应自动进行历史记忆的持久化。

## 为什么这很重要

如果过早地持久化了推测性上下文：

- 错误的特性会在任务上变得粘滞
- 即便没有发生任何精炼，已保存的历史记忆也会开始显得具有权威性
- 后续泳道会继承误导性的提示词
- 用户会对「History Memory」界面失去信任

## 修复范围

- 除非精炼器写回了已确认的提示，否则将 backlog 预加载视为临时的。
- 当任务仍然缺少以下内容时，对任务级作用域的会话，门控 backlog `taskAdaptiveHarness` 的启动：
  - 显式的 `contextSearchSpec`，或
  - 已保存的结构化历史记忆分析
- 对于此类 backlog 卡片，不要从卡片详情的历史记忆面板自动持久化 `jitContextSnapshot`。
- 保持顶层规划输入预加载不变；本问题专门针对任务/卡片的生命周期。

## 相关文件

- `src/core/kanban/task-adaptive.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab-panels.tsx`
- `src/core/kanban/agent-trigger.ts`

## 验证目标

- 没有 `contextSearchSpec` 的新建 backlog 卡片：
  - 不应在详情面板加载时自动持久化 `jitContextSnapshot`
  - 不应使用推测性的 `taskAdaptiveHarness` 自动启动任务级作用域的 backlog 会话
- 在 backlog 精炼器写入 `contextSearchSpec` 之后：
  - 任务级作用域的 backlog/todo/dev 会话可以消费任务自适应预加载
  - 历史记忆面板可以持久化已确认的快照

## 解决方案

于 2026-04-22 实现：

- 现在，除非任务已经具有已确认的 `contextSearchSpec` 或已保存的历史记忆分析，否则任务级作用域的 backlog `taskAdaptiveHarness` 将被禁用
- 卡片详情的 `History Memory` 面板不再为新建的 backlog 卡片自动加载或持久化推测性快照
- 如果新建的 backlog 卡片上已经存在旧的推测性 `jitContextSnapshot`，打开历史记忆面板会将其清除回 `null`

## 验证

- `npx vitest run src/core/kanban/__tests__/task-adaptive.test.ts 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-detail-and-prompts.test.tsx'`
- `npx vitest run 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx'`
- `npx tsc --noEmit`
- `entrix run --tier fast`

真实卡片清理：

- `taskId=5f27533f-cc82-4c91-89b0-bb62427bd8db`
- 已清除陈旧的 `feature-explorer` `jitContextSnapshot`
- 当前 API 状态已恢复为 `contextSearchSpec: null`，且没有持久化的历史记忆快照
