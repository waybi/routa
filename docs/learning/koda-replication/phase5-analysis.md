# Routa Phase 5 设计拆解：Kanban + Orchestrator + MCP

> **本文定位**：教学设计 / 协调边界解剖笔记，不是 Kanban 或 MCP API 手册。目标是解释一张卡片怎样从“数据记录”变成主动自动化入口、委派怎样变成真实子 agent session，以及 MCP 为什么既是能力接口，也是不能绕过领域政策的系统边界。
>
> 阅读顺序沿用 Phase 0–4：**业务痛点 → 如果不管会怎样腐烂 → 当前设计怎么堵 → Before / After → 权衡与边界**。
>
> 全文代码分四类标记：**真实代码摘录**（可按 `file:line` 回查）、**基于真实代码的简化**（省略无关字段）、**假设反例**（说明没有该设计时会怎样，非 Routa 历史代码）、**目标建议**（用于说明更强契约，未必已在当前代码落地）。
>
> 本文事实基线是 Git 快照 `34eb1ed58d48fd121c87c5915a8ff09035f1b3a4`。高风险结论均经过独立复核；格式不合格或存在反例的候选不会被包装成现状事实。

## 目录

- [「你在这里」锚点](#anchor-here)
- [总体业务场景](#anchor-scene)
  - [三条协调链](#anchor-three-flows)
  - [完整对象依赖图](#anchor-object-map)
  - [设计动机与设计哲学](#anchor-philosophy)
- [问题 1：Kanban 为什么不只是 Task 的 UI 投影](#anchor-q1)
- [问题 2：一次列迁移究竟选择哪套 automation](#anchor-q2)
- [问题 3：为什么系统需要两种 Orchestrator](#anchor-q3)
- [问题 4：委派深度与重启恢复分别在防什么](#anchor-q4)
- [问题 5：MCP 为什么必须执行与 REST 相同的领域政策](#anchor-q5)
- [四个可迁移模式](#anchor-patterns)
- [尚未证实的边界](#anchor-gaps)
- [Phase 5 如何向 Phase 6 交棒](#anchor-next)
- [学习笔记](#anchor-notes)
- [一句话带走](#anchor-takeaway)

---

## 「你在这里」锚点 {#anchor-here}

```text
Routa 全局施工图：

  models/ ──→ store/ ──→ worker/ ──→ acp/ ──→ workflows/ ──→ kanban/mcp
     ↑           ↑          ↑          ↑           ↑              ↑
  Phase 0     Phase 1    Phase 2    Phase 3     Phase 4         Phase 5
  领域词汇    数据事实    运行策略    协议适配     任务图编译       协调入口
```

前五层已经提供：

- Phase 0：Task、Agent、BackgroundTask、EventBus 等领域词汇；
- Phase 1：Store port 与可查询事实；
- Phase 2：BackgroundTask 生命周期、调度与恢复；
- Phase 3：ACP provider 防腐层；
- Phase 4：WorkflowDefinition 到 BackgroundTask DAG 的编译。

Phase 5 要回答的是：

> 这些能力怎样进入真实协作现场？谁决定何时启动 agent、谁负责父子委派、agent 又通过什么安全接口修改系统？

BUILD_ORDER 把 Phase 5 标成 `Kanban + Orchestrator + MCP`（`docs/learning/koda-replication/BUILD_ORDER.md:273-337`）。这三个名字并不是三个同级 CRUD 模块：

| 模块 | 角色 |
|---|---|
| Kanban | 业务状态与自动化触发面 |
| Orchestrator | 长流程与父子 agent 协调者 |
| MCP | agent-facing capability boundary |

当前代码还存在两种职责不同的 Orchestrator：

```text
KanbanWorkflowOrchestrator
  关心 card、column、lane step、automation session

RoutaOrchestrator
  关心 parent agent、child agent、delegated task、ACP process
```

不要因为都叫 Orchestrator 就把它们合并成一个上帝对象。

Phase 4 的交棒是：

```text
Workflow 负责把高层步骤变成耐久任务图；
Phase 5 负责让真实协作入口安全地触发和操作这些运行能力。
```

---

## 总体业务场景：一张卡进入 Dev 后，系统发生了什么 {#anchor-scene}

用户或 agent 把一张卡从 Todo 移到 Dev。从 UI 看只是列变化，从系统看至少跨越三种语言：

```text
业务语言：
卡片进入 Dev

协调语言：
COLUMN_TRANSITION + column automation

执行语言：
创建 ACP session、发送 prompt、接收 lifecycle event
```

随后 lane agent 通过 MCP 更新卡片、提交证据或移动到下一列；若它需要把子任务交给另一个 specialist，又会进入父子 agent 委派链。

### 三条协调链 {#anchor-three-flows}

#### 链 1：列迁移驱动 lane automation

```text
move_card / REST transition
          ↓
Task.columnId 持久化
          ↓
COLUMN_TRANSITION
          ↓
resolveTransitionAutomation()
          ↓
KanbanWorkflowOrchestrator
          ↓
column automation session
```

#### 链 2：协调 agent 委派子 agent

```text
MCP delegate_task_to_agent
          ↓
RoutaOrchestrator.delegateTaskWithSpawn()
          ↓
depth check + specialist resolve
          ↓
Agent record + Task assignment
          ↓
ACP child process/session
          ↓
completion/report → parent wake-up
```

#### 链 3：agent 通过 MCP 改变业务事实

```text
Agent MCP call
    ├─ update_task
    ├─ update_card
    ├─ move_card
    ├─ provide_artifact
    └─ delegate_task_to_agent
          ↓
MCP schema / profile / tool handler
          ↓
Domain tool
          ↓
Store + EventBus + Orchestrator
```

三条链通过 `Task`、`AgentEvent`、sessionId 和 Store 会合，但变化原因不同：

- Kanban 变化来自业务流程；
- 委派变化来自协作拓扑；
- MCP 变化来自外部 agent 能力请求。

### 完整对象依赖图 {#anchor-object-map}

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                    Routa Phase 5 协调全景                                    │
└──────────────────────────────────────────────────────────────────────────────┘

【1. 业务状态入口】

 UI / REST PATCH / MCP move_card
              │
              ▼
      TaskStore + KanbanBoardStore
              │
              ├─ Task.columnId / status
              ├─ target column automation
              └─ transition gates
              │
              ▼
      emitColumnTransition(EventBus)
              │
              ▼

【2. Lane 自动化协调】

 resolveTransitionAutomation()
   ├─ source exit/both 优先
   └─ 否则 target entry/both
              │
              ▼
 KanbanWorkflowOrchestrator
   ├─ activeAutomations[cardId]
   ├─ lane automation steps
   ├─ session lifecycle
   ├─ completion / failure / recovery
   └─ optional auto-advance
              │
              ▼
 Kanban session creation callback
              │
              ▼
 ACP runtime / provider


【3. Agent-facing capability boundary】

 ACP agent
    │ MCP tools/list + tools/call
    ▼
 Routa MCP surface
    ├─ AgentTools
    ├─ KanbanTools
    ├─ NoteTools
    ├─ WorkspaceTools
    └─ delegation tool
              │
       ┌──────┴─────────┐
       ▼                ▼
 move_card       delegate_task_to_agent
       │                │
       ▼                ▼
 KanbanTools      RoutaOrchestrator
                        ├─ depth check
                        ├─ Agent/Task mutation
                        ├─ child ACP spawn
                        └─ parent wake-up


【4. 稳定事实与进程内协调状态】

 Store 中的事实                    Orchestrator 内存状态
 ─────────────                    ────────────────────
 Task / Agent / Board             childAgents Map
 session metadata                 agentSessionMap
 artifacts                        delegationGroups
 laneSessions                     completion dedupe Maps
```

这张图最重要的分界不是文件夹，而是：

```text
Store 保存“现在是什么”；
Orchestrator 保存“这次协调正在怎样推进”；
MCP 决定“外部 agent 被允许请求什么”；
Kanban policy 决定“请求是否符合业务条件”。
```

### 设计动机与设计哲学 {#anchor-philosophy}

Phase 5 面对四种失控风险：

| 风险 | 如果没有边界 |
|---|---|
| 列变化直接散落副作用 | 每个 route、UI、tool 各自启动 agent |
| 多种协调关系混成一张 Map | lane step 与 parent/child delegation 互相污染 |
| prompt 被当成权限系统 | agent 可忽略提示，绕过 gate |
| 进程内状态被误认为耐久事实 | 重启后 completion 和 after_all 无法解释 |

因此这一层用了四种不同控制手段：

```text
Event seam         → 解耦状态写入与自动化触发
Orchestrator       → 集中长期协调策略
MCP capability     → 约束 agent 可见和可调用能力
Server-side policy → 即使 agent 不配合也不能越过领域门禁
```

#### 五镜头验收

| 镜头 | 当前结构 | 想挡住什么 | 已确认边界 |
|---|---|---|---|
| **分** | Kanban 与 delegation 各自有 Orchestrator | 不同协调身份与生命周期混用 | 两者不能因同名而合并 |
| **稳** | Task、Board、Agent、session metadata 留在 Store | UI、MCP、provider 变化不抹掉业务事实 | 部分协调 Map 尚未恢复 |
| **向** | 状态变化通过 EventBus 驱动自动化 | route 不直接依赖 provider 实现 | 同一 transition 只解析一套 automation |
| **约** | MCP tool handler 仍须执行 column policy | prompt 或工具名不等于权限 | required-artifact gate 当前有 MCP 绕过 |
| **权** | 深度限制、active map、completion dedupe 控制递归和重复 | 多 agent 协调无限扩散 | depth 查询采用 permissive fallback |

---

## 问题 1：Kanban 为什么不只是 Task 的 UI 投影 {#anchor-q1}

> **本节验证的设计判断**：当列配置拥有 automation 时，`columnId` 不再只是显示字段。列迁移是领域事件，它可以启动 session、切换 specialist、进入恢复策略，并触发下一列自动化。

### 纯 UI 投影的假设

如果 Kanban 只是展示 Task 状态：

```typescript
// ❌ 假设反例
await taskStore.save({
  ...task,
  columnId: targetColumnId,
});
```

那么移动完成后没有任何运行含义。所有 agent 启动只能由调用方额外记住：

```text
UI 移卡后再 POST /start-agent
REST route 移卡后自己 new process
MCP move_card 后自己决定 provider
```

列状态和执行副作用会在每个入口重新拼装。

### 当前堵法：持久化状态后发领域事件

`emitColumnTransition()` 把列变化翻译成统一事件（`src/core/kanban/column-transition.ts:27-39`）：

```typescript
export function emitColumnTransition(
  eventBus: EventBus,
  data: ColumnTransitionData,
): void {
  eventBus.emit({
    type: AgentEventType.COLUMN_TRANSITION,
    agentId: "kanban-system",
    workspaceId: data.workspaceId,
    data,
    timestamp: new Date(),
  });
}
```

事件携带：

```text
cardId / cardTitle
boardId / workspaceId
fromColumnId / toColumnId
fromColumnName / toColumnName
```

消费者因此不需要重新猜“哪张卡从哪里移到哪里”。

以 MCP `move_card` 为例，正常顺序是（`src/core/tools/kanban-tools.ts:412-437`）：

```text
1. finalizeActiveTaskSession()
2. 更新 columnId / status / position
3. taskStore.save(task)
4. workspace changed broadcast
5. emitColumnTransition()
```

这体现了一个重要顺序：

> 先留下可查询事实，再通知自动化消费者。

如果事件先发，listener 读取 Store 时可能仍看到旧列。

### Event 不是 Automation 本身

`COLUMN_TRANSITION` 只说明发生了列变化，不说明一定要启动 agent。

```text
Event = 发生了什么
Policy = 这次变化是否应该触发 automation
Orchestrator = 触发后怎样推进
```

列是否启用 automation、是 entry 还是 exit 触发，仍由 Board configuration 决定。

### Before / After

```text
❌ 入口直接执行
UI move → start provider
REST move → start provider
MCP move → start provider
```

```text
✅ 状态事实与触发解耦
UI / REST / MCP
       ↓
TaskStore.save
       ↓
COLUMN_TRANSITION
       ↓
Kanban automation policy
       ↓
Orchestrator
```

### 这是什么模式

- **Domain Event**：列变化从对象赋值升级为业务事实；
- **Observer / Event Bus**：生产者不依赖具体自动化消费者；
- **Transactional Ordering（弱形态）**：先保存后发事件；
- **Active Record 的反面**：Task 本身不负责 spawn agent。

注意：当前 EventBus 是进程内机制，不等于数据库 outbox。保存成功后进程若在 emit 前崩溃，仍可能漏事件。这里隔离了代码职责，没有自动获得跨进程 exactly-once。

**一句话带走**：当列可以启动 agent 时，移卡就不是改 UI 字段，而是发布一条可能改变系统运行状态的领域事件。

---

## 问题 2：一次列迁移究竟选择哪套 automation {#anchor-q2}

> **本节验证的设计判断**：同一次 transition 必须有确定的 automation 选择顺序，否则 source exit 与 target entry 可能同时启动，导致一张卡在一次移动中产生两套竞争 session。

### 两边都可能声明 automation

从 A 列移动到 B 列：

```text
A 可以声明：离开我时运行 cleanup/review
B 可以声明：进入我时运行 implement/verify
```

模型允许：

```text
transitionType = entry | exit | both
```

如果系统简单地把两边都执行：

```typescript
// ❌ 假设反例
if (source.exitAutomation) trigger(source);
if (target.entryAutomation) trigger(target);
```

同一张卡会同时出现：

- 两个 session 都认为自己拥有当前 card；
- 两边都可能写 `triggerSessionId`；
- 两个 specialist 都可能调用 `move_card`；
- completion event 无法明确归属哪个 automation。

### 当前选择规则：source exit 优先

`resolveTransitionAutomation()`（`column-transition.ts:52-76`）返回单个结果：

```typescript
const sourceTransitionType =
  sourceColumn?.automation?.transitionType ?? "entry";

if (
  sourceColumn?.automation?.enabled
  && (sourceTransitionType === "exit" || sourceTransitionType === "both")
) {
  return { column: sourceColumn, automation: sourceColumn.automation };
}

const targetTransitionType =
  targetColumn?.automation?.transitionType ?? "entry";

if (
  targetColumn?.automation?.enabled
  && (targetTransitionType === "entry" || targetTransitionType === "both")
) {
  return { column: targetColumn, automation: targetColumn.automation };
}
```

真实优先级是：

```text
1. source exit / both
2. 否则 target entry / both
3. 否则不触发
```

未配置 `transitionType` 时默认是 `entry`。

因此若 source 满足 exit、target 同时满足 entry：

```text
只选择 source automation
```

不是：

```text
source + target 一起运行
```

### 为什么返回一个对象，而不是数组

返回类型本身就是约束：

```typescript
{ column: KanbanColumn; automation: KanbanColumnAutomation }
  | undefined
```

它迫使调用方处理“零或一套 automation”。

`KanbanWorkflowOrchestrator` 消费同一个 resolver（`workflow-orchestrator.ts:295-305`），所以选择策略不需要在 handler 和 orchestrator 里复制两遍。

### 权衡

source 优先是确定性政策，但不是唯一可能政策。其他系统也可以选择：

```text
先执行 exit，完成后再执行 entry
只允许 target entry
把 exit 和 entry 编译成串行 workflow
```

关键不是哪种永远正确，而是：

> 一次 transition 的多边 automation 冲突必须由一个可测试的政策裁决，不能交给事件到达时序。

### 已确认测试边界

仓库存在 source-exit 与 target-entry 同时配置的测试意图，但核心 orchestrator suite 当前被 `describe.skip` 跳过。因而源码语义已确认，回归保护强度却不足。

**一句话带走**：列迁移的第一项编排工作不是 spawn agent，而是确定这一次到底由哪一边拥有自动化解释权。

---

## 问题 3：为什么系统需要两种 Orchestrator {#anchor-q3}

> **本节验证的设计判断**：Orchestrator 应围绕一种稳定协调身份建模。Card/lane session 与 parent/child agent 是两套不同关系，合并只会制造一个同时理解 Kanban、ACP、delegation、recovery 和 UI 的上帝对象。

### KanbanWorkflowOrchestrator 的稳定身份是 card

它的活动记录以 card 为中心（`workflow-orchestrator.ts:143-164`）：

```typescript
interface ActiveAutomation {
  cardId: string;
  boardId: string;
  workspaceId: string;
  columnId: string;
  automation: KanbanColumnAutomation;
  currentStepIndex: number;
  sessionId?: string;
  status: "queued" | "running" | "completed" | "failed";
}
```

它回答：

```text
这张卡当前在哪一列？
这一列选中了什么 automation？
lane 的当前 step 是谁？
哪个 session 在代表这张卡工作？
成功后是否继续下一 step 或下一列？
```

### RoutaOrchestrator 的稳定身份是 parent/child agent

它的 child record 以 agent 为中心（`src/core/orchestration/orchestrator.ts:98-111`）：

```typescript
interface ChildAgentRecord {
  agentId: string;
  sessionId: string;
  parentAgentId: string;
  parentSessionId: string;
  taskId: string;
  role: AgentRole;
  provider: string;
  workspaceId: string;
}
```

它回答：

```text
谁委派了谁？
child 在做哪个 Task？
child 使用哪个 provider/session？
child 完成后唤醒哪个 parent session？
after_all 组何时全部完成？
```

### 同一 Task 不等于同一种协调关系

Kanban lane agent 和 delegated child 都可能关联 Task，但关系不同：

```text
Kanban：
Task/Card ──进入 Column──→ lane specialist session

Delegation：
Parent Agent ──delegate Task──→ Child Agent/session
```

前者的父级是 lane/column policy；后者的父级是另一个 agent。

如果硬合并：

```typescript
// ❌ 假设反例
class UniversalOrchestrator {
  activeCards = new Map();
  childAgents = new Map();
  queueByBoard = new Map();
  delegationGroups = new Map();

  onAnyEvent(event) {
    // COLUMN_TRANSITION?
    // AGENT_COMPLETED?
    // REPORT_SUBMITTED?
    // parent wake-up?
    // auto-advance?
  }
}
```

一个 `AGENT_COMPLETED` 会同时面临：

- 它是 lane step completion 吗？
- 它是 delegated child completion 吗？
- 要启动下一 lane step，还是唤醒 parent？
- 要 auto-advance card，还是完成 after_all group？

### 两种 Orchestrator 通过事件和稳定事实协作

它们不需要互相 import 具体类才能共存：

```text
EventBus / session lifecycle
TaskStore / AgentStore
sessionId / taskId
```

是共同接缝。

这延续 Phase 0–4 的模式：

```text
共享领域词汇
+ 分离的运行策略
```

### 这是什么模式

- **Process Manager**：每个 Orchestrator 管理一个长期业务过程；
- **Aggregate Identity**：一个围绕 card，一个围绕 parent/child agent；
- **Bounded Context（轻量）**：相同 Task 在不同协调上下文中扮演不同角色；
- **Mediator**：集中事件与副作用顺序，但不吞并 Store 和 provider adapter。

### 何时可以合并

只有当两个协调器满足以下条件时才值得合并：

```text
□ 使用同一稳定身份；
□ 由同一事件开始和结束；
□ 拥有相同失败与恢复策略；
□ 状态可由同一事实集合重建；
□ 合并后不会引入跨领域条件分支。
```

当前 card/lane 与 parent/child 明显不满足。

**一句话带走**：Orchestrator 不是“所有自动化代码”的容器；它应围绕一种长期协调关系建立边界。

---

## 问题 4：委派深度与重启恢复分别在防什么 {#anchor-q4}

> **本节验证的设计判断**：深度限制防空间上的递归爆炸；状态恢复防时间上的上下文丢失。两者是不同可靠性维度，不能因为有一个就假设另一个也成立。

### 委派深度：防止 agent 无限生 agent

典型协作：

```text
Coordinator(depth 0)
  └─ Crafter(depth 1)
       └─ Verifier(depth 2)
```

如果没有深度约束：

```text
A delegate B
B delegate C
C delegate D
...
```

成本和协调节点数都可能失控。

TypeScript 当前常量是（`src/core/orchestration/delegation-depth.ts:21`）：

```typescript
export const MAX_DELEGATION_DEPTH = 2;
```

`checkDelegationDepth()` 只有在 parent depth `>= 2` 时拒绝；合法 child depth 是 parent + 1。

### 已确认边界：深度读取采用 permissive fallback

`getDelegationDepth()` 在以下情况返回 0（`delegation-depth.ts:44-64`）：

```text
AgentStore.get() 抛错
agent 不存在
metadata 不存在
delegationDepth 不存在
字符串无法 parse
```

随后：

```text
currentDepth = 0
allowed = true
childDepth = 1
```

这意味着系统把“无法证明 parent 深度”解释为“parent 是 root”。

#### 这种选择的收益

- 旧 agent 没有 metadata 时仍可委派；
- Store 短暂异常不会完全阻断协作；
- 从未采用 delegation depth 的历史数据可继续工作。

#### 这种选择的代价

- 深度 2 agent 的记录若暂时不可读，会被“洗浅”为 0；
- 不存在的 caller ID 也可能走 root fallback；
- 深度限制不是 fail-closed 安全边界；
- metadata 正确性成为递归控制的前提。

更强契约通常会区分：

```typescript
// 🎯 目标建议，不代表当前实现
type DepthReadResult =
  | { state: "known"; depth: number }
  | { state: "legacy"; depth: 0 }
  | { state: "unavailable"; error: string };
```

“历史没有字段”和“Store 查询失败”不应天然拥有相同语义。

### 重启恢复：防止长期协调状态丢失

`RoutaOrchestrator` 保存多组实例 Map（`orchestrator.ts:226-263`）：

```text
childAgents
agentSessionMap
delegationGroups
activeGroupByAgent
childCompletionSnapshots
childCompletionMemoryPromises
childCompletionPromises
```

它们分别承载：

- child agent 与 ACP session 的映射；
- `after_all` group 成员和已完成集合；
- completion snapshot 去重；
- 并发 completion finalizer 去重。

### 已确认边界：这些 Map 没有重建路径

singleton 初始化（`orchestrator-singleton.ts:27-59`）本质是：

```typescript
const orchestrator = new RoutaOrchestrator(
  system,
  processManager,
  config,
);
```

它没有：

```text
□ 扫描 AgentStore 恢复 child records
□ 扫描 TaskStore 恢复 delegated task
□ 从 session DB 重建 agentSessionMap
□ 从 memory 文件重建 after_all groups
□ 恢复 completionHandled / dedupe snapshots
```

Agent memory writer 确实记录 delegation、child session start 和 completion，但当前没有把这些记录读回 Orchestrator Map 的路径。

### 持久化 session metadata 为什么仍不够

ACP session DB 可以保存：

```text
routaAgentId
parentSessionId
role
provider
workspaceId
```

但 `after_all` 还需要：

```text
groupId
完整 childAgentIds
completedAgentIds
activeGroupByAgent
```

completion 去重还需要：

```text
completionHandled
last completion snapshot
in-flight finalization identity
```

所以“session 可 hydrate”不能自动推出“Orchestrator 可恢复”。

### 空间与时间两个维度

```text
Delegation depth
  控制同一时刻协作树能长多深

Orchestrator recovery
  控制进程重启后能否继续理解这棵树
```

两者缺一不可：

```text
有 depth、无 recovery
→ 不会无限递归，但重启后忘记 parent/child completion

有 recovery、无 depth
→ 能记住一棵不断膨胀的树
```

### 这是什么模式

- **Recursion Budget**：以 metadata 限制委派层数；
- **Identity Map**：进程内维护 agent/session 对应关系；
- **Idempotent Consumer**：completion Map 防止重复唤醒；
- **Checkpoint / Rehydration 缺口**：持久化记录尚未成为可恢复状态机。

**一句话带走**：深度限制让协调树别长疯；rehydration 让系统重启后还认得这棵树。

---

## 问题 5：MCP 为什么必须执行与 REST 相同的领域政策 {#anchor-q5}

> **本节验证的设计判断**：MCP 是 agent 进入系统的正式写入口，不是可信内部快捷方式。只要 MCP 可以修改 Task 或移动 Card，它就必须执行与其他入口同强度的领域约束。

### prompt 不是 enforcement

`buildTaskPrompt()` 会告诉 lane agent：

```text
先提供 artifact
满足 delivery gate
完成当前 lane step 后才能 move_card
```

但语言模型可能：

- 忘记；
- 误解；
- 使用旧 prompt；
- 直接调用 tool；
- 被另一个 MCP client 替代。

因此：

```text
Prompt guidance = 帮 agent 做对
Server policy   = 阻止 agent 做错
```

前者不能替代后者。

### MCP move_card 的正常领域链

`RoutaMcpToolManager` 注册 `move_card`，最终委派给：

```typescript
kanbanTools.moveCard({
  cardId,
  targetColumnId,
  position,
});
```

`KanbanTools.moveCard()` 不是简单 Store update。它会处理：

```text
当前 active lane 是否允许离开
required artifacts
required task fields
contract rules
delivery rules
checklist / human approval / validator gates
delivery snapshot
session finalization
column transition event
```

这正说明 MCP handler 应依赖领域工具，而不是在协议层直接改字段。

### 高风险已确认缺口：required-artifact gate 可被 MCP 绕过

`KanbanTools` 的 artifact store 是可选依赖（`src/core/tools/kanban-tools.ts:126-145`）：

```typescript
private artifactStore?: ArtifactStore;

setArtifactStore(artifactStore: ArtifactStore): void {
  this.artifactStore = artifactStore;
}
```

required-artifact gate 的条件是（`kanban-tools.ts:325-344`）：

```typescript
const requiredArtifacts = targetColumn.automation?.requiredArtifacts;

if (
  requiredArtifacts
  && requiredArtifacts.length > 0
  && this.artifactStore
) {
  // 查询并阻断缺失 artifact
}
```

当目标列要求 artifact、但 `artifactStore` 未注入时：

```text
条件为 false
→ 不查询 artifact
→ 不返回 missing-artifact error
→ 继续后续 transition 逻辑
```

这是 fail-open，不是 fail-closed。

### 生产 MCP wiring 恰好没有注入 artifactStore

标准 MCP server 创建 `KanbanTools` 时（`src/core/mcp/routa-mcp-server.ts:82-87`）：

```typescript
const kanbanTools = new KanbanTools(
  routaSystem.kanbanBoardStore,
  routaSystem.taskStore,
);
kanbanTools.setEventBus(routaSystem.eventBus);
kanbanTools.setAutomationSystem(routaSystem);
toolManager.setKanbanTools(kanbanTools);
```

缺少：

```typescript
kanbanTools.setArtifactStore(routaSystem.artifactStore);
```

`/api/mcp/tools` 的 direct execution 路径也重新创建一份 `KanbanTools`，同样只注入 EventBus 与 automation system（`src/app/api/mcp/tools/route.ts:103-107`）。

`RoutaSystem` 虽然拥有 `artifactStore`，并把它注入了 `AgentTools`，但 `AgentTools` 与后来单独 new 的 `KanbanTools` 不是同一个对象。依赖不会自动传播。

### 行为结果

在 MCP `move_card` 中：

```text
targetColumn.requiredArtifacts 非空
KanbanTools.artifactStore = undefined
             ↓
artifact gate 被跳过
             ↓
若其他 gates 通过
             ↓
taskStore.save(task)
             ↓
emitColumnTransition()
```

三种独立核查镜头——composition、behavior、test/adversarial——均确认了这条调用链。

### REST 对照

REST Task PATCH 路径直接使用 `system.artifactStore` 查询 required artifacts，并在缺失时返回 400（`src/app/api/tasks/[taskId]/route.ts:383-425`）。

标准 `RoutaSystem` 构造会提供 artifact store，所以正常 REST path 可以执行该门禁。

这形成入口漂移：

```text
REST transition
  → artifactStore 可用
  → 缺 artifact 被挡住

MCP move_card
  → 独立 KanbanTools 未注入 artifactStore
  → artifact gate 被跳过
```

ADR 0007 指出的风险正是这一类：lane specialist 通常直接调用 MCP；若政策只在 REST 生效，自动化 agent 就拥有旁路。

### 为什么“有其他 gate”不能证明 artifact gate 安全

其他 gate 可能恰好阻止某张卡移动，但它们回答不同问题：

```text
contract gate  → story contract 是否有效
 delivery gate → Git/worktree/PR 是否 ready
approval gate  → 是否有人类批准
artifact gate  → 指定证据对象是否存在
```

不能因为 contract gate 可能失败，就说 artifact gate 已被执行。

安全契约必须逐条成立：

```text
requiredArtifacts 配置非空
→ Store 必须可用
→ 缺失必须拒绝
```

### 更可靠的依赖形状

```typescript
// 🎯 目标建议，不代表当前实现
class KanbanTools {
  constructor(
    private kanbanBoardStore: KanbanBoardStore,
    private taskStore: TaskStore,
    private artifactStore: ArtifactStore,
  ) {}
}
```

若 `move_card` 永远需要 artifact policy，依赖就不应是可选 setter。

另一种做法是把所有 transition policy 收敛到一个领域服务：

```typescript
// 🎯 目标建议
transitionService.moveCard({
  actor,
  cardId,
  targetColumnId,
});
```

REST、MCP、UI、automation 都调用同一服务，避免每个 adapter 自己组装一份不完整的依赖图。

### 这是什么模式

- **Policy Enforcement Point**：所有写入口必须经过同一领域判断；
- **Fail Closed**：缺少执行 policy 所需的依赖时拒绝，而不是放行；
- **Capability Security**：agent 获得 tool，不等于获得绕过业务约束的权力；
- **Composition Root Completeness**：对象能构造不等于依赖已完整装配。

**一句话带走**：MCP 是另一扇正门，不是后门；REST 会挡住的违规迁移，agent tool 也必须挡住。

---

## 四个可迁移模式 {#anchor-patterns}

### 模式 1：状态变化先成为领域事件，再驱动副作用

#### 是什么

```text
持久化新状态 → 发布 transition event → policy 选择 → Orchestrator
```

#### 适用信号

```text
□ UI、REST、agent tool 都能触发同一状态变化；
□ 状态变化可能启动外部副作用；
□ 新消费者会持续增加；
□ 生产者不应认识 provider/runtime。
```

#### 配方

```text
1. 定义完整 event payload；
2. 先保存可查询事实；
3. 再发 event；
4. 由一个 policy resolver 解释 event；
5. consumer 做幂等或去重；
6. 若需跨进程可靠性，引入 outbox/replay。
```

#### 别过度

只有一个调用方、状态变化无副作用时，直接函数调用可能更清楚。

---

### 模式 2：一个 Orchestrator 围绕一种协调身份

#### 是什么

```text
Card Orchestrator 以 cardId 为中心
Delegation Orchestrator 以 parent/child agent 为中心
```

#### 检查清单

```text
□ 它的稳定 identity 是什么？
□ 开始和终止事件是什么？
□ 哪些状态必须持久化？
□ 哪些 Map 只是运行时缓存？
□ recovery 从哪里重建？
```

#### 别过度

两个流程若拥有相同 identity、状态机和恢复策略，强拆会增加无意义转发。

---

### 模式 3：Prompt 做引导，Policy 做执法

#### 是什么

```text
Prompt: “请先提交测试证据”
Policy: 没有 test_results artifact 就拒绝 move_card
```

#### 配方

```text
1. prompt 展示规则与修复路径；
2. tool handler 不信任 prompt 已被遵守；
3. 服务端基于 Store 事实重新评估；
4. 缺少 policy dependency 时 fail closed；
5. 所有写入口跑同一 contract test。
```

#### 别过度

纯建议、不会改变共享状态的事项无需全部升级为硬 gate。

---

### 模式 4：把进程内协调状态显式分成可恢复与不可恢复

#### 是什么

不是所有 Map 都必须持久化，但必须知道丢失后会怎样。

```text
可重建缓存
  → 重启后从 Store/session records 重算

不可重建 checkpoint
  → 必须持久化或接受协调中断
```

#### 配方

```text
1. 列出全部 runtime Map；
2. 为每项指定权威事实源；
3. 设计 hydrate/reconcile；
4. completion handler 对未知旧 session 明确处理；
5. 用重启测试验证 parent wake-up 与 after_all。
```

#### 别过度

短命、无副作用、丢失后可以安全重试的 UI cache 不必变成数据库表。

---

## 尚未证实的边界 {#anchor-gaps}

本轮有多条候选因为 Verifier 返回未知枚举、复合主张包含反例，或重试预算耗尽，不能当成已确认事实。它们保留为后续调查问题：

### 1. KanbanSessionQueue 的完整公平性

已观察到源码存在 board 级 running 计数、队列数组、stale reconciliation 和 lifecycle drain，但独立 verdict 没有通过结构门禁。

仍需单独验证：

```text
□ 动态提高 concurrency limit 后是否立即 drain；
□ 已有 queued backlog 时，新 enqueue 会不会插队；
□ card 跨 board 后重新 enqueue 怎样清理旧索引；
□ 多实例是否共享容量事实；
□ 四种 lifecycle event 是否都有执行测试。
```

### 2. Lane steps 与 fallback chain 的组合语义

复合候选被反例推翻：普通 lane steps 与 fallback steps 可能被拼成同一数组，不能直接声称“失败只会进入 fallback、成功永远不会进入 fallback”。

后续应分别验证：

```text
laneSteps=[A,B], fallback=[F]
A 失败时启动谁？
A/B 都成功后 F 是否仍会运行？
```

### 3. MCP 两套 tool catalog 是否漂移

Finder 报告 `RoutaMcpToolManager` 与 `mcp-tool-executor` 的 essential 列表可能不一致，但两次 Verifier 都返回非规范 verdict，按门禁保持不确定。

应以可执行 parity test 比较：

```text
Streamable MCP tools/list
vs
GET /api/mcp/tools?mode=essential
```

### 4. `/api/mcp/tools` direct POST 的 mode 边界

候选指出 direct POST 可能使用 full definitions 校验工具名，而不把 essential mode 传给 executor；但 verdict schema 不合格，未计入事实。

需要 HTTP 测试明确：

```text
mode=essential
+ 调用一个 full-only tool
→ 应拒绝还是允许？
```

### 5. 交付政策是否覆盖所有写路径

MCP `move_card` 与 REST Task PATCH 的共享 delivery evaluator 是窄范围事实候选，但独立 verdict 未通过格式门禁。Finder 还发现 status route、verdict convergence、auto-advance 等旁路候选。

因此不能把“所有 transition 都统一执法”写成已完成事实。需要按入口建立矩阵：

| 入口 | artifact | story | contract | delivery | generic gate | event |
|---|---|---|---|---|---|---|
| REST PATCH | 待契约测试 | 待契约测试 | 待契约测试 | 待契约测试 | 待契约测试 | 待契约测试 |
| status route | 待核验 | 待核验 | 待核验 | 待核验 | 待核验 | 待核验 |
| MCP move_card | 已确认 artifact 缺口 | 待核验 | 待核验 | 待核验 | 待核验 | 待核验 |
| verdict convergence | 待核验 | 待核验 | 待核验 | 待核验 | 待核验 | 待核验 |
| auto-advance | 待核验 | 待核验 | 待核验 | 待核验 | 待核验 | 待核验 |

`inconclusive` 不等于“没有问题”，也不等于“已证实有问题”。它只表示本轮证据流程没有产生可采纳结论。

---

## Phase 5 如何向 Phase 6 交棒 {#anchor-next}

Phase 6 是 API 路由壳。它应把 Phase 5 的能力暴露为薄 transport，而不是在 route 中再写一套协调策略。

```text
Phase 6 route
    │ parse / validate request
    ▼
Phase 5 domain capability
    ├─ move card under transition policy
    ├─ emit column event
    ├─ delegate task through orchestrator
    └─ expose tools through MCP boundary
```

### API 层应做什么

```text
□ 解析 HTTP/MCP transport；
□ 校验 workspace、ID、输入 schema；
□ 选择已经组装好的 domain capability；
□ 映射领域错误到响应；
□ 保留 session/workspace scope。
```

### API 层不应做什么

```text
❌ 自己解析 source exit / target entry 优先级
❌ 自己 new provider adapter
❌ 自己维护 childAgents Map
❌ 自己复制 artifact/delivery/contract gate
❌ 只靠 prompt 约束 agent 写行为
❌ 把缺失依赖解释为自动放行
```

### Phase 5 骨架最小垂直切片

BUILD_ORDER 列出大量 Kanban、Orchestrator 与 MCP 文件。骨架不应机械复制全部复杂度；最小可教、可验证切片是：

```text
Task/Board Store
      ↓
moveCard()
      ↓
server-side transition policy
      ↓
TaskStore.save()
      ↓
COLUMN_TRANSITION
      ↓
resolveTransitionAutomation()
      ↓
KanbanWorkflowOrchestrator callback
```

再加一条独立委派切片：

```text
MCP delegate_task_to_agent
      ↓
depth check
      ↓
Task + Agent mutation
      ↓
ACP child session
      ↓
completion → parent notification
```

### 骨架验收建议

```text
□ source exit 与 target entry 同时满足时只选择 source；
□ 缺省 transitionType 按 entry；
□ 卡片保存后才发 COLUMN_TRANSITION；
□ 相同 transition 不产生重复 active automation；
□ MCP 与 REST 对同一 transition policy 运行同一 contract test；
□ requiredArtifacts 非空且 ArtifactStore 缺失时 fail closed；
□ delegation depth 2 被拒绝；
□ AgentStore 查询失败不会把深度静默洗成 0；
□ Orchestrator 重建后可恢复或明确终止旧 child coordination；
□ completion 重复事件只唤醒 parent 一次。
```

其中 fail-closed artifact gate、深度读取错误语义和 rehydration 是从当前实现边界提炼出的增强验收，不是 BUILD_ORDER 原文已有保证。

---

## 学习笔记 {#anchor-notes}

### 1. Kanban 的本质取决于列迁移有没有副作用

```text
无副作用 → UI 投影
有 automation → 主动业务流程入口
```

不要只看组件长什么样，要看 `columnId` 改变后系统做了什么。

### 2. EventBus 解耦依赖，不自动提供可靠投递

```text
生产者不认识消费者 ≠ 事件不会丢
```

跨进程恢复需要 outbox、event log 或 reconciliation。

### 3. 同名类不代表同一边界

```text
KanbanWorkflowOrchestrator ≠ RoutaOrchestrator
```

先问稳定 identity，再问能不能合并。

### 4. Tool schema 不是完整授权

```text
能调用 move_card
≠
可以绕过 requiredArtifacts
```

Capability 决定“可以请求什么”，domain policy 决定“请求是否被允许”。

### 5. 可选依赖最危险的情况是静默降级

```typescript
if (policy && dependency) {
  enforce();
}
```

如果 dependency 缺失时继续运行，就可能把 composition bug 变成 policy bypass。

### 6. metadata budget 不是强安全边界

委派深度存于 metadata 且读取失败回退 0，适合兼容性，不适合作为 fail-closed 的资源或权限边界。

### 7. 先区分 durable fact 与 coordination memory

```text
TaskStore 中的 task.status
  = durable fact

Orchestrator.childCompletionPromises
  = process-local coordination memory
```

只有前者存在，不代表后者能在重启后自动恢复。

### 8. 五镜头自测

```text
分：Kanban、delegation、MCP 各自的变化原因是什么？
稳：哪些 identity 和事实跨进程仍存在？
向：route/tool 依赖领域能力，还是直接依赖 provider？
约：同一写行为在所有入口是否执行同一 policy？
权：并发、深度、重试和恢复的保证强度到底到哪里？
```

---

## 一句话带走 {#anchor-takeaway}

> **Phase 5 的核心不是把 Kanban、Orchestrator 和 MCP 堆在一起，而是建立三道清晰边界：列迁移用领域事件触发自动化，长期协调按稳定身份分给不同 Orchestrator，所有 agent 写操作则必须通过与 REST 同强度、依赖完整且 fail-closed 的 MCP 领域政策。**
