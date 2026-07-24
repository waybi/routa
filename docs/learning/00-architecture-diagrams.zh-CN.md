---
title: Routa 架构图集
---

# Routa 架构图集

> 配合 [01-系统骨架导览](01-routa-architecture-tour.zh-CN.md) 到
> [06-泳道经验记忆](06-lane-experience-memory.zh-CN.md) 六篇文字使用。
> 每张图对应一篇文档的核心主题。

---

## 图 1：系统分层总览

对应 [01-系统骨架导览](01-routa-architecture-tour.zh-CN.md)

```mermaid
graph TB
    subgraph Presentation["表现层 Presentation"]
        direction LR
        Home["主页<br/>选模式"]
        Sessions["会话<br/>Sessions"]
        Kanban["看板<br/>Kanban"]
        Team["团队<br/>Team"]
        Spec["规格"]
        Feature["特性浏览"]
        Harness["Harness"]
        Settings["设置"]
    end

    subgraph API["API / 传输层（双后端语义对等）"]
        direction LR
        NextJS["Web: Next.js<br/>src/app/api/*"]
        Axum["Desktop: Rust/Axum<br/>crates/routa-server"]
        NextJS <-. "api-contract.yaml<br/>ADR-0001" .-> Axum
    end

    subgraph Protocol["协议适配层"]
        direction LR
        REST["REST<br/>CRUD"]
        MCP["MCP<br/>工具调用"]
        ACP["ACP<br/>跑 Agent"]
        A2A["A2A<br/>Agent 互通"]
        AGUI["AG-UI<br/>UI 流"]
        SSE["SSE<br/>实时推送"]
    end

    subgraph Domain["领域服务层（业务大脑）"]
        direction LR
        Orch["编排<br/>orchestration"]
        KanbanAuto["泳道自动化<br/>kanban automation"]
        Workflow["工作流<br/>workflows"]
        Review["评审<br/>review"]
        Trace["追踪<br/>trace"]
        SharedSession["共享会话<br/>shared-session"]
    end

    subgraph Container["服务容器"]
        direction LR
        RoutaSystem["TS: RoutaSystem<br/>src/core/routa-system.ts"]
        AppState["Rust: AppState<br/>crates/routa-core/src/state.rs"]
    end

    subgraph Store["存储 / 注册表层"]
        direction LR
        WS["workspace"]
        Task["task"]
        Session["session"]
        Note["note"]
        Codebase["codebase"]
        Worktree["worktree"]
        KBoard["kanban board"]
        Artifact["artifact"]
        Skill["skill"]
    end

    subgraph Persist["持久化 / 运行时层"]
        direction LR
        PG["Postgres"]
        SQLite["SQLite"]
        Mem["内存"]
        JSONL["JSONL trace"]
        Docker["Docker 沙箱"]
        GitWT["git worktree"]
    end

    Presentation --> API
    API --> Protocol
    Protocol --> Domain
    Domain --> Container
    Container --> Store
    Store --> Persist

    style Presentation fill:#e3f2fd,stroke:#1565c0
    style API fill:#fce4ec,stroke:#c62828
    style Protocol fill:#f3e5f5,stroke:#6a1b9a
    style Domain fill:#e8f5e9,stroke:#2e7d32
    style Container fill:#fff3e0,stroke:#e65100
    style Store fill:#e0f2f1,stroke:#00695c
    style Persist fill:#f5f5f5,stroke:#616161
```

---

## 图 2：三种编排模式

对应 [04-三种模式对比](04-three-modes-compared.zh-CN.md)

