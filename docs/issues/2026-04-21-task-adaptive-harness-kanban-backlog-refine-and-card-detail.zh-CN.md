---
title: "看板应在待办精炼和卡片详情中呈现 Task-Adaptive Harness"
date: "2026-04-21"
kind: issue
status: resolved
severity: medium
area: kanban
tags:
  - kanban
  - harness
  - backlog-refinement
  - card-detail
  - task-adaptive-harness
  - sessions
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md"
github_issue: 516
github_state: closed
github_url: "https://github.com/phodal/routa/issues/516"
---

# 看板应在待办精炼和卡片详情中呈现 Task-Adaptive Harness

## 发生了什么

`Task-Adaptive Harness` 现已作为一项执行能力存在：

- ACP 会话创建可以接受 `taskAdaptiveHarness`
- 看板提示词入口和移动受阻补救流程已经会传递 task-adaptive 上下文请求
- MCP 现已暴露 `assemble_task_adaptive_harness`

但在用户最需要看到并信任它的两个看板界面上，该能力仍未被产品化：

- 待办精炼（backlog refinement），规划者/精炼者在重写或拆解一个故事之前，应先加载相关的历史任务/会话上下文
- 卡片详情（card detail），操作者应能够看到选中了哪些历史会话和摩擦信号，而不是接收一次无声的上下文注入

结果导致该特性目前更像是隐藏的基础设施，而不是一个可见的看板工作流能力。

## 预期行为

看板应把 `Task-Adaptive Harness` 当作一等的精炼与检视原语来对待。

具体而言：

- 待办精炼会话应默认请求 task-adaptive 水合（hydration），尤其是面向待办精炼器/规划的自动化
- 卡片详情应暴露一个紧凑的 harness 摘要，包括匹配到的历史会话、恢复的文件，以及诸如读取失败或重复读取等高优先级摩擦信号
- 用户应能够理解为什么某个规划/精炼会话以特定的历史上下文切片启动
- 详情界面应能明确显示 harness 是找到了强匹配、弱匹配，还是没有相关历史

## 复现上下文

- 环境：两端
- 触发：
  1. 打开看板，启动或自动化待办/规划工作
  2. 观察到手动规划提示词和移动受阻补救流程使用了 `taskAdaptiveHarness`
  3. 检视待办精炼和卡片详情流程
  4. 注意到待办精炼自动化路径尚未清晰地接入 harness，且卡片详情不显示已编译的 harness 包或置信度

## 可能的原因

- 当前实现优先处理会话启动的管道接线，而非看板 UX 的呈现
- 待办精炼有多条入口路径，包括自动化和恢复，并非所有路径目前都会传递 task-adaptive 输入
- 已编译的 harness 包被注入到会话启动中，但尚未被存储或投影为可见的卡片详情读模型
- 当前卡片详情面板聚焦于就绪度、执行、证据和运行；尚未包含 harness/上下文区块

## 相关文件

- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `src/core/harness/task-adaptive.ts`
- `src/core/harness/task-adaptive-tool.ts`
- `src/app/api/acp/acp-session-create.ts`

## 观察

- 当前看板提示词路径已经从 `kanban-tab.tsx` 传递 `taskAdaptiveHarness`
- 移动受阻补救流程也会传递 task-adaptive 输入，这印证了 harness 与规划式修复流程相关
- 自动化和恢复路径仍在那条显式的看板提示词路径之外创建会话
- 卡片详情已经有就绪度、执行、变更、证据和运行的标签页，因此一个 harness/上下文面板可以契合现有的信息架构，无需发明一个全新的界面
- 2026-04-21 针对 `http://localhost:3000/workspace/default/kanban?boardId=4e8e567c-e308-48cd-a4f6-e3d8e1d17839` 的浏览器验证确认：在任务 `8370421b-46fd-4cd3-bd98-89390b7c2006` 的卡片详情中渲染了 `JIT CONTEXT` 标签页
- 同一次验证还暴露出一个卡片详情交互缺陷：反复点击 `JIT CONTEXT` 时，内容窗格停留在 `Overview` 主体上，而没有切换到 JIT 面板
- 这意味着当前"用户感知为空"的风险不仅仅是检索质量问题；卡片详情中还存在一个标签切换/UI 状态问题，可能会完全隐藏正常工作的 JIT 数据
- 2026-04-21 针对 `http://localhost:3001` 的后续验证表明：当通过 Playwright 依据真实 DOM 角色/选择器驱动时，`JIT CONTEXT` 标签切换缺陷不再复现
- 2026-04-21 现已为该界面建立端到端测试：针对本地 `/Users/phodal/ai/routa-js` 仓库创建一张看板卡片，打开卡片详情，切换到 `JIT Context`，并验证匹配到的特性/文件得以渲染
- 2026-04-21 剩余的缺口不再是卡片详情的 UI 外壳；而是针对弱请求或仅限仓库根目录请求的检索质量，这部分在 issue `#517` 中单独追踪
- 2026-04-22 待办会话不再必须从空白的规划提示词开始：
  - `session/new` 现在会从同一工作区/仓库中已保存的任务记忆里预加载 `Relevant History Memory`
  - `session/new` 还会从仓库的特性界面索引中预加载 `Relevant Feature Tree Context`
  - 待办看板会话现在允许通过 `Read`、`Grep` 和 `Glob` 进行有限的原生只读检视
  - 待办/任务提示词现在明确指示 Agent 先消费历史记忆，然后通过 `contextSearchSpec` 把确认过的 `featureCandidates` / `relatedFiles` 写回
