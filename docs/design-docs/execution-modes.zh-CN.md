---
title: 执行模式
---

# 执行模式

关于 Routa 三种主要执行模式在行为、编排边界与交付模型上有何差异的持久化设计说明。

本文档刻意以代码为依据。它描述的是仓库当前已实现的内容，而非一个理想化的产品愿景。

## 目的

Routa 提供三种一等公民的执行模式：

- Sessions（会话）
- Kanban（看板）
- Team（团队）

这三者都是以 Agent 为先的入口界面。它们的区别不是「简单 vs 高级」，真正的区别在于编排从哪里开始：

- Sessions：从一个可恢复的对话线程开始
- Kanban：从工作流状态与泳道自动化开始
- Team：从一个负责协调的 lead 开始，由它派发真实的子会话

## 模式对照表

| 模式 | 主要单元 | 入口形态 | 多 Agent 边界 | 质量控制形态 | 最佳适用场景 |
|---|---|---|---|---|---|
| Sessions | 一个会话线程 | 直接启动器 | 需要时 ROUTA 可在会话内部委派 | 灵活、针对具体任务、未预先绑定到泳道策略 | 通用实现、探索、恢复 |
| Kanban | 泳道中的一张任务卡 | 看板 + 泳道流转 | 泳道自动化根据卡片移动创建会话 | 服务端强制产物、契约规则、交付门禁 | 交付流水线、可重复执行、可见的流程控制 |
| Team | 一次由团队 lead 主导的运行 | 共享团队启动器 | 团队 lead 分波次派发真实子会话 | 在 lead 层强制委派 + 验证文化 | 跨多专业、多代码区域的复杂工作 |

## Sessions 模式

### 代码做了什么

- Sessions 启动器使用 `HomeInput` 并设置 `defaultAgentRole: "ROUTA"`，同时仍允许切换角色并自定义专家。这意味着默认入口是 ROUTA，但该模式并未硬锁定为单一角色。参见 `src/app/workspace/[workspaceId]/sessions/sessions-page-client.tsx` 与 `src/client/components/home-input.tsx`。
- `HomeInput` 会先精确地创建一个会话，然后为该会话发送或存储提示词。它不会预先创建固定的工作者图谱。参见 `src/client/components/home-input.tsx`。
- 在一个会话内部，内置的角色选择器仍然暴露 `CRAFTER`、`ROUTA`、`GATE` 与 `DEVELOPER`。参见 `src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx`。
- ROUTA 专家明确仅作为协调者：它将实现委派给 CRAFTER、将验证委派给 GATE，而不是自己编辑代码。参见 `docs/specialists/core/routa.md`。
- 会话详情 UI 会在父 ROUTA 会话下恢复子 CRAFTER 会话，并在 crafter 面板中将其可视化。参见 `src/app/workspace/[workspaceId]/sessions/[sessionId]/use-session-crafters.ts`。

### 产品含义

Sessions 是默认的通用模式。

重要的细微之处在于，Sessions 不是「纯聊天」。它是一个带可选编排的单会话入口界面。运行从一个可恢复的线程开始，只有在任务确实需要时，ROUTA 才会派生专家工作。

这使得 Sessions 成为摩擦最低的多 Agent 入口：

- 一个可在之后恢复的主线程
- 无需预先满足泳道策略
- 无需强制的团队波次管理
- 无需预先承诺的工作流图谱

由于它不会在前期加载看板自动化或团队名册，它通常是以 Agent 为先的启动模式中最节省 token 的一种。

### 文案指引

将 Sessions 描述为：

- 默认模式
- 单会话优先
- 默认 ROUTA 优先
- 仅在需要时引入 CRAFTER/GATE 的能力

不要将 Sessions 描述为：

- 纯单 Agent 聊天
- 固定的 ROUTA -> CRAFTER -> GATE 流水线

## Kanban 模式

### 代码做了什么

- Kanban 是一个主动的自动化界面，而不仅仅是看板视图。列的流转会发出可触发会话的工作流事件。参见 ADR 0004 与 `src/core/kanban/workflow-orchestrator.ts`。
- 默认列为 `backlog`、`todo`、`dev`、`review`、`done`、`blocked`，每个阶段都可以携带推荐的自动化。参见 `src/core/models/kanban.ts` 与 `src/core/kanban/boards.ts`。
- 推荐的泳道默认值由专家驱动：
  - `backlog`、`todo`、`dev`、`blocked` 默认使用 CRAFTER 专家
  - `review` 与 `done` 默认使用 GATE 专家
- `review` 默认要求产物与交付就绪状态。
- `done` 默认要求已提交的变更、干净的工作树以及 PR 就绪的分支。
- 看板自动化按看板分别排队，并带有并发限制，因此卡片移动不会让运行时陷入踩踏。参见 `src/core/kanban/kanban-session-queue.ts`。
- dev 泳道的会话可以通过 watchdog 或 Ralph-loop 策略进行监督和恢复。参见 `src/core/kanban/board-session-supervision.ts` 与 `src/core/kanban/workflow-orchestrator.ts`。
- 交付规则作为列策略在 UI、REST 与 MCP 之间强制执行，而不是仅依赖提示词纪律。参见 ADR 0007 与 `src/core/kanban/task-delivery-readiness.ts`。

