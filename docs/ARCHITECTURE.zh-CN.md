---
status: canonical
purpose: Routa.js 运行时边界、领域模型、协议栈与跨后端不变量的权威架构概览。
principles:
  - 以工作区为先的作用域，优于隐藏的全局状态
  - Next.js 与 Rust 之间的双后端语义对等
  - 面向协议的编排，优于针对特定 Provider 的耦合
  - 面向桌面端与开发流程的本地优先执行
  - 持久的系统边界，优于逐端点的重复实现
update_policy:
  - 让本文件聚焦于稳定的架构与不变量。
  - 将路由与端点清单放入 docs/product-specs/FEATURE_TREE.md。
  - 将设计意图与演进理由放入 docs/design-docs/。
---

# Routa.js 架构

Routa.js 是一个以工作区为先的多 Agent 协调平台，拥有两个运行时表面：

- Web 端：位于 `src/` 的 Next.js 应用与 API
- 桌面端：位于 `apps/desktop/` 的 Tauri 应用，由 `crates/routa-server/` 中的 Axum 提供支撑

本项目有意不做成「两个独立的产品」。Web 端与桌面端在部署模型和存储上存在差异，但它们应当保持相同的领域语义、API 形态以及 Agent 协调行为。

## 核心原则

- 工作区为先：工作区是会话、任务、笔记、看板、代码库、worktree 与记忆的顶层协调边界。
- 双后端对等：Next.js 与 Rust 暴露相同的产品概念，并应与 `api-contract.yaml` 保持一致。
- 面向协议的编排：REST、MCP、ACP、A2A、AG-UI 与 SSE 都是一等集成表面。
- 本地优先执行：桌面端模式倾向于使用 SQLite、本地 Agent 二进制文件、本地 worktree 与 Trace 文件。
- Provider 抽象：不同的 Agent CLI 与运行时被规范化到适配层之后，而不是让针对特定 Provider 的协议细节泄漏到整个系统中。

## 仓库结构

| 区域 | 用途 |
|---|---|
| `src/app/` | Next.js App Router 页面与 API 路由 |
| `src/client/` | 客户端组件、Hooks、视图模型、A2UI 辅助工具 |
| `src/core/` | TypeScript 领域逻辑：存储、ACP/MCP、看板自动化、工作流、笔记、工具 |
| `apps/desktop/` | Tauri 外壳与桌面端打包 |
| `crates/routa-core/` | 共享的 Rust 领域/运行时基础：存储、ACP 管理器、沙箱、技能、事件 |
| `crates/routa-server/` | 面向桌面端/本地服务器模式的 Axum HTTP API |
| `crates/routa-cli/` | CLI 入口与 ACP 服务命令 |
| `crates/routa-rpc/` | RPC 契约辅助工具 |
| `crates/routa-scanner/` | 代码库扫描工具 |
| `docs/` | 持久的架构、设计意图、计划、适应度指南 |

## 运行时拓扑

### Web 端运行时

- Next.js 在 `src/app/` 下提供页面服务。
- `src/app/api/` 中的 API 处理器使用来自 `src/core/routa-system.ts` 的 TypeScript `RoutaSystem`。
- `RoutaSystem` 按环境选择存储：
  - `DATABASE_URL` -> 基于 Postgres 的存储
  - `ROUTA_DB_DRIVER=sqlite` 或本地 Node 运行时 -> 基于 SQLite 的存储
  - 回退 -> 内存存储
- 实时更新主要通过 SSE 端点与进程内事件广播来传递。

### 桌面端运行时

- Tauri 托管 UI，并从 `crates/routa-server/src/lib.rs` 启动内嵌的 Axum 服务器。
- 共享应用状态在 `crates/routa-core/src/state.rs` 中构建。
- Rust 后端负责本地 SQLite 持久化、ACP 运行时管理、Docker 辅助的 Agent 执行、沙箱管理以及本地文件/worktree 操作。
- Tauri 静态导出占位符是一个路由实现细节，并不属于领域模型的一部分。

