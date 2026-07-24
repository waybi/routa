---
title: Kanban 自动化：从卡片挪动到 Agent 干活，一条血管到底
prerequisite: 01-routa-architecture-tour.zh-CN.md
---

# Kanban 自动化：从卡片挪动到 Agent 干活，一条血管到底

> 接着[系统骨架导览](01-routa-architecture-tour.zh-CN.md)的方向 B 深入。
> 假设你已经知道 Routa 的三种模式、三个角色和全景分层；本文只聚焦
> **Kanban 模式下，一张卡片从位置变化到 Agent 干活再到门禁验收的完整机制**。
>
> 本文是**学习笔记**，不是规范来源。事实以代码和
> [`docs/adr/0004-kanban-driven-automation.md`](../adr/0004-kanban-driven-automation.md)、
> [`docs/operational/kanban-transition-gates.zh-CN.md`](../operational/kanban-transition-gates.zh-CN.md) 为准。

## 0. 一句话抓住本质

> 卡片位置变了 → 发事件 → Orchestrator 接住 → 排队 → 创建 Agent 会话去干活
> → 监督 Agent 活没活着 → Agent 干完了过门禁 → 通过就自动推到下一列。

整个系统是一个**事件驱动的流水线**，五个角色各管一段：

~~~plaintext
触发器             编排器               队列            Agent 会话        门禁 / 推进
Column          Workflow            Session          ACP              Gates +
Transition  →   Orchestrator  →     Queue    →       Session    →     AutoAdvance
~~~

## 1. 触发器：卡片挪了一下，发出一声"喊"

**代码入口：** `src/core/kanban/column-transition.ts`

当你在看板上拖卡片（或 API / MCP 工具 `move_card` 被调用），系统做一件事：

```ts
emitColumnTransition(eventBus, {
  cardId, cardTitle, boardId, workspaceId,
  fromColumnId: "todo",   // ← 从哪来
  toColumnId:   "dev",    // ← 到哪去
});
```

往 EventBus 上扔一个 `COLUMN_TRANSITION` 事件，事件里带着"谁从哪到哪"。

**关键细节：** `resolveTransitionAutomation()` 决定这次挪动**触发哪一列的自动化**：

~~~plaintext
源列配了 exit / both 触发？ → 用源列的 automation
否则目标列配了 entry / both 触发？ → 用目标列的 automation
都没配 → 不触发，什么都不做
~~~

列可以配"进入时触发"、"离开时触发"或"两头都触发"。

## 2. 编排器：接住事件，决定"派谁去干活"

**代码：** `src/core/kanban/workflow-orchestrator.ts`（~960 行，Kanban 自动化的大脑）

`KanbanWorkflowOrchestrator` 启动后做三件事。

### 2a. 监听事件

~~~plaintext
eventBus.on(…):
  COLUMN_TRANSITION  → handleColumnTransition    // 卡片挪了
  AGENT_COMPLETED    → handleAgentCompletion     // Agent 干完了
  AGENT_FAILED       → handleAgentCompletion     // Agent 挂了
  AGENT_TIMEOUT      → handleAgentCompletion     // Agent 超时了
  REPORT_SUBMITTED   → handleAgentCompletion     // Agent 提交了报告
~~~

### 2b. 收到 COLUMN_TRANSITION 后的决策链

~~~plaintext
收到 COLUMN_TRANSITION
   │
   ▼
① 去 board store 拿 board 配置
   │
   ▼
② resolveTransitionAutomation → 确定用哪一列的 automation
   │
   ▼
③ getKanbanAutomationSteps → 拿到该列配的 step 列表
   （每个 step 指定一个 provider / specialist / role）
   （可以有多个 step，是有序的，不是并行的）
   │
   ▼
④ 防循环保护：非 dev 列最多跑 3 次自动化就停
   （NON_DEV_AUTOMATION_REPEAT_LIMIT = 3）
   │
   ▼
⑤ 如果是 dev 列 → 加载 supervision 配置（watchdog / ralph_loop）
   否则 → supervision = disabled
   │
   ▼
⑥ 注册 ActiveAutomation，状态=queued，交给 createSession 去跑
~~~

### 2c. ActiveAutomation：编排器脑子里的"在跑任务表"