### 产品含义

Kanban 是流程驱动的模式。

关键区别在于编排从工作流状态开始，而不是从一段自由形式的对话开始。将卡片移入某个泳道可以自动创建下一个 Agent 会话，而泳道策略可以强制执行产物、交付门禁与排序。

这是交付控制能力最强的模式，因为它为系统提供了一个稳定的工作流边界：

- 卡片状态即触发器
- 泳道定义谁接下来运行
- review/done 携带显式的质量门禁
- 排队使看板执行保持在可控范围内

### 精确性说明

不要说「每个泳道都是一个 GATE」。

代码并非如此实现。

准确的表述是：

- 每个泳道都可以成为一个自动化边界
- 泳道由专家/角色/策略驱动
- review 与 done 是默认的 GATE 检查点

## Team 模式

### 代码做了什么

- Team 模式通过 `HomeInput` 启动，但该模式硬绑定到 `team-agent-lead`。角色切换与自定义专家选择被禁用。启动前必须先选择仓库。参见 `src/app/workspace/[workspaceId]/team/team-page-client.tsx`。
- 团队 lead 是一个 ROUTA 角色的专家，但与通用的核心 ROUTA 专家不同。它的提示词明确围绕规划、委派、协调、验证，并且从不亲自实现。参见 `docs/specialists/team/team-agent-lead.md` 与 `resources/specialists/team/agent-lead.yaml`。
- 团队 lead 使用真实的子会话进行委派，而不是轻量级的隐藏委派路径。提示词明确要求使用 `delegate_task_to_agent`，从而让工作在 Team UI 中可见。
- lead 被要求保持较小的活动波次、隔离重叠的范围，并在完成前重新验证。
- Team 页面对顶层运行和后代数量建模，这反映出 Team 模式本质上是面向会话树的，而非面向单线程的。

### 产品含义

Team 是组织驱动的模式。

运行从一个 lead 开始，而不是从一个自由形式的实现会话开始，也不是从一个看板泳道开始。lead 决定谁应该工作、在哪个波次工作，以及采用什么样的验证循环。

这使得 Team 成为当协调问题本身就是一等公民时的正确模式：

- 多个专业需要协同工作
- 工作可以从并行波次中获益
- 前端/后端/QA/评审的分工很重要
- 任务跨越多个子系统或代码区域

### 多代码库说明

Team 最适合在一个工作区内处理多代码库工作，但这一表述需要一些细微的限定。

代码当前所保证的：

- 一个工作区可以容纳多个代码库
- Team 模式使用一个可以跨专家委派的 lead
- Team 启动器要求在启动前进行一次初始的仓库选择

由此得出的产品推断：

- Team 是跨代码库或跨仓库协调最自然的模式，因为它从委派和波次管理开始，而不是从单个泳道或单个主线程开始

不应宣称的内容：

- Team 在入口处已经提供了一个专用的多仓库启动器 UI

## 推荐的首页措辞

使用反映编排边界而非用户资历的措辞：

- Sessions：默认、单线程入口、ROUTA 优先、动态专家扩展、恢复摩擦最低
- Kanban：工作流驱动、泳道自动化、review/done 质量门禁、交付控制能力最强
- Team：lead 驱动、真实子会话委派、最适合复杂的跨专业工作、协调模型最强

在首页呈现时，使用两个文本层级，而不是一段信息过载的段落：

- 主文案：面向用户的选择指引，聚焦于何时选择该模式
- 次文案：更小的技术细节，聚焦于底层 Agent 编排如何工作

推荐的拆分：

- Sessions 主文案：默认入口，一个可恢复的线程，适合开始与恢复工作
- Sessions 次文案：ROUTA 优先，动态扩展 CRAFTER/GATE，通常是最节省 token 的路径
- Kanban 主文案：带有显式阶段与验收边界的交付流程模式
- Kanban 次文案：泳道自动化，按阶段的专家执行，review/done 中的 GATE 检查点
- Team 主文案：面向复杂跨专业或多代码库工作的团队编排模式
- Team 次文案：team-agent-lead 启动，真实子会话，基于波次的委派，显式的验证

避免使用这些表述：

- 「Team 是高级模式」
- 「Kanban 只是一个经典看板」
- 「Sessions 只是普通聊天」

## 代码引用

- `src/app/workspace/[workspaceId]/sessions/sessions-page-client.tsx`
- `src/app/workspace/[workspaceId]/sessions/[sessionId]/session-page-client.tsx`
- `src/app/workspace/[workspaceId]/sessions/[sessionId]/use-session-crafters.ts`
- `src/client/components/home-input.tsx`
- `src/app/workspace/[workspaceId]/team/team-page-client.tsx`
- `docs/specialists/core/routa.md`
- `docs/specialists/team/team-agent-lead.md`
- `resources/specialists/team/agent-lead.yaml`
- `src/core/models/kanban.ts`
- `src/core/kanban/boards.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/kanban-session-queue.ts`
- `src/core/kanban/task-delivery-readiness.ts`
- `src/core/kanban/board-session-supervision.ts`
- `docs/adr/0004-kanban-driven-automation.md`
- `docs/adr/0007-kanban-delivery-transition-policies.md`
