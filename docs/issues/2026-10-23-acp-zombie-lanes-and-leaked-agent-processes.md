---
title: "Late turn ends dropped after the 5-minute prompt wait; agent processes leak on startup timeout, re-spawn and step end"
date: "2026-10-23"
kind: issue
status: resolved
severity: high
area: "acp"
tags: ["kanban", "acp", "dsh", "process-lifecycle", "session-queue", "memory"]
reported_by: "claude"
related_issues: ["2026-09-20-kanban-design-retrospective-topbi-run.md"]
github_issue: null
github_state: null
github_url: null
---

# 超时后才到的回合结束被丢掉，施工者进程在启动超时、重复拉起、步骤结束时泄漏

## What Happened

2026-10-23 13:39，一台 24GB 内存的机器上有 89 个 DSH 施工者进程挂在 Routa（pm2 `routa-prod`）下，只有 5 个在干活，footprint 合计 64GB，交换区 58.6/59.4GB 用满；清理 50 分钟后又涨回 83 个 / 61GB。看板队列 `runningCount` 一直是 5（满额），卡 1e7dd356 的列内下一步排不上。

同一天的 pm2 日志（`~/.pm2/logs/routa-prod-*.log`）里：

- 48 条 `[AcpProcess:DeepSeek Harness] Unhandled message: {"jsonrpc":"2.0","id":3,"error":{... usage_limit_reached ...}}`：Routa 等 `session/prompt` 5 分钟超时后，dsh 后来回的回合报错没人接，lane 永远 `running`（例：卡 25afcd82 的 Main Pusher 会话 435fbeed）。
- 31 条 `Timeout waiting for session/new`、3 条 `Timeout waiting for initialize`：启动只给 15 秒，超时后进程没被结束。
- 85 次 `Session <id> not found, auto-creating`：其中 75 个会话之前 `Background ACP creation failed`，prompt 路径为同一会话再拉一个进程，前一个脱管；另有 5 次紧跟在 `Killing process pid=` 之后——失败会话刚被结束，恢复提示（notifyKanbanAgent）又把它拉起来。
- 手工清理时 29 个进程里 25 个 `POST /api/sessions/<id>/disconnect` 返回 `Session not found`：这些进程已不在 Routa 的管理范围内。

## Expected Behavior

- 超时之后才到的回合结束（成功或报错）照样结束这一步：lane 记 completed / failed，释放看板名额。
- 一步结束就结束这一步的进程；Done 列失败时结束该卡全部进程；同一会话不会同时有两个进程，Routa 不会留下管不到的进程。
- 启动慢（内存紧张时 dsh 冷启动超过 15 秒）不算失败；真超时就立刻结束那个进程。

## Reproduction Context

- Environment: web（Next.js，pm2 生产模式），施工者 provider = dsh
- Trigger: 跑全量测试超过 5 分钟的 Done 列推送步骤 + RunAI 账号限流（`trial_rate_limited`）；内存压力下 dsh 冷启动超过 15 秒。

## Why This Might Happen

- `acp-process.ts` `sendRequest` 超时后删掉 pending 条目；之后到来的应答只有「带 stopReason 的成功」被 `handleLateTurnCompleteResult` 转成 `turn_complete`，错误应答落到 Unhandled 分支；同 stopReason 的第二次迟到成功还会被去重吞掉。
- `acp-process-manager.ts` `createSession` / `loadSession` 在 initialize / session/new 失败时只清 MCP、不结束已 spawn 的进程；`processes.set` 覆盖同会话旧条目时不结束旧进程；`killSession` 只认 Map 里登记的那一个。
- `workflow-orchestrator.ts` 只在 Done 最后一步成功时 `killTeardownSession`；前几列步骤完成后的进程一直留到卡进 Done，Done 失败时不收尾；失败路径先 kill 再 `notifyKanbanAgent`，提示词经 `ensurePromptSessionExists` 把被结束的会话重新拉起。

## Resolution (2026-10-23)

| 问题 | 改法 | 测试 |
|---|---|---|
| 超时后到的报错被丢 | `AcpProcess` 记下超时的 prompt 请求号；迟到的报错发成 `sessionUpdate: "error"`（code `prompt_failed_after_timeout`），迟到的成功逐条发 `turn_complete`，经会话存储变成 AGENT_FAILED / AGENT_COMPLETED，编排器改 lane 状态、看板队列释放名额 | `late-turn-end-after-prompt-timeout.test.ts`、`acp-process.test.ts`「turn end after a session/prompt timeout」 |
| 启动 15 秒超时 | initialize / session/new / session/load 默认 60 秒（npx/uvx 120 秒），`ROUTA_ACP_STARTUP_TIMEOUT_MS` 可覆盖 | `acp-process.test.ts`「startup timeout」 |
| 启动失败、重复拉起留下脱管进程 | `AcpProcessManager.bootAcpProcess`：启动失败即结束进程；正在启动的进程登记在 `startingProcesses`，`killSession` 一并结束且不再登记；`registerProcess` 换新进程时结束旧进程 | `acp-process-manager.test.ts`「agent process lifecycle」 |
| 步骤结束不关进程、Done 失败不收尾、恢复提示重新拉起 | 编排器每步结束（完成、失败、超时、改走恢复）结束该步会话，工具调用合成的完成等回合结束再关；Done 列失败结束该卡全部会话、保留工作副本；每个会话只结束一次；已结束的会话不再发恢复提示 | `workflow-orchestrator-kill-session.test.ts`、`workflow-orchestrator-done-teardown.test.ts`、`done-worktree-cleanup.test.ts` AC1、`workflow-orchestrator.test.ts`「records AGENT_FAILED recovery」 |

