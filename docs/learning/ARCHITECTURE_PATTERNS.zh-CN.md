---
status: learning-notes
purpose: 从 Routa 代码库中提炼可迁移的架构模式与工程纪律，作为学习大纲 + 参考手册。
audience: 想从这个项目"偷武器"的中高级工程师
note: 这不是 Routa 的 canonical 文档，是学习笔记。重点是"模式可迁移性"，不是"记住具体实现"。
verified: 2026-06-24 用 4 个独立 agent 逐条核查过代码定位，39 条声明 38 条确认、0 条编造；已修正 2 处"少说"。
surveyed: 2026-06-24 又用 8 个独立 agent 地毯式扫了 notes/review/harness/trace/workflow/sandbox/Rust-core/前端/存储 九大未读领域，自下而上实证发现新模式（见 Part A 的 A8~A12 + Rust 附录）并记录架构债务（见 Part C）。结论：原 A1~A7 七个模式确实贯穿全项目（非看板专属），且有 5 个域级新模式之前漏掉了。
---

# Routa 架构模式与工程纪律

> 学习原则：**以"模式"为单位学，代码只是例证。** 每学一个，问自己"我下个项目怎么用"，而不是"这函数第 300 行干嘛"。

## 怎么用这份文档

每个模式/纪律都是一张**学习卡片**，固定四段：

1. **是什么** —— 一句话讲清概念（说人话）
2. **这项目怎么用** —— 真实代码定位 + 它解决的具体问题
3. **你以后怎么用** —— 可迁移的套路，脱离 Routa 也成立
4. **状态** —— `未学 / 学习中 / 已掌握`，我们逐个推进时更新

---

## 全局蓝图（先建立坐标系）

```
两个运行面（Web · Next.js / Desktop · Tauri+Rust）——同一套领域语义 (ADR-0001)
        │
   ┌────┴─────────────────────────────────────────┐
   界面层      页面 / 看板 / 会话详情 / 轨迹
   API 层      REST · SSE · /api/*
   协议适配    ACP · MCP · A2A · AG-UI（统一 agent 接口）   ← 防腐层
   领域服务    编排 · 看板自动化 · 工作流 · 笔记 · 审查 · 调度
   存储        workspace / task / session / note / codebase / worktree（接口化）
   持久化      Postgres / SQLite / 内存 / JSONL 轨迹
   └───────────────────────────────────────────────┘
依赖方向永远向下；EventBus 横向贯穿各层做解耦。
```

---

# Part A — 架构模式（七把武器）

## 模式 1：依赖倒置 + 接口化 Store

- **是什么**：上层依赖"接口"而非"具体实现"。Store 定义成接口，内存/Postgres/SQLite 是可替换的实现。
- **这项目怎么用**：
  - `src/core/routa-system.ts:38` `RoutaSystem` 接口把所有 store 声明为接口类型（`AgentStore`、`TaskStore`、`WorkspaceStore`…）。
  - `createInMemorySystem()`（`:70`）全用 `new InMemoryXxxStore()`；生产换成 `Pg*` / SQLite 实现，业务代码不动。
  - 三种存储模式由环境切换：`DATABASE_URL`→Postgres，`ROUTA_DB_DRIVER=sqlite`→SQLite，否则内存。
  - Rust 端对称：`crates/routa-core/src/state.rs` 的 `AppStateInner` 同样字段。
- **你以后怎么用**：任何"将来可能换实现"的东西（DB、缓存、外部 API、文件存储）都先定义接口。好处：测试全内存跑、部署可换后端、业务零改动。这是六边形架构的"端口"。
- **状态**：未学

## 模式 2：协议适配 / 防腐层（ACP & MCP）

- **是什么**：把"易变、不可控的外部依赖"挡在领域之外，用适配器翻译成内部统一模型。DDD 称之为 Anti-Corruption Layer（防腐层）。
- **这项目怎么用**：
  - **ACP（出方向：Routa 怎么驱动 agent）**：`src/core/acp/`。`claude-code-sdk-adapter.ts`、`opencode-sdk-adapter.ts` 把各家 CLI 的输出翻译成统一 session update；`provider-registry.ts` / `provider-adapter/` 做分发。加新 provider = 加适配器，上层不动（ADR-0002）。
  - **MCP（回方向：agent 怎么反向操作 Routa）**：`src/core/mcp/routa-mcp-tool-manager.ts` 用 `server.tool(name, desc, schema, handler)` 注册工具；`/api/mcp/route.ts` 是统一入口（多方法：POST 处理 JSON-RPC，GET 开 SSE 流，DELETE 终止会话，非仅 POST）；`mcp-server-profiles.ts` 按场景白名单裁剪工具。
  - 触发统一走协议而非函数：`agent-trigger.ts:674` 用 `fetch POST /api/acp` + JSON-RPC `session/new`，而不是直接 new 进程。
