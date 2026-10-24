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
   否则 → supervision = disabled，另挂「只超时不重试」的列看门狗
          （laneWatchdog，默认 20 分钟，2026-10-23 起）
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
  超了就 push 到等待队列。有空位但队列里已有更早排队的卡时，新卡排到队尾，先放行
  早来的（不插队）。
- **`drainQueue()`**：某个 Agent 完成/失败/超时 → 从 running 删掉 → 检查等待队列 →
  有空位就启动下一个。每一轮都重新读 map 里当前的队首：`start()` 要等十几秒，
  这期间别的流程可能新入队；循环外拿一份旧数组收尾写回，会把新入队的卡删掉
  （2026-10-23 卡 1e7dd356 就这样丢了 Todo 第二步）。
- **`reconcileBoardEntries()`**：防脏数据——检查 running / queued 里的卡片是不是
  还在这个 board 和这个列，不是就清掉（防止卡片已被手动挪走但队列里还有它）。
  另外清掉「状态是 queued 却不在任何队列里」的孤儿条目，否则 `enqueue()` 会一直
  回「已排队」，卡永远起不来。
- 队列只在内存里，Routa 重启会清空；重启后靠 restart-recovery / revive 重新入队。

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
对每个 ActiveAutomation（dev 列看 supervision；其他列看 laneWatchdog，关掉的跳过）：
   │
   ├─ status=queued 且看板队列已替它启动会话（task.triggerSessionId）？
   │     → 接管这个会话，按 running 继续往下看
   │
   ├─ （仅 dev）session 状态 = error？
   │     → 立刻发 AGENT_FAILED 事件
   │
   └─ 算 idleMs = 当前时间 − 最后有意义活动时间
      └─ idleMs > 阈值？（dev：supervision.inactivityTimeoutMinutes，默认 10；
                         其他列：laneWatchdog.inactivityTimeoutMinutes，默认 20）
         → 标记 session timed out
         → 发 AGENT_TIMEOUT 事件（lane 记 timed_out、结束该步进程、队列释放名额）
         → 仅 dev：通知 Agent"你很久没动了，怎么回事？"并按 maxRecoveryAttempts 重试
~~~

非 dev 列的步骤超时后不自动重跑，POST revive 也跳过它（Done 列推送员重跑可能重复推送），卡片显示失败，等人点「重新运行」。
看板可覆盖阈值：工作区 metadata 的 `kanbanLaneSessionWatchdog:<boardId>` 写 JSON，如 `{"enabled":true,"inactivityTimeoutMinutes":30}`（1–240 分钟，`enabled:false` 关闭）。

### 5b. 完成后处理（handleAgentCompletion）——Agent 干完了怎么办

这是最精密的部分，画成决策树：

~~~plaintext
Agent 完成/失败/超时
   │
   ▼
⓪ 编排器不处理这次结束的出口，也都落 lane 终态（lane-session-settlement.ts，只改记录）：
   ├─ 用户删卡/移卡结束的会话（cardEndedSessionIds，含 forgetCard 丢掉的运行）
   ├─ 已完成卡收尾时的失败（isPostCompletionTeardownFailure）
   │    → 会话历史里回合以 end_turn 结束记 completed，否则 transitioned，从不记 failed
   ├─ 自动化已 completed/failed、30 秒后已删，或事件会话不是编排器在跟的这一步
   │    → 按事件：成功 completed；取消 failed+turn_cancelled；失败 failed+agent_failed
   │      （环境故障 environment_failure）；超时 timed_out
   └─ 已是终态的记录不改（同一会话的多次结束事件只生效一次）
   编排器在跟的这一步：进程退出（AGENT_FAILED）但会话历史里这一回合已 end_turn 结束 → 按成功处理
   │
   ▼
① 是成功吗？
   ├─ AGENT_FAILED / AGENT_TIMEOUT → successEvent = false
   ├─ 回合以 stopReason=cancelled 结束 → successEvent = false
   │    （会话库发 success:false 的 AGENT_COMPLETED，记 recoveryReason=turn_cancelled）
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
   → 启动下一个 step（startNextAutomationStep，结果是 started / queued / failed）
     例：先跑 CRAFTER 写代码，再跑 GATE 评审
     board 名额满时 createSession 回 {queued:true}：自动化保持 queued，不记失败、
     不写错误；队列之后拉起这一步时会写 triggerSessionId，编排器在它结束时接管
     这个会话并继续推进
   │
   ▼
