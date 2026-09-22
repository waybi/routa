---
title: "Kanban 看板设计复盘：TopBI 板 13 卡实跑（2026-09-18 → 09-20）"
date: "2026-09-20"
kind: analysis
status: open
severity: critical
area: "kanban"
tags:
  - kanban
  - workflow-orchestrator
  - restart-recovery
  - lane-automation
  - kanban-session-queue
  - agent-trigger
  - sqlite
  - ui-architecture
  - accessibility
  - i18n
  - state-machine
  - performance
  - ux
reported_by: "agent"
related_issues: []
github_issue: null
github_state: null
github_url: null
---

# Kanban 看板设计复盘：TopBI 板 13 卡实跑

> **审计范围**：UI 层 20,988 行 + 核心层 8,813 行 + API 层 526 行 = **30,327 行看板代码**
> 两次独立分析合并：流转/展示/交互深度分析（188 行） + 数据层/UI 架构/可达性广度审计（43 项发现）

## 数据来源（全部本轮实际采集，可复跑）

| 数据 | 命令 | 结果 |
|---|---|---|
| 卡片 | `sqlite3 routa.db "select count(*) from tasks"` | 13（全部在 TopBI 板 `312b1f5a`） |
| ACP 会话 | `sqlite3 routa.db "select count(*) from acp_sessions"` | 221–225（分析期间持续增长） |
| 会话消息 | `select count(*) from session_messages` | 17803 |
| 列分布 | `SELECT column_id, COUNT(*) FROM tasks GROUP BY column_id` | review:6, dev:4, done:2, todo:1, backlog:0 |
| 泳道会话（laneSessions 展开） | python / sqlite json_each 聚合 | 154 条：completed 72–74 / failed 57 / timed_out 20 / running 5–6 |
| 平均会话/任务 | `AVG(json_array_length(session_ids))` | 15.5（最多 25，最少 9） |
| **会话浪费率** | `(57+20)/154` | **50%**（failed 37% + timed_out 13%） |
| pm2 日志 | `wc -l ~/.pm2/logs/routa-prod-{out,error}.log` | 8934 / 952 行 |
| 服务重启 | `pm2 list` ↺ 列 | 18 次；`acp_sessions.owner_instance_id` 出现 12 个不同 `next-<pid>` |
| 重复自动化拦截 | `pm2 logs \| grep "Stopped repeated" \| wc -l` | **146 次**（review 113, todo 68） |
| ACP 创建失败 | `pm2 logs \| grep "Background ACP creation failed"` | 8 次 |
| Prompt 超时 | `pm2 logs \| grep "session/prompt timed out"` | 8+ 次 |
| artifacts | `select type,count(*) from artifacts group by 1` | screenshot 29 / logs 25 / test_results 20 / code_diff 6，screenshot 共 13.8MB base64 |
| DSH 子进程 | `pgrep -fl deepseek-harness/apps/cli/lib/bin.js` | 15 → 22 个（持续增长），RSS 合计 3.27GB，全部 ppid=41891(routa-prod) |
| 仓库合并 | `git branch --merged` in topbi | 13 个 `issue/*` 分支 **0 个**合入 `feat/coder-query` |
| 任务完成率 / 堵塞率 | DB 查询 | 完成 2/13 = **15.4%**；堵塞 10/13 = **76.9%** |

### 专家会话分布

| 专家角色 | 会话数 | 占比 |
|---------|--------|------|
| kanban-todo-orchestrator | 66 | 29.9% |
| kanban-dev-executor | 48 | 21.7% |
| kanban-qa-frontend | 46 | 20.8% |
| kanban-backlog-refiner | 24 | 10.9% |
| kanban-review-guard | 16 | 7.2% |
| kanban-pr-publisher | 7 | 3.2% |
| kanban-done-reporter | 6 | 2.7% |

## 一句话结论

看板的**流转引擎（orchestrator）把「基础设施故障」「服务重启」「用户刷新页面」都当作 Agent 的行为来计数和熔断**，
UI 又只用一个 `lastSyncError` 字符串 + 「同步问题」标签把这些混在一起呈现，
导致 13/13 卡片带红色警告、Done 列与仓库真实状态脱节、用户无法从卡片上判断「现在到底卡在哪一步、该不该动手」。

