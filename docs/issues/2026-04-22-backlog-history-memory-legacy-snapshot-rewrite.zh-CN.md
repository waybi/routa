---
title: 旧版 backlog 卡片可能重新持久化过期的历史记忆快照
date: "2026-04-22"
kind: issue
status: resolved
severity: medium
area: "kanban"
tags: ["kanban", "backlog", "history-memory", "task-adaptive-harness"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-22-backlog-history-memory-should-not-persist-before-refinement.md"
github_issue: null
github_state: null
github_url: null
created_at: 2026-04-22
updated_at: 2026-04-22
---

## 摘要

新建的 backlog 卡片现在能够正确地在 backlog 精化（refinement）确认 feature 或文件提示之前，
避免生成 `contextSearchSpec` 和 `jitContextSnapshot`。

但那些本身已经携带旧的投机性 `jitContextSnapshot` 的旧版 backlog 卡片，在通过任务 API 手动清除该快照之后，
仍可能再次显示这个过期的快照。

## 复现

任务：
- `5f27533f-cc82-4c91-89b0-bb62427bd8db`
- 标题：`[Feature]Add Superpowers skill/spec import support`

观察位置：
- `http://localhost:3000/workspace/default/kanban?boardId=4e8e567c-e308-48cd-a4f6-e3d8e1d17839&taskId=5f27533f-cc82-4c91-89b0-bb62427bd8db`

步骤：
1. `PATCH /api/tasks/5f27533f-cc82-4c91-89b0-bb62427bd8db`，请求体为 `{"jitContextSnapshot": null}`
2. 确认立即返回的 PATCH 响应中不再包含 `jitContextSnapshot`
3. 等待大约 2 秒
4. `GET /api/tasks/5f27533f-cc82-4c91-89b0-bb62427bd8db`

修复前观察到的结果：
- 旧的 `jitContextSnapshot` 可能再次出现
- 过期的快照仍然指向 `feature-explorer`

## 为何重要

这会让 backlog 门控（gating）在旧卡片上看起来不可靠：
- 新卡片行为正确
- 旧卡片仍可能显示或复用投机性的历史记忆

这在 dogfooding 期间会造成困惑，因为 UI 看上去与新规则相互矛盾。

## 证据

- 新建的冒烟测试任务 `f17fe830-b589-4d3d-9660-c93189957d02` 保持在：
  - `contextSearchSpec: null`
  - `jitContextSnapshot: null`
- 旧版任务 `5f27533f-cc82-4c91-89b0-bb62427bd8db` 在手动清除约 2 秒后恢复了其过期的快照

## 解决方案

新增了两处改动：

1. 保存路径（save-path）防护
   - 新建的 backlog 任务以及无关任务的保存操作会剥离投机性的 `jitContextSnapshot`
   - 这一处理被加入到任务 API 路由和 task-store 保存路径中

2. 读取路径（read-path）防护
   - task-store 水合（hydration）以及 `/api/tasks` + `/api/tasks/[taskId]` 的序列化现在也会在返回
     payload 之前剥离投机性的 backlog 快照
   - 这能防止旧的已持久化行在看板 UI 中浮现，或被 prompt 预加载复用

## 验证

- 定向测试：
  - `npx vitest run src/core/kanban/__tests__/task-adaptive.test.ts src/app/api/tasks/__tests__/route.test.ts 'src/app/api/tasks/[taskId]/__tests__/route.test.ts'`
  - `42 passed`
- 类型检查：
  - `npx tsc --noEmit`
  - 通过
- fast 适应度函数：
  - `entrix run --tier fast`
  - 通过
- 实时 API：
  - `GET /api/tasks/5f27533f-cc82-4c91-89b0-bb62427bd8db`
  - `GET /api/tasks?workspaceId=default`
  - 两者均不再为该旧版 backlog 卡片暴露 `jitContextSnapshot`

## 备注

- 在诊断过程中，多个旧的辅助 `node --eval` 进程以及一个较旧的 `next-server` 仍然占用着
  `routa.db`；为避免污染实时验证，已将它们清理掉。
- 旧的数据行可能仍然实际存在于 SQLite 中，但产品行为现已正确：
  没有确认上下文的 backlog 卡片不会浮现或复用投机性的历史记忆。
