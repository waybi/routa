---
title: "Kanban Provider 优先级在设置、标签页选择与会话创建之间出现分歧"
date: "2026-04-03"
status: resolved
resolved_at: "2026-04-03"
severity: high
area: "kanban"
tags: [kanban, provider, acp, session, automation, settings, ui]
reported_by: "Codex"
related_issues: [
  "docs/issues/2026-03-19-kanban-hidden-provider-failures.md",
  "docs/issues/2026-03-14-kanban-story-lane-automation-stalls-after-first-session.md"
]
---

# Kanban Provider 优先级在设置、标签页选择与会话创建之间出现分歧

## 发生了什么

看板暴露了多个 Provider 入口，且优先级互不一致：

1. `Kanban Settings` 中的泳道自动化可能让 `providerId` 为空，而 UI 将这一状态描述为 `Auto`。
2. 看板标签页允许用户在 ACP 输入栏中选择一个 Provider。
3. 卡片详情重跑和会话创建仍可能解析到另一个 Provider（通常是 `opencode`），因为标签页中选定的 Provider 仅存储在客户端本地的 ACP 状态中。

这造成了一个具有误导性的流程：

1. 用户在看板标签页中选择了 `codex`。
2. 某个泳道或卡片详情视图暗示下一次运行将使用该 Provider。
3. 实际的卡片会话在创建时并未带上显式的 Provider 覆盖。
4. 服务端回退到泳道默认值、specialist 默认值或 `opencode`。
5. 最终会话的 Provider 不再与看板中可见的选择匹配。

## 期望行为

Provider 解析应遵循一个稳定的模型：

1. 卡片级覆盖具有最高优先级。
2. 若卡片没有覆盖，则 `Kanban Settings` 中泳道的显式 Provider 胜出。
3. 若泳道配置为 `Auto`，则看板当前标签页的 Provider 胜出。
4. 会话一旦创建，其 Provider 即不可变，UI 应展示该冻结后的值。
5. 在看板会话/输入区域更改 Provider 影响的是后续运行与重跑，而非已经创建的会话。

## 复现场景

- 环境：`localhost:3000` 上的 Web 端看板
- 触发方式：打开卡片详情，在看板标签页中选择或观察某个 Provider，重跑卡片或让 backlog 自动化创建会话

## 为什么会发生

- `useAcp` 仅在浏览器本地存储中持久化当前 Provider。
- 服务端的看板自动化无法读取该仅存于客户端的选择。
- `resolveKanbanAutomationStep(...)` 将缺失的泳道 Provider 配置视为 `specialist.defaultProvider`，这与 UI 文案中将相同状态描述为 `Auto` 相冲突。
- 新建卡片、issue 导入、重跑以及会话展示并未全部通过同一个 helper 或元数据来源来解析 Provider。

## 相关文件

- `src/core/kanban/effective-task-automation.ts`
- `src/core/kanban/board-auto-provider.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/app/api/kanban/boards/route.ts`
- `src/app/api/kanban/boards/[boardId]/route.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab-panels.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-activity.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx`
- `crates/routa-server/src/api/kanban.rs`

## 解决方案

此问题已在当前代码库中解决。

修复方案围绕一个看板级（board-scoped）的自动 Provider 统一了 Provider 处理逻辑：

- 新增持久化的看板元数据 `kanbanAutoProvider:<boardId>`，并在 Next.js 与 Rust 的看板 API 中将其暴露为 `autoProviderId`。
- 更新了看板自动化解析逻辑，使缺失的泳道 `providerId` 表示 `Auto`，而非隐式的 specialist Provider，并采用共享的优先级模型：
  卡片覆盖 -> 显式泳道 Provider -> 看板自动 Provider -> specialist 默认值 -> 运行时回退。
- 当看板标签页选择是当前权威来源时，在创建/导入/移动/重跑操作之前持久化看板自动 Provider。
- 更新了看板设置、泳道摘要、卡片详情、空会话面板以及会话头部，使其展示相同的已解析 Provider 链。
- 不再悄悄地将手动卡片创建/导入转换为卡片级的 Provider 覆盖。

## 验证

- `npx vitest run 'src/core/kanban/__tests__/board-auto-provider.test.ts' 'src/core/kanban/__tests__/effective-task-automation.test.ts' 'src/app/api/kanban/boards/__tests__/route.test.ts' 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-settings-modal.test.tsx' 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx'`
- `npx vitest run 'src/core/kanban/__tests__/workflow-orchestrator-singleton.test.ts' 'src/app/api/tasks/[taskId]/__tests__/route.test.ts'`
- `npx vitest run 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-detail-and-prompts.test.tsx'`
- 对改动的 TypeScript 文件运行 `npx eslint ...`
- `cargo fmt --all`
- `cargo test -p routa-server api::kanban::tests::translates_workspace_updated_kanban_event -- --exact`