---

## 一、任务流转层（最严重）

### 1.1 基础设施错误被当成 Agent 失败反复重试并触发熔断

- `error.log` 中 18 次 `no adapter registered for provider "local-7357"`（来源 `~/.dsh/profiles/acp/cordis.patch.yml` 硬编码 provider）。
- 每次失败 2–3 秒内返回（`('todo','failed')` 26 条中位 3s；`('dev','failed')` 18 条中位 2s），orchestrator 记 `recoveryReason=agent_failed`，watchdog_retry 再试 → 再失败。
- `getNonDevAutomationRunCount()` 只按 `laneSessions` 末尾连续同列条目计数，**不区分失败原因**，3 次秒失败就触发 `NON_DEV_AUTOMATION_REPEAT_LIMIT=3` 熔断（`workflow-orchestrator.ts:96-131`）。
- 结果：57 条 failed 泳道会话里 58 条 `agent_failed`，其中绝大多数是 provider 未注册这一个根因。

### 1.2 服务重启 = 泳道会话被判 timed_out，且重启计入熔断计数

- 20 条 `timed_out` 中 `('review','timed_out')` 14 条中位 3502s、最大 149025s（41.4h）；`('todo','timed_out')` 最大 148478s。
- 41 小时的「超时」= 09-18 10:01 → 09-20 03:16，对应 `acp_sessions` 按小时统计里 09-18 18 时 → 09-20 11 时之间**零会话创建**，即服务根本没在跑。
- `restart-recovery.ts:57-63 resolveStaleLaneSessionTerminalStatus()` 对所有非活跃 running 会话一律标 `timed_out`/`transitioned`，然后 `reviveMissingEntryAutomations` 重新触发 entry automation → 又多一条泳道会话 → 计数 +1。
- `activeAutomations` 是内存 Map（`workflow-orchestrator.ts:342-372`），重启即丢，正在跑的多步泳道的「下一步」上下文全部丢失。

### 1.3 多步 Review 泳道在 QA 通过后经常不启动 review-guard，卡片带 APPROVED 停在 Review

- 案例 `c1ad4e2f`：`review qa-frontend completed 09-20T03:16→03:23`，`verificationVerdict=APPROVED`，但泳道无 `review-guard stepIndex=1` 条目，卡片仍在 review 列。
- 案例 `e99d4cbb`：`verificationVerdict=APPROVED` 但 `column_id=dev`，且 `artifactSummary.requiredSatisfied=false`（缺 screenshot/test_results），互相矛盾。
- 根因链：`review-lane-convergence.ts:39-42` 要求 `!hasRemainingSteps`；`lane-automation-state.ts:63-88 findCurrentLaneSession()` 只匹配 running/transitioned/completed，当当前会话是 failed/timed_out 时返回 undefined → `currentStepIndex` 无法解析 → `hasRemainingSteps = steps.length > 1 = true` → 永远不收敛。日志 62 次 `[LaneAutomation] Could not resolve active step for multi-step lane` 就是这条路径。
- 同一路径也让 `route.ts:393-400` 的拖动拦截误判：只要 `triggerSessionId` 残留且泳道多步，用户手动拖卡也会被 400 拒绝。

### 1.4 Done ≠ 交付：Done 列卡片、13 个 issue 分支 0 个合入基线

- `done` 列 `deliveryRules` 只检查 `requireCommittedChanges/requireCleanWorktree/requirePullRequestReady`（worktree 内的状态），不检查「已合入 baseBranch」。
- `381c56fe` 在 Done 但 `verification_verdict=NULL`，`last_sync_error="ACP session did not complete successfully"`——它是被 `autoAdvanceOnSuccess` 直接推进的，从未有人/Agent 盖章。
- Done 列还有 2 步自动化（PR Publisher + 完成汇报员），失败也只是写 `lastSyncError`，不回退列。

### 1.5 步骤并发跑：Review 的 step 1 在 step 0 完成前启动

