---
title: Agent 触发与 ACP 桥梁：从"叫人干活"到真实 AI 进程
prerequisite: kanban-automation-deep-dive.zh-CN.md
---

# Agent 触发与 ACP 桥梁：从"叫人干活"到真实 AI 进程

> 接着 [Kanban 自动化深潜](kanban-automation-deep-dive.zh-CN.md) 的断点深入。
> 上一篇停在 `triggerAssignedTaskAgent` 这个函数调用——"叫人来干活"到底怎么落地还是黑箱。
> 本文打开这个黑箱，讲清楚三件事：
> 1. 怎么拼出喂给 Agent 的 prompt（信封里装什么）
> 2. 怎么通过 ACP 协议创建真实 AI CLI 进程（信封怎么寄出去）
> 3. 不同 Provider（Claude Code / OpenCode / Kimi / …）怎么被归一化（方言怎么统一成普通话）
>
> 本文是**学习笔记**，不是规范来源。事实以代码和
> [ADR-0002](../adr/0002-provider-normalization-via-acp.md) 为准。******

## 0. 一句话抓住本质

> Kanban 决定"该叫人了" → **agent-trigger** 把任务的所有上下文打包成一封 prompt 信
> → 通过 **ACP 协议**发出 `session/new` + `session/prompt` 两步调用
> → 真实的 AI CLI 进程启动
> → 进程的输出通过 **Provider Adapter** 归一化成统一格式
> → 系统的其余部分（UI / trace / 编排器）只看归一化后的消息。

用一句话：**agent-trigger 是"领域层"到"协议层"的桥，Provider Adapter 是"协议层"到"各 AI CLI 方言"的桥。两座桥加起来，让 Routa 的其他模块永远不需要知道"到底用的是 Claude 还是 OpenCode"。**

## 1. 全景图：两座桥的位置

~~~plaintext
Kanban Orchestrator                    UI / Trace / EventBus
(上一篇讲的)                           (消费者)
       │                                      ▲
       │ triggerAssignedTaskAgent()            │ NormalizedSessionUpdate
       ▼                                      │
┌──────────────────────────────────────────────┴───────────────────┐
│                     Bridge 1: agent-trigger.ts                   │
│                                                                  │
│  ① buildTaskPrompt()  — 把 task 的全部上下文拼成一封 prompt 信     │
│  ② resolveKanbanAutomationProvider()  — 确定用哪个 Provider       │
│  ③ triggerAcpTaskAgent() / triggerA2ATaskAgent() — 发出调用       │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                  ACP 协议（JSON-RPC over HTTP）
                  session/new → session/prompt
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│               ACP Runtime（src/core/acp/）                       │
│                                                                  │
│  session-prompt.ts   — 接收 prompt，启动 Agent CLI 进程          │
│  acp-process-manager.ts — 管理进程生命周期                       │
│  provider-registry.ts — Provider 发现 + 工厂模式                 │
│  http-session-store.ts — 会话状态存储                            │
└─────────────────────────────────┬────────────────────────────────┘
                                  │
                    Agent CLI 进程的原始输出（各 Provider 格式不同）
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│             Bridge 2: provider-adapter/                          │
│                                                                  │
│  IProviderAdapter.normalize()                                    │
│    claude-adapter    → 把 Claude stream-json 转成统一格式         │
│    opencode-adapter  → 把 OpenCode ACP 原生消息转成统一格式       │
│    standard-acp-adapter → Kimi / Gemini / Copilot / Codex / …    │
│    docker-opencode-adapter → Docker 容器内的 OpenCode             │
│                                                                  │
│  输出：NormalizedSessionUpdate（所有 Provider 长得一模一样）       │
└─────────────────────────────────────────────────────────────────┘
~~~

## 2. Bridge 1：agent-trigger.ts —— 拼信 + 寄信

**代码：** `src/core/kanban/agent-trigger.ts`（~905 行）

这个文件做三件事：拼 prompt、选 provider、发调用。

### 2a. 拼 prompt：buildTaskPrompt() —— 信封里装什么

这是整个文件最大的函数（~330 行），它把 task 的**所有上下文**拼成一封结构化的 prompt 文本。

信封的结构：