每张正在自动化的卡，在编排器里是一个 `ActiveAutomation` 对象：

~~~plaintext
ActiveAutomation {
  cardId, cardTitle, boardId, workspaceId,
  columnId, columnName, stage,         // 在哪一列
  automation,                           // 列的自动化配置
  steps: [...]                          // 有序 step 列表
  currentStepIndex: 0,                  // 当前跑到哪一步
  sessionId,                            // 当前 ACP 会话 ID
  status: queued | running | completed | failed,
  supervision,                          // 监督策略
  attempt: 1,                           // 第几次尝试
  recoveryAttempts: 0,                  // 已恢复几次
  signaledSessionIds: Set<string>,      // 已通知过的 session
  enableAutomaticFallback,              // 失败时自动试下一个 step？
}
~~~

这张表就是编排器的全部"记忆"。它在内存里，HMR 时通过 `globalThis` 存活。

## 3. 队列：不是来了就跑，要排队

**代码：** `src/core/kanban/kanban-session-queue.ts`

为什么需要队列？因为看板上可能有 10 张卡同时进 dev 列，但你不想同时启动 10 个
Agent 进程把机器打爆。

~~~plaintext
┌──────────────────────────────────────────────────┐
│          KanbanSessionQueue                      │
│                                                  │
│   concurrencyLimit（per board）                  │
│   ┌────────────────────────────────────────┐     │
│   │  Board "board-1"                       │     │
│   │   running: [card-A, card-B]  (limit=2) │     │
│   │   queued:  [card-C, card-D, card-E]    │     │
│   └────────────────────────────────────────┘     │
│                                                  │
│   when card-A's Agent finishes:                  │
│     1. remove card-A from running                │
│     2. drainQueue → start card-C                 │
│                                                  │
└──────────────────────────────────────────────────┘
~~~

关键机制：

- **`enqueue()`**：来了新任务 → 检查当前 board 跑了几个 → 没超限就 `startEntry()` →
  超了就 push 到等待队列。
- **`drainQueue()`**：某个 Agent 完成/失败/超时 → 从 running 删掉 → 检查等待队列 →
  有空位就启动下一个。
- **`reconcileBoardEntries()`**：防脏数据——检查 running / queued 里的卡片是不是
  还在这个 board 和这个列，不是就清掉（防止卡片已被手动挪走但队列里还有它）。

## 4. 创建会话：真正"叫一个 Agent 来干活"

**代码：** `src/core/kanban/workflow-orchestrator-singleton.ts` 里的 `startKanbanTaskSession()`

这是最复杂的一步，把前面所有准备串成一个真实的 Agent 调用：

~~~plaintext
startKanbanTaskSession(taskId)
   │
   ▼
① 读 task → 检查还在预期列吗？ → 不在就 abort
   │
   ▼
② resolveTaskWorktreeTruth → 找到任务关联的 repo / worktree
   │
   ▼
③ 如果是进 dev 列 & 没有 worktree → 自动创建 git worktree
   （给 Agent 一个隔离的代码副本干活）
   （创建失败 → task 状态变 BLOCKED，挪到 blocked 列）
   │
   ▼
④ resolveEffectiveTaskAutomation → 确定用哪个 provider / specialist / role
   （先看 step 配置 → 再看 board 默认 auto-provider）
   │
   ▼
⑤ 收集上下文：
   · 同 board 所有 task 的 flow 历史（flow ledger）
   · task 的证据摘要（evidence summary）
   · story readiness / INVEST 验证
   · lane experience memory（跨任务历史记忆）
   │
   ▼
⑥ triggerAssignedTaskAgent → 真正调 ACP 协议启动一个 Agent CLI 进程
   传入：workspace、cwd（worktree 路径）、task 详情、specialist 提示词、
         board 列配置、摘要上下文、flow 报告…
   │
   ▼
⑦ 拿到 sessionId → 记入 task.triggerSessionId + task.sessionIds[]
   + upsertTaskLaneSession（泳道历史）
   + assignWorktreeSession
   │
   ▼
⑧ save task → 完成
~~~

"叫人干活"不是随便叫——它把任务的所有上下文（worktree、历史、证据、flow 经验）
全打包好喂给 Agent，让 Agent 带着充分信息开工。