- 聚合发现 2 处 `review-guard(stepIndex=1).startedAt < qa-frontend(stepIndex=0).completedAt`（例 `383c998e`：qa 08:58:58→09:05:07，guard 08:59:07 启动）。
- 说明 `startNextAutomationStep` 与 restart-recovery/revive 的 enqueue 之间没有互斥；「泳道间不信任」的设计在同一泳道内被打破（guard 审的是尚未产出 QA 报告的卡）。

### 1.6 `GET /api/kanban/boards` 带副作用

- `src/app/api/kanban/boards/route.ts:60` 在 GET 里 `Promise.all(boards.map(reviveMissingEntryAutomations))`。
- 实测：打开一次看板页，`3fdcfaff` 的 `Stopped repeated non-dev automation` 告警从 46 条涨到 79 条；error.log 共 192 条同类告警，全是页面刷新触发的空转。
- 副作用还包括为已熔断卡片再次 `save(task)` 覆盖 `lastSyncError`/`updatedAt`，让用户看到卡片「刚更新」但其实什么都没发生。

### 1.7 会话进程不回收

- 板设置并发上限 5（`board-session-limits.ts:1`），但 22 个 DSH 子进程存活（最老 11 分 40 秒，全部由当前 routa-prod 拉起），泳道状态 completed 的会话进程也没退出。
- 每个 55–228MB，合计 3.27GB；同期 error.log 出现 3 条 `[NODE-CRON] missed execution ... Possible blocking IO or high CPU`。

### 1.8 双事件监听器竞态——orchestrator 与 queue 对同一事件独立处理

- `KanbanWorkflowOrchestrator`（`workflow-orchestrator.ts:220-232`）和 `KanbanSessionQueue`（`kanban-session-queue.ts:58-68`）都独立监听 `AGENT_COMPLETED/FAILED/TIMEOUT/REPORT_SUBMITTED`。
- Queue 的 handler 移除 job 条目并 drain 下一个任务；orchestrator 的 handler 做 recovery/auto-advance。两个 async handler 执行顺序不确定。
- Queue 可能先移除 job 并 drain 新任务 → orchestrator 的 recovery 再创建第二个并发会话 → 绕过 concurrency limit。

### 1.9 Prompt dispatch 超时静默吞错

- `agent-trigger.ts:719-752`：ACP session prompt 以 fire-and-forget 发射，函数在 prompt dispatch 前就已返回 `{ localSessionId }`。
- `agent-trigger.ts:736-741`：timeout 时仅打 `console.warn`，**不发射 `AGENT_FAILED` 事件** → orchestrator 永不知会话启动失败。
- 非 dev 列无 supervision（`workflow-orchestrator.ts:55-57` 硬编码 `stage === "dev"`），挂死的 review/todo agent 永远不会被 watchdog 发现。
- 对应 pm2 日志中 8+ 次 `session/prompt timed out`。

### 1.10 A2A Transport 死代码

- `agent-trigger.ts:644-649`：

```typescript
function getStepTransport(step?: KanbanAutomationStep): KanbanTransport {
  if (step?.transport === "a2a") {
    return "acp";  // ← BUG: 即使配置了 a2a 也返回 acp
  }
  return step?.transport ?? "acp";
}
```

- `triggerA2ATaskAgent` 永远不会被调用。A2A 自动化配置静默回退到 ACP。

---

## 二、数据层

### 2.1 FK 约束被禁用

```bash
sqlite3 routa.db "PRAGMA foreign_keys"
# 结果: 0
```

所有 `sqlite-schema.ts` 中的 `REFERENCES ... ON DELETE CASCADE` 声明（lines 48, 66, 116, 137 等）形同虚设。删除 workspace 不会级联清理 tasks/boards/agents/sessions。

### 2.2 tasks 表无索引全表扫描

```bash
sqlite3 routa.db "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='tasks'"
# 结果: 仅 sqlite_autoindex_tasks_1（PK）
```

缺失索引：`workspace_id`、`board_id`、`column_id`、`status`、`assigned_to`、`(board_id, column_id, position)` 复合索引。`listByWorkspace`/`listByStatus`/`listByAssignee` 全表扫描。

