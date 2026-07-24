---
title: 泳道经验记忆：Routa 怎么越用越"聪明"
prerequisite: 05-specialist-persona-system.zh-CN.md
---

# 泳道经验记忆：Routa 怎么越用越"聪明"

> 接着 [Specialist 人设体系](05-specialist-persona-system.zh-CN.md) 深入。
> 前五篇讲清了"Agent 怎么被叫来干活、干的是什么角色"。
> 本文讲最后一块拼图：**Agent 带着什么"前人经验"开工——以及这些经验从哪来、怎么注入。**
>
> 这是 Routa 跟普通工具最大的差异化能力：**闭环学习。每次任务执行都产生经验记录，
> 经验被合成成模式，模式被注入下一次任务的 prompt，Agent 因此越来越"聪明"。**
>
> 本文是**学习笔记**，不是规范来源。事实以代码为准。

## 0. 一句话抓住本质

> **每次 Agent 干活都留下记录 → 记录被合成成"经验模式" → 下一个 Agent 开工时，
> 经验模式被注入 prompt → Agent 带着前人的教训和策略干活 → 干完又留下新记录。
> 闭环。越转越聪明。**

## 1. 全景图：四层记忆，从原始数据到 Agent 的 prompt

~~~plaintext
┌──────────────────────────────────────────────────────────────┐
│                    Agent 的 Prompt                             │
│                                                              │
│  ## Lane Experience Memory      ← 泳道经验（当前列+历史列）   │
│  ## Flow Guidance               ← 流量指导（board 级瓶颈）    │
│  ## Relevant History Memory     ← 历史相似任务的经验           │
│  ## Relevant Strategy Memory    ← 推理记忆（harness 策略）    │
└───────────────────────────────┬──────────────────────────────┘
                                │ 注入
                                │
┌───────────────────────────────┴──────────────────────────────┐
│              合成层：把原始记录变成可读的模式                    │
│                                                              │
│  synthesizeTaskLaneJitContextAnalysis()   ← 泳道经验合成      │
│  analyzeFlowForTasks()                   ← 流量诊断           │
│  scoreAndRankHistoryMemory()             ← 历史任务匹配       │
│  searchReasoningMemories()               ← 策略记忆检索       │
└───────────────────────────────┬──────────────────────────────┘
                                │ 读取
                                │
┌───────────────────────────────┴──────────────────────────────┐
│              原始数据层：每次执行留下的记录                      │
│                                                              │
│  task.laneSessions[]     ← 每次 session 的详细记录            │
│  task.laneHandoffs[]     ← 泳道间交接记录                     │
│  task.jitContextSnapshot ← JIT 上下文快照                     │
│  .routa/reasoning-memory/memories.json ← 策略记忆库           │
└──────────────────────────────────────────────────────────────┘
~~~

## 2. 原始数据：每次 Agent 干活留下什么

### 2a. TaskLaneSession：一次 session 的详细档案

**代码：** `src/core/kanban/task-lane-history.ts`

每次 Agent 在某个泳道干活，`upsertTaskLaneSession()` 记录：

~~~plaintext
TaskLaneSession {
  sessionId:       "acp-session-xxx",
  columnId:        "dev",
  columnName:      "Dev",
  provider:        "claude",
  role:            "CRAFTER",
  specialistId:    "crafter-v3",
  specialistName:  "Crafter",
  status:          "completed" | "failed" | "timed_out",
  startedAt:       "2026-07-23T10:00:00Z",
  completedAt:     "2026-07-23T10:45:00Z",
  attempt:         1,
  loopMode:        "watchdog_retry",
  recoveryReason:  "agent_failed",    ← 如果是恢复的
  recoveredFromSessionId: "xxx",      ← 从哪个失败的 session 恢复的
  objective:       "实现登录 API",
}
~~~

**每一次 session 启动/完成/失败/恢复都会更新这条记录。** 积累下来，一个 task 的
`laneSessions[]` 就是它在看板上"走过的路"的完整日志。

### 2b. TaskLaneHandoff：泳道间的交接记录

~~~plaintext
TaskLaneHandoff {
  id:              "handoff-xxx",
  fromColumnId:    "dev",
  toColumnId:      "review",
  requestType:     "environment_preparation" | "runtime_context" | "clarification",
  request:         "请确认测试数据库是否已初始化",
  status:          "requested" | "blocked" | "responded" | "failed",
  respondedAt:     "2026-07-23T11:00:00Z",
}
~~~

这记录了**列与列之间的沟通**——dev 列的 CRAFTER 向 review 列的 GATE 要什么、等了多久、有没有被阻塞。

## 3. 合成层：把原始记录变成可读的模式

### 3a. 泳道经验合成（Lane Experience）

**代码：** `src/core/kanban/task-lane-experience.ts`（~600 行）