- **你以后怎么用**：对接任何"第三方/不稳定/多家实现"的东西（支付、短信、LLM、云厂商），先定义你自己的内部模型，再写适配器翻译。永远不要让外部协议的细节渗进核心业务。
- **实证补充（8-agent 扫出）**：防腐其实是**四层桥接**，不止一层——Provider 协议 → `NormalizedSessionUpdate`（归一化）→ `WorkspaceAgentEvent`（语义块：Read/Write/Compile/Test）→ AG-UI SSE 事件，每层可独立测试（`provider-adapter/`、`agent-event-bridge/`、`ag-ui/event-adapter.ts`）。前端也有防腐：`resolveApiPath` + `desktopAwareFetch`（`src/client/config/backend.ts`）把"Web/桌面后端在哪"挡在业务外。
- **状态**：未学

## 模式 3：事件驱动 / EventBus

- **是什么**：模块之间不直接调用，而是"发事件 / 听事件"。生产者不认识消费者，一个事件可被多方消费。
- **这项目怎么用**：
  - `src/core/events/event-bus.ts` 定义 `EventBus` 和事件类型（`COLUMN_TRANSITION`、`AGENT_COMPLETED`、`AGENT_FAILED`…）。
  - 看板循环：`moveCard` 发 `COLUMN_TRANSITION`（`kanban-tools.ts:426`）→ `WorkflowOrchestrator` 收到起 agent → agent 完成发 `AGENT_COMPLETED` → 同一事件被 orchestrator（推进）和 `KanbanSessionQueue`（放行队列）**同时**消费。
  - 整个看板本质是"跑在 EventBus 上的事件状态机"。
- **你以后怎么用**：当"一件事发生后，有多个互不相关的后续动作"时，用事件而非层层调用。典型：用户注册后要发邮件+建积分+记日志——发一个 `UserRegistered` 事件，三个监听器各干各的。解耦、可扩展、易测。
- **实证补充**：EventBus 远不止 emit/on，还有几个进阶能力（`event-bus.ts:55-306`）：**优先级订阅**、**一次性订阅(one-shot)**、**WaitGroup(after_all 语义——父 agent 等多个子 agent 全完成再回调)**、**pre-subscribe(先订阅再触发，避免竞态丢事件)**、**事件缓冲(订阅者可异步 drain 不丢)**。Rust 端用 `tokio::sync::broadcast` 天然支持多订阅者（`crates/routa-core/src/acp/mod.rs`）。
- **状态**：未学

## 模式 4：服务容器 / 集中装配（Composition Root）

- **是什么**：所有依赖在一个地方组装、接线，而不是在各处 `new`。
- **这项目怎么用**：
  - `src/core/routa-system.ts` 是 TS 的服务容器：把 store、EventBus、tools 全部 wire 在一起（`workspaceTools.setWorkspaceStore(...)`、`tools.setArtifactStore(...)`）。新服务在这里引入，而非在路由里临时造。
  - `crates/routa-core/src/state.rs` 的 `AppState` 是 Rust 对应物。
  - CLAUDE.md 明确："New domain services should usually be introduced here rather than instantiated ad hoc inside route handlers."
- **你以后怎么用**：一个应用应该有一个"组装根"（main / bootstrap / container），所有对象图在这里构建并注入。避免依赖散落、避免隐藏的全局状态。
- **状态**：未学

## 模式 5：编排外壳 + 领域钩子（Orchestration Shell）

- **是什么**：超大、行为密集的文件，拆成"薄的顶层外壳 + 抽出的领域分支"，而不是按 UI 切片。
- **这项目怎么用**：
  - ADR-0006。CLAUDE.md："For long behavior-heavy files, prefer orchestration shell + domain hooks over UI-only slicing." 同样套路用于超大 API 路由：薄路由 + 抽工作流分支。
  - 看板就是范例：`workflow-orchestrator.ts` 当外壳，把"列变更""完成处理""恢复""队列""闸门"拆成 `column-transition.ts` / `transition-gates.ts` / `kanban-session-queue.ts` / `restart-recovery.ts` 等独立职责文件。