### 2.3 Position 全局编号非列内编号

```sql
SELECT column_id, group_concat(position) FROM tasks
WHERE board_id = '312b1f5a-f1d6-4e51-b0da-334944e64609' GROUP BY column_id;
-- dev: 7,10,11,12 | done: 0,4 | review: 1,2,3,5,6,8 | todo: 9
```

跨列移动不重算位置（`task.position = params.position ?? task.position`），列内排序不可预测。

### 2.4 NEEDS_FIX / CANCELLED 无列映射

- `columnIdToTaskStatus()` 和 `taskStatusToColumnId()`（`src/core/models/kanban.ts:319-372`）的 switch 无 `NEEDS_FIX`/`CANCELLED` case，静默落入 `default → backlog`。
- 但 `agent-tools.ts:518` 和 `orchestrator.ts:1527` 会设置 `NEEDS_FIX`，看板无对应可视化列。

### 2.5 setDefault 非事务化两步 SQL

- `sqlite-stores.ts:289-299`：先 `UPDATE ... SET isDefault = false`，再 `UPDATE ... SET isDefault = true`，两步间崩溃 → workspace 无默认看板。应包在 transaction 内。

### 2.6 findReadyTasks 全量加载 + O(N²)

- `sqlite-task-store.ts:162-173`：加载 workspace **全部 tasks**（含大型 JSON 字段 `jit_context_snapshot`、`lane_sessions`、`delivery_snapshot`），构建 Map，遍历 dependencies。

### 2.7 atomicUpdate 仅覆盖 5 字段

- `sqlite-task-store.ts:198-223`：乐观锁 CAS 仅保护 `status/completionSummary/verificationVerdict/verificationReport/assignedTo`。`moveCard` 修改的 `columnId/status/position/deliverySnapshot/comments/laneSessions` 走 `save()` 无 version check，并发 move 可互相覆盖。

### 2.8 appendHistory 读-改-写竞态

- `sqlite-stores.ts:818-852`：先 `get(sessionId)` 读 → 内存拼接 history → `update` 写回。两个并发 `appendHistory` 可导致前者的 notification 被覆盖。

---

## 三、数据展示层

### 3.1 一个字段承担三种语义：`lastSyncError`

- 字段名叫 sync error，实际写入的是：① 熔断信息 ② watchdog 恢复进度 ③ ACP 失败。13/13 卡片非空。
- UI（`kanban-card.tsx:140-151 getSyncLabel`）把它渲染成「同步问题」（i18n key `syncIssue`），语义来自 GitHub 同步，用户完全无法关联到「自动化被熔断」。
- `workflow-orchestrator.ts:505-507` `else if (!task.lastSyncError)` 只在为空时写入 → 旧错误永不被新错误覆盖；只有成功时清空。所以 Done 列 `2a932341` 至今显示 `开发执行员 recovered after session failed. Attempt 2/2.`（Dev 阶段的旧信息）。

### 3.2 卡片没有「当前在哪一步」

- 卡片正面渲染：状态徽章 / 同步徽章 / 优先级 / artifact gate / artifact 数 / 摘要 / 评审反馈 / 实时尾巴 / 标签 / worktree。
- **没有**：当前泳道第几步（QA Frontend 还是 Review Guard）、这一步跑了多久、本列已重跑几次、距熔断还剩几次。用户只有点开详情 → 执行 tab 才能看到「当前运行：前端质量守卫」。
- 而后端 `laneSessions` 已经有 `stepIndex/stepName/status/startedAt/attempt/recoveryReason` 全部信息，只是没用。

### 3.3 徽章重复/矛盾

- 排队卡片渲染两个一模一样的「排队中 #4」（状态徽章与同步徽章都走 queuePosition 分支）。
- `2a932341`：「完成」+「同步问题」并列；`e99d4cbb`：「已通过」+「Needs Screenshot +1」并列。
- 「空闲」徽章（`sessionStatus` undefined）出现在正在运行 review-guard 的卡上（`f86424f3` 有 live tail 却显示空闲），因为徽章取的是 `linkedSession.acpStatus`，而 linkedSession 只跟 `triggerSessionId`。