```mermaid
graph TB
    User(("用户"))

    User -->|"打字聊天"| S_Entry["Sessions 入口<br/>HomeInput 输入框"]
    User -->|"拖拽卡片"| K_Entry["Kanban 入口<br/>看板 UI"]
    User -->|"建队给指令"| T_Entry["Team 入口<br/>Team Page"]

    subgraph Sessions["Sessions 模式（懒展开）"]
        S_Entry --> S_ROUTA["创建 ROUTA 会话<br/>（单个 ACP 进程）"]
        S_ROUTA -->|"需要时才调<br/>delegate_task"| S_CRAFTER["拉 CRAFTER"]
        S_ROUTA -->|"需要时才调<br/>delegate_task"| S_GATE["拉 GATE"]
    end

    subgraph KanbanMode["Kanban 模式（按位置触发）"]
        K_Entry --> K_Event["COLUMN_TRANSITION<br/>事件"]
        K_Event --> K_Orch["KanbanWorkflow<br/>Orchestrator"]
        K_Orch --> K_Queue["Session Queue<br/>并发控制"]
        K_Queue --> K_Agent["列配置的 specialist<br/>自动启动 ACP"]
    end

    subgraph TeamMode["Team 模式（主动铺开）"]
        T_Entry --> T_Lead["创建 team-agent-lead<br/>（单个 ACP 进程）"]
        T_Lead -->|"批量 delegate_task<br/>waitMode=after_all"| T_Wave["Wave 1<br/>多个 CRAFTER 并行"]
        T_Wave -->|"全部完成后<br/>wakeParent"| T_Lead
        T_Lead -->|"派 GATE 验收"| T_GATE["Wave 2: GATE"]
    end

    S_CRAFTER --> ACP
    S_GATE --> ACP
    K_Agent --> ACP
    T_Wave --> ACP
    T_GATE --> ACP

    ACP["ACP 协议<br/>session/new + session/prompt<br/>（三条路的共同终点）"]
    ACP --> CLI["真实 AI CLI 进程<br/>Claude Code / OpenCode / Kimi"]

    style Sessions fill:#e8f5e9,stroke:#2e7d32
    style KanbanMode fill:#fff3e0,stroke:#e65100
    style TeamMode fill:#e3f2fd,stroke:#1565c0
    style ACP fill:#f3e5f5,stroke:#6a1b9a
    style CLI fill:#fce4ec,stroke:#c62828
```

---

## 图 3：Kanban 自动化流水线

对应 [02-Kanban 自动化深潜](02-kanban-automation-deep-dive.zh-CN.md)

```mermaid
graph LR
    Drag["拖卡片<br/>Todo → Dev"] --> Emit["emitColumn<br/>Transition"]
    Emit --> Resolve["resolve<br/>Transition<br/>Automation"]
    Resolve --> Orch["Workflow<br/>Orchestrator"]

    subgraph Orchestrator["编排器决策"]
        Orch --> Steps["获取 automation<br/>steps 列表"]
        Steps --> Loop["防循环保护<br/>≤3 次/非dev列"]
        Loop --> Super["加载监督策略<br/>watchdog / ralph_loop"]
        Super --> Register["注册<br/>ActiveAutomation"]
    end

    Register --> Queue

    subgraph QueueSystem["并发队列"]
        Queue["Session<br/>Queue"] --> Check{"running<br/>< limit?"}
        Check -->|"是"| Start["startEntry<br/>启动 ACP"]
        Check -->|"否"| Wait["排队等待"]
        Wait -.->|"有空位时<br/>drainQueue"| Start
    end

    Start --> CreateSession["startKanban<br/>TaskSession"]

    subgraph SessionCreation["创建会话"]
        CreateSession --> WT["创建 git<br/>worktree"]
        WT --> Provider["确定 provider<br/>+ specialist"]
        Provider --> Context["收集上下文<br/>flow + memory"]
        Context --> Trigger["triggerAssigned<br/>TaskAgent"]
    end

    Trigger --> Agent["ACP Agent<br/>干活中..."]

    Agent --> Watchdog["Watchdog<br/>每30s扫描"]
    Watchdog -->|"超时"| Timeout["AGENT_TIMEOUT"]
    Agent -->|"完成"| Complete["AGENT_COMPLETED"]
    Agent -->|"失败"| Failed["AGENT_FAILED"]

    subgraph Completion["完成后处理"]
        Complete --> Satisfied{"完成条件<br/>满足?"}
        Satisfied -->|"是 + 有下一step"| NextStep["启动下一 step"]
        Satisfied -->|"是 + autoAdvance"| Advance["自动推到下一列"]
        Satisfied -->|"否"| Recover{"需要恢复?"}
        Recover -->|"是"| RecoverSession["recoverAutomation<br/>attempt + 1"]
        Recover -->|"否"| MarkFailed["标记失败"]
        Failed --> Recover
        Timeout --> Recover
    end

    Advance -->|"发新的<br/>COLUMN_TRANSITION"| Emit

    style Drag fill:#fff3e0,stroke:#e65100
    style Agent fill:#e3f2fd,stroke:#1565c0
    style Advance fill:#e8f5e9,stroke:#2e7d32
```