## 5. 监督：Agent 开始干活后，有人盯着它

编排器不是"发射后不管"。它有两层监督。

### 5a. Watchdog（看门狗）——每 30 秒扫一次

~~~plaintext
setInterval(() => scanForInactiveSessions(), 30_000)
~~~

逻辑：

~~~plaintext
对每个 status=running 的 ActiveAutomation：
   │
   ├─ session 状态 = error？
   │     → 立刻发 AGENT_FAILED 事件
   │
   └─ 算 idleMs = 当前时间 − 最后有意义活动时间
      └─ idleMs > supervision.inactivityTimeoutMinutes？
         → 标记 session timed out
         → 发 AGENT_TIMEOUT 事件
         → 通知 Agent"你很久没动了，怎么回事？"
~~~

### 5b. 完成后处理（handleAgentCompletion）——Agent 干完了怎么办

这是最精密的部分，画成决策树：

~~~plaintext
Agent 完成/失败/超时
   │
   ▼
① 是成功吗？
   ├─ AGENT_FAILED / AGENT_TIMEOUT → successEvent = false
   └─ 其他 & data.success ≠ false  → successEvent = true
   │
   ▼
② 满足完成条件吗？（isCompletionSatisfied）
   watchdog_retry 模式 → 只要成功就算满足
   ralph_loop 模式    → 要检查 completionRequirement：
     turn_complete         → 只要成功就行
     completion_summary    → task.completionSummary 不能为空
     verification_report   → task.verificationReport 不能为空
   │
   ▼
③ 成功 & 满足 & 还有下一个 step？
   → 启动下一个 step（startNextAutomationStep）
     例：先跑 CRAFTER 写代码，再跑 GATE 评审
   │
   ▼
④ 失败 & 开了 automatic fallback & 还有下一个 step？
   → 试下一个 fallback agent（比如 Claude 失败了换 OpenCode）
   │
   ▼
⑤ 需要恢复吗？（shouldRecover）
   ├─ 监督模式 ≠ watchdog_retry / ralph_loop → 不恢复
   ├─ 已经超过 maxRecoveryAttempts → 不恢复
   ├─ TIMEOUT / FAILED → 恢复
   └─ ralph_loop + COMPLETED 但没满足完成条件 → 恢复
   → 发恢复通知 → recoverAutomation（重新 createSession，attempt+1）
   │
   ▼
⑥ 成功 & 满足 & autoAdvanceOnSuccess？
   → 自动把卡片推到下一列（autoAdvanceCard）
     → 推完后再发一个 COLUMN_TRANSITION 事件
       → 又回到步骤 1，触发下一列的自动化——形成链式反应
   │
   ▼
⑦ 30 秒后从 activeAutomations 里清理掉这条记录
~~~

这就是 Kanban 自动化能"像流水线一样自己跑"的原因：
`autoAdvanceOnSuccess` 让卡片干完一列的活就自动进下一列，
下一列又触发新的自动化。

## 6. 门禁：不是想过就能过

在执行 `move_card` 的路径上（API route / MCP tool），还有三层独立的**转换门禁**，
任何一层拦住就过不去。

### Layer 1: Transition Gates（`transition-gates.ts`）

~~~plaintext
① requiredChecklist
   task 的文本里必须有 "- [x] browser smoke" 这种已勾选的 checklist 项。
   实现：用正则扫描 task 的 objective / comment / scope / acceptanceCriteria /
   verificationCommands / testCases / completionSummary / verificationReport / comments，
   收集所有 [x] 项，再跟要求的 label 做 case-insensitive 匹配。

② requiredHumanApproval
   task.verificationVerdict 必须 = APPROVED（人类手动点了"批准"）。

③ validatorCommand
   验证证据里必须出现指定命令 + passing 结果。
   例："npm test -- --run smoke" 必须在 verificationReport 里出现且同行有
   pass / passed / success / ok / green 之一，且不含 fail / error / red。
   注意：Routa 不执行命令，只检查证据里有没有！

gateMode：
  blocking → 拦住，不让过
  warning  → 放行，但写一条审计警告
~~~

### Layer 2: Delivery Readiness（`task-delivery-readiness.ts`）

检查 git 仓库的**实际状态**（真正跑 git 命令）：