## 共享架构模型

两个运行时遵循相同的分层结构，尽管具体实现有所不同：

```text
Presentation
  React pages, workspace views, session detail, kanban, settings, traces

API / Transport
  Next.js route handlers or Axum routers

Protocol Adapters
  REST, MCP, ACP, A2A, AG-UI, SSE, JSON-RPC normalization

Domain Services
  orchestration, kanban automation, workflow execution, notes, review, scheduling,
  trace, harness, shared sessions, worker dispatch

Stores / Registries
  workspace, task, session, note, codebase, worktree, schedule, artifact, skill

Persistence / Runtime
  Postgres, SQLite, in-memory, JSONL traces, local processes, Docker, filesystem
```

依赖方向应保持向下。UI 层与传输层依赖领域服务；存储层与运行时层不应依赖 UI 相关的关注点。

## 主要领域边界

### 工作区

工作区是首要的用户可见作用域。用户先按工作区导航，然后在该作用域内检视会话、看板、笔记、任务、代码库或记忆。

当前权威背景：
- [workspace-centric-redesign.md](./design-docs/workspace-centric-redesign.md)

重要不变量：
- 新的产品表面应当要求显式的工作区上下文，除非它们是有意为之的引导（bootstrap）流程。

### 代码库与 Worktree

- 一个工作区可以拥有多个代码库。
- 代码库为仓库身份及元数据建模，例如路径、分支、标签与默认状态。
- Worktree 是与工作区和代码库绑定的临时或半持久执行副本。
- 文件搜索、沙箱解析与仓库选择应当流经代码库/worktree 上下文，而不是依赖隐藏的全局仓库状态。

### 会话

- 会话表示一个实时或历史的 Agent 执行线程。
- 会话以工作区为作用域，并驱动会话详情页、Trace 视图与自动化状态。
- 会话历史可能存储在数据库行和/或 JSONL Trace 中，具体取决于运行时。
- ACP 是 Agent CLI 的主要执行传输方式，但某些 Provider 需要适配器进行转换。

### 任务与看板

- 任务是持久的工作单元。
- 看板不仅是一种 UI 投影；它还驱动基于泳道的自动化与排队。
- 列（column）的迁移可以触发全新的 ACP 会话，并以 Provider/角色/会话元数据丰富任务。
- `src/core/kanban/kanban-session-queue.ts` 中的 TypeScript 队列强制实施每个看板的并发约束，并防止陈旧的自动运行条目被错误地重新触发。

### 后台任务与工作流

- 后台任务为持久的异步工作建模，例如定时运行、轮询触发的动作或工作流扇出。
- 工作流将更高层级的自动化定义转换为多个具有依赖顺序的后台任务。
- 调度 tick、Webhook 事件与轮询适配器都可以将后台任务入队，而不是内联调用执行。

### Trace 与评审

- Trace 记录会话生命周期、消息、工具调用、文件变更以及用于审计和调试的 VCS 上下文（`src/core/trace/`、`crates/routa-core/src/trace/`）。
- Trace 数据是一等的调试与归因机制，而非附带的日志流。
- 评审（Review）提供多阶段代码评审，包含发现项、严重程度与验证上下文（`src/core/review/`）。

### Harness 与 Worker

- Harness 检测仓库信号、脚本入口与规范来源，以驱动治理与质量分析（`src/core/harness/`）。
- `crates/harness-monitor` 被记录为一个四层 Harness 循环 `Context -> Run -> Observe -> Govern`；稳定记录仍为 `Task / Run / Workspace / EvalSnapshot / PolicyDecision / Evidence`，CLI/TUI 仍消费同一条共享的运行评估路径。
- Worker 抽象本地与基于 Docker 的执行环境（`src/core/worker/`）。
- Rust 中的沙箱策略解析强制实施工作区感知的 Docker 约束（`crates/routa-core/src/sandbox/`）。