~~~plaintext
┌──────────────────────────────────────────────────────────────┐
│  "You are assigned to Kanban task: {title}"                   │
│                                                               │
│  ## Context                                                   │
│  IMPORTANT: 你在 Kanban 上下文里，用 MCP 工具管理这张卡          │
│                                                               │
│  ## Task Details                                              │
│  Card ID / Board ID / Current Column / Next Column / Priority │
│  Labels / GitHub Issue URL                                    │
│                                                               │
│  ## Objective                                                 │
│  {task.objective —— 任务的目标描述}                             │
│                                                               │
│  ## Story Readiness（结构化字段就绪度）                         │
│  scope=present, acceptanceCriteria=missing, …                 │
│                                                               │
│  ## INVEST Snapshot（用户故事质量检查）                          │
│  Independent: PASS / Negotiable: WARN / …                     │
│                                                               │
│  ## Artifact Gates（制品门禁）                                  │
│  当前列要什么 / 下一列要什么 / 缺什么                           │
│                                                               │
│  ## Contract Gates（合约门禁）                                  │
│  要不要 canonical YAML story                                   │
│                                                               │
│  ## Delivery Gates（交付门禁）                                  │
│  committed changes / clean worktree / PR-ready                 │
│                                                               │
│  ## Transition Gates（转换门禁）                                │
│  checklist / human approval / validator evidence               │
│                                                               │
│  ## Evidence Bundle（证据包）                                   │
│  已有多少 artifact / 缺什么 / verdict / report 状态             │
│                                                               │
│  ## Relevant History Memory（跨任务历史记忆）                    │
│  以前类似任务的经验和模式                                       │
│                                                               │
│  ## Relevant Strategy Memory（推理记忆）                        │
│  从 harness 推理记忆库里搜出的相关策略                          │
│                                                               │
│  ## Lane Experience（泳道经验）                                  │
│  同 board 其他任务在这个泳道的经验教训                           │
│                                                               │
│  ## Current Lane History（当前泳道历史）                         │
│  上一次在这个列跑过的 session 的情况                             │
│                                                               │
│  ## Lane Handoff Context（泳道交接）                             │
│  前一列的 session 信息 / 待处理的 handoff 请求                   │
│                                                               │
│  ## Dev Verification Safety（dev 列专属安全规则）                │
│  不要乱杀进程 / 不要假设 localhost:3000 就是对的                 │
│                                                               │
│  ## Flow Guidance（流量指导）                                    │
│  board 级别的瓶颈和流量分析建议                                  │
│                                                               │
│  ## Available MCP Tools                                       │
│  update_task / update_card / move_card / create_note /         │
│  list_artifacts / provide_artifact / capture_screenshot / …    │
│                                                               │
│  ## Instructions                                              │
│  1. 完成你这个阶段的工作                                       │
│  2. 先用任务级工具再用全 board 查询                             │
│  3. 保持聚焦在这个任务上                                       │
│  4. 完成后 move_card 到 {nextColumnId}                          │
│  …                                                            │
└──────────────────────────────────────────────────────────────┘
~~~

**关键洞察：这封 prompt 不是随便写的一句"帮我写代码"，而是一份高度结构化的工作包**——它告诉 Agent：

- 你是谁（Kanban task 的执行者）
- 你的任务是什么（objective）
- 你在哪个阶段（current column）
- 下一步怎么走（next column + move_card 指令）
- 你有哪些约束（各种 gates）
- 前人留了什么经验（history/experience memory）
- 你能用哪些工具（MCP tools 清单）

**而且 backlog 列和其他列的指令完全不同**：backlog 是"只做规划不写代码"（禁用 Bash/Write/Edit），其他列是"干活+推卡"。prompt 本身就在控制 Agent 的行为边界。

### 2b. 选 Provider：resolveKanbanAutomationProvider()

~~~plaintext
resolveKanbanAutomationProvider(provider?)
   │
   ├─ provider = "claude" 且 Claude Code SDK 已配置？
   │     → 用 "claude-code-sdk"
   │
   └─ 否则
         → 用传入的 provider，默认 "opencode"
~~~

简单粗暴：就是确认用哪个 AI CLI。

### 2c. 发调用：两条路径

`triggerAssignedTaskAgent()` 是总入口，根据 step 配置的 transport 分叉：