---

## 图 4：转换门禁三层检查

对应 [02-Kanban 自动化深潜](02-kanban-automation-deep-dive.zh-CN.md) 第 6 节

```mermaid
graph TB
    Move["卡片要从 A 列 → B 列"] --> L1

    subgraph L1["Layer 1: Transition Gates"]
        TG1["requiredChecklist<br/>task 文本里有 ✅ 勾选项?"]
        TG2["requiredHumanApproval<br/>verdict = APPROVED?"]
        TG3["validatorCommand<br/>证据里有命令 + passed?"]
    end

    L1 --> L2

    subgraph L2["Layer 2: Delivery Readiness"]
        DR1["requireCommittedChanges<br/>有 commit（相对 base）?"]
        DR2["requireCleanWorktree<br/>工作树干净?"]
        DR3["requirePullRequestReady<br/>feature branch + 能开 PR?"]
    end

    L2 --> L3

    subgraph L3["Layer 3: Required Artifacts"]
        RA1["screenshot<br/>有截图?"]
        RA2["test_results<br/>有测试结果?"]
        RA3["code_diff<br/>有代码变更?"]
    end

    L3 --> Decision{"gateMode?"}
    Decision -->|"blocking"| Block["❌ 拦住，不让过"]
    Decision -->|"warning"| Warn["⚠️ 放行，记审计警告"]
    Decision -->|"全通过"| Pass["✅ 卡片进入目标列"]

    style L1 fill:#fce4ec,stroke:#c62828
    style L2 fill:#fff3e0,stroke:#e65100
    style L3 fill:#e3f2fd,stroke:#1565c0
    style Pass fill:#e8f5e9,stroke:#2e7d32
    style Block fill:#ffcdd2,stroke:#b71c1c
    style Warn fill:#fff9c4,stroke:#f57f17
```

---

## 图 5：Agent 触发与 Provider 归一化

对应 [03-Agent 触发与 ACP 桥梁](03-agent-trigger-and-acp-bridge.zh-CN.md)