`synthesizeTaskLaneJitContextAnalysis()` 扫描一个 task 的所有 `laneSessions[]`，
按列分组，为每一列生成一个 `LaneAnalysis`：

~~~plaintext
LaneAnalysis（每个列一个）
{
  sessionCount:       5,           ← 这个列跑过几次
  completedSessions:  3,
  failedSessions:     1,
  recoveredSessions:  1,

  summary: "Dev 列跑了 5 次，3 次成功，1 次失败后恢复，1 次彻底失败",

  learnedPatterns: [               ← 最多 8 条
    "3 prior run(s) completed without issue",
    "Recovery needed 2 times for reason: context_missing",
    "Specialist context: claude-opus-4",
    "Latest objective: validate API response schema",
  ],

  topFailures: [                   ← 最多 6 条，按频率排序
    { reason: "agent_failed", count: 2 },
    { reason: "watchdog_inactivity", count: 1 },
  ],

  recommendedActions: [            ← 最多 6 条
    "Review agent timeout settings for dev lane",
    "Consider breaking large tasks into smaller subtasks",
  ],

  contextHints: { ... },           ← 合并的 contextSearchSpec
  flowGuidance: [ ... ],           ← board 级流量指导（如果有）
}
~~~

**从原始的 5 条 session 记录，合成出一段结构化的"经验总结"。**

### 3b. 流量诊断（Flow Ledger）

**代码：** `src/core/kanban/flow-ledger.ts`（~450 行）

`analyzeFlowForTasks()` 不看单个 task，而是看**整个 board 上所有 task 的聚合数据**，
产出 `FlowDiagnosisReport`：

~~~plaintext
FlowDiagnosisReport
{
  bouncePatterns: [                ← 弹回模式：卡片被退回的规律
    { from: "review", to: "dev", count: 4,
      reason: "3/4 times due to missing test evidence" },
  ],

  laneMetrics: {                   ← 每列的统计指标
    "dev": {
      completionRate: 0.85,
      failureRate: 0.10,
      recoveryRate: 0.05,
      avgDuration: "42 min",
      medianDuration: "38 min",
    },
    "review": { ... },
  },

  failureHotspots: [               ← 失败热点
    { columnId: "review", failureCount: 7,
      topReasons: ["missing_artifacts", "incomplete_tests"] },
  ],

  handoffFriction: [               ← 交接摩擦
    { from: "dev", to: "review",
      blockedRate: 0.40,           ← 40% 的交接被阻塞
      avgResponseTime: "18 min" },
  ],

  flowGuidance: [                  ← 生成的建议
    { severity: "CRITICAL",
      summary: "Review 列失败率 60%",
      recommendation: "检查 review 列的 automation 配置" },
    { severity: "WARNING",
      summary: "Dev→Review 交接 40% 被阻塞",
      recommendation: "考虑在 dev 列增加 artifact 自动收集" },
  ],
}
~~~

**触发门槛：只有 board 上有 3+ 个 task 带 session 历史时才会运行。** 防止数据太少时产生噪音。

### 3c. 历史相似任务匹配（History Memory）

**代码：** `src/core/kanban/context-preload.ts`（~700 行）

扫描同一工作区的所有 task，用**多维度加权评分**找出最相似的历史任务：

~~~plaintext
评分规则：
  feature 重叠:       30 分/个
  文件路径重叠:        18 分/个
  路由重叠:            14 分/个
  API 重叠:            14 分/个
  模块/症状 hint 重叠:  10 分/个
  查询文本重叠:          2 分/个
  时间近因加分:          3 分

取 top 3 → 格式化为 "## Relevant History Memory"
~~~

### 3d. 策略记忆检索（Strategy Memory）

**代码：** `src/core/harness/reasoning-memory.ts`

从 `.routa/reasoning-memory/memories.json` 文件里检索，评分：

~~~plaintext
评分规则：
  feature ID 匹配:      40 分/个
  文件路径精确匹配:      50 分/个
  文件名匹配（不含路径）: 15 分/个
  标签匹配:              12 分/个
  task ID 匹配:          20 分/个
  置信度乘数:            confidence × 8
  证据数量加分

取 top 3 → 格式化为 "## Relevant Strategy Memory"
~~~

## 4. 注入链路：经验怎么进入 Agent 的 prompt

在 `startKanbanTaskSession()`（`workflow-orchestrator-singleton.ts`）里，
所有记忆在 Agent 启动前**一次性注入**：

~~~plaintext
startKanbanTaskSession(taskId)
   │
   ▼
① 收集 board 上所有 task 的历史
   allBoardTasks = taskStore.listByWorkspace(workspaceId)
   │
   ▼
② 流量诊断（3+ 个有历史的 task 才跑）
   flowReport = analyzeFlowForTasks(tasksWithFlow)
   │
   ▼