~~~plaintext
triggerAssignedTaskAgent()
   │
   ├─ transport = "a2a"?
   │     → triggerA2ATaskAgent()
   │       远程 Agent-to-Agent 调用：
   │       ① 解析 agentCardUrl（远程 Agent 的地址）
   │       ② 解析 authConfig（认证头）
   │       ③ client.sendMessage(agentCardUrl, prompt, metadata)
   │       ④ 后台等 completion → 发 AGENT_COMPLETED / AGENT_FAILED
   │
   └─ transport = "acp"（默认）
         → triggerAcpTaskAgent()
           本地 ACP 调用（最常见的路径）：
           ① POST /api/acp → session/new
              传入：cwd、branch、provider、role、workspaceId、
                    specialistId、name、toolMode、mcpProfile …
           ② 拿到 sessionId
           ③ 异步调 dispatchSessionPrompt()
              传入：sessionId + buildTaskPrompt() 的完整 prompt
           ④ 如果 prompt 超时 → 不立刻报错，等生命周期事件
              如果 prompt 失败 → 发 AGENT_FAILED 事件
~~~

**ACP 调用的两步分离（session/new → session/prompt）是刻意的**：先创建会话（拿到 sessionId 好挂到 task 上），再异步发 prompt（允许 prompt 很大、很慢，不阻塞会话创建流程）。

## 3. ACP 协议层：session/new 和 session/prompt 到底做了什么

**代码：** `src/core/acp/session-prompt.ts`（~740 行）

### session/new：创建一个"空壳"会话

~~~plaintext
POST /api/acp
{
  jsonrpc: "2.0",
  method: "session/new",
  params: {
    cwd: "/path/to/worktree",     ← Agent 的工作目录
    branch: "task-abc-123",        ← git 分支
    provider: "claude",            ← 用哪个 AI CLI
    role: "CRAFTER",               ← 角色
    workspaceId: "default",
    specialistId: "crafter-v3",    ← 专家 ID（加载对应 Markdown 人设）
    specialistLocale: "zh-CN",
    name: "Fix login bug · CRAFTER",
    toolMode: "full",              ← MCP 工具集（essential 或 full）
    mcpProfile: "kanban-planning", ← MCP 服务器配置方案
  }
}
~~~

返回：`{ result: { sessionId: "xxx" } }`

这一步做的事：
- 在 `http-session-store` 里注册一条会话记录
- 准备 MCP 配置（Agent 能用哪些工具）
- 加载 specialist 的提示词（人设）
- 还没启动 AI CLI 进程！

### session/prompt：真正启动 AI CLI 进程

~~~plaintext
dispatchSessionPrompt({
  sessionId: "xxx",
  prompt: [ { type: "text", text: "You are assigned to Kanban task: ..." } ],
  workspaceId: "default",
  provider: "claude",
  cwd: "/path/to/worktree",
})
~~~

这一步做的事：
- 拼出 specialist 的系统提示词（coordinator prompt）
- 查 `ProviderRegistry` 找到 provider 的工厂函数
- 调工厂创建 AI CLI 进程（Claude Code CLI / OpenCode CLI / …）
- 进程启动后，它的输出通过 **Provider Adapter** 归一化
- 归一化后的消息推入 `http-session-store`，通过 SSE 流给前端

## 4. Bridge 2：Provider Adapter —— 把方言翻译成普通话

**代码：** `src/core/acp/provider-adapter/`

### 4a. 问题：每个 AI CLI 说不同的话

~~~plaintext
Claude Code CLI：
  输出 stream-json 格式（自己的私有格式）
  tool_call 里立刻带 rawInput（参数随事件一起来）

OpenCode CLI：
  输出标准 ACP 格式
  tool_call 先来，rawInput 在后续的 tool_call_update 里才到（延迟到达）

Kimi / Gemini / Copilot / Codex / Kiro / Auggie：
  都走标准 ACP 格式，但细节各有不同
~~~

如果让系统的每个角落都处理这些差异，代码会爆炸。

### 4b. 解法：IProviderAdapter 接口 + NormalizedSessionUpdate

~~~plaintext
┌─────────────────────────────────────────────────────────┐
│                IProviderAdapter 接口                      │
│                                                          │
│  getBehavior()  → 这个 Provider 的行为特征                │
│    {                                                     │
│      type: "claude" | "opencode" | "kimi" | …,           │
│      immediateToolInput: true/false,  ← 参数是立刻来     │
│                                         还是延迟来？     │
│      streaming: true/false,           ← 是流式的吗？     │
│    }                                                     │
│                                                          │
│  normalize(sessionId, rawNotification)                   │
│    → NormalizedSessionUpdate | null                       │
│    把 Provider 的私有格式翻译成统一格式                   │
│                                                          │
│  handleDeferredInput?(toolCallId, update)                │
│    → 处理延迟到达的工具参数（OpenCode 等需要）            │
└─────────────────────────────────────────────────────────┘
~~~