④ 失败 & 开了 automatic fallback & 还有下一个 step？
   → 试下一个 fallback agent（比如 Claude 失败了换 OpenCode）
     环境故障、限流（rate_limited）、非 dev 列看门狗超时、回合被取消（turn_cancelled）不走 fallback
   │
   ▼
⑤ 需要恢复吗？（shouldRecover）
   ├─ 监督模式 ≠ watchdog_retry / ralph_loop → 不恢复
   ├─ 已经超过 maxRecoveryAttempts → 不恢复
   ├─ 环境故障、限流（rate_limited）、回合被取消（turn_cancelled）→ 不恢复
   │    （限流另走延后重跑，见 5e，不扣 maxRecoveryAttempts）
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

**被取消或被重启打断的步骤（卡 5fdaa681）**：回合以 stopReason=cancelled 结束时，会话库仍发 AGENT_COMPLETED
（看板队列靠它释放名额），但带 `success:false`，会话终态记 failed。编排器把这一步记 failed + `turn_cancelled`，
不起下一步、不走 fallback、不恢复、不 autoAdvance，卡留在本列，等人点「重新运行」或 POST revive。
pm2 重启时施工者先收到 SIGINT、以 cancelled 回复，所以重启打断的步骤主要走这条路；
Routa 先死、没收到回合结束的，由启动清扫和 revive 记 timed_out + `restart_interrupted`（见 5d）。
两种都是 failed / timed_out，Done 列的这类卡在「需要你处理」里显示为 Done 岗位失败。
**用户在网页上手动取消某张卡在跑的会话，同样以 cancelled 结束：卡会停在本列，不再自动接下一步。**
之前这一步被记成 completed 并推进：卡 a0b2b4fa 的 Done 推送员（会话 4a14cb98）2026-10-23 20:25:46 被取消，
Routa 接着起了完成汇报员，提交没进主干。

**每个出口都落终态（卡 6d8365ca，复盘 L189）**：之前 ⓪ 里这些出口直接 return，lane 记录停在 running，
要等重启后的启动清扫才收尾，而且被记成 transitioned / timed_out。复盘脚本和「需要你处理」只认 completed，
于是误报「缺推送员和汇报员」（25afcd82、e11cac2f、497ae435），僵尸 running 还占看板名额。
现在每个出口都调同一个幂等函数 `settleEndedLaneSession`：重读卡、只改仍是 running 的那条记录、存库；
不起下一步、不 kill、不 fallback、不恢复，所以编排器没跟踪的运行不会被推进两次。
会话结束事件早于 lane 记录写入时（极快结束的会话）找不到记录，由下次启动清扫按真实结果补登（见 5d）。
没被编排器跟踪的会话结束时，按事件里的 workspaceId 扫该工作区的卡找这条 running 记录。

### 5c. 手动「重新运行」（PATCH retryTrigger）

~~~plaintext
PATCH /api/tasks/{id} {retryTrigger:true}
   │  归档当前会话、清 triggerSessionId / lastSyncError、移出队列
   │  先把这些改动存库（startKanbanTaskSession 会重读卡并写入新 lane 记录）
   ▼
enqueueKanbanTaskSession(resumeLane: true)
   │  resolveLaneResumeStep 按本列最近一条 lane 记录选步骤：
   │    没完成（failed / timed_out，含 turn_cancelled、restart_interrupted）→ 重跑那一步；
   │    完成了 → 跑下一步（下一步丢了的情况）；
   │    已是最后一步或还没跑过 → 第一步
   │  卡上有卡片级 agent 覆盖、或选不出步骤时，照原样起会话，但同样交给编排器
   │  （stepIndex 用起会话时的步骤号 0）；编排器拒绝接管（adoptLaneRun 返回 false）时，
   │  这次运行结束时仍由 5b ⓪ 的兜底落终态
   ▼
