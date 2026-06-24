---
title: "开发服务器在应用启动期间记录工作流编排器启动 TypeError"
date: "2026-04-21"
kind: issue
status: resolved
severity: medium
area: "kanban"
tags: ["runtime", "workflow-orchestrator", "scheduler", "validation", "feature-explorer"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-feature-explorer-hotspot-auto-retro-for-task-adaptive-memory.md"
---

# 开发服务器在应用启动期间记录工作流编排器启动 TypeError

## 发生了什么

在 Next.js 开发服务器上对 `Feature Explorer` 进行本地浏览器验证期间，应用成功启动并正常提供页面，但服务器日志输出了一个启动异常：

`TypeError: startWorkflowOrchestrator is not a function`

该错误抛出自：

- `src/core/routa-system.ts:357`
- 在 require `./kanban/workflow-orchestrator-singleton` 时
- 此时调度器正在启动后台服务

来自本地验证的相关调用栈：

1. `getRoutaSystem`
2. `src/core/scheduling/scheduler-service.ts`
3. `runWithSpan`
4. `startWorkflowOrchestrator(system)`

## 预期行为

运行 `npm run dev` 时，应在不产生运行时异常的情况下初始化调度器和看板工作流编排器。

后台服务应当：

- 正常启动，或者
- 在明确的功能开关 / 兼容性保护后失败

但它们不应抛出启动期 `TypeError`。

## 复现

1. 在 `/Users/phodal/ai/routa-js` 中运行 `npm run dev`
2. 打开 `http://localhost:3000/workspace/default/feature-explorer`
3. 观察应用启动期间的服务器日志

观察到的结果：

- 应用页面正常渲染
- `Feature Explorer` 正常工作
- 调度器记录了一个针对 `startWorkflowOrchestrator` 的 `TypeError`

## 为什么这很重要

- 它表明开发运行时是在编排器的导出或导入契约损坏的情况下启动的。
- 由于页面仍能渲染，它可能在验证运行中掩盖真实的回归问题。
- 它可能导致后台自动化处于部分初始化状态，却看起来运行正常。

## 初步证据

- 新的摩擦画像（friction-profile）流程的验证仍然成功：
  - `GET /api/feature-explorer/friction-profiles?...` 返回 `200`
  - `POST /api/feature-explorer/friction-profiles?...` 返回 `200`
- 该故障看起来与新的 `Task-Adaptive Harness` 工作正交，应作为一个独立的运行时问题处理。

## 相关文件

- `src/core/routa-system.ts`
- `src/core/scheduling/scheduler-service.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/core/tools/kanban-tools.ts`

## 解决方案

- 2026-04-21：通过在 `src/core/routa-system.ts` 和 `src/core/tools/kanban-tools.ts` 两处规范化 `workflow-orchestrator-singleton` 模块互操作（interop）来修复
- 解析器现在在开发运行时加载期间既能容忍直接的命名导出，也能容忍 `default` / `module.exports` 形态
- 重新验证：
  - `GET /api/feature-explorer/friction-profiles?workspaceId=default&repoPath=/Users/phodal/ai/routa-js` -> `200`
  - `POST /api/feature-explorer/friction-profiles?...` -> `200`
  - `entrix run --tier fast` -> `PASS`

## 复发

- 2026-05-01：同样的冷启动症状在 `GET /api/workspaces?status=active` 上再次出现。
- 根因比导出形态互操作更狭窄：Turbopack 因为 `workflow-orchestrator-singleton.ts` 静态导入了 `agent-trigger.ts`，从而把它包装成了一个异步模块；而 `getRoutaSystem()` 在启动期间是同步 require 该单例的，所以命名导出此时还不可用。
- 通过将 `agent-trigger` 导入移到已经是异步的看板任务会话启动路径之后来修复。冷启动 `GET /api/workspaces?status=active` 现在返回 `200`，不再出现 TypeError。