```mermaid
graph TB
    subgraph Bridge1["Bridge 1: agent-trigger.ts"]
        Build["buildTaskPrompt()<br/>拼结构化 prompt"]
        Resolve["resolveKanban<br/>AutomationProvider()<br/>选 Provider"]
        Build --> Dispatch
        Resolve --> Dispatch
        Dispatch{"transport?"}
        Dispatch -->|"acp"| TriggerACP["triggerAcpTaskAgent()<br/>本地 CLI 进程"]
        Dispatch -->|"a2a"| TriggerA2A["triggerA2ATaskAgent()<br/>远程 Agent"]
    end

    subgraph ACPLayer["ACP 协议层"]
        TriggerACP --> New["POST /api/acp<br/>session/new"]
        New --> SessionID["拿到 sessionId"]
        SessionID --> Prompt["dispatchSessionPrompt()<br/>session/prompt"]
        Prompt --> Specialist["加载 Specialist<br/>系统 prompt"]
        Specialist --> Factory["ProviderRegistry<br/>查工厂函数"]
        Factory --> Spawn["启动 AI CLI 进程"]
    end

    subgraph Bridge2["Bridge 2: Provider Adapter（翻译社）"]
        Spawn --> Claude["Claude Code CLI<br/>stream-json 格式"]
        Spawn --> OpenCode["OpenCode CLI<br/>标准 ACP 格式"]
        Spawn --> Others["Kimi / Gemini /<br/>Copilot / Codex / ..."]

        Claude --> CA["claude-adapter<br/>.normalize()"]
        OpenCode --> OA["opencode-adapter<br/>.normalize()"]
        Others --> SA["standard-acp-adapter<br/>.normalize()"]

        CA --> Unified
        OA --> Unified
        SA --> Unified
    end

    Unified["NormalizedSessionUpdate<br/>（统一格式，所有 Provider 一样）"]

    Unified --> UI["→ SSE → 前端 UI"]
    Unified --> TraceStore["→ Trace 存储"]
    Unified --> EventBus["→ EventBus → Orchestrator"]

    style Bridge1 fill:#fff3e0,stroke:#e65100
    style ACPLayer fill:#e3f2fd,stroke:#1565c0
    style Bridge2 fill:#f3e5f5,stroke:#6a1b9a
    style Unified fill:#e8f5e9,stroke:#2e7d32
```

---

## 图 6：Specialist 加载优先级链

对应 [05-Specialist 人设体系](05-specialist-persona-system.zh-CN.md)

```mermaid
graph TB
    Need["需要 specialist<br/>id='crafter', locale='zh-CN'"]

    Need --> DB{"① Database<br/>优先级 100"}
    DB -->|"找到"| Use["使用该 Specialist"]
    DB -->|"未找到"| User{"② User Files<br/>~/.routa/specialists/<br/>优先级 75"}
    User -->|"找到"| Use
    User -->|"未找到"| Bundled{"③ Bundled Resources<br/>resources/specialists/<br/>优先级 50"}
    Bundled -->|"找到"| Locale{"有 locale overlay?"}
    Locale -->|"有 zh-CN"| Merge["合并 overlay<br/>中文字段覆盖英文"]
    Locale -->|"无"| Use
    Merge --> Use
    Bundled -->|"未找到"| Hardcoded["④ Hardcoded Fallback<br/>specialist-prompts.ts<br/>优先级 25<br/>（最后防线）"]
    Hardcoded --> Use

    Use --> Config["SpecialistConfig<br/>{id, name, role, systemPrompt,<br/>roleReminder, modelTier, provider}"]

    Config --> Inject["注入 ACP 会话<br/>Agent 变成这个角色"]

    style DB fill:#e8f5e9,stroke:#2e7d32
    style User fill:#e3f2fd,stroke:#1565c0
    style Bundled fill:#fff3e0,stroke:#e65100
    style Hardcoded fill:#ffcdd2,stroke:#b71c1c
    style Use fill:#f3e5f5,stroke:#6a1b9a
```

---

## 图 7：泳道经验记忆——闭环学习

对应 [06-泳道经验记忆](06-lane-experience-memory.zh-CN.md)