编排器 adoptLaneRun：为这次运行建 ActiveAutomation（running 或 queued），
   它结束后照常推进到列内下一步 / autoAdvance
   │
   ▼
接口从库里重读卡再返回，不用请求开头复制的旧卡覆盖新 lane 记录
~~~

看板前端（`use-kanban-retry-feedback.ts`）：卡片和详情的「运行/重新运行」按钮一点下去就禁用并显示「启动中…」，
请求结束前连点无效，请求失败弹看板错误提示（「重新运行失败」）并恢复按钮。请求成功后，卡片在新运行露面前
（会话还没进会话列表，或在看板队列里排队）显示「启动中」，不退回上一次失败的 lane 记录；新会话进列表、卡离开本列
或等满 3 分钟，就恢复按真实状态显示。

这就是 Kanban 自动化能"像流水线一样自己跑"的原因：
`autoAdvanceOnSuccess` 让卡片干完一列的活就自动进下一列，
下一列又触发新的自动化。

### 5d. 重启后续跑（POST /api/kanban/boards/{id}/revive）

~~~plaintext
reviveMissingEntryAutomations（restart-recovery.ts）逐张卡：
   │  本列 running 但进程已不在的 lane 记录 → 先读会话持久化历史看它怎么结束的：
   │    回合 end_turn 结束 → completed（completedAt=会话结束时间）
   │    错误 / 取消 / 回合中进程退出 → failed + recoveryReason（取消为 turn_cancelled）
   │    历史里没有结束 → timed_out + restart_interrupted
   │  （卡上已有 verdict / completionSummary 也一样：结论是上一列写的，不说明本列这一步做完了）
   │  跳过：本列还有活会话 / Done 已跑完 / 非 dev 熔断 / 环境故障 / 看门狗判超时
   │        / 限流还没到 retryAfterAt / 可重试环境失败已熔断（见 5e）
   ▼
┌─ Review 收敛到别的列 → 移卡 + processKanbanColumnTransition（编排器正常路径）
├─ 本列最近一条运行 failed / timed_out 且不是第 0 步（被打断、被取消、失败）
│     → enqueueKanbanTaskSession(step=那一步, adoptLaneRun: true)，重跑被打断的那一步
├─ 本列上一步 completed/transitioned 且还有下一步
│     → enqueueKanbanTaskSession(step=下一步, adoptLaneRun: true)
│     → 编排器 adoptLaneRun 接管（排队的话在队列拉起时按 triggerSessionId 接管）
│     → 它结束后 lane 记 completed，再起列内下一步 / autoAdvance
└─ 其他（含第 0 步被打断）→ processKanbanColumnTransition（从本列第一步走编排器正常路径）
~~~

中间那条直接起会话、不经过列转移事件，所以必须交给编排器登记；否则步骤跑完 lane 一直是 running，
列内再下一步也不会起（2026-10-23 重启后 4 张 Done 卡的完成汇报员、7a25276b 的 Flight Review Guard）。
revive 拉起的步骤失败（如迟到的限流报错）时同样由编排器记 failed，不再起后面的步骤。
**行为变化（卡 6d8365ca）**：本列 running 记录的会话其实已经 end_turn 结束时，revive 先把它记 completed，
再走「上一步 completed 且还有下一步」那条，起本列下一步，不再当作被打断、从同一步重跑；
它是本列最后一步（如 Done 汇报员、卡已 COMPLETED）时什么都不起。

