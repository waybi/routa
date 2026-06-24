# ADR 0004: 看板驱动的自动化

- Status: accepted
- Date: 2026-03-08
- Derived from: [issue #96](https://github.com/phodal/routa/issues/96), [issue #148](https://github.com/phodal/routa/issues/148)

## 背景

看板（kanban）既可以是任务状态的纯 UI 投影，也可以是主动的自动化触发面。随着 Routa.js 引入 Agent 编排，问题就变成了：应该把自动化的触发边界放在哪里。

考虑过的方案：
1. 由任务状态变更触发自动化（与看板无关）
2. 由看板列（column）切换触发自动化（看板感知）
3. 仅由用户显式操作触发自动化

## 决策

看板泳道即自动化触发器。列切换会通过一个带有按看板并发控制的队列来创建 ACP 会话。

流程如下：
1. 卡片移动到某个 `automation.enabled=true` 的列
2. `column-transition.ts` 发出一个 `COLUMN_TRANSITION` 事件
3. `workflow-orchestrator.ts` 接收该事件，并通过 `agent-trigger.ts` 构建任务提示词
4. 会话在 `kanban-session-queue.ts` 中排队，遵循看板并发上限（默认值：1）
5. 会话完成时，下一张排队中的卡片自动晋升
6. 陈旧检测会移除那些卡片已被移动或已经存在会话的条目

看板数据模型是本地优先（local-first）的，独立于外部问题跟踪器。GitHub Issues 同步只是一层叠加层（overlay），而不是事实来源。

## 影响

- 看板不只是 UI——任何修改看板列状态的代码都必须意识到它可能触发自动化。
- 按看板并发控制可以防止多张卡片同时进入自动化泳道时出现踩踏（stampede）。
- 会话队列必须处理陈旧条目（卡片在其会话开始前已被移走）。
- TypeScript（`src/core/kanban/`）和 Rust（`crates/routa-core/src/store/kanban*.rs`）都实现了看板领域。
- 看板配置（列、自动化规则、并发上限）按工作区存储。

## 代码引用

- `src/core/kanban/column-transition.ts` — 切换事件的发出
- `src/core/kanban/workflow-orchestrator.ts` — 事件 → 会话触发
- `src/core/kanban/kanban-session-queue.ts` — 按看板并发队列
- `src/core/kanban/agent-trigger.ts` — 任务提示词构建
- `src/core/kanban/board-session-limits.ts` — 并发上限管理
- `src/core/models/kanban.ts` — KanbanBoard、KanbanColumn、KanbanColumnAutomation
