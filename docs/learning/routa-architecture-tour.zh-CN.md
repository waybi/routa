---
title: Routa 系统骨架：一张地图看懂
---

# Routa 系统骨架：一张地图看懂

> 面向第一次接触 Routa 的人（或 AI agent）的架构导览。讲法刻意「场景先行、名词最后」：
> 先看三种干活姿势，再认三个角色，然后一张全景骨架图、一条端到端动线，最后给出往下钻的入口。
>
> 本文是**导览**，不是规范来源。事实以 [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) 与
> [`docs/adr/`](../adr/README.md) 为准；如有冲突，以它们为准。

## 0. 一句话抓住本质

Routa 是一个**多 Agent 协调平台**——你不是自己写代码，而是指挥一群 AI Agent 帮你写。
它的全部设计都在回答一个问题：

> **一群 AI 干活时，怎么组织、怎么监督、怎么验收？**

首页的标题就是它的灵魂：**「你要进入哪种执行模式？」**
三种模式都支持多 Agent；区别不在能力等级，而在于**编排从哪里开始**——单会话、看板泳道，
还是 Team lead 的委派树。整个系统就是围绕这「三种编排起点」长出来的。

## 1. 场景先行：三种模式 = 三种「带 AI 干活」的姿势

### ① Sessions ——「一个人聊，按需喊人」

- **场景**：我就想开个对话，让 AI 帮我改点东西、探索一下。
- **机制**：ROUTA 先起手；需要时才拉 CRAFTER（执行）、GATE（把关），动态扩展协作。
- **特点**：最省 token，不预先铺开编排图。
- **入口**：`/workspace/<id>/sessions`

### ② Kanban ——「流水线，卡片过关」

- **场景**：一堆任务要围绕 backlog → todo → dev → review → done 持续推进。
- **机制**：卡片进泳道自动触发 agent；GATE 在 review/done 用 transition gate 把关。
- **特点**：有阶段、有责任边界、有验收门禁。
- **入口**：`/workspace/<id>/kanban`

### ③ Team ——「包工头带队，分波次派活」

- **场景**：复杂任务，需要多个专家协同、分工执行、集中观察团队运行。
- **机制**：`team-agent-lead` 起手，按「波次（wave）」派生真实子会话，汇总验收。
- **特点**：委派树可见，协作 / 分工 / 回收都摊开给你看。
- **入口**：`/workspace/<id>/team`

> **关键洞察**：三种模式的「能力」是一样的（都是多 Agent），差别只是
> **谁来发起编排、编排图什么时候展开**：
>
> | 模式 | 编排展开方式 |
> |---|---|
> | Sessions | **懒展开** —— 用到才拉人 |
> | Kanban | **按泳道触发** —— 卡片位置决定谁干活 |
> | Team | **主动铺开** —— lead 先规划再派活 |

## 2. 三个反复出现的名字：ROUTA / CRAFTER / GATE

界面和代码里反复出现三个大写名字，这是 Routa 的「工种」抽象：

| 角色 | 大白话 | 职责 |
|---|---|---|
| **ROUTA** | 调度者 / 项目经理 | 起手、理解意图、决定要拉谁进来 |
| **CRAFTER** | 干活的工匠 | 真正写代码、执行任务 |
| **GATE** | 质检员 | 在 review/done 关卡把关，决定能不能放行 |
| **team-agent-lead** | 包工头 | Team 模式专属：分波次派活 + 汇总 |

这些角色在代码里叫 **specialist（专家）**，是外部化的 Markdown + YAML 文件
（[ADR-0005](../adr/0005-specialist-externalization.md)，加载逻辑见 `src/core/specialists/`）。
也就是说，角色的「人设 / 提示词」是可配置的文件，不是硬编码——这就是它能灵活换阵容的原因。

## 3. 全景骨架图：从你点的地方，一路到最底层

把界面上能点到的东西，和背后的层次全串起来：

~~~plaintext
┌─ 表现层 Presentation（你眼睛看到的）─────────────────────────────
│  主页(选模式) · 会话 · 看板 · 团队 · 规格 · 特性浏览 · Harness · 设置
│
│  Web     = Next.js 路由 + React 页面（src/app/），
│            全部挂在「工作区」URL 下：/workspace/default/…
│  Desktop = 同一套界面装进 Tauri 桌面壳（apps/desktop/，内嵌 Rust/Axum 服务器）
└───────────────┬─────────────────────────────────────────────────
                ▼