### 4c. NormalizedSessionUpdate：统一的消息格式

不管原始消息来自 Claude 还是 OpenCode，翻译后都长这样：

~~~plaintext
NormalizedSessionUpdate {
  sessionId: "xxx",
  provider: "claude" | "opencode" | …,
  eventType:                            ← 7 种标准事件类型
    | "tool_call"          工具调用开始
    | "tool_call_update"   工具执行进度/完成
    | "agent_message"      Agent 说的话
    | "agent_thought"      Agent 的思考过程
    | "user_message"       用户输入
    | "plan_update"        执行计划更新
    | "turn_complete"      一轮结束
    | "error"              出错
  timestamp: Date,

  toolCall?: {              ← 统一的工具调用结构
    toolCallId, name, title,
    status: pending | running | completed | failed,
    input?: {...},
    output?: ...,
    inputFinalized: boolean,  ← 参数是否已经完整
  },
  message?: { role, content, isChunk },
  turnComplete?: { stopReason, usage },
  error?: { code, message },
}
~~~

### 4d. Adapter 家族：目前有 5 个

~~~plaintext
BaseProviderAdapter（抽象基类，提供公共工具方法）
   │
   ├── claude-adapter.ts         Claude Code：stream-json → 统一格式
   │     特点：immediateToolInput=true（参数随 tool_call 一起来）
   │
   ├── opencode-adapter.ts       OpenCode：标准 ACP → 统一格式
   │     特点：immediateToolInput=false（参数在 update 里才来）
   │
   ├── standard-acp-adapter.ts   Kimi / Gemini / Copilot / Codex / Kiro / Auggie
   │     走标准 ACP 协议的通用适配器
   │
   ├── docker-opencode-adapter.ts  Docker 容器内的 OpenCode
   │     通过 HTTP bridge 连接容器内的 CLI
   │
   └── trace-recorder.ts        追踪记录器（不是 Provider，是旁路记录）
~~~

### 4e. 类比：翻译社

~~~plaintext
                  ┌──── Claude Code CLI 说日语 ────┐
                  │                                │
用户/系统 ←─普通话─┤──── OpenCode CLI 说英语 ──────┤── 翻译社
(只看统一格式)     │                                │   (Provider
                  │──── Kimi CLI 说韩语 ──────────┤    Adapter)
                  │                                │
                  └──── Codex CLI 说法语 ─────────┘
~~~

**所有翻译在 Provider Adapter 里完成。出了这一层，系统的任何地方都只看到"普通话"（NormalizedSessionUpdate）。** UI 不关心是 Claude 还是 OpenCode，trace 不关心，编排器不关心。

## 5. Provider Registry：Provider 的花名册

**代码：** `src/core/acp/provider-registry.ts`

Provider Registry 管三件事。

### 5a. 谁能用？——工厂注册

~~~plaintext
ProviderRegistry（单例）
   registry: Map<providerId, ProviderFactory>

   register("claude", claudeFactory)
   register("opencode", opencodeFactory)
   register("claude-code-sdk", sdkFactory)
   …

   create("claude", config) → 启动一个 Claude Code CLI 进程
~~~

### 5b. 用什么型号？——Model Tier

每个 Provider 有三档模型：

~~~plaintext
PROVIDER_MODEL_TIERS = {
  claude:        { fast: "haiku-4.5",     balanced: "sonnet-4.5",    smart: "opus-4.6"   },
  claudeCodeSdk: { fast: "haiku-...",     balanced: "sonnet-...",    smart: "opus-4-5"   },
  opencode:      { fast: "fast",          balanced: "balanced",      smart: "smart"       },
}
~~~

- **fast**：速度快、便宜，用于简单任务
- **balanced**：性价比，默认
- **smart**：最强大脑，用于复杂任务

Specialist 可以指定 `modelTier`，系统根据 tier + provider 自动选模型。

### 5c. 复合模型 ID：`provider:model`

~~~plaintext
"claude:opus-4.6"   → provider=claude,  model=opus-4.6
"opus-4.6"          → provider=opencode, model=opus-4.6（默认 provider）
"sonnet-4.5"        → provider=opencode, model=sonnet-4.5
~~~

这个设计让 specialist 配置可以用一个字符串同时指定"用谁的"和"用哪个模型"。

## 6. A2A 路径：调远程 Agent