### 笔记、记忆与制品（Artifact）

- 笔记支持协作式知识捕获，并在 TypeScript 侧使用基于 CRDT 的实时行为。
- 运行时/进程内存监控是一个位于 `/api/system/memory` 的系统 API；`/api/memory` 仅作为该诊断表面的一个已废弃兼容别名保留。
- 工作区交付记忆是一个用于存放有证据支撑的上下文记录的产品领域，在相应层级实现后，必须使用显式的产品表面，例如 `/api/workspace-memory`、`/api/agent-memory` 或 `/api/memory-pack`。
- 制品是在 Agent、工作流或协调工具之间交换的结构化输出。
- 共享会话支持多用户或多 Agent 协调，具备事件广播与提示词分发能力（`src/core/shared-session/`）。

## 系统工厂与共享状态

### TypeScript `RoutaSystem`

`src/core/routa-system.ts` 是 Next.js 运行时的中心装配点。它接线了：

- 用于 Agent、会话、任务、笔记、工作区、代码库、worktree、调度、看板、后台任务、工作流运行与制品的存储
- 用于进程内协调的 `EventBus`
- 面向 MCP 的工具表面，例如 `AgentTools`、`NoteTools` 与 `WorkspaceTools`
- 笔记广播与 CRDT 文档管理
- 用于运行时权限委派流程的权限存储

该文件相当于 TypeScript 版本的服务容器。新的领域服务通常应在此处引入，而不是在路由处理器内部临时实例化。

### Rust `AppState`

`crates/routa-core/src/state.rs` 对 Axum 服务器扮演相同的角色。它接线了：

- 核心存储，包括工作区、代码库、worktree、任务、笔记、看板、会话、制品、调度与 ACP 会话存储
- `AcpManager`、二进制/运行时/预热（warmup）管理器以及 ACP 路径解析
- `SkillRegistry`
- `EventBus`
- `SandboxManager`
- Docker 检测与进程管理

这使桌面端/服务器执行保持本地优先，同时保留与 Web 端运行时相同的领域词汇。

## 协议栈

| 协议 | 主要端点 | 角色 |
|---|---|---|
| REST | `/api/*` | CRUD 与面向产品的操作 |
| MCP | `/api/mcp`、`/api/mcp/tools` | 工具执行与协作式 Agent 能力 |
| ACP | `/api/acp` 及相关运行时/注册表/Docker 路由 | 派生、提示、流式、安装、预热以及管理 Agent 运行时 |
| A2A | `/api/a2a/*` | Agent 间互操作 |
| AG-UI | `/api/ag-ui` | 面向 UI 的 Agent 流协议 |
| A2UI | `/api/a2ui/*` | 面向仪表盘的 UI 协议表面 |
| SSE | ACP、笔记、AG-UI 及相关端点 | 向前端推送增量更新 |

产品表面经常变化。关于端点清单，请使用 [docs/product-specs/FEATURE_TREE.md](./product-specs/FEATURE_TREE.md)，而不是把本文档扩展成 API 目录。

## ACP 与 Provider 架构

ACP 是编码类 Agent 的主要执行协议，但各个 Provider 的行为并不完全一致。

规范化模式为：

```text
Provider process or bridge
  -> provider-specific output / notifications
  -> adapter normalization
  -> unified session updates
  -> persistence, traces, and UI streaming
```

当前的 Provider/运行时关注点包括：

- 标准的兼容 ACP 的 CLI
- 必须被翻译为类 ACP 更新的 Claude Code 风格 stream-json 流
- 基于 Docker 的 OpenCode 执行路径
- 运行时安装、预热与注册表发现

Rust 的 ACP 子系统位于 `crates/routa-core/src/acp/` 下，而 Web 端运行时将对应的进程与路由逻辑保留在 `src/core/acp/` 与 `src/app/api/acp/` 下。

## 实时与事件机制

存在两种主要的实时机制：