┌─ API / 传输层（两套后端，同一套语义 —— 核心设计约束）────────────
│  src/app/api/*  ══ 语义对等（api-contract.yaml，ADR-0001）══  crates/routa-server
└───────────────┬─────────────────────────────────────────────────
                ▼
┌─ 协议适配层（把「跟 Agent 说话」的各种方言统一化）───────────────
│  REST · MCP · ACP · A2A · AG-UI · SSE
│  └─ ACP 是主力：spawn / prompt / stream 一个真实的 AI CLI 进程
│     （src/core/acp/，ADR-0002）
└───────────────┬─────────────────────────────────────────────────
                ▼
┌─ 领域服务层（真正的「业务大脑」）────────────────────────────────
│  orchestration 编排 · kanban automation 泳道自动化 · workflows 工作流
│  review 评审 · trace 追踪 · scheduling 调度 · shared-session 共享会话 …
│
│  TS   = RoutaSystem（src/core/routa-system.ts）＝ 服务容器，组装一切
│  Rust = AppState（crates/routa-core/src/state.rs）＝ 同角色的服务容器
└───────────────┬─────────────────────────────────────────────────
                ▼
┌─ 存储 / 注册表层（领域名词的落地）───────────────────────────────
│  workspace · task · session · note · codebase · worktree · schedule
│  kanban board · background-task · workflow-run · artifact · skill
└───────────────┬─────────────────────────────────────────────────
                ▼
┌─ 持久化 / 运行时层 ──────────────────────────────────────────────
│  Web: Postgres / SQLite / 内存回退     Desktop: SQLite + 本地文件系统
│  JSONL 追踪文件 · 本地进程 · Docker 沙箱 · git worktree
└──────────────────────────────────────────────────────────────────
~~~

这张图的三个「看懂就懂 Routa」要点：

1. **依赖方向永远向下**：UI 依赖领域服务；存储 / 运行时不许反过来依赖 UI。
2. **左右两根柱子是镜像**：Web 的 `RoutaSystem` 和 Desktop 的 `AppState` 用同样的领域名词、
   两套实现。这就是「dual-backend semantic parity（双后端语义对等）」
   （[ADR-0001](../adr/0001-dual-backend-semantic-parity.md)）——不是两个产品，是一个产品两个跑法。
3. **协议适配层是 Routa 跟别的 AI 工具最不一样的地方**：它不绑死某个 AI CLI，而是把
   Claude Code、OpenCode、Kimi 等统统协议化到 ACP
   （[ADR-0002](../adr/0002-provider-normalization-via-acp.md)）。
   首页「配置 Provider」清单列出的就是这些 Provider。

## 4. 最高频的骨架名词：Workspace（工作区）

URL 全是 `/workspace/default/…`，左上角常驻「Default Workspace」切换按钮——因为
**Workspace 是 Routa 一切的容器**，架构原则第一条就是 Workspace-first
（[ADR-0003](../adr/0003-workspace-first-scope.md)）。一个工作区里装着：

~~~plaintext
Workspace（工作区）
├─ sessions        会话（跟 Agent 的执行线程）
├─ tasks           任务（看板上的卡片）
├─ kanban boards   看板（泳道 + 列自动化）
├─ codebases       代码库（可以有多个）
├─ worktrees       工作树（给 Agent 干活用的临时代码副本）
├─ notes           笔记（CRDT 实时协作）
├─ memories        记忆
└─ traces          追踪记录（审计 / 调试用）
~~~

**为什么这很重要**：传统工具容易有「隐藏的全局状态」（比如当前打开的是哪个 repo）。
Routa 强制一切都挂在工作区下，不许藏；这样多 Agent 并行时才不会互相踩。

## 5. 一次完整的「干活」怎么流动（动态视角）

静态骨架之外，再看一条「血液怎么流」的动线。以 Kanban 模式为例（最能体现系统全貌）：

~~~plaintext
你把卡片从 Todo 拖到 Dev
   │
   ▼
① 看板检测到列变化，触发 lane automation（泳道自动化）
   （并发控制：src/core/kanban/kanban-session-queue.ts，防止乱触发）
   │
   ▼
② 领域层查这一列配了什么：哪个 Provider、哪个 specialist（CRAFTER？）
   │
   ▼
③ 通过 ACP 协议 spawn 一个真实的 AI CLI 进程去干活
   │
   ▼
④ Agent 的输出 → 适配器归一化 → 变成统一的 session update
   ├─→ 存进 trace（JSONL / DB），留审计证据
   └─→ 通过 SSE 实时推给浏览器，你能看到它在干什么
   │
   ▼
⑤ 卡片想进 Review / Done？先过 transition gate（转换门禁）：
   · 有没有测试结果 / 截图 / 代码 diff？（requiredArtifacts）
   · 有没有 commit、干净工作树、PR-ready？（deliveryRules）
   · 要不要人类点「APPROVED」？（requiredHumanApproval）
   —— GATE 角色在这里把关，不满足就拦住（gateMode: blocking）
   │
   ▼
⑥ 全过了 → 卡片进 Done，任务状态变 COMPLETED
~~~

这条动线把前面所有层都串起来了：
**表现层（拖卡）→ 领域层（泳道自动化）→ 协议层（ACP spawn）→ 运行时（真实进程）→
存储（trace）→ 实时（SSE 回推）→ 门禁（GATE 验收）**。

Sessions 模式和 Team 模式走的是**同一条血管**，只是触发点不同：
Sessions 是你在输入框发话触发，Team 是 lead 分波次触发。

## 6. 想深入？六个可以顺着骨架往下钻的方向

| 方向 | 入口 | 适合搞懂什么 |
|---|---|---|
| A. 编排核心 | `src/core/routa-system.ts` | 服务容器怎么组装一切 |
| B. Kanban 自动化 | `src/core/kanban/`、`src/core/models/kanban.ts` | 泳道怎么触发 Agent、门禁怎么拦（[ADR-0004](../adr/0004-kanban-driven-automation.md)、[ADR-0007](../adr/0007-kanban-delivery-transition-policies.md)） |
| C. ACP / Provider 归一 | `src/core/acp/` | 不同 AI CLI 怎么被统一成一种协议（[ADR-0002](../adr/0002-provider-normalization-via-acp.md)） |
| D. 双后端对等 | 对比 `src/core/routa-system.ts` 与 `crates/routa-core/src/state.rs` | Web 和桌面怎么保持一致、哪里还没对齐（[ADR-0001](../adr/0001-dual-backend-semantic-parity.md)） |
| E. Trace / Review | `src/core/trace/`、`src/core/review/` | Agent 干的活怎么被审计和评审 |
| F. Team 波次编排 | `src/core/orchestration/orchestrator.ts`、`src/core/specialists/` | 包工头怎么分波次派活、怎么汇总 |

## 30 秒记忆版

> Routa = 在一个**工作区（Workspace）**里，用**三种编排起点**（Sessions / Kanban / Team），
> 指挥**三种角色**（ROUTA / CRAFTER / GATE）的 AI Agent，通过**统一协议**（以 ACP 为主）干活；
> 所有过程被 **trace** 记录、被**门禁（gate）**验收、经 **SSE** 实时回传；
> 并且这套东西在 **Web（Next.js）和桌面（Rust）上语义完全对等**。

## 延伸阅读

- [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) —— 架构边界、领域模型、协议栈的权威描述
- [`docs/adr/README.md`](../adr/README.md) —— 各架构决策的「为什么」
- [`docs/operational/kanban-transition-gates.zh-CN.md`](../operational/kanban-transition-gates.zh-CN.md) —— 转换门禁字段与语义详解

## 附：本文的讲解配方（想给别的模块写同款导览时照抄）

1. **场景先行，名词最后**：先讲「你会怎么用它」，再给概念起名字。
2. **一句话本质**开头，**30 秒记忆版**收尾，中间才是细节。
3. **一张全景图**把「界面上能点到的」与「代码里的层次」串起来，依赖方向画清楚。
4. **一条端到端动线**（动态视角）验证静态骨架是不是真的通。
5. 每个断言**落到真实代码路径 / ADR**，可被人和 agent 核验；导览与规范分离，冲突以规范为准。
