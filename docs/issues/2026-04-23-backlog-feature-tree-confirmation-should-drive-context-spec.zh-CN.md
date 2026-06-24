---
title: "Backlog refiner 应在持久化检索提示前确认 feature-tree 上下文"
date: "2026-04-23"
kind: issue
status: resolved
resolved_at: "2026-04-23"
severity: medium
area: kanban
tags:
  - backlog-refiner
  - feature-tree
  - context-search
  - canonical-story
reported_by: "codex"
related_issues:
  - "2026-04-22-history-memory-search-pattern-evidence.md"
  - "2026-04-22-backlog-history-memory-should-not-persist-before-refinement.md"
github_issue: 526
github_state: closed
github_url: "https://github.com/phodal/routa/issues/526"
---

# Backlog refiner 应在持久化检索提示前确认 feature-tree 上下文

## 发生了什么

Backlog 精炼最近已经不再在仓库检查之前持久化推测性的 `contextSearchSpec`，但当前的精炼流程仍然把过多的归一化工作留给了 Agent：

- `load_feature_tree_context` 返回原始的特性候选项
- Agent 必须手动推断哪个候选项应当成为规范的任务/特性绑定
- 规范故事 YAML 目前还没有一个明确的 `feature_tree` 区块来承载已确认的特性上下文
- 相同的特性确认逻辑在 `create_card`、`decompose_tasks` 和 `update_task` 中被重复实现

这使得 backlog 精炼仍然依赖临时的 `Grep` / `Glob` 用法，即便 feature-tree 证据其实已经更强、更结构化。

## 预期行为

Backlog 精炼应当具备一条专用的 feature-tree 确认路径：

1. Agent 可以调用一个聚焦的 MCP 工具，为某个故事/查询确认最佳的 feature-tree 匹配。
2. 该工具返回：
   - 选中的特性
   - 归一化后的 `contextSearchSpec`
   - 一个可直接用于提示词的 `feature_tree` YAML 区块
3. 如果提供了 `taskId`，该工具可以将已确认的特性/文件提示持久化到任务上。
4. 在确认之后，规范的 backlog 故事 YAML 可以包含一个可选的 `feature_tree` 区块，以便下游泳道能够看到故事被锚定到了哪个特性。

## 为什么这很重要

- 在早期故事范围界定阶段，feature-tree 确认比宽泛的 `*.ts` / `*.rs` glob 更可靠。
- 一旦精炼确认了特性锚点，任务就应当携带一个持久的特性锚点。
- 规范 YAML 应当把该特性锚点暴露给下游专家，而不是迫使他们之后再重新构建它。

## 相关文件

- `src/core/kanban/context-preload.ts`
- `src/core/harness/task-adaptive-tool.ts`
- `src/core/mcp/mcp-tool-executor.ts`
- `src/core/mcp/routa-mcp-tool-manager.ts`
- `src/core/tools/agent-tools.ts`
- `resources/specialists/workflows/kanban/prompts/templates.json`
- `resources/specialists/workflows/kanban/backlog-refiner.yaml`

## 验证目标

- `confirm_feature_tree_story_context` 为某个查询/特性提示返回归一化的 feature-tree 选择结果
- backlog 提示词指示 Agent 在进行宽泛的仓库扫描之前优先使用 feature-tree 确认
- 在精炼一张已有的 backlog 卡片时，已确认的特性上下文可以被持久化到任务上
- 规范 YAML 示例和提示词允许出现可选的 `feature_tree` 区块，且不破坏下游解析

## 解决方案说明

- 新增了一个专用的 MCP 工具 `confirm_feature_tree_story_context`，它把 feature-tree 检索封装为一个可直接用于提示词的单一结果：
  - 选中的特性
  - 归一化后的 `contextSearchSpec`
  - 可选的、用于规范 backlog 故事的 `feature_tree` YAML 区块
- backlog 提示词现在明确告知 refiner 在进行更宽泛的 `Grep`/`Glob` 扫描之前优先使用 feature-tree 确认，并且只在确认或具体的仓库检查之后才持久化 `contextSearchSpec`。
- 现有的 backlog 确认门控现在将 `confirm_feature_tree_story_context` 视为一个确认步骤，因此新建的 backlog 卡片仍然能够避免推测性的上下文持久化。
- PR #529 已于 2026-04-23 合并，并关闭了 GitHub issue #526。

## 验证说明

- `npx vitest run src/core/mcp/__tests__/mcp-tool-executor.test.ts src/core/mcp/__tests__/routa-mcp-tool-manager.test.ts src/core/kanban/__tests__/backlog-context-confirmation.test.ts 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-agent-input.test.ts' src/core/kanban/__tests__/agent-trigger.test.ts`
  - PASS（`41 passed`，`2 skipped`）
- 对改动文件运行 `npx eslint ...`
  - PASS
- `npx tsc --noEmit`
  - PASS
- 在已有的 backlog 卡片 `5f27533f-cc82-4c91-89b0-bb62427bd8db` 上进行实时冒烟测试
  - `contextSearchSpec` 仍为 `null`
  - 没有持久化任何推测性的、任务所属的历史上下文