**启动清扫（startup-lane-sweep.ts，instrumentation `register()` 里、开始接请求前跑一次）**：
重启会结束所有施工者进程，但 revive 要有人对每块看板手动 POST，而且只看当前列，
所以上一个进程留下的 running 记录（包括修复前漏跟踪、已经卡住的那些）会一直显示在跑。
启动时 `endStaleRunningLaneSessions` 扫所有工作区的所有卡，用和 revive 相同的「还在跑吗」判定
（本进程有活进程、本进程会话库记 ready/connecting，或会话属于本实例且租约有效；上一个进程的会话 ownerInstanceId 是旧 pid，都判已结束），把判为已结束的 running 记录收尾：
先按会话持久化历史（`readPersistedSessionEndHistory`，读 session_messages 及写入时间；会话库此时还没 hydrate）
补登真实结果：end_turn → completed，错误 / 取消 / 回合中退出 → failed + recoveryReason，completedAt 取那条消息的写入时间、
取不到才用当前时间；历史里没有结束的，当前列的标 timed_out + `restart_interrupted`，已离开的列标 transitioned。
只对 running 记录逐条读历史。失效的 triggerSessionId 清掉。
它只改记录、不起会话；之后再 POST revive，决策和不清扫时一样。
只在本机 SQLite + 内嵌执行时跑：配了 `ROUTA_ACP_RUNNER_URL`（施工者在独立 runner 里）、
Postgres（可能多实例共库）、`next build` 阶段（`NEXT_PHASE=phase-production-build`）都跳过；
`ROUTA_SKIP_RUNTIME_SERVICES=1` 也跳过。pm2 日志打一行 `[RestartRecovery] Startup sweep ended N …`。

### 5e. 环境失败与重试预算（卡 79804de2）

模型限流（429）和 Routa 重启打断都不是卡自己的错，以前却照样扣重试次数：
10-23 的 92744a50、7a25276b、6ad2df9d 共 0 次真实代码失败，都被 429 和重启扣光预算停住。
现在把失败分三类：

| 类别 | recoveryReason | 怎么认出来 | 扣预算吗 | 之后怎么办 |
|---|---|---|---|---|
| 等人修的环境失败 | `environment_failure` | 报错含 `Not registered in ProviderRegistry` / `Unknown provider:` | 不扣 | 永不自动重跑，`isAwaitingEnvironmentFix`=true，revive 也跳过 |
| 可重试：限流 | `rate_limited` | 报错（`event.data.error`、会话 `acpError`；看门狗超时再加会话最后一条消息）含 `usage_limit_reached`、`rate_limit_error`、`trial_rate_limited`，或明确的 HTTP 429 写法（`HTTP 429`、`HTTP/1.1 429`、`"status":429`、`status 429`、`429 Too Many Requests`）。裸数字 429（如 `processed 429 rows`）不算 | 不扣 | 到 `retryAfterAt` 自动从同一步（同 stepIndex）重跑 |
| 可重试：重启打断 | `turn_cancelled`、`restart_interrupted` | 回合 stopReason=cancelled；启动清扫 / revive 收尾的 running 记录（见 5b、5d） | 不扣 | 不定时重跑，仍由 revive 或人点「重新运行」从该步重跑 |

「不扣预算」指两处：非开发列 3 次上限（`getNonDevAutomationRunCount` 跳过 failed / timed_out 的可重试记录），
和开发列 `recoveryAttempts`（限流不进 `shouldRecover` / `recoverAutomation`，重跑沿用失败前的 attempt 与 recoveryAttempts）。
分类偏保守：证据不足一律按普通失败扣预算。

**429 什么时候重跑**（`computeRateLimitRetryAt`，`environment-failure.ts`）：
- 报错里有服务端时间（`resets_at=<ISO>`、`"resets_at":<unix 秒或 ISO>`、多层转义也认；`resets_in_seconds`；`retry-after` / `retry_after` 秒数）：
  在该时间上**只往后**加 0–60 秒抖动，不会早于服务端时间；服务端时间已过就从现在算。
- 没有服务端时间：本列连续第 1 / 2 / ≥3 次分别等 5 / 10 / 20 分钟，±20% 抖动。
- 计划时间写在失败那条 lane 记录的 `retryAfterAt`（ISO），`lastSyncError` 写
  `[environment] rate_limited：限流，预计 HH:MM 重试`（HH:MM 是服务器本地时间）。