除了 ACP（本地 CLI 进程），agent-trigger 还支持 **A2A**（Agent-to-Agent）路径：

~~~plaintext
triggerA2ATaskAgent()
   │
   ▼
① step.agentCardUrl → 远程 Agent 的"名片"地址
   （例如：https://remote-agent.example.com/.well-known/agent.json）
   │
   ▼
② resolveA2AAuthConfig(authConfigId) → 解析认证头
   │
   ▼
③ client.sendMessage(agentCardUrl, prompt, metadata)
   → 把同一份 buildTaskPrompt() 的 prompt 发给远程 Agent
   │
   ▼
④ 后台 client.waitForCompletion() → 轮询等远程 Agent 完成
   → 完成后发 AGENT_COMPLETED / AGENT_FAILED 事件
   → 编排器（Orchestrator）正常接住这些事件
~~~

**ACP vs A2A 的区别**：

| | ACP | A2A |
|---|---|---|
| Agent 在哪跑 | 本地进程 | 远程服务 |
| 通信方式 | 本地 JSON-RPC + stdio/HTTP | 远程 HTTP |
| 控制粒度 | 完整（spawn/prompt/stream） | 只有 sendMessage + waitForCompletion |
| 输出监控 | 实时流式（SSE） | 轮询等最终结果 |

**但对 Orchestrator 来说，两条路径长得一样**：都返回 sessionId，都发 AGENT_COMPLETED/FAILED 事件。归一化在 agent-trigger 里就完成了。

## 7. 端到端串联：一张卡触发一个 Agent 的完整链路

~~~plaintext
Orchestrator 决定：cardId=abc 该进 dev 列了，配的是 Claude + CRAFTER
       │
       ▼
  startKanbanTaskSession()（上一篇第 4 节）
       │  准备 worktree、确定 provider/specialist/role、收集上下文
       ▼
  triggerAssignedTaskAgent()
       │
       ▼
  transport = "acp"（本地 CLI 进程）
       │
       ▼
  triggerAcpTaskAgent()
       │
       ├─① resolveKanbanAutomationProvider("claude")
       │     → "claude"（或 "claude-code-sdk"）
       │
       ├─② buildTaskPrompt(task, boardColumns, ...)
       │     → 拼出 ~200-500 行的结构化 prompt
       │       （包含 task 详情 + 所有门禁 + 历史经验 + 工具清单 + 指令）
       │
       ├─③ POST /api/acp  method: "session/new"
       │     → 创建空壳会话，拿到 sessionId
       │     → 加载 specialist 的 Markdown 人设
       │     → 准备 MCP 工具集
       │
       ├─④ 返回 sessionId 给 Orchestrator
       │     → Orchestrator 把 sessionId 挂到 task.triggerSessionId
       │     → 记入泳道历史
       │
       └─⑤ 异步调 dispatchSessionPrompt()
             │
             ├─ 拼接 specialist 的系统 prompt（coordinator prompt）
             ├─ 查 ProviderRegistry 找到 claude 的工厂
             ├─ 工厂启动 Claude Code CLI 进程
             │     （传入 cwd、branch、model、MCP 配置…）
             │
             └─ CLI 进程开始工作，输出流经 Provider Adapter：
                   │
                   ▼
                claude-adapter.normalize()
                   │
                   ▼
                NormalizedSessionUpdate
                   │
                   ├─→ http-session-store（存状态）
                   ├─→ SSE → 前端（你看到 Agent 在干什么）
                   ├─→ trace（审计记录）
                   └─→ EventBus → Orchestrator（生命周期事件）
                         │
                         └─ AGENT_COMPLETED / AGENT_FAILED / AGENT_TIMEOUT
                              → 回到上一篇的"完成后处理"流程
~~~

## 8. 源码导航表