```mermaid
graph TB
    subgraph Execution["Agent 执行"]
        Agent["Agent 在 Dev 列干活"] --> Complete["完成/失败/超时"]
    end

    Complete --> Record["upsertTaskLaneSession()<br/>记录 session 档案"]

    subgraph RawData["原始数据积累"]
        Record --> LS["task.laneSessions[]<br/>每次 session 的详细记录"]
        Record --> LH["task.laneHandoffs[]<br/>泳道间交接记录"]
    end

    subgraph Synthesis["合成层（下次启动前）"]
        LS --> LaneExp["synthesizeTaskLane<br/>JitContextAnalysis()<br/>泳道经验合成"]
        LH --> LaneExp
        LS --> Flow["analyzeFlowForTasks()<br/>board 级流量诊断"]
        LS --> History["scoreAndRank<br/>HistoryMemory()<br/>历史相似任务匹配"]
        LS --> Strategy["searchReasoning<br/>Memories()<br/>策略记忆检索"]
    end

    subgraph Injection["注入 Agent Prompt"]
        LaneExp --> P1["## Lane Experience Memory<br/>当前列的模式/问题/建议"]
        Flow --> P2["## Flow Guidance<br/>board 级 CRITICAL/WARNING"]
        History --> P3["## Relevant History Memory<br/>相似任务的方案和结果"]
        Strategy --> P4["## Relevant Strategy Memory<br/>harness 的教训和策略"]
    end

    P1 --> Prompt["buildTaskPrompt()"]
    P2 --> Prompt
    P3 --> Prompt
    P4 --> Prompt

    Prompt --> NextAgent["下一个 Agent<br/>带着前人智慧开工"]
    NextAgent --> Agent

    style Execution fill:#e3f2fd,stroke:#1565c0
    style RawData fill:#fff3e0,stroke:#e65100
    style Synthesis fill:#f3e5f5,stroke:#6a1b9a
    style Injection fill:#e8f5e9,stroke:#2e7d32
```

---

## 图 8：Workspace 作用域

```mermaid
graph TB
    subgraph WA["Workspace A（电商前端）"]
        WA_S["sessions"]
        WA_T["tasks / kanban"]
        WA_C["codebase: react-app"]
        WA_W["worktrees"]
        WA_N["notes"]
        WA_M["memories"]
    end

    subgraph WB["Workspace B（Go 微服务）"]
        WB_S["sessions"]
        WB_T["tasks / kanban"]
        WB_C["codebase: go-api"]
        WB_W["worktrees"]
        WB_N["notes"]
        WB_M["memories"]
    end

    WA_S -.-|"❌ 不互通"| WB_S
    WA_T -.-|"❌ 不互通"| WB_T
    WA_M -.-|"❌ 记忆隔离"| WB_M

    User(("用户")) --> WA
    User --> WB

    style WA fill:#e3f2fd,stroke:#1565c0
    style WB fill:#e8f5e9,stroke:#2e7d32
```

---

## 图 9：一张卡从 Backlog 到 Done 的完整生命线

```mermaid
sequenceDiagram
    actor U as 用户
    participant UI as 看板 UI
    participant EB as EventBus
    participant WO as Workflow<br/>Orchestrator
    participant Q as Session<br/>Queue
    participant ACP as ACP 协议
    participant Agent as AI Agent<br/>(CRAFTER)
    participant Gate as AI Agent<br/>(GATE)
    participant TG as Transition<br/>Gates

    U->>UI: 拖卡片 Backlog → Todo
    Note over UI: 无 automation，纯状态变化

    U->>UI: 拖卡片 Todo → Dev
    UI->>EB: COLUMN_TRANSITION 事件
    EB->>WO: handleColumnTransition
    WO->>WO: resolveTransitionAutomation<br/>→ dev 列配了 CRAFTER
    WO->>Q: enqueue(cardId)
    Q->>Q: 检查并发 < limit
    Q->>ACP: session/new + session/prompt
    ACP->>Agent: 启动 Claude Code CLI<br/>+ 结构化 prompt

    loop Watchdog 每 30s
        WO->>ACP: 检查 Agent 活着吗?
    end

    Agent->>EB: AGENT_COMPLETED
    EB->>WO: handleAgentCompletion
    WO->>WO: autoAdvanceOnSuccess
    WO->>EB: COLUMN_TRANSITION<br/>(Dev → Review)

    EB->>WO: handleColumnTransition
    WO->>ACP: session/new (GATE specialist)
    ACP->>Gate: 启动 GATE 验收

    Gate->>EB: AGENT_COMPLETED
    EB->>WO: autoAdvance → Done

    WO->>TG: evaluateTransitionGates
    TG-->>WO: checklist ✅ approval ✅<br/>commit ✅ clean ✅

    WO->>UI: 卡片进 Done ✅
```