~~~plaintext
进 review 列：
  ✓ 必须有 commit（相对 base branch 有提交）
  ✓ 工作树必须干净（没有未提交的改动）

进 done 列：
  ✓ 上面两条 + PR-ready（用了 feature branch，能开 PR）
~~~

实现路径：`resolveTaskWorktreeTruth()` 找到 repo 路径 →
`getRepoDeliveryStatus()` 跑 git 命令拿到 modified / untracked / ahead / behind /
commitsSinceBase 等指标 → 与 `KanbanDeliveryRules` 比对。

### Layer 3: Required Artifacts（`transition-artifacts.ts`）

列配了 `requiredArtifacts`？必须有对应产物：

~~~plaintext
screenshot    → 要有截图
test_results  → 要有测试结果
code_diff     → 要有代码变更记录
~~~

## 7. 全景串联：一张卡从 Backlog 到 Done 的完整生命线

~~~plaintext
                 ┌─────────────────────────────────────────────┐
                 │           EventBus（中枢神经）               │
                 │  所有组件通过事件通信，不直接耦合              │
                 └──────────────┬──────────────────────────────┘
                                │
  你拖卡片 Backlog → Todo       │
         （没有 automation）    │   什么都不发生，纯 UI 状态变化
                                │
  你拖卡片 Todo → Dev           │
         │                      │
         ▼                      │
  emitColumnTransition ─────────┤──→ COLUMN_TRANSITION 事件
                                │          │
                                │          ▼
                                │   WorkflowOrchestrator.handleColumnTransition
                                │          │
                                │          ▼
                                │   resolveTransitionAutomation
                                │   → dev 列配了 automation（CRAFTER specialist）
                                │          │
                                │          ▼
                                │   KanbanSessionQueue.enqueue
                                │   → 检查并发：board 限制 2 个同时跑
                                │   → 当前 running=1，limit=2，可以跑！
                                │          │
                                │          ▼
                                │   startKanbanTaskSession
                                │   → 创建 git worktree（隔离代码副本）
                                │   → 确定 provider=Claude Code，role=CRAFTER
                                │   → 打包 task 上下文 + flow 经验
                                │   → triggerAssignedTaskAgent
                                │          │
                                │          ▼
                                │   ┌─────────────────────────────┐
                                │   │  ACP Session: Claude Code   │
                                │   │  在 worktree 里写代码…       │
                                │   │ （真实的 Agent CLI 进程）     │
                                │   └──────────┬──────────────────┘
                                │              │
   watchdog 每 30s 扫 ──────────│──────────────┤ 空闲超时？→ AGENT_TIMEOUT
                                │              │
                                │   Agent 干完了（AGENT_COMPLETED）
                                │              │
                                │              ▼
                                │   handleAgentCompletion
                                │   → 成功 + completionSatisfied
                                │   → 有下一个 step？例如要跑 GATE 评审？
                                │     ├─ 是 → startNextAutomationStep（留在 dev）
                                │     └─ 否 → autoAdvanceOnSuccess？
                                │              ├─ 是 → 自动推到 review 列
                                │              │       → 发新的 COLUMN_TRANSITION
                                │              └─ 否 → 标记 completed，等人来推
                                │
  卡片被推到 Review 列           │
         │                      │
         ▼                      │
  COLUMN_TRANSITION ────────────┤──→ review 列的 automation 触发
                                │     → GATE specialist 来评审
                                │
  GATE 评审通过                  │
  卡片要进 Done 列               │
         │                      │
         ▼                      │
  门禁检查 ─────────────────────│──→ 三层门禁检查：
                                │     ✓ checklist 全勾了？
                                │     ✓ human approval？
                                │     ✓ validator evidence？
                                │     ✓ 有 commit？工作树干净？PR-ready？
                                │     ✓ 有截图 / 测试结果？
                                │          │
                                │          ├─ 全通过 → 卡片进 Done
                                │          └─ 没通过 → blocking 模式拦住
                                │                      warning 模式放行但记警告
~~~

## 8. 源码导航表