- 到点由进程内计时器（`rate-limit-retry.ts` 的 `RateLimitRetryScheduler`，每张卡最多一个）重跑：
  先重读卡，卡已移列、本列已有 running 记录、或本列最新记录已不是那条 rate_limited，就放弃；
  否则清掉 triggerSessionId、交给编排器 `adoptLaneRun` 接管后起同一步（重跑函数 `runRateLimitRetry` 也在 `rate-limit-retry.ts`，编排器只传依赖）。
  卡被移走（列转移、`move_card`、`forgetCard`）或编排器 stop 时取消计时器；列转移里先取消计时器，再走 `leaveLane` 结束旧车道。
- 起会话时就报 429（`workflow-orchestrator-singleton.ts` 触发阶段）：记一条 `rate-limited-<uuid>` 的 failed 记录带 `retryAfterAt`，不起计时器，由 revive 到点后重跑。
- 看门狗超时后 12 秒才到的 429（a2f634b3 那种）不改判：同一会话只处理第一次结束事件，仍记 `watchdog_inactivity`。

**熔断**：同一列从最新往回数，连续的可重试环境失败（限流、取消、重启打断）达到
`RETRYABLE_ENVIRONMENT_FAILURE_FUSE_LIMIT = 5` 次就停：不再排计时器，`lastSyncError` 写
`[environment] rate_limited：连续 N 次可重试环境失败，已熔断，停止自动重跑`，revive 也跳过。
中间出现一次 completed 或一次普通失败，连续计数清零；换列重新计数。

已知限制：
- 计时器只在进程内。Routa 重启后不会自己到点重跑，要有人（或调度会话）POST revive；revive 在 `retryAfterAt` 之前跳过、之后从同一步重跑。
- Done 推送员 429 后也会被延后重跑同一步。推送幂等不在本卡范围：如果推送员在报 429 前已经推了一部分，重跑可能重复推送。
- 同一个 RunAI 账号限流时多张卡会拿到同一个 `resets_at`，在 60 秒内一起重跑，可能再撞 429；靠看板并发上限和熔断兜底，没有跨卡共享限流状态。
- Rust 后端（桌面版）只同步了模型：`TaskLaneSessionRecoveryReason::RateLimited` 与 `retry_after_at`，读写不丢 lane 记录；Rust 的 revive 没有加 `retryAfterAt` 守卫。

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

## 变更记录