没有后续步骤复用上一步的会话：同列下一步和恢复都新建会话（`startNextAutomationStep` / `recoverAutomation` 都调 `createSession`），换列时 `prepareTaskForColumnChange` 清掉 `triggerSessionId`。结束进程走 `AcpProcess.kill()`，先清 `_alive` 再发信号，退出不产生 `process_exited` 错误，不会触发 3054a54f 修过的「进程一退就记 failed 并重跑 Done 末步」。

部署前已经脱管的进程（不在新 Routa 进程的 Map 里）不会被新逻辑接管，部署重启时要手动清一次。

## 非 Dev 列无活动看门狗（2026-10-23 补）

上面的修复让「迟到的回复」能结束步骤；如果施工者根本不再回复（进程挂住、回复丢在半路、进程没了却没报退出），非 Dev 列的步骤照样永远 `running`：`shouldSuperviseStage` 只认 `dev`，看门狗只扫 Dev 列。

改法：

- Backlog / Todo / Review / Done 列的步骤挂上只超时、不重试的看门狗（`ActiveAutomation.laneWatchdog`）。N 分钟没有任何 ACP 活动，就发 `AGENT_TIMEOUT`：lane 记 `timed_out`（`recoveryReason: watchdog_inactivity`），按 deea45bd 的路径结束该步进程（Done 列失败时结束全卡进程），看板队列释放名额，卡片显示失败，等人「重新运行」。
- 非 Dev 列不重试、不发恢复提示、也不交给卡上配置的兜底施工者（`enableAutomaticFallback`）：Done 列推送员重跑可能重复推送；Review / Todo / Backlog 的步骤由人看过原因再重跑。POST revive 也跳过「最后一次运行是在本列被看门狗判超时」的非 Dev 卡（Dev 列照旧）。
- 看板队列满时，步骤排队，队列启动后会话号只写在卡的 `triggerSessionId` 上，编排器要等这一步结束才知道它；看门狗现在会按 `triggerSessionId` 接管已启动的排队步骤（Dev 列同样受益）。
- 阈值：默认 20 分钟；看板可在工作区 metadata `kanbanLaneSessionWatchdog:<boardId>` 写 `{"enabled":true,"inactivityTimeoutMinutes":30}` 覆盖（1–240 分钟，`enabled:false` 关闭），写法同 `kanbanDevSessionSupervision:<boardId>`。

阈值依据（`routa.db` 只读，`session_messages.created_at` 是每条 ACP 通知入库的时间，按会话求相邻两条的最大间隔，算到第一条 `turn_complete` 为止）：

| 列 | 已完成步骤数 | 最长空档中位 | 最长空档 p99 | 最长空档 |
|---|---|---|---|---|
| backlog | 144 | 0.7 分 | 2.2 分 | 2.3 分 |
| todo | 168 | 1.4 分 | 3.3 分 | 6.2 分 |
| review | 292 | 0.4 分 | 10.0 分 | 10.0 分（600.3 秒） |
| done | 269 | 0.3 分 | 5.6 分 | 6.8 分 |
| 列没有 stage 的旧看板 | 16 | 0.6 分 | 10.0 分 | 10.0 分 |

超过 8 分钟的空档都出在一次工具调用里（`tool_call` → `tool_call_update`）：`job_output wait` 或长测试命令，最长 600.0–600.5 秒，因为 DSH 单次工具等待到 10 分钟就返回。所以正常步骤两次事件间最多空 10 分钟，阈值取它的两倍。同一批数据里，三个挂住的 Done 步骤空了 2.2 / 3.1 / 7.0 小时，20 分钟能在半小时内放出名额。Dev 列默认 10 分钟正好卡在这个上限上：13 个被判 `timed_out` 的 Dev 会话里，6 个超时前只安静了 608–628 秒，其中有没有误杀本次没查，Dev 阈值也没改。pm2 日志行没有时间戳，算不出间隔，只用 routa.db。

测试：`workflow-orchestrator-lane-watchdog.test.ts`（四列各一条超时用例、19 分钟安静不误杀、看板覆盖、看板关闭、排队后启动的步骤、不交给兜底施工者）、`restart-recovery.test.ts`「revive of a … step the inactivity watchdog ended」、`board-session-supervision.test.ts`「defaults the lane watchdog outside Dev」。撤掉修复后其中 11 条变红。

剩余：Routa 重启后内存里的 `activeAutomations` 清空，重启前已在跑的步骤不归看门狗管（Dev 列同样如此）；Rust 桌面后端没有对应看门狗，本次只改了 Web（Next.js）后端。

## 变更记录

| 日期 | 改了什么 | 效果 | 提交 |
|---|---|---|---|
| 2026-10-23 | 迟到的回合结束能结束步骤；启动超时放宽到 60 秒；启动失败、重复拉起不留进程 | 迟到报错不再让 lane 永远 running | 8949946d |
| 2026-10-23 | 每步结束即结束该步进程；Done 失败结束全卡进程 | 进 Done 前不再攒各步进程 | deea45bd |
| 2026-10-23 | 非 Dev 列无活动看门狗：默认 20 分钟记 timed_out、结束进程、释放名额，不重试，revive 跳过；排队后启动的步骤也接管 | 不回复的非 Dev 步骤最多占名额 20 分钟（以前无限期） | 本提交 |
