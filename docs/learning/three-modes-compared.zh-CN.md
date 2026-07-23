---
title: 三种编排模式：同一条血管，三个不同的心脏
prerequisite: agent-trigger-and-acp-bridge.zh-CN.md
---

# 三种编排模式：同一条血管，三个不同的心脏

> 接着 [Agent 触发与 ACP 桥梁](agent-trigger-and-acp-bridge.zh-CN.md) 深入。
> 前三篇从 Kanban 一条路打通了"卡片→编排器→队列→ACP→Provider→归一化"的完整链路。
> 本文把视角拉回全景，**对比三种模式怎么走不同的路但最终汇入同一条血管**。
>
> 本文是**学习笔记**，不是规范来源。事实以代码为准。

## 0. 一句话抓住本质

> 三种模式共享同一套基础设施（ACP / Provider Adapter / Specialist / MCP 工具），
> 差别只有一个：**谁来发起编排、编排图什么时候展开**。

~~~plaintext
Sessions：你打字 → ROUTA 起手 → 需要时才拉 CRAFTER/GATE（懒展开）
Kanban：  你拖卡 → 泳道自动触发 → 列配置决定谁干活（按位置触发）
Team：    你建队 → Lead 先规划 → 按波次批量派活（主动铺开）
~~~

但三条路最终都到同一个终点：**通过 ACP 协议启动一个真实的 AI CLI 进程**。

## 1. 全景对比图

~~~plaintext
                    ┌─────────────────────────────────┐
                    │        你（用户）                 │
                    └───┬───────────┬─────────────┬───┘
                        │           │             │
               ① Sessions    ② Kanban       ③ Team
               「打字聊天」   「拖卡片」      「建队伍」
                        │           │             │
                        ▼           ▼             ▼
              ┌─────────────┐ ┌──────────┐ ┌──────────────┐
              │ HomeInput   │ │ 看板 UI   │ │ Team Page    │
              │ 输入框发话   │ │ 拖拽卡片  │ │ 选 Lead 建队 │
              └──────┬──────┘ └────┬─────┘ └──────┬───────┘
                     │             │              │
                     ▼             ▼              ▼
              ┌─────────────┐ ┌──────────────┐ ┌─────────────────┐
              │ 创建 ROUTA  │ │ COLUMN_      │ │ 创建 team-      │
              │ 会话        │ │ TRANSITION   │ │ agent-lead 会话 │
              │ (单个 ACP)  │ │ 事件         │ │ (单个 ACP)      │
              └──────┬──────┘ └──────┬───────┘ └────────┬────────┘
                     │               │                  │
                     │               ▼                  │
                     │        ┌──────────────┐          │
                     │        │ Kanban       │          │
                     │        │ Workflow     │          │
                     │        │ Orchestrator │          │
                     │        │ + Session    │          │
                     │        │ Queue        │          │
                     │        └──────┬───────┘          │
                     │               │                  │
                     ▼               ▼                  ▼
              ┌──────────────────────────────────────────────┐
              │         RoutaOrchestrator                     │
              │  (Sessions 和 Team 共用的编排器)               │
              │                                              │
              │  delegateTaskWithSpawn()                      │
              │  → 按需创建 CRAFTER / GATE 子会话              │
              │  → 管理 parent-child 生命周期                  │
              │  → 完成后 wakeParent() 汇报结果                │
              └──────────────────┬───────────────────────────┘
                                 │
                                 ▼
              ┌──────────────────────────────────────────────┐
              │         ACP + Provider Adapter                │
              │  (三条路的共同终点)                             │
              │                                              │
              │  session/new → session/prompt                 │
              │  → 启动真实 AI CLI 进程                        │
              │  → Provider Adapter 归一化输出                 │
              │  → SSE 推给前端                                │
              └──────────────────────────────────────────────┘
~~~

**关键发现：Sessions 和 Team 用的是同一个 `RoutaOrchestrator`，Kanban 用的是独立的 `KanbanWorkflowOrchestrator`。但三者最终都走 ACP。**

## 2. Sessions 模式：懒展开——用到才拉人

### 触发方式

~~~plaintext
你在输入框打字 → handleSend()
   │
   ▼
BrowserAcpClient.createSession()
   │
   ▼
POST /api/acp  method: "session/new"
   │  params: { role: "ROUTA", provider: "claude", ... }
   │
   ▼
handleSessionNew()（acp-session-create.ts）
   │
   ├─ 幂等检查（30 秒 TTL，防重复提交）
   ├─ 启动 ACP 进程（只有 ROUTA 一个）
   └─ 初始化 RoutaOrchestrator 单例
~~~

### 懒展开：CRAFTER/GATE 什么时候出现？