| 环节 | 文件 | 一句话 |
|---|---|---|
| Prompt 拼装 | `src/core/kanban/agent-trigger.ts` `buildTaskPrompt()` | 把 task 上下文拼成结构化 prompt |
| Provider 选择 | `agent-trigger.ts` `resolveKanbanAutomationProvider()` | 确定用哪个 AI CLI |
| ACP 触发 | `agent-trigger.ts` `triggerAcpTaskAgent()` | session/new + session/prompt |
| A2A 触发 | `agent-trigger.ts` `triggerA2ATaskAgent()` | 远程 Agent 调用 |
| 总入口 | `agent-trigger.ts` `triggerAssignedTaskAgent()` | 根据 transport 分叉 ACP/A2A |
| 会话 Prompt 派发 | `src/core/acp/session-prompt.ts` | 接收 prompt，启动 CLI 进程 |
| Provider 注册表 | `src/core/acp/provider-registry.ts` | Provider 发现 + 工厂 + 模型层级 |
| Provider 适配接口 | `src/core/acp/provider-adapter/types.ts` | IProviderAdapter + NormalizedSessionUpdate |
| 适配基类 | `provider-adapter/base-adapter.ts` | 公共工具方法 |
| Claude 适配器 | `provider-adapter/claude-adapter.ts` | stream-json → 统一格式 |
| OpenCode 适配器 | `provider-adapter/opencode-adapter.ts` | 标准 ACP + 延迟 input → 统一格式 |
| 标准适配器 | `provider-adapter/standard-acp-adapter.ts` | Kimi/Gemini/Copilot/Codex/Kiro/Auggie |
| Docker 适配器 | `provider-adapter/docker-opencode-adapter.ts` | 容器内 OpenCode |
| Specialist 加载 | `src/core/specialists/` | Markdown+YAML 人设文件加载（ADR-0005）|
| ACP 进程管理 | `src/core/acp/acp-process-manager.ts` | CLI 进程的生命周期管理 |
| 会话状态存储 | `src/core/acp/http-session-store.ts` | 会话状态 + SSE 推送 + 活动监测 |
| MCP 配置生成 | `src/core/acp/mcp-config-generator.ts` | 给 Agent 准备 MCP 工具集 |

## 9. 三个设计洞察

### 洞察 1：Prompt 就是"工单"，不是"聊天"

`buildTaskPrompt()` 拼出的不是一句自然语言请求，而是一份结构化的**工单**——
包含 Context / Task Details / Objective / Gates / Evidence / Memory / Tools / Instructions 等
完整章节。这份工单让 Agent 像收到一份工程规格书一样开始工作，而不是靠"猜"用户想要什么。

**而且工单内容因泳道而异**：backlog 列的工单禁止写代码（只做规划），
dev 列的工单有安全验证规则，review 列的工单有 handoff 指令。
prompt 本身就是 Agent 的行为约束边界。

### 洞察 2：两步调用（session/new + session/prompt）是刻意的解耦

为什么不合成一步？因为：
- `session/new` 是同步的、轻量的：创建会话记录，拿到 sessionId，
  Orchestrator 可以立刻把 sessionId 挂到 task 上。
- `session/prompt` 是异步的、重量级的：启动真实的 AI CLI 进程，
  prompt 可能很大（几百行），进程启动可能很慢（Docker 拉镜像）。
- 如果合成一步，session/new 的超时可能导致 Orchestrator 拿不到 sessionId，
  task 状态就乱了。

### 洞察 3：Provider Adapter 是 Routa 能支持多 Provider 的关键

没有 Provider Adapter，每加一个新的 AI CLI 就要改系统的几十个地方。
有了它，加新 Provider = **只写一个 adapter 文件**（实现 `normalize()` 方法），
系统的其余部分（UI、trace、编排器、门禁…）完全不用动。
这就是 ADR-0002 决策的核心价值。

## 延伸阅读

- [ADR-0002: Provider Normalization via ACP](../adr/0002-provider-normalization-via-acp.md) ——
  "为什么所有 Provider 都归一化到 ACP"的架构决策
- [ADR-0005: Specialist Externalization](../adr/0005-specialist-externalization.md) ——
  角色人设为什么是外部 Markdown+YAML 文件
- [Kanban 自动化深潜](kanban-automation-deep-dive.zh-CN.md) —— 本文的前置
- [系统骨架导览](routa-architecture-tour.zh-CN.md) —— 全景地图

## 后续可深入的方向

| 方向 | 关键入口 | 问题 |
|---|---|---|
| Specialist 人设体系 | `src/core/specialists/` + ADR-0005 | CRAFTER/GATE 的 Markdown 人设怎么加载、怎么切语言 |
| MCP 工具集 | `mcp-config-generator.ts` + `mcp-setup.ts` | Agent 能用哪些工具、不同 mcpProfile 有什么区别 |
| 泳道经验记忆 | `task-lane-experience.ts` | 跨任务历史怎么注入新会话——Routa 比普通看板"聪明"的地方 |
| 进程管理 | `acp-process-manager.ts` | CLI 进程的启动/停止/重启/超时/Docker |