- 2026-04-22 任务执行提示词现在会包含来自当前卡片的 `Saved History Memory`，因此 Todo/Dev/Review 会话可以复用先前的摘要、热门文件、热门会话和可复用提示词，而无需先打开卡片详情
- 2026-04-22 MCP 现在还暴露了 `load_feature_tree_context`，因此待办/任务专家可以按需深入特性树上下文，而不必只依赖预加载的提示词区块
- 2026-04-22 在 `http://localhost:3000/workspace/default/kanban?boardId=4e8e567c-e308-48cd-a4f6-e3d8e1d17839` 上的实时验证确认升级后的待办规划者在行为上（而不仅是配置上）正在消费新的预加载路径：
  - 以故事输入 `为 Kanban 增加 flow event 的查询与趋势摘要能力，优先复用现有事件持久化和读取契约` 启动一个新的规划会话
  - 产生了 ACP 会话 `2f1f35f2-d7fe-48e5-8e1b-2d2581f52918`
  - 创建了卡片 `4d69f47a-371b-4191-81a0-7c89c06a028e`
  - 持久化了 `contextSearchSpec.featureCandidates=["kanban-workflow"]`
  - 持久化了 `contextSearchSpec.relatedFiles`，其中包含 `crates/routa-server/src/api/kanban.rs`、`src/app/api/kanban/events/route.ts`、`src/app/api/kanban/boards/[boardId]/route.ts`、`src/app/api/kanban/boards/route.ts` 以及 `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
  - 持久化了 `moduleHints` / `symptomHints`，明确保留了 `reuse existing event persistence / read contract` 这一约束
- 2026-04-22 一次更深入的 Playwright DOM 探查推翻了此前关于标签页回归的报告：
  - 对于任务 `8370421b-46fd-4cd3-bd98-89390b7c2006`，点击 `HISTORY MEMORY` 会将 `aria-selected` 从 `overview=true` / `jitContext=false` 变为 `overview=false` / `jitContext=true`
  - 渲染出的面板文本包含 `SAVED HISTORY MEMORY`、已保存的摘要内容、热门文件、热门会话、可复用提示词，以及恢复的历史/流程区块
  - 此前 `agent-browser` 的读数是一次假阴性，由该工具的交互/快照路径导致，而非卡片详情标签页中的产品缺陷

## 解决方案

- 2026-04-22：在实时验证确认这个后续工作的两个部分均已产品化后关闭：
  - 待办精炼/规划会话预加载相关的历史记忆和特性树上下文，并将由此得到的高信号提示写回 `contextSearchSpec`
  - 卡片详情连同流程/检索视图一起暴露已保存的 `History Memory` 结果，包括置信度、匹配的文件、恢复的会话、警告、失败以及可复用提示词
- 在 `http://localhost:3000/workspace/default/kanban?boardId=4e8e567c-e308-48cd-a4f6-e3d8e1d17839` 上的实时应用中验证：
  - 创建一个新的待办故事会持久化 `featureCandidates` / `relatedFiles` / `moduleHints` / `symptomHints`
  - 打开既有的 flow-event 卡片并切换到 `HISTORY MEMORY` 会显示已保存的历史记忆和恢复出的 task-adaptive 上下文

## 参考

- 本地相关 issue：`docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md`
- GitHub 总览 issue：`https://github.com/phodal/routa/issues/515`