- **你以后怎么用**：文件超过几百行、分支密集时，先按"业务工作流"切（不是按技术层切），每块职责单一。重构前先按 workflow branch 拆，别过早抽通用 utils。
- **状态**：未学

## 模式 6：保守降级 + 幂等 + 自愈（生产级韧性）

- **是什么**：默认系统会出错。失败要降级成已知状态、操作要可重复不出错、崩溃后要能自己恢复。
- **这项目怎么用**：
  - **保守降级**：worktree 创建失败 → 任务打到 `blocked` 列（`workflow-orchestrator-singleton.ts:194`）；`a2a` transport 暂时回落到 `acp`（`agent-trigger.ts:632`）。失败也是一种状态流转，不静默吞。
  - **幂等防撞**：两条移卡路径（agent `move_card` / 系统 `autoAdvanceCard`）靠 `columnId` 是否已变化互斥（`workflow-orchestrator.ts:911`），绝不重复移动。
  - **租约 + 自愈**：`restart-recovery.ts` 重启后扫僵尸会话，用 lease（`ownerInstanceId` + `leaseExpiresAt`）判断会话是否还活着，清理过期、重放"该跑没跑"的自动化。
  - **超时 ≠ 失败**：ACP prompt 的 HTTP 超时不当失败，等 EventBus 生命周期事件定状态（`agent-trigger.ts:646`）。
- **你以后怎么用**：写任何异步/分布式/长任务代码时，问三个问题：失败了降级到哪个安全状态？这操作重复执行会不会出错？进程重启后未完成的工作怎么恢复？用 lease/版本号防脑裂和重复。
- **实证补充**：这套韧性是**全项目级**的，不止看板——①**乐观锁**：DB store 用 `version` 列 + `atomicUpdate(expectedVersion)` 防并发覆盖（`pg-task-store.ts`、`sqlite-task-store.ts`）；②**幂等 upsert**：`onConflictDoUpdate`（写）/`onConflictDoNothing`（轨迹）；③**多层完成检测**：后台 worker 4 层兜底（内存→DB→孤儿 5min→陈旧 2h，`background-worker/index.ts`）；④**安全追加**：`appendSafe()` 吞错不崩（`trace/writer.ts`）；⑤**SSE 自愈**：前端断线 3s 重连 + 重拉全量 + 客户端去重（`use-notes.ts`、`use-kanban-events.ts`）。
- **状态**：未学

## 模式 7：双后端语义对等（Contract-First 一致性）

- **是什么**：两套技术实现（TS/Rust）暴露同一套业务概念和 API 形状，用契约文件约束一致。
- **这项目怎么用**：
  - ADR-0001。`api-contract.yaml`（仓库根）是两边对齐的契约。
  - `RoutaSystem`（TS）与 `AppState`（Rust）字段逐一对应；领域词汇（workspace/task/session）两边一字不差。
  - 文档诚实记录了风险："not every persistence-backed implementation is fully symmetric yet"——对等是有维护成本的。
- **你以后怎么用**：当你有多端（Web/移动/桌面）或多服务要保持行为一致时，用一份契约（OpenAPI / protobuf / schema）当单一事实源，从它生成或校验各端。注意：这是一笔持续的税，量力而行。
- **状态**：未学

---

# Part B — 工程纪律（两套机制让架构不腐化）

## 纪律 1：ADR（架构决策记录）

- **是什么**：把"为什么这么设计"写成不可变的决策记录，后人能追溯、不会无意推翻。
- **这项目怎么用**：`docs/adr/` 下 0001~0007，每条一个决策（双后端对等、ACP 归一化、workspace-first、看板驱动自动化、specialist 外置、编排外壳、看板交付流转策略）。索引见 `docs/adr/README.md`；AGENTS.md 称 ADR 是"why is it built this way?"的 canonical 答案。（注：ARCHITECTURE.md 的 ADR 表只列到 0006，已落后于实际目录——这本身就是"文档会漂移"的活例子。）
- **你以后怎么用**：每个有长期影响的架构决策写一条 ADR（背景 / 决策 / 后果 / 替代方案）。一页纸即可。它让团队记忆不依赖某个人的脑子。
- **状态**：未学

## 纪律 2：Fitness Functions（可执行的架构约束）

- **是什么**：把架构规则变成 CI 能跑的自动检查，而不是口头君子协定。
- **这项目怎么用**：`docs/fitness/` 是规则手册，`crates/entrix/` 是执行引擎。CLAUDE.md 要求 PR 前 `entrix run --tier fast/normal`。还有 `.dependency-cruiser.cjs`（依赖方向约束）、storybook governance、design-system CSS lint 等。
- **你以后怎么用**：把你最在意的架构规则（分层依赖方向、命名、禁止某些 import、测试覆盖）写成脚本挂进 CI。架构不靠自觉，靠红灯。
- **状态**：未学