### 3.4 列表接口体积

- `/api/tasks?workspaceId=` 13 张卡返回 **2035KB**：`laneSessions` 874KB（56.9%）+ `jitContextSnapshot` 399KB（26%）。
- 每条泳道会话重复携带完整 `objective`（`task-lane-history.ts:66`），`383c998e` 21 条泳道会话重复 106KB 同一段 story YAML。
- 看板每 10s 轮询 live tail（`kanban-tab.tsx:84`），加上 SSE 触发的 refetch，2MB 载荷会在会话活跃时反复拉取。
- screenshot artifact 以 base64 存 SQLite（单张最大 3.1MB）。

### 3.5 详情页「概览」把多轮 QA 报告堆叠

- `c1ad4e2f` 概览 tab 渲染了 3 段同名 `QA Frontend Findings`（e175/e181/e182），没有轮次/时间/结论区分。

---

## 四、UI 架构与可维护性

### 4.1 God Component——kanban-tab.tsx 2,263 行 / 135 个 hooks

```bash
wc -l src/app/workspace/\[workspaceId\]/kanban/kanban-tab.tsx   # 2263
grep -c "useState" ...   # 57
grep -c "useEffect" ...  # 26
grep -c "useCallback" ...# 31
grep -c "useMemo" ...    # 21
# 总计: 135 个 hooks
```

状态类别：Board 选择（5）、Task CRUD（7）、Agent/AI（6）、GitHub 导入（3）、Codebase modal（20+）、详情 split（3）、文件变更（2）、删除确认（2）、Move blocked（3）、Session backfill（3+）、页面可见性（1）。Prop drilling 最深达 4-5 层，最大 prop 对象 35+ 属性。

15 个文件超 500 行（其中 4 个超 1,000 行），看板模块 UI 总量 20,988 行。

### 4.2 无 Error Boundary

```bash
grep -rn "ErrorBoundary" src/app/workspace/\[workspaceId\]/kanban/
# 仅 kanban-fitness-workbench-modal.tsx:77 有一处
```

board surface（DnD 区域）、card detail（1,554 行）、activity panel（861 行）、detail panels（1,782 行）、settings modal（1,202 行）、codebase modal（1,195 行）均无 Error Boundary。渲染错误会崩溃整个看板页面。

### 4.3 30+ 硬编码英文字符串（i18n 违规）

违反 `AGENTS.md` 规范。已验证违规位置：

- `kanban-card-detail.tsx`：`"Workspace default"` (L83)、`"Column"` (L467)、`"Runs"` (L469)、`"GitHub"` (L478)、`"Repo Health"` (L1429)、`"Session mismatch"/"Aligned"` (L1441)、`"Open active session"` (L1470) 等 20+ 处
- `kanban-card-activity.tsx`：`formatTaskRunKind`/`formatTaskRunStatus` 全部返回硬编码英文 (L37-63)
- `kanban-tab.tsx:1747`：`"This issue has an attached worktree. Clean it up now?"`
- `kanban-fitness-workbench-modal.tsx`：15+ 处 `"Failed to load fitness files"` 等

### 4.4 DnD 缺 KeyboardSensor + 列无 ARIA

- `kanban-tab-panels.tsx:503-504`：仅配置 `MouseSensor` + `TouchSensor`，无 `KeyboardSensor`。
- 列 drop zone 无 `tabIndex`/`role`/`aria-*`/keyboard event handler。键盘用户完全无法移动卡片。

### 4.5 9 处 window.confirm + 1 处 window.prompt

- `kanban-tab.tsx:1463` — 删除分支；`1474` — 清理 issue branches；`1746` — worktree 清理（硬编码英文）；`1903` — 新建看板（`window.prompt`，无验证/取消处理）
- `kanban-settings-modal.tsx:396` — 清空全部任务
- `kanban-enhanced-file-changes-panel.tsx:174,296,306,316` — git 操作

### 4.6 乐观更新回滚用过期 prop

`kanban-tab.tsx:1766,1805`：