~~~plaintext
一开始只有 ROUTA 一个 Agent 在跑
   │
   │  用户可能只是问个问题、探索一下
   │  → 不需要 CRAFTER/GATE，省 token
   │
   │  直到 ROUTA 判断"这个活需要人帮忙"
   │
   ▼
ROUTA 调用 MCP 工具：delegate_task_to_agent
   │  params: { specialist: "CRAFTER", task: "实现登录功能" }
   │
   ▼
RoutaOrchestrator.delegateTaskWithSpawn()
   │
   ├─ 检查委派深度（最多 2 层，防无限递归）
   ├─ 解析 specialist 配置（加载 Markdown 人设）
   ├─ 创建子 agent 记录（带 parentId、delegationDepth）
   ├─ spawnChildAgent()：启动一个新的 ACP 进程
   │     → 传入 specialist 的系统 prompt + 任务 prompt
   └─ 注册完成回调
          │
          ▼
     CRAFTER 开始在独立的 ACP 进程里写代码
          │
          │  干完后调 report_to_parent
          │
          ▼
     orchestrator.wakeParent()
          │  把结果汇报给 ROUTA
          │
          ▼
     ROUTA 收到结果，决定下一步
     → 可能再派 GATE 去验收
     → 也可能直接告诉用户"搞定了"
~~~

### Sessions 模式的本质

~~~plaintext
Session 模式 = ROUTA 独奏 + 按需拉人

时间线：
t0  ──── ROUTA 启动 ────────────────────────────────────────
t1  ──── 用户聊天，ROUTA 独自回答 ─────────────────────────
t2  ──── ROUTA 判断需要帮手 → 拉 CRAFTER ──── CRAFTER 干活 ──
t3  ──── CRAFTER 报完 → ROUTA 继续 ─────────────────────────
t4  ──── ROUTA 判断需要验收 → 拉 GATE ──────── GATE 验收 ────
t5  ──── GATE 报完 → ROUTA 告诉用户结果 ────────────────────

特点：
· 编排图是"按需长出来的"，不是预先画好的
· 可能从头到尾只有 ROUTA 一个人（如果只是聊天/探索）
· 最省 token：不用的 agent 不会被创建
~~~

## 3. Team 模式：主动铺开——Lead 先规划再批量派活

### 触发方式

~~~plaintext
你在 Team 页面点"新建" → 选择 team-agent-lead
   │
   ▼
创建一个锁定 specialist="team-agent-lead" 的会话
   │  dispatchMode: "pending-prompt"（等你给第一个指令）
   │
   ▼
POST /api/acp  method: "session/new"
   │  params: { role: "ROUTA", specialistId: "team-agent-lead", ... }
   │
   ▼
handleSessionNew() → 启动 ACP 进程 + 初始化 RoutaOrchestrator
~~~

### 波次派活：Lead 怎么组织一群 Agent 干活

~~~plaintext
Lead 收到你的指令："构建一个带登录的仪表盘"
   │
   ▼
① Lead 先规划，创建 Spec（带 @@@task 块）
   Task A: "实现后端 API"
   Task B: "构建 React 组件"
   Task C: "添加样式"
   │
   ▼
② Lead 停下来等你确认 Spec（STOP for approval）
   │
   ▼  你确认后
   │
③ Lead 批量派活（Wave 1）：
   delegate_task(A, specialist="CRAFTER", waitMode="after_all")
   delegate_task(B, specialist="CRAFTER", waitMode="after_all")
   delegate_task(C, specialist="CRAFTER", waitMode="after_all")
   │
   │  三个调用创建了一个 DelegationGroup
   │
   ▼
④ Lead END YOUR TURN（强制结束自己的轮次）
   │
   │  三个 CRAFTER 在各自的 ACP 进程里并行干活
   │
   ▼
⑤ 全部完成后，orchestrator.wakeParent()
   │  汇报聚合结果：
   │  "## Delegation Group Complete
   │   - 实现后端 API: COMPLETED. Summary...
   │   - 构建 React 组件: COMPLETED. Summary...
   │   - 添加样式: COMPLETED. Summary..."
   │
   ▼
⑥ Lead 审查结果 → 派 GATE 验收（Wave 2）
   delegate_task(verify_all, specialist="GATE", waitMode="after_all")
   │
   ▼
⑦ GATE 报告 → Lead 汇总 → 告诉你最终结果
~~~

### Team 模式的独特机制

**DelegationGroup（委派组）：**

~~~plaintext
waitMode="after_all" 的工作方式：

Lead 调 delegate_task × 3
   │
   ▼
orchestrator 创建 DelegationGroup:
   { groupId, agentIds: [A, B, C], completed: [] }
   │
   ▼