## 纪律 3：统一语言（Ubiquitous Language）

- **是什么**：业务概念在代码、文档、UI、跨技术栈里用同一套词，不漂移。
- **这项目怎么用**：`workspace / session / task / codebase / worktree` 从 UI 到 API 到 TS 到 Rust 一字不差；ADR-0001 强制两个运行面"语义对等"本质就是"统一语言不许因换技术栈而变"。
- **你以后怎么用**：和业务方定好术语表，代码里就用这些词（不要业务叫"订单"、代码叫 `record`）。这是 DDD 的灵魂，也是降低沟通成本最便宜的手段。
- **状态**：未学

## 纪律 4：Baby-Step Commits（小步提交）

- **是什么**：一个 commit 一个关注点，小而清晰，Conventional Commits 格式。
- **这项目怎么用**：CLAUDE.md "Git Discipline"：一 commit = 一个 feature/fix/refactor，目标 <10 文件 & <1000 行，不许 kitchen-sink，混合关注点要拆。
- **你以后怎么用**：提交前问"这个 commit 是不是只做了一件事？"。好处：review 容易、回滚精准、history 可读、二分定位 bug 快。
- **状态**：未学

## 纪律 5：重构前先加特征测试（Characterization Tests）

- **是什么**：动大行为之前，先写测试把现有的路由/生命周期/持久化/恢复行为"锁住"，确保重构不改变可观察行为。
- **这项目怎么用**：CLAUDE.md "Before large behavior refactors, add or extend characterization tests that lock routing/lifecycle/persistence/recovery behavior." 看板那些防僵尸、防重复的边界逻辑就是被测试锁住的不变量。
- **你以后怎么用**：接手一段没测试的老代码要改时，先写测试描述它"现在"的行为（哪怕行为是错的），再重构，绿灯保证你没破坏既有契约。
- **状态**：未学

## 纪律 6：图谱探查 + 影响分析（改动前先看波及面）

- **是什么**：大改前先分析改动的影响半径、测试半径、评审上下文。
- **这项目怎么用**：CLAUDE.md 推荐 `entrix graph impact` / `graph test-radius` / `graph review-context`。
- **你以后怎么用**：改公共模块前，先搞清"谁依赖我"。哪怕没有专门工具，用 grep/IDE 找引用、跑相关测试子集，也是同样的纪律。
- **状态**：未学

---

# Part A（续）— 实证扫出的域级新模式（8-agent 发现）

> 这 5 个模式之前漏了，因为它们在 notes/trace/review/workflow/sandbox 等"非看板"领域，而早期只深读了看板。它们和 A1~A7 一样是真·跨域设计。

## 模式 A8：CRDT 无冲突协同编辑

- **是什么**：多人同时编辑同一份内容，不靠加锁、不靠"最后写入赢"，而用 CRDT（无冲突复制数据类型）让并发修改自动合并。
- **这项目怎么用**：notes 域用 Yjs。`crdt-document-manager.ts:222` 的 `computeTextDiff()` 把"全量内容更新"压成最小的 insert/delete/retain 操作，在 `Y.Doc.transact()`（`:101`）里原子应用，Yjs 引擎自动合并并发编辑——**没有一行显式冲突解决代码**。`crdt-note-store.ts` 是 `NoteStore` 接口的 CRDT 实现（又见 A1）。
- **你以后怎么用**：做协同文档/白板/多端同步时，别自己写"冲突合并"，用成熟 CRDT 库（Yjs/Automerge）。代价：内存里每个文档一个副本（注意清理，这项目有 24h 自动回收）。
- **状态**：未学

## 模式 A9：事件溯源 + Append-only Ledger + 重放