```typescript
setLocalTasks(optimistic); // 乐观更新
// ... on error:
setLocalTasks(tasks);      // ← 用 tasks prop 回滚，可能已过期！
```

其他操作（auto-patching、session backfill）可能已更新 `localTasks`，回滚会丢弃所有并发更改。应改为 functional updater。

### 4.7 其他 UI 问题

| 问题 | 位置 |
|------|------|
| 20+ 空 catch 块静默吞错 | kanban-page-client.tsx (5处), kanban-tab.tsx (6处), 其他多处 |
| Modal 无 focus trap / `role="dialog"` / `aria-modal` / 背景 scroll 未锁 | kanban-tab-modals.tsx |
| 4 个 props 接收后 `void`（availableProviders 等），触发无意义重渲染 | kanban-card.tsx:303-306 |
| 多个 async onClick 无 try/catch | kanban-card-detail.tsx:427,461,1122 |
| 26+ props 深层 drilling（应走 Context） | kanban-card-detail.tsx |
| `save()` 50 字段 INSERT/UPDATE 双写 | sqlite-task-store.ts:14-127 |
| `formatAgentCardTarget` 在 3 个文件重复定义 | card-detail:87, activity:142, tab-helpers:257 |
| `ColumnTransitionHandler` 死代码 | column-transition.ts:83-126 |

---

## 五、交互逻辑层

### 5.1 「重新运行」按钮几乎不出现在卡片上

- `kanban-card.tsx:239-242`：`canRetry` 仅当 `sessionStatus==='error'` 或 `(!triggerSessionId && columnId==='dev')`；`canRun` 要求 `!triggerSessionId`。
- 熔断卡片（Todo/Review 列）`triggerSessionId` 为空但列不是 dev → 两个条件都不满足 → 13 张卡 0 个按钮。用户必须点开详情 → 执行 tab → 拉到底部才能找到「重新运行」。
- 而 `PATCH {retryTrigger:true}` 后端本身是对熔断放行的（`route.ts:356-362` 清 trigger + 移除队列，直接 enqueue），只是前端没给入口。

### 5.2 拖拽反馈缺失

- 拖动被 `route.ts:399` 拒绝时返回 400 + 英文长句 `Cannot move "…" out of Review yet: … is still active and … must run next`，没有 i18n，也没有「强制移动」选项。

### 5.3 详情页信息层级倒置

- 顶部是可编辑标题 + 优先级；「当前运行 / 失败原因 / 重新运行」在执行 tab 深处；而这三样才是卡片卡住时用户第一需要的。

---

## 六、优化方案

按「先止血、再修正确性、再修数据层、最后重构展示」排序。每项给出落点文件，便于拆成 baby-step commit。

### P0 止血（1–2 天）

| # | 改动 | 落点 |
|---|---|---|
| P0-1 | 熔断计数只统计**有实质运行**的条目：过滤掉 `completedAt-startedAt < 15s` 且无 `lastActivityAt` 的秒失败；秒失败连续 ≥2 次直接标 `infra_error` 并停止重试，不计入 repeat limit | `workflow-orchestrator.ts getNonDevAutomationRunCount` |
| P0-2 | 把 `reviveMissingEntryAutomations` 从 `GET /api/kanban/boards` 移到服务启动钩子 + 显式 `POST /api/kanban/boards/:id/revive`；GET 必须无副作用 | `src/app/api/kanban/boards/route.ts:60` |
| P0-3 | 泳道会话 completed/failed 后回收 DSH 子进程（或至少 idle N 分钟后 kill），并让 `board-session-limits` 的 5 真正对应存活进程数 | `kanban-session-queue.ts` / process manager |
| P0-4 | `lastSyncError` 每次失败都覆盖写（去掉 `else if (!task.lastSyncError)`），泳道切列时清空 | `workflow-orchestrator.ts:505` |
| P0-5 | 修 DSH profile：`local-7357` 改为已注册 provider 或走 env 注入 | `~/.dsh/profiles/acp/cordis.patch.yml` |
| P0-6 | prompt dispatch timeout 时发射 `AGENT_FAILED` 事件（而非仅 warn） | `agent-trigger.ts:736-741` |
| P0-7 | 启用 `PRAGMA foreign_keys = ON`；添加 tasks 复合索引 `(board_id, column_id, position)` | SQLite 连接初始化 + sqlite-schema.ts |

