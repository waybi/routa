---
title: "看板列自动化未启动 Agent 会话，且手动 issue 模态框打开时崩溃"
date: "2026-03-12"
status: resolved
severity: high
area: "kanban"
tags: [kanban, automation, tiptap, acp, ui]
reported_by: "Codex"
related_issues: ["docs/issues/2026-03-09-issue-100-implementation-analysis.md"]
---

# 看板列自动化未启动 Agent 会话，且手动 issue 模态框打开时崩溃

## 发生了什么

在验证本地看板工作流时，出现了两个独立的故障：

1. 打开 `Manual issue` 模态框时，页面在创建任何 issue 之前就因 TipTap SSR 运行时错误而崩溃。
2. 在 `Todo` 列上启用列自动化并将卡片移入该列后，没有创建 ACP 会话，UI 中也没有出现任何可见的自动化状态。

当任务被显式分配了 Provider 并移入 `dev` 时，`Dev` 列的自动启动路径仍然可以工作，这表明该故障是列自动化特有的问题，而非所有由任务触发的会话创建。

## 预期行为

- 打开 `Manual issue` 应正常渲染编辑器并允许创建 issue。
- 将卡片移入启用了自动化的列应启动所配置的 Agent 会话，将会话 ID 持久化到任务上，并在 UI 中呈现该状态。

## 复现上下文

- 环境：Web 端
- 触发条件：在本地 Next.js 开发服务器（`http://127.0.0.1:3000`）上验证看板端到端工作流

观察到的步骤：

1. 打开某个工作区的看板页面。
2. 点击 `Manual`。
3. 看到 TipTap SSR 运行时错误，而不是 issue 表单。
4. 在本地修复模态框后，配置 `Todo` 列自动化。
5. 创建一张卡片并将其移入 `Todo`。
6. 观察到卡片移动了，但没有会话启动，也没有显示任何失败反馈。

## 可能的原因

- 模态框中的 TipTap 编辑器可能使用了对 SSR 敏感的默认配置进行初始化，这与主聊天/编辑器组件不同。
- 工作流编排器可能在监听列转换，但没有接入会话创建回调，因此自动化状态被记录下来，却没有实际启动 Agent 会话。
- UI 可能假设自动化是异步的，但在没有产生会话时，并未渲染待处理或失败的自动化反馈。

## 相关文件

- `src/app/workspace/[workspaceId]/kanban-create-modal.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/agent-trigger.ts`

## 观察记录

- TipTap 错误信息：`Tiptap Error: SSR has been detected, please set immediatelyRender explicitly to false to avoid hydration mismatches.`
- 将任务 `PATCH /api/tasks/[taskId]` 移入 `todo` 成功并更新了 `columnId`，但没有返回 `triggerSessionId`。
- 将带有 `assignedProvider` 和 `assignedRole` 的任务 `PATCH /api/tasks/[taskId]` 移入 `dev` 时确实返回了 `triggerSessionId` 和 `worktreeId`。
- 截图证据见 `dogfood-output/2026-03-12/screenshots/kanban-drag-result.png` 以及同一文件夹下的相关截图。

## 参考资料

- `dogfood-output/2026-03-12/screenshots/kanban-drag-result.png`
- `dogfood-output/2026-03-12/screenshots/kanban-modal-closed.png`

## 解决说明

- 已于 2026 年 3 月 12 日针对当前本地 worktree 和运行中的应用重新验证。
- `npm run test:run -- src/core/kanban/__tests__/todo-column-automation.test.ts` 通过。
- `npx playwright test e2e/kanban-column-automation.spec.ts` 在 `chromium` 和 `chromium-headed` 下均通过。
- 当前行为：创建手动 issue 成功，将卡片移入启用了自动化的 `todo` 列会创建 ACP 会话、持久化 `triggerSessionId`，并在看板 UI 中暴露该会话。