- 传输层流式：主要使用 SSE 进行会话、笔记与协议更新
- 进程内事件机制：TypeScript 与 Rust 两个运行时中的 `EventBus`

它们支持：

- Agent 生命周期跟踪
- 看板自动运行队列的排空
- 笔记变更传播
- 工作流与后台任务的协调
- 会话与 Trace 表面的 UI 刷新触发

## 持久化模型

### Web 端

- 当配置了 `DATABASE_URL` 时，主要的持久化目标是 Postgres。
- 本地 Node 开发支持 SQLite。
- 内存模式仍可用于测试与轻量级运行时场景。

### 桌面端

- SQLite 是常规的持久化存储。
- 文件系统状态也是持久化的一部分：会话 JSONL Trace、仓库、worktree、Agent 二进制文件与本地配置。

### Trace 与历史

- 会话与 Trace 历史可能存储在数据库记录、JSONL 文件或两者中，具体取决于运行时。
- Trace 数据是一等的调试与归因机制，而非附带的日志流。

## Rust API 表面

`crates/routa-server/src/api/mod.rs` 中的 Axum 路由器展示了桌面端/服务器后端的广度。除核心的工作区/会话/任务 API 之外，它还包括：

- ACP 注册表、运行时与 Docker 路由
- 看板与 worktree 路由
- MCP 服务器管理
- 克隆、文件以及 GitHub 导入/搜索辅助工具
- 调度、轮询、Webhook、工作流与后台任务
- 沙箱与评审端点

这种广度是有意为之的：桌面端后端不是一个轻薄的传输垫片，而是一个完整的本地协调运行时。

## 当前过渡区域

仓库仍在完成以工作区为中心的规范化。其持久状态记录在 [docs/design-docs/workspace-centric-redesign.md](./design-docs/workspace-centric-redesign.md) 中，但关键的架构注意事项是：

- 当省略工作区作用域时，某些路径仍会回退到 `"default"`
- 某些引导/运行时流程仍假定存在一个默认工作区
- 并非每个基于持久化的实现在 TypeScript 与 Rust 之间都已完全对称
- 即使其他存储已是持久化的，某些工作流运行持久化仍保留在内存中

请将 `"default"` 视为过渡性脚手架，而非目标领域模型。

## 架构决策记录

`docs/adr/` 目录记录了塑造整个代码库边界、协议与模式的持久架构决策。ADR 是「为什么这样构建？」的权威答案。

可通过以下方式发现决策：`claude -p "What ADRs exist and what do they decide?"`

当前 ADR：

| ADR | 决策 |
|---|---|
| [0001](./adr/0001-dual-backend-semantic-parity.md) | Web 端与桌面端通过 api-contract.yaml 共享领域语义 |
| [0002](./adr/0002-provider-normalization-via-acp.md) | 所有 Agent 运行时通过适配层规范化为 ACP |
| [0003](./adr/0003-workspace-first-scope.md) | 工作区是顶层协调边界 |
| [0004](./adr/0004-kanban-driven-automation.md) | 看板泳道触发带排队并发的 ACP 会话 |
| [0005](./adr/0005-specialist-externalization.md) | 专家（Specialist）以 Markdown+YAML 形式存在并按优先级加载 |
| [0006](./adr/0006-orchestration-shell-pattern.md) | 复杂文件采用薄外壳 + 领域 Hooks 结构 |

## 相关文档

- 产品/API 索引：[docs/product-specs/FEATURE_TREE.md](./product-specs/FEATURE_TREE.md)
- 架构决策：[docs/adr/](./adr/)
- 设计意图：[docs/design-docs/](./design-docs/)
- 编码风格：[docs/coding-style.md](./coding-style)
- 仓库运行契约：`AGENTS.md`（仓库根目录）
- [MCP Spec](https://modelcontextprotocol.io/) · [ACP Spec](https://github.com/agentclientprotocol/typescript-sdk) · [A2A Spec](https://a2aprotocol.ai/)