### P1 正确性（3–5 天）

| # | 改动 | 落点 |
|---|---|---|
| P1-1 | `findCurrentLaneSession` 回退时也接受 failed/timed_out（取当前列最新一条），让 `currentStepIndex` 可解析；`hasRemainingSteps` 在无法解析时返回 `false` 而不是 `steps.length>1`，避免死锁 | `lane-automation-state.ts:63-88, 137-140` |
| P1-2 | `activeAutomations` 落盘（或从 `laneSessions` 重建）：重启后先按 `laneSessions` 最后一条 completed 的 `stepIndex+1` 续跑，而不是重新 entry | `workflow-orchestrator.ts`, `restart-recovery.ts` |
| P1-3 | 重启判定的会话状态用新枚举 `interrupted`（不是 `timed_out`），且不计入 repeat limit；恢复时若 `lastActivityAt` 距今 < 30min 优先 resume 而非重建 | `restart-recovery.ts:57-63` |
| P1-4 | 同一卡片同一泳道加互斥：`startNextAutomationStep` 与 revive enqueue 共用 `laneSessions` 里 running 条目作为锁 | `workflow-orchestrator.ts:677`, `restart-recovery.ts:242` |
| P1-5 | Done 的 `deliveryRules` 增加 `requireMergedIntoBase`（`git merge-base --is-ancestor <branch> <base>`），Done 自动化失败回退到 Review | `task-delivery-readiness.ts`, `column-transition.ts` |
| P1-6 | 收敛时校验一致性：`verificationVerdict=APPROVED` 但 `artifactSummary.requiredSatisfied=false` → 判 `NOT_APPROVED` 并写明原因 | `review-lane-convergence.ts` |
| P1-7 | 统一事件处理：queue 作为 orchestrator 内部组件而非独立监听 EventBus，消除双监听竞态 | `workflow-orchestrator.ts`, `kanban-session-queue.ts` |
| P1-8 | 修复 `getStepTransport` A2A bug：返回 `step.transport` 本身 | `agent-trigger.ts:644-649` |
| P1-9 | 为 review/todo/backlog 加轻量 inactivity watchdog | `workflow-orchestrator.ts:55-57` |

### P2 展示、交互与架构重构（1–2 周）