- **是什么**：不只存"当前状态"，而是把"发生过的每件事"按顺序不可变地追加记录；当前状态可由事件序列重放得出。审计、归因、回放全靠它。
- **这项目怎么用**：trace 域。①**JSONL append-only 轨迹**：`trace/writer.ts:92` 用 `fs.appendFile` 单向追加，按日期分片；②**Ledger 账本**：`trace/run-outcome.ts` 把每次任务运行的结果（指纹、证据束、失败模式、车道转移）追加到 `trace-ledger.jsonl`；③**重放**：`trace-replay.ts` 把轨迹序列重放成两条管道（语义层 EventBridge + UI 层 AG-UI），支持渐进式回放；④**双后端存储**：本地 JSONL、Serverless(Vercel) 走 Postgres，同一 `TraceReader/Writer` API 屏蔽差异。
- **你以后怎么用**：需要审计/可回溯/"时间旅行"调试的系统（金融、工作流、agent 行为），用事件溯源。哪怕不全量上 ES，关键操作记一条 append-only 日志，价值巨大。注意并发写要加锁（这项目这里有撕裂风险，见 Part C）。
- **状态**：未学

## 模式 A10：分阶段流水线 + 策略/证据闸门

- **是什么**：复杂判断不是一步到位，而是拆成多个阶段逐级提纯；阶段之间用"闸门"（策略/证据/置信度）卡住，不达标不放行。
- **这项目怎么用**：①**review 三阶段流水线**：Context → Candidates → Validator（`review/review-analysis.ts:43`），每阶段一个 specialist LLM，Validator 用置信度阈值(≥7)+排除规则过滤 findings（`multi-phase-review.ts`）——高精度低召回的刻意取舍；②**harness 四层治理循环** Context→Run→Observe→Govern（`crates/harness-monitor/`），`evaluate/gates.rs` 推断 EffectClass→PolicyDecision(Allow/RequireApproval/AllowWithEvidence/Deny)→EvidenceRequirement，形成"证据栅栏"；③看板的列闸门(transition-gates)也是同一思想的轻量版。
- **你以后怎么用**：质量/安全/审批类逻辑，拆成"生成→校验→放行"的阶段，每段单一职责、可独立测；用显式闸门（而非一坨 if）表达准入条件。LLM 流水线尤其适合"一个大 prompt 拆成几个专职 worker 逐级提纯"。
- **状态**：未学

## 模式 A11：任务 DAG 依赖编排 + 步骤数据流

- **是什么**：把一个大流程建模成"有向无环图"——任务之间声明依赖，调度器按拓扑顺序挑出"就绪"的任务执行；上游产出自动喂给下游。
- **这项目怎么用**：workflow 域。`background-task-store.ts:218` 的 `listReadyToRun()` 检查 `dependsOnTaskIds` 全部 COMPLETED 才算就绪（拓扑调度）；`workflow-executor.ts` 支持 `parallel_group` 并行；`background-worker/index.ts:162` 的 `resolveTaskPrompt` 用 `${steps.StepName.output}` 占位符把上游输出注入下游 prompt（数据流）。并发上限 `MAX_CONCURRENT_TASKS=2` + 优先级 FIFO。
- **你以后怎么用**：多步骤、有依赖、能并行的批处理/流水线（CI、数据管道、agent 编排），用 DAG 建模而非硬编码顺序。依赖声明 + 就绪检测 + 输出传递三件套。
- **状态**：未学

## 模式 A12：能力分层 + 策略解析（沙箱安全模型）

- **是什么**：给"被执行的不可信代码/agent"划定权限边界——能力分层（只读观察 vs 可写行动），权限通过"策略链"解析合并，运行时可收紧而不动基础配置。
- **这项目怎么用**：sandbox 域（Rust 为主）。`sandbox/policy.rs:49` 的 `SandboxCapabilityTier::Observation | Action`；`permission_constraints.rs:59` 的 `apply_permission_constraints()` 把约束规范化合并进基础策略，`normalize_capabilities()` 从访问权限推导能力（如 read_write_paths→WorkspaceWrite）；`ResolvedSandboxCapability` 带 `reason` 字段（决策可解释）。worker 层 LocalWorker/DockerWorker 同接口多态（本地 vs 容器隔离），按能力约束路由任务（`worker/registry.ts`）。
- **你以后怎么用**：跑用户代码/插件/AI agent 时，用"能力白名单 + 分层 + 策略解析"而非"全有或全无"。每个权限决策附带 reason，便于审计和调试。本地/容器执行用统一 Worker 接口，调度器不关心底层。
- **状态**：未学

## 附录 R：Rust 端工程惯用法（语言级，非架构级）

> 这些是 Rust 实现 A1/A3/A4 时的语言惯用法，理解它们才看得懂 `crates/routa-core/`。