| 环节 | 文件 | 行数 | 一句话 |
|---|---|---|---|
| 触发事件 | `src/core/kanban/column-transition.ts` | ~130 | 卡片挪动 → 发 COLUMN_TRANSITION |
| 编排大脑 | `src/core/kanban/workflow-orchestrator.ts` | ~960 | 监听事件、派活、监督、恢复、自动推进 |
| 编排组装 | `src/core/kanban/workflow-orchestrator-singleton.ts` | ~490 | 把 RoutaSystem 的各种 store/service 注入编排器 |
| 并发队列 | `src/core/kanban/kanban-session-queue.ts` | ~300 | per-board 并发控制：排队 / 启动 / drain |
| 转换门禁 | `src/core/kanban/transition-gates.ts` | ~170 | checklist / 人类审批 / 验证命令 |
| 交付就绪 | `src/core/kanban/task-delivery-readiness.ts` | ~220 | git 状态检查：commit / clean / PR-ready |
| 制品要求 | `src/core/kanban/transition-artifacts.ts` | ~60 | screenshot / test_results / code_diff |
| 泳道历史 | `src/core/kanban/task-lane-history.ts` | ~200 | 每次 session 的详细记录 |
| 泳道经验 | `src/core/kanban/task-lane-experience.ts` | ~600 | 跨任务历史记忆注入 |
| Flow 账本 | `src/core/kanban/flow-ledger.ts` | ~450 | board 级别流量 / 瓶颈分析 |
| Agent 触发 | `src/core/kanban/agent-trigger.ts` | ~1200 | 拼接 prompt、调 ACP 启动进程 |
| 监督策略 | `src/core/kanban/board-session-supervision.ts` | ~100 | watchdog_retry / ralph_loop 配置 |
| 领域模型 | `src/core/models/kanban.ts` | ~370 | 列/板/列自动化/门禁的类型定义 |

## 9. 三个设计洞察

### 洞察 1：事件驱动解耦，每个环节只管自己一段

- `column-transition.ts` 只管发事件，不知道 orchestrator 的存在。
- `kanban-session-queue.ts` 只管排队，不知道 Agent 在干什么。
- `transition-gates.ts` 只管检查，不知道卡片是手动挪的还是自动推的。
- 好处：每个模块可以独立测试、独立替换。

### 洞察 2：autoAdvanceOnSuccess + 事件循环 = 自动流水线

- Dev 列 Agent 干完 → 自动推到 Review → 触发 Review 列 Agent → 干完推到 Done。
- 但用了 `NON_DEV_AUTOMATION_REPEAT_LIMIT = 3` 做防循环保护，
  非 dev 列最多跑 3 次就停。
- 这意味着系统**允许**自动从头跑到尾，但**防住了**无限循环。

### 洞察 3：门禁是"证据检查"，不是"执行检查"

- `validatorCommand` 只检查证据文本里有没有出现 `npm test` + `passed`，
  不会真去跑 `npm test`。
- 这是刻意的：Routa 是**协调平台**，不是 CI/CD。
  跑命令是 Agent 的事，Routa 只看结果。

## 延伸阅读

- [ADR-0004: Kanban-Driven Automation](../adr/0004-kanban-driven-automation.md) ——
  "为什么用看板泳道触发 Agent"的架构决策
- [ADR-0007: Kanban Delivery Transition Policies](../adr/0007-kanban-delivery-transition-policies.md) ——
  交付门禁策略决策
- [`docs/operational/kanban-transition-gates.zh-CN.md`](../operational/kanban-transition-gates.zh-CN.md) ——
  转换门禁字段与语义详解
- [系统骨架导览](01-routa-architecture-tour.zh-CN.md) —— 全景地图（本文的前置）

## 后续可深入的方向

| 方向 | 关键入口 | 问题 |
|---|---|---|
| Agent 触发细节 | `agent-trigger.ts` | 怎么拼 prompt、怎么调 ACP——连接 Kanban 和协议层的桥 |
| watchdog vs ralph_loop | `board-session-supervision.ts` + orchestrator 恢复逻辑 | 两种监督模式的区别和运行细节 |
| 泳道经验记忆 | `task-lane-experience.ts` | 跨任务历史怎么注入新会话——Routa 比普通看板"聪明"的地方 |
| Flow 账本 | `flow-ledger.ts` | board 级别的流量/瓶颈分析怎么影响 Agent 行为 |