③ 泳道经验合成
   refreshTaskLaneExperienceMemory(task, { flowReport })
   → task.jitContextSnapshot.perLaneAnalysis 被填充
   │
   ▼
④ 证据摘要 + Story 就绪度 + INVEST 验证
   summaryContext = {
     evidenceSummary,
     storyReadiness,
     investValidation,
   }
   │
   ▼
⑤ 触发 Agent，把所有上下文传给 buildTaskPrompt()
   triggerAssignedTaskAgent({
     task: enrichedTask,     ← 带着 jitContextSnapshot
     summaryContext,
     flowReport,
   })
   │
   ▼
⑥ buildTaskPrompt() 里拼出四段记忆 prompt：

   buildSavedHistoryMemoryPromptSection(task)
   → "## Relevant History Memory"
      匹配的历史 task + 文件列表 + 先前 session 摘要

   buildTaskStrategyMemoryPromptSection(task)
   → "## Relevant Strategy Memory"
      匹配的策略记忆 + 教训 + 结果追踪

   buildLaneExperiencePromptSection(task)
   → "## Lane Experience Memory"
      当前列的模式/问题/建议 + 最多 3 个历史列

   formatFlowGuidanceForPrompt(flowReport)
   → "## Flow Guidance (Board-Level Learned Patterns)"
      CRITICAL/WARNING 级别的流量建议（最多 5 条）
   │
   ▼
⑦ Agent 收到完整 prompt，带着"前人智慧"开工
~~~

## 5. Agent prompt 里的记忆长什么样

Agent 实际收到的 prompt 里，四段记忆大概长这样：

~~~plaintext
## Relevant History Memory

**Task "修复登录 API 超时"（相似度: 高）**
匹配原因: 共享文件 src/api/auth.ts, src/middleware/session.ts
先前方案: 增加了连接池大小 + 添加了超时重试逻辑
结果: 成功，耗时 35 分钟

---

## Relevant Strategy Memory

**教训: "API 超时问题优先检查连接池"**
来源: 2026-07-20 的 harness 推理
置信度: high
结果追踪: 3 次应用，2 次有效

---

## Lane Experience Memory

### Current: Dev
Dev 列跑了 5 次，3 次成功，1 次恢复，1 次失败
- **Patterns**: 大任务拆分后成功率更高；Claude Opus 在这个列表现最好
- **Top Issues**: agent_failed (2 次), watchdog_inactivity (1 次)
- **Actions**: 考虑在大任务前先跑 feature tree 确认

### Previous: Backlog
Backlog 列 2 次成功
- **Patterns**: 有 canonical YAML 的任务流转更顺

---

## Flow Guidance (Board-Level Learned Patterns)

分析窗口: 7月15日–7月23日 | 12 tasks, 34 sessions

- **[CRITICAL]** Review 列失败率 60%
  → 检查 review 列的 artifact 门禁配置
- **[WARNING]** Dev→Review 交接 40% 被阻塞
  → 在 dev 列完成时自动收集 test_results artifact
~~~

**Agent 看到这些信息后，会调整自己的行为：**
- 看到"API 超时问题优先检查连接池" → 先检查连接池
- 看到"大任务拆分后成功率更高" → 主动拆分子任务
- 看到"Review 列失败率 60%" → 更认真准备 artifact

## 6. 闭环：学习循环怎么转起来

~~~plaintext
Task A 进入 Dev 列
   │
   ▼
Agent 带着空白经验开工（第一次没有历史）
   │  干完了，成功
   ▼
upsertTaskLaneSession() 记录：
   { sessionId: "s1", status: "completed", duration: "40min" }

═══════════════════════════════════════════════

Task B 进入 Dev 列
   │
   ▼
Agent 带着 Task A 的经验开工：
   "## Lane Experience: Dev 列 1 次成功"
   │  干完了，但失败了（超时）
   ▼
upsertTaskLaneSession() 记录：
   { sessionId: "s2", status: "timed_out", recoveryReason: "watchdog_inactivity" }

═══════════════════════════════════════════════

Task C 进入 Dev 列
   │
   ▼
Agent 带着 Task A + Task B 的经验开工：
   "## Lane Experience:
    Dev 列 2 次，1 成功 1 超时
    - Patterns: 超时 1 次，原因 watchdog_inactivity
    - Actions: 考虑拆分大任务或调整超时阈值"
   │
   │  Agent 看到"超时 1 次"，主动把任务拆小
   │  干完了，成功
   ▼
upsertTaskLaneSession() 记录：
   { sessionId: "s3", status: "completed", duration: "25min" }

═══════════════════════════════════════════════

Task D 进入 Dev 列
   │
   ▼