Lead END TURN（被挂起等待）
   │
   │  A 完成 → completed: [A]      （还没全完，不唤醒 Lead）
   │  C 完成 → completed: [A, C]   （还没全完，不唤醒 Lead）
   │  B 完成 → completed: [A, C, B]（全完了！）
   │
   ▼
orchestrator.wakeParent() → 唤醒 Lead，带上聚合结果
~~~

**Team Roster（团队花名册）：**

~~~plaintext
每个专家有一组显示名，自动分配：
  team-researcher:    [Alex, Sam, Jack, Tina, Eric]
  team-frontend-dev:  [Lee, Taylor, Felix, Jay, Robin]
  team-backend-dev:   [Jimmy, Bill, Robin, James, Jason]
  team-qa:            [Chris, Terry, Leo, Ben, David]

好处：UI 上看到的不是"CRAFTER-1、CRAFTER-2"
      而是"Lee 在做前端、Jimmy 在做后端"——团队感
~~~

**会话层级：**

~~~plaintext
Sessions 模式：扁平的  Lead → [CRAFTER, GATE]
Team 模式：    树状的  Lead → [Wave1: A, B, C] → [Wave2: GATE]
                            每个成员有自己的"泳道"(SessionLane)

UI 可视化：
┌─ Lead (team-agent-lead) ──────────────────────────┐
│  规划 → 派活 → 等待 → 审查 → 再派 → 完成           │
├─ Lee (前端) ──────────────────────────────────────┤
│  收到任务 → 写代码 → report_to_parent              │
├─ Jimmy (后端) ────────────────────────────────────┤
│  收到任务 → 写代码 → report_to_parent              │
├─ Chris (QA) ──────────────────────────────────────┤
│  收到验收任务 → 验证 → report_to_parent            │
└───────────────────────────────────────────────────┘
~~~

## 4. 三模式深度对比表

| 维度 | Sessions | Kanban | Team |
|---|---|---|---|
| **触发方式** | 用户在输入框打字 | 卡片被拖到新列 | 用户建队给指令 |
| **编排器** | `RoutaOrchestrator` | `KanbanWorkflowOrchestrator` | `RoutaOrchestrator`（同 Sessions） |
| **初始 Agent** | 只有 ROUTA | 列配置的 specialist | 只有 team-agent-lead |
| **子 Agent 何时出现** | ROUTA 调 `delegate_task` 时 | 卡片进入配了 automation 的列时 | Lead 调 `delegate_task` 时 |
| **编排展开方式** | 懒展开（用到才拉） | 按位置触发（卡片位置决定） | 主动铺开（Lead 先规划） |
| **并发控制** | 委派深度限制（max 2 层） | per-board 并发队列 | DelegationGroup 批量等待 |
| **结果汇报** | `report_to_parent` → 唤醒 ROUTA | EventBus 事件 → Orchestrator | `report_to_parent` → 唤醒 Lead |
| **门禁/验收** | ROUTA 决定是否派 GATE | transition gates（三层门禁） | Lead 显式派 GATE |
| **自动推进** | 无（ROUTA 自己决定） | `autoAdvanceOnSuccess`（链式反应） | 无（Lead 按波次推进） |
| **会话结构** | 扁平（parent → children） | 扁平（每列一个独立 session） | 树状（Lead → 波次 → 成员） |
| **持续性** | 可恢复主会话 | 任务驻留看板直到 Done | 一次性团队任务 |
| **UI 入口** | `/workspace/{id}/sessions` | `/workspace/{id}/kanban` | `/workspace/{id}/team` |

## 5. 共享基础设施：三条路的公共地基

~~~plaintext
┌──────────────────────────────────────────────────────────────┐
│                    三条路共享的基础设施                        │
│                                                              │
│  ACP 协议层                                                   │
│    session/new + session/prompt                              │
│    → 不管哪种模式，最终都调这两步                              │
│                                                              │
│  Provider Registry + Provider Adapter                        │
│    → Claude Code / OpenCode / Kimi 的归一化                   │
│    → 三种模式看到的都是 NormalizedSessionUpdate               │
│                                                              │
│  Specialist 体系                                              │
│    → ROUTA / CRAFTER / GATE / DEVELOPER 的 Markdown 人设     │
│    → 三种模式共用同一套角色定义                               │
│                                                              │
│  MCP 工具集                                                   │
│    → delegate_task / report_to_parent / update_card / ...    │
│    → 按模式和角色配不同的工具子集                              │
│                                                              │
│  EventBus + SSE                                               │
│    → 实时事件广播 + 前端推送                                   │
│    → 三种模式共用同一套事件机制                               │
│                                                              │
│  Trace / 审计                                                 │
│    → 所有 session 的消息、工具调用、文件变更都被记录           │
│    → 三种模式共用同一套追踪基础设施                           │
└──────────────────────────────────────────────────────────────┘
~~~