| 日期 | 改了什么 | 效果 | 提交 |
|---|---|---|---|
| 2026-10-23 | 队列 drain 每轮读当前队首、清 queued 孤儿、空位先放行早排队的卡；下一步排队不再记失败；重新运行先存库再重读卡；重新运行按 lane 记录选步骤并由编排器接管（第 3 节、5b、5c） | 新增 8 个用例、1 个旧用例补断言，撤掉任一修复对应用例变红；卡 1e7dd356 那类「上一步完成、下一步报 ACP session did not complete successfully.」不再出现 | fix(kanban): board queue drain…、fix(kanban): a lane step queued…、fix(tasks): rerunning a card keeps…、本提交 |
| 2026-10-23 | 看板「运行/重新运行」按钮点击即显示「启动中…」并防连点，失败弹提示并恢复；重跑成功后新运行露面前卡片显示「启动中」（5c 节末） | 新增 13 个前端用例，撤掉组件改动 7 个变红、撤掉提示和标记 2 个变红 | fix(kanban): run/rerun shows a disabled…、本提交 |
| 2026-10-23 | POST revive 起「本列下一步」时带 `adoptLaneRun: true`，由编排器接管（排队的在拉起时接管）；重新运行的接管改走同一个参数（5c、5d） | 新增 2 个用例（直接起、排队后起），撤掉修复 2 个都变红；修复前 4 张 Done 卡的完成汇报员跑完后 lane 一直 running | e2b122f1 fix(kanban): revive hands the next lane step to the orchestrator |
| 2026-10-23 | 启动时清扫上一个进程留下的 running lane 记录（所有卡、所有列，判定与 revive 相同，只改记录不起会话；runner / Postgres / next build 跳过）；补 revive 拉起步骤失败、Done 列末步、列转移分支 3 个用例（5d） | 新增 10 个用例；撤掉 instrumentation 调用、去掉「所有列」各有 1 个变红，撤掉 e2b122f1 的 adoptLaneRun 4 个变红；修复前 6 条已结束步骤（a1d9bffc 等）重启后仍显示 running | fix(kanban): end lane records left running by the previous process on startup |
| 2026-10-24 | 车道步骤被取消（stopReason=cancelled）记 failed + `turn_cancelled`，不起下一步、不走 fallback 和恢复、不进下一列；启动清扫和 revive 把当前列被重启打断的记录一律记 timed_out + `restart_interrupted`（不再因卡上有 verdict/completionSummary 记 transitioned）；revive 对本列第 1 步及以后被打断的卡重跑那一步；TS 与 Rust 的 recoveryReason 各加两个值（5b、5c、5d） | 新增 C1–C8 对应用例与随机对拍（清扫 10,000 组、取消 10,000 组，不一致 0 组），撤掉实现后 C1/C2/C4/C5/C6/C7/C8 用例变红；修复前 Done 推送员被取消会被记 completed 并起完成汇报员（卡 a0b2b4fa 提交漏进主干）。界面手动取消会话后卡停在本列 | 本提交 fix(kanban): record cancelled or restart-interrupted lane steps as failed and rerun them |
| 2026-10-24 | 429 限流和重启打断归为「可重试环境失败」：新 recoveryReason `rate_limited` 和 lane 字段 `retryAfterAt`（TS 与 Rust 同步）；限流、取消、重启打断不计非开发列 3 次上限、不扣开发列 recoveryAttempts；429 按 resets_at / retry-after 或 5/10/20 分钟退避在同一步自动重跑；revive 在 retryAfterAt 前不重跑；同列连续 5 次可重试环境失败熔断（5b、5d、5e） | 新增约 100 个用例与随机对拍（分类 10,000 条、时间 10,000 组，不一致 0；植入错各被抓到），线上库 76 条失败记录里复盘报告列的 15 次 429 全判 rate_limited；撤掉实现后 C3/C4/C6 用例与 Rust 用例变红 | feat(rust): keep rate_limited lane records…、feat(kanban): classify rate limits as retryable…、fix(kanban): rate limits and restart interruptions no longer consume retry budgets…、本提交 fix(kanban): revive waits for retryAfterAt… |
| 2026-10-24 | 卡 79804de2 rebase 到主干（主干新增 leaveLane）：列转移先取消限流计时器再 leaveLane；限流重跑函数从编排器挪到 `rate-limit-retry.ts`（5e） | workflow-orchestrator.ts 1647 → 1596 行，回到 1600 行预算内；新增「move_card 移到 Blocked 后计时器取消、到点 0 个会话」用例，去掉取消那一行即变红 | 本提交 refactor(kanban): run the rate-limit rerun from rate-limit-retry.ts… |
| 2026-10-24 | 车道步骤结束的每个出口都落 lane 终态（用户结束 / 已完成卡收尾 → completed 或 transitioned，从不 failed；自动化已结束、已删、会话不匹配 → 按事件），只改记录不推进；进程退出前回合已 end_turn 的按完成处理；forgetCard 丢掉的运行按收尾处理；编排器不再改写已结束的记录；重新运行找不到续跑步骤（卡片级 agent 覆盖等）也交编排器接管（5b、5c） | 新增 44 个用例（结束出口 24、进程层 8、重跑入口 12），改前与撤掉实现各 28 个变红（全是断言失败）；修复前 25afcd82 / e11cac2f / 497ae435 的 Done 推送员和汇报员跑完仍 running、fd9722de 的开发会话 b2261ec7 没有结束记录 | 本提交 fix(kanban): settle the lane record at every end of a step session |
| 2026-10-24 | 启动清扫和 revive 对已结束会话的 running 记录按会话持久化历史补登真实结果（end_turn → completed、错误/取消/回合中退出 → failed，completedAt 取会话结束时间），没有结束记录的保持原规则；revive 遇真实 completed 的步骤接本列下一步（5d） | 新增 16 个用例和 224 组全组合对拍（不一致 0 组；埋错 1 格被抓到），撤掉实现后清扫用例 10 个变红、对拍 96 格不一致 | 本提交 fix(kanban): the restart sweep records ended sessions by their real outcome |