- **`Arc<RwLock<T>>` 共享可变状态**：无 GC，用原子引用计数+读写锁替代全局 this（`events/mod.rs`、`sandbox/manager.rs`）。
- **`spawn_blocking` 隔离阻塞 I/O**：SQLite 同步 I/O 不能跑在 async runtime，丢到专属线程池（`db/mod.rs:92` `with_conn_async`）。
- **双层错误型 + `?`**：领域错误 `ServerError`(thiserror) 与协议错误 `RpcError` 分离，`impl From` 自动转换（`error.rs`、`rpc/error.rs`）；错误是一等公民，编译器强制处理。
- **类型级状态机**：状态用 enum 不用字符串（`TaskLaneSessionStatus`），`match` 强制穷举所有分支，消灭 TS 里 `status === 'UNKNOWN'` 漏网。
- **结构体组合 > trait 对象**：AppState 持有所有具体 store 类型，编译期静态分派，无虚函数开销（代价：CRUD 模板化重复）。
- **`tokio::sync::broadcast`**：SSE 多订阅天然支持，不用手工 `listeners.push`。

---

# Part C — 架构债务（8-agent 实证发现）

> 诚实记录：这些是 agent 从代码里挖出的真实缺口/风险，印证了 ARCHITECTURE.md 自己承认的"not every persistence-backed implementation is fully symmetric yet"。**学习时要知道哪些是"理想"、哪些还没补齐。**

| # | 债务 | 证据 | 影响 |
|---|---|---|---|
| C1 | **WorkflowRun 仍全程内存** | 三种模式都用 `InMemoryWorkflowRunStore`（`routa-system.ts:155/227`） | 进程重启，进行中的工作流丢失 |
| C2 | **内存 store 无并发控制** | `InMemoryTaskStore` 无 `version`/`atomicUpdate`，但 Pg/Sqlite 有 | 内存模式下乐观锁"沉默失效"，A7 对等有缺口 |
| C3 | **重试/退避未落实** | `maxAttempts` 字段存在但调度处硬编码为 1（`run-schedule-tick.ts`、polling） | 失败任务不自动重试，韧性弱于设计意图 |
| C4 | **Ledger 写入无锁/无事务** | `fs.appendFile` 无锁（`run-outcome.ts:219`）；PG 端 `onConflictDoNothing` 不处理重复 | 高并发完成时可能写入撕裂/乱序 |
| C5 | **多源历史合并靠 JSON.stringify 精确匹配** | `session-history.ts:14` 全 JSON 比较 | 含时间戳/随机字段时虚假不匹配 → 冗余记录 |
| C6 | **前端缺统一 DI/事件中枢** | hooks 分散，无 app 级 composition root / SSE meta-hook | 重连/去抖逻辑重复，对标后端 RoutaSystem 缺位 |
| C7 | **文档漂移已发生** | ARCHITECTURE.md 的 ADR 表停在 0006，实际有 0007 | 印证"手写文档必漂移"，正是 B2 fitness 该兜的 |

---

# 学习进度追踪

| # | 模式/纪律 | 状态 |
|---|---|---|
| A1 | 依赖倒置 + 接口化 Store | 未学 |
| A2 | 协议适配 / 防腐层（四层桥接） | 未学 |
| A3 | 事件驱动 / EventBus（含 WaitGroup/优先级） | 未学 |
| A4 | 服务容器 / 集中装配 | 未学 |
| A5 | 编排外壳 + 领域钩子 | 未学 |
| A6 | 保守降级 + 幂等 + 自愈（乐观锁/多层兜底） | 未学 |
| A7 | 双后端语义对等 | 未学 |
| A8 | CRDT 无冲突协同编辑 | 未学 |
| A9 | 事件溯源 + Ledger + 重放 | 未学 |
| A10 | 分阶段流水线 + 策略/证据闸门 | 未学 |
| A11 | 任务 DAG 依赖编排 + 数据流 | 未学 |
| A12 | 能力分层 + 策略解析（沙箱） | 未学 |
| R | Rust 工程惯用法（附录） | 未学 |
| B1 | ADR | 未学 |
| B2 | Fitness Functions | 未学 |
| B3 | 统一语言 | 未学 |
| B4 | Baby-Step Commits | 未学 |
| B5 | 重构前特征测试 | 未学 |
| B6 | 图谱探查 / 影响分析 | 未学 |

> 推进顺序建议：A1 → A7（七把通用武器，最先掌握）→ A8~A12（域级进阶模式）→ Rust 附录 → B1~B6（纪律）。
> 每过完一个，更新对应状态为"已掌握"，并在卡片下补充你自己的"我会怎么用"笔记。
> Part C 的架构债务不用"学"，是用来校准认知的——知道哪些是理想、哪些没补齐。