## 6. 三个设计洞察

### 洞察 1：两个编排器，不是三个

Sessions 和 Team 共用 `RoutaOrchestrator`（`src/core/orchestration/orchestrator.ts`），
差别只是 system prompt 里的行为指令不同：

- Sessions 的 ROUTA：自由度高，可以自己干活也可以委派
- Team 的 Lead：**Hard Rule 6** 强制走"波次 + 验证"流程

Kanban 用独立的 `KanbanWorkflowOrchestrator`（`src/core/kanban/workflow-orchestrator.ts`），
因为它的触发机制完全不同——是事件驱动而非对话驱动。

### 洞察 2：懒展开 vs 主动铺开 不是"谁更好"，是场景匹配

~~~plaintext
Sessions（懒展开）适合：
  · 探索性工作——"帮我看看这段代码"
  · 单次任务——"修一个 bug"
  · 不确定需要多少人的场景

Team（主动铺开）适合：
  · 明确的多人协作——"做一个完整功能"
  · 需要并行提速——三个 CRAFTER 同时干
  · 需要显式可见的分工和回收

Kanban（按位置触发）适合：
  · 持续交付流程——backlog 到 done 的流水线
  · 需要质量门禁——每一步都有验收标准
  · 多任务并行管理——看板上 10 张卡同时推进
~~~

### 洞察 3：`delegate_task` + `report_to_parent` 是 Sessions/Team 的核心协议

这对 MCP 工具就是 Sessions/Team 模式的"血液循环"：

~~~plaintext
Parent（ROUTA/Lead）                     Child（CRAFTER/GATE）
       │                                        │
       │── delegate_task_to_agent ──────────────→│
       │   (启动子 Agent，传入任务)               │ 开始干活
       │                                        │
       │   END TURN（挂起等待）                   │ ...
       │                                        │
       │←── report_to_parent ───────────────────│
       │   (完成汇报：summary + verdict)         │ 结束
       │                                        │
       ▼ 继续下一步决策
~~~

Kanban 不用这套——它用 EventBus 事件
（`AGENT_COMPLETED` / `AGENT_FAILED`）做生命周期管理。

## 7. 源码导航表

| 模块 | 文件 | 职责 |
|---|---|---|
| Sessions 页面 | `src/app/workspace/[workspaceId]/sessions/sessions-page-client.tsx` | 会话列表 + 输入框 |
| Team 页面 | `src/app/workspace/[workspaceId]/team/team-page-client.tsx` | 团队列表 + 建队入口 |
| Team 运行视图 | `team/[sessionId]/team-run-page-client.tsx` | 委派树 + 泳道可视化 |
| 会话创建 | `src/app/api/acp/acp-session-create.ts` | `handleSessionNew()` 幂等创建 + Orchestrator 初始化 |
| RoutaOrchestrator | `src/core/orchestration/orchestrator.ts` | Sessions/Team 共用：委派、子进程、完成汇报 |
| KanbanWorkflowOrchestrator | `src/core/kanban/workflow-orchestrator.ts` | Kanban 专用：事件驱动 + 监督 + 自动推进 |
| Specialist Prompts | `src/core/orchestration/specialist-prompts.ts` | ROUTA/CRAFTER/GATE/DEVELOPER 的系统 prompt |
| 委派深度 | `src/core/orchestration/delegation-depth.ts` | max 2 层限制 |

## 延伸阅读

- [系统骨架导览](routa-architecture-tour.zh-CN.md) — 全景地图
- [Kanban 自动化深潜](kanban-automation-deep-dive.zh-CN.md) — Kanban 路径的完整细节
- [Agent 触发与 ACP 桥梁](agent-trigger-and-acp-bridge.zh-CN.md) — 三条路共用的 ACP 基础设施

## 30 秒记忆版

> 三种模式 = **三种不同的触发方式 + 同一套 ACP 基础设施**。
>
> Sessions：你打字 → ROUTA 独奏 → 按需拉人（`delegate_task`）→ 懒展开。
> Kanban：你拖卡 → 列配置触发 → 事件驱动编排 → 门禁验收 → 自动流水线。
> Team：你建队 → Lead 规划 → 批量波次（`waitMode="after_all"`）→ 聚合验证。
>
> Sessions 和 Team 共用 `RoutaOrchestrator`；Kanban 用 `KanbanWorkflowOrchestrator`。
> 三条路最终都走 ACP → Provider Adapter → 真实 AI CLI 进程。