Agent 带着 A+B+C 的经验：
   "## Lane Experience:
    Dev 列 3 次，2 成功 1 超时
    - Patterns: 拆分后成功率提高
    - Flow Guidance: [WARNING] Dev→Review 交接有摩擦"
   │
   │  越来越"聪明"——知道该拆分、知道交接要注意什么
   ▼
   ...循环继续
~~~

**这就是 Routa 的"越用越聪明"机制：不是 AI 模型在学习，是系统在积累经验并注入 prompt。**

## 7. 策略门控：不是所有时候都注入记忆

**代码：** `src/core/kanban/board-history-memory-policy.ts`

~~~plaintext
KanbanHistoryMemoryPolicy {
  mode:               "off" | "auto" | "force",
  minMatchedSessions: 2,        ← 至少匹配 2 个历史 session
  minMatchedFiles:    3,        ← 至少匹配 3 个文件
  minFeatureCandidates: 1,      ← 至少匹配 1 个 feature
  minConfidence:      "medium", ← 最低置信度
}
~~~

- **off**：不注入历史记忆（新 board / 实验性 board）
- **auto**：满足阈值才注入（默认，防噪音）
- **force**：强制注入（信任历史数据的成熟 board）

**为什么需要门控？** 如果一个 board 只跑过 1 个 task，
"历史经验"其实是噪音而非信号。门控确保只有**足够多的数据支撑时**才注入记忆。

## 8. 源码导航表

| 模块 | 文件 | 职责 |
|---|---|---|
| 泳道历史记录 | `src/core/kanban/task-lane-history.ts` | 记录每次 session 的详细档案 |
| 泳道经验合成 | `src/core/kanban/task-lane-experience.ts` | 从原始记录合成 LaneAnalysis |
| 流量诊断 | `src/core/kanban/flow-ledger.ts` | Board 级弹回/瓶颈/热点/摩擦分析 |
| 流量类型 | `src/core/kanban/flow-ledger-types.ts` | FlowDiagnosisReport 类型定义 |
| 历史任务匹配 | `src/core/kanban/context-preload.ts` | 多维度加权评分找相似历史任务 |
| 策略记忆 | `src/core/harness/reasoning-memory.ts` | Harness 推理记忆检索 |
| 记忆注入入口 | `src/core/kanban/workflow-orchestrator-singleton.ts` | `startKanbanTaskSession()` 里的注入链 |
| Prompt 拼装 | `src/core/kanban/agent-trigger.ts` | 四段记忆 prompt 的格式化 |
| 门控策略 | `src/core/kanban/board-history-memory-policy.ts` | 控制何时注入历史记忆 |

## 9. 三个设计洞察

### 洞察 1：不是 AI 在"学习"，是系统在积累

Routa 的"越用越聪明"不依赖模型微调或 fine-tuning。
每次 Agent 的执行结果被记录到 `laneSessions[]`，
下次启动时把这些记录合成成 prompt 文本注入——
**Agent 的"记忆"完全在 prompt 工程层面实现，与模型无关。**

换一个模型（Claude → OpenCode），经验照样有效。

### 洞察 2：四种记忆覆盖四种认知维度

~~~plaintext
泳道经验   → "这条生产线的历史表现如何"   → 局部模式
流量指导   → "整个工厂的瓶颈在哪"        → 全局模式
历史相似   → "以前有没有人做过类似的事"    → 类比经验
策略记忆   → "我们学到了什么教训"          → 抽象策略
~~~

从局部到全局、从具体到抽象，四层覆盖让 Agent 不是"只看自己的活"，
而是带着整个 board 和工作区的集体智慧工作。

### 洞察 3：门控防止"垃圾进垃圾出"

不是记忆越多越好。流量分析有 3-task 门槛，历史匹配有多维度评分阈值，
board 级别还有 `KanbanHistoryMemoryPolicy` 策略开关。
**这些门控确保只有"信号"而非"噪音"进入 Agent 的 prompt。**

## 延伸阅读

- [Kanban 自动化深潜](02-kanban-automation-deep-dive.zh-CN.md) — 记忆注入所在的编排流程
- [Agent 触发与 ACP 桥梁](03-agent-trigger-and-acp-bridge.zh-CN.md) — `buildTaskPrompt()` 怎么拼装记忆
- [系统骨架导览](01-routa-architecture-tour.zh-CN.md) — 全景地图

## 30 秒记忆版

> Routa 的"学习"机制 = **闭环 prompt 工程**：
>
> 每次 Agent 干活 → 记录到 `laneSessions[]` →
> 下一个 Agent 启动前合成成四段记忆（泳道经验 / 流量指导 / 历史相似 / 策略记忆）→
> 注入 prompt → Agent 带着前人智慧干活 → 干完又留下记录 → 循环。
>
> 不依赖模型微调。换模型，经验照样有效。
> 有门控策略防止噪音。越用越聪明，但不会"乱聪明"。
