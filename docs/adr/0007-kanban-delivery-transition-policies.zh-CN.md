# ADR 0007: 看板交付流转策略

- Status: accepted
- Date: 2026-04-08
- Derived from: local design follow-up for Kanban delivery gating consistency

## Context

看板卡片的流转此前已经有部分守卫，但强制约束分散在多条路径中：

- UI/API 任务更新会用交付就绪检查来阻止某些流转
- MCP `move_card` 会强制执行产物闸门和 story 就绪闸门，但不执行同样的交付规则
- 专家（specialist）提示词描述了移动的预期，但仅凭提示词并不是一个权威性的守卫

这造成了不一致：同一个 `dev -> review` 或 `review -> done` 流转可能在一条路径上被阻止，却在另一条路径上被放行。

这种失效模式在看板自动化中尤其明显，因为专家会话通常会直接调用 MCP `move_card`。如果交付闸门只存在于路由处理器中，泳道专家就可以绕过它。

## Decision

看板流转的交付就绪要求属于列级策略，而不是路由专属的条件判断。

我们将它们表示为 `KanbanColumnAutomation` 内部的 `deliveryRules`，并要求所有流转路径都评估同一套策略：

- `requireCommittedChanges`
- `requireCleanWorktree`
- `requirePullRequestReady`

评估流程为：

1. 目标列在 `automation.deliveryRules` 中声明交付策略
2. 流转处理器计算出 `TaskDeliveryReadiness`
3. 一个共享的评估器在需要时将就绪状态 + 策略转换为阻断性错误
4. `/api/tasks/[taskId]` 和 MCP `move_card` 都使用同一个评估器
5. 专家提示词把同样的交付策略作为指引呈现出来，但策略由服务端强制执行

默认看板推荐配置定义了默认策略：

- `review`：已提交的更改 + 干净的工作区
- `done`：已提交的更改 + 干净的工作区 + PR 就绪的分支

## Consequences

- 看板交付规则现在可按列配置，而不是硬编码到特定的路由分支中。
- MCP、UI 和自动化会话现在共享同一个移动闸门的事实来源。
- 专家提示词可以描述后端所强制执行的同一个闸门，从而减少提示词与后端之间的漂移。
- 使用自定义泳道名称的看板可以采用同样的交付闸门行为，而无需新增 `if targetColumnId === ...` 分支。
- 阻止流转时可以留下一条确定性的任务评论，这样即使移动是由自动化专家发起的，阻止原因也会在看板历史中可见。

## Code References

- `src/core/models/kanban.ts` — `KanbanColumnAutomation.deliveryRules`
- `src/core/kanban/boards.ts` — recommended default delivery policies
- `src/core/kanban/task-delivery-readiness.ts` — shared readiness + policy evaluator
- `src/core/tools/kanban-tools.ts` — MCP `move_card` enforcement
- `src/app/api/tasks/[taskId]/route.ts` — REST task transition enforcement
- `src/core/kanban/agent-trigger.ts` — specialist prompt injection for delivery gates