| # | 改动 | 落点 |
|---|---|---|
| P2-1 | 拆 `lastSyncError` 为结构化 `automationState: { kind: 'circuit_open'\|'infra_error'\|'agent_failed'\|'recovering'\|'ok', message, runCount, limit, lastStepId, at }`；UI 按 kind 上色/文案，i18n 走 `t.kanban.automation.*`；`syncIssue` 只留给 GitHub 同步 | `models/task.ts`, `kanban-card.tsx:140-151` |
| P2-2 | 卡片正面加「泳道进度条」：`步骤 2/2 · 评审守卫 · 运行 3m12s · 本列第 4 次运行（上限 3）`，数据源就是 `laneSessions` 最后一条 | `kanban-card.tsx` 新增 `LaneProgress` |
| P2-3 | 「重新运行」按钮条件改为 `automationState.kind in ('circuit_open','infra_error','agent_failed') || !triggerSessionId`，与列无关 | `kanban-card.tsx:239-242` |
| P2-4 | 去重徽章：queuePosition 只渲染一次；状态徽章取当前列最新泳道会话的 status，而不是 `linkedSession.acpStatus` | `kanban-card.tsx:245-265` |
| P2-5 | 列表接口瘦身：`/api/tasks` 默认不返回 `laneSessions[].objective` 与 `jitContextSnapshot`（`?include=` 显式请求）；`laneSessions` 只返回最近 N 条 + 汇总计数 | `src/app/api/tasks/route.ts`, `task-lane-history.ts:66` |
| P2-6 | screenshot artifact 落文件系统（`~/.routa/workspace/.../artifacts/`），DB 只存路径 + 尺寸 | `artifact store` |
| P2-7 | 详情页首屏 = 「当前状态卡」：当前步骤 / 上次失败原因 / 重新运行 / 强制移动；QA 报告按轮次折叠并带时间戳与结论 | `kanban-card-detail.tsx`, `kanban-detail-panels.tsx` |
| P2-8 | 拖动被拒时返回结构化 `{ code:'LANE_STEPS_REMAINING', currentStep, nextStep }`，前端 toast 用 i18n 并提供「跳过剩余步骤并移动」 | `route.ts:393-400`, `kanban-tab.tsx` |
| P2-9 | **拆分 kanban-tab.tsx**：抽取 `useKanbanBoardState`、`useKanbanModals`、`useKanbanSessions`、`useKanbanCodebaseModal` 四个 domain hooks | `kanban-tab.tsx`（57 useState → 每 hook <15） |
| P2-10 | board surface / card detail / modal 添加 **Error Boundary** | 看板 UI 关键区域 |
| P2-11 | 30+ 硬编码字符串迁入 **i18n** | kanban-card-detail/card-activity/tab/fitness-workbench |
| P2-12 | 添加 **KeyboardSensor** + 列 ARIA 属性；Modal 加 focus trap + `role="dialog"` | kanban-tab-panels.tsx, kanban-tab-modals.tsx |
| P2-13 | 乐观更新改 **functional updater**；`window.confirm/prompt` 替换为自定义 Dialog | kanban-tab.tsx |
| P2-14 | `moveCard` 时重计算目标列 **position**（0 起连续）；`atomicUpdate` 覆盖 `columnId/status/position` | column-transition.ts, sqlite-task-store.ts |
| P2-15 | 补全 `NEEDS_FIX`/`CANCELLED` **列映射** + UI 指示 | kanban.ts:319-372 |
| P2-16 | flow-diagnostics **可视化仪表盘** | 新增 dashboard 组件 |

### 验证方式（每项改动都应有）

- 特征化测试：用本轮 `383c998e`/`c1ad4e2f` 的 `laneSessions` 真实 JSON 作为 fixture，锁定「秒失败不计熔断」「failed 后仍能解析 step」「APPROVED+步骤缺失 → 补跑 review-guard 而非停滞」。
- 运行时探针：`curl /api/tasks?workspaceId=… | wc -c` 目标 < 200KB；`pgrep -c bin.js` ≤ 并发上限 + 1；打开看板页 error.log 行数不增长。

---

## 附：本轮观察到的正向设计（应保留）

- `laneSessions` append-only 且字段完整（stepIndex/attempt/recoveryReason/recoveredFromSessionId），是复盘能做到这一步的前提——问题只是没被 UI 消费。
- Review 收敛按 `verificationVerdict` 而非文本判定（9ce356e0 已让 specialist 强制盖章）是对的方向。
- `retryTrigger` 后端语义清晰（清 trigger + 清错误 + 出队 + 直接入队），只需要前端给入口。
- 泳道间不信任（下游重验上游）原则正确，需要补的是**同泳道内步骤串行互斥**。
- **Canonical Story 规范化**：`requireCanonicalStory` + `loopBreakerThreshold` 门控是任务质量的良好实践。
- **Flow Ledger 诊断框架**：弹跳检测 / 失败热点 / 交接摩擦分析是成熟的可观测性设计。
- **多步 Specialist Pipeline**：Backlog 梳理员→Todo 编排员→开发执行员→前端质量守卫→评审守卫→PR Publisher→完成汇报员——完整的 agent-first 编排。
- **Delivery Rules 硬门控**：`requireCommittedChanges` + `requireCleanWorktree` + `requirePullRequestReady`。
- **SSE 实时推送**：`kanban-event-broadcaster` + `useKanbanEvents` 增量刷新机制。
- **History Memory Policy**：跨任务历史记忆注入的 confidence 分级策略。

## Issue Hygiene

- 2026-09-22: `kind: analysis`, reviewed. Several items it raised shipped in `docs/exec-plans/completed/kanban-ux-feedback.md` (toast layer, completion notifications, list payload diet, live-tail push). Left `open` as reference material; not an active tracker.
