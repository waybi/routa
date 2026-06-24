---
title: "即使存在历史会话，仅含仓库根目录的请求 JIT Context 仍保持为空"
date: "2026-04-21"
kind: issue
status: resolved
severity: medium
area: "kanban"
tags: ["jit-context", "task-adaptive-harness", "feature-explorer", "history-session", "kanban"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md"
  - "docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md"
github_issue: 517
github_state: closed
github_url: "https://github.com/phodal/routa/issues/517"
---

# 即使存在历史会话，仅含仓库根目录的请求 JIT Context 仍保持为空

## 发生了什么

`JIT Context` 即使在 `/Users/phodal/ai/routa-js` 下也可能渲染为空，而本地 Codex 历史中明显包含匹配的 Trace 以及可恢复的上下文。

针对当前仓库的真实探测显示：

- `~/.codex/sessions` 当前包含 `1767` 个 Trace 文件。
- `collectMatchingTranscriptSessions("/Users/phodal/ai/routa-js")` 为此仓库返回 `200` 个匹配的 Trace。
- `assembleTaskAdaptiveHarness("/Users/phodal/ai/routa-js", { taskLabel: "Repo-root only", taskType: "analysis" })` 返回：
  - `selectedFiles: []`
  - `matchedSessionIds: []`
  - 警告：`No task-adaptive files could be resolved from the current request.`

与此同时，探测一个具体的看板文件表明数据是存在的：

- `assembleTaskAdaptiveHarness(..., { filePaths: ["src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx"] })` 返回：
  - `5` 个匹配的会话
  - 高信号的失败信息，例如缺失文件/路径读取
  - 针对 `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx` 的重复读取热点
- `Feature Explorer` 将同一个文件映射为：
  - 页面路由：`/workspace/:workspaceId/kanban`
  - 特性：`kanban-workflow`
  - 文件统计：`changes=5`、`sessions=5`、`updatedAt=2026-04-21T09:15:36`

这意味着空状态并非由缺乏历史导致，而是由当前请求的形态不够强、无法解析出候选文件/特性所导致。

## 期望行为

当 `JIT Context` 仅接收到仓库/工作区上下文时，它仍应通过推导以下一项或多项来恢复有用的历史会话上下文：

- 来自当前卡片/任务界面的候选文件
- 来自 `Feature Explorer` 的候选特性
- 当前仓库的近期/高信号历史会话

空状态应仅保留给真正没有历史的卡片，而不是用于那些拥有大量本地 Trace 证据、仅含仓库根目录的请求。

## 复现上下文

- 环境：Web 端
- 触发条件：打开看板卡片详情，并为一张未传入强 `filePaths`、`featureId` 或 `historySessionIds` 的卡片请求 `JIT Context`

针对 `/Users/phodal/ai/routa-js` 运行的本地诊断命令：

1. 统计 `~/.codex/sessions` 下的本地 Trace 文件数量
2. 调用 `collectMatchingTranscriptSessions(repoRoot)`
3. 调用 `assembleTaskAdaptiveHarness(repoRoot, { taskLabel, taskType })`
4. 调用 `assembleTaskAdaptiveHarness(repoRoot, { filePaths: [...] })`
5. 调用 `Feature Explorer` 辅助方法，将同一文件映射为特性/页面/会话统计

## 为何可能发生

- `Task-Adaptive Harness` 目前要求传入 `filePaths`、`featureId` 或 `historySessionIds` 之一才能恢复 `selectedFiles`；仅含仓库根目录的请求无法推断起始界面。
- `JIT Context` 已接入 `task-adaptive` 检索，但尚未接入 `Feature Explorer` 的特性/页面/文件归因作为兜底发现步骤。
- 当前的空状态逻辑将「未解析出 selectedFiles」当作「无上下文」，即便 `collectMatchingTranscriptSessions(repoRoot)` 已经证明存在仓库范围的历史。
- 当前的 UI/任务接线可能并不总是从卡片传入最强的历史输入，尤其是那些泳道/会话元数据较弱或不完整的卡片。

## 改进方向

将任务级的 `contextSearchSpec` 用作 `JIT Context` 的首轮检索契约。

与其等待后续的实现 Trace 来恢复文件，backlog 精炼阶段应直接在卡片/任务上写入结构化的检索提示，例如：

- `query`
- `featureCandidates`
- `relatedFiles`
- `routeCandidates`
- `apiCandidates`
- `moduleHints`
- `symptomHints`

这样即使在首个实现会话尚未产生 Trace 证据之前，也能为 `Task-Adaptive Harness` 提供即时（just-in-time）的种子。

## 计划接线

1. `backlog refiner` 应在创建或精炼卡片时输出 `contextSearchSpec`
2. 任务持久化应在 Web 端/桌面端后端之间存储 `contextSearchSpec`
3. `buildKanbanTaskAdaptiveHarnessOptions()` 应转发：
   - `relatedFiles -> filePaths`
   - `featureCandidates -> featureIds`
4. `Task-Adaptive Harness` 应合并 `featureIds + filePaths + historySessionIds`
5. `JIT Context` 应在首次打开时消费这些提示，随后再使用真实会话 Trace 进行精炼

## 进度记录

- 2026-04-21：验证了仅含仓库根目录的请求保持为空，而文件范围的请求能立即恢复会话与摩擦信号
- 2026-04-21：确认 `Feature Explorer` 已经能够将文件映射到 `feature/page/session` 证据，应将其视为结构化兜底方案
- 2026-04-21：开始实现任务级 `contextSearchSpec` 持久化以及看板/工具链的传播
- 2026-04-21：`Task-Adaptive Harness` 现已能通过特性界面索引，从 `query`、`routeCandidates`、`apiCandidates`、`moduleHints` 和 `symptomHints` 中为文件/特性推断提供种子
- 2026-04-21：看板的 task-adaptive 接线现在会在旧卡片尚未拥有显式 `contextSearchSpec.query` 时，回退使用卡片标题作为隐式 query
- 2026-04-21：针对 `http://localhost:3001/api/harness/task-adaptive` 重新验证后发现，即便在基于提示的检索工作上线之后，仅含仓库根目录的请求仍为空
- 2026-04-21：确认了对照案例：当存在 `featureIds/routeCandidates/moduleHints` 时，同一仓库返回高置信度匹配、已恢复的文件、可复用的摩擦画像以及相关历史会话
- 2026-04-21：验证了当前看板/JIT 产品路径对于带提示的卡片是可用的，但最初仅含仓库根目录的兜底缺口仍未解决，使本问题保持开启状态
- 2026-04-21：为 `Task-Adaptive Harness` 添加了 `historySummary`，使关联的历史会话种子被压缩为概览加上若干顶部种子会话，而不再仅暴露最终恢复的会话
- 2026-04-21：新增 MCP 工具 `summarize_task_history_context` 以及新的只读专家 `history-summary-analyst`，使未来的分析可以从压缩后的种子证据出发，而不必重新读取所有关联的 Trace
- 2026-04-21：`JIT Context` 现在提供 `Open History Analysis`，可从卡片详情启动一个专用的 `history-summary-analyst` 会话，而不必强迫用户将原始关联会话注入当前实现会话
- 2026-04-21：`Open History Analysis` 再次调整为启动一个独立的会话页面，而不是劫持当前看板会话面板，从而使历史分析不再干扰正在进行的执行对话
- 2026-04-21：仅含仓库根目录的兜底不再为空。重新验证 `assembleTaskAdaptiveHarness("/Users/phodal/ai/routa-js", { taskLabel: "为 Kanban 建立可持久化的流动事件模型", taskType: "implementation", locale: "zh-CN" })` 现在返回 `featureId=kanban-workflow`、`selectedFiles=17`、`matchedSessionIds=6`，并且不再输出 `No task-adaptive files could be resolved from the current request.`
- 2026-04-21：本问题现在主要是一个验证问题，而非缺失检索原语；下一轮应对多个热点特性进行 dogfood，并对比强提示与弱提示下 `JIT Context` / `History Analysis` 的质量。
- 2026-04-21：热点验证暴露了 `Task-Adaptive Harness` 中的一个排序缺陷：显式的 `featureIds` 与推断出的候选特性通过 `uniqueSorted(...)` 合并，导致 `["feature-explorer", "a2a"]` 被重排为 `["a2a", "feature-explorer"]`，使无关的兜底特性成为主特性。
- 2026-04-21：文件排序也发生了漂移，因为 `inferredSeed.filePaths` 被合并到显式特性文件之前，因此即使 `featureId` 被纠正，`selectedFiles` 仍以无关的兜底文件开头。
- 2026-04-21：在保留显式特性顺序并优先显式特性文件之后，针对 `/Users/phodal/ai/routa-js` 重新验证热点案例，`feature-explorer`、`tasks`、`mcp` 和 `spec` 都返回了预期的主特性。
- 2026-04-21：修复后的 API 验证快照：
  - `feature-explorer -> featureId=feature-explorer, selectedFiles=16, matchedSessions=6`
  - `tasks -> featureId=tasks, selectedFiles=8, matchedSessions=6`
  - `mcp -> featureId=mcp, selectedFiles=16, matchedSessions=6`
  - `spec -> featureId=spec, selectedFiles=8, matchedSessions=6`

## 验证候选清单

使用 `Feature Explorer` 的摩擦画像作为首轮验证队列，而不是随意挑选卡片。

当前本地快照 `.routa/feature-explorer/friction-profiles.json` 中的顶部热点特性：

1. `kanban-workflow`
   - `matchedSessions=6`、`selectedFiles=8`、`failures=8`、`repeatedReads=5`
   - 最佳主验证目标，因为它正是 `JIT Context` 和 `History Analysis` 的目标产品界面
   - 代表性已恢复会话：
     - `019daf46-1a5b-7001-8a17-df4a7053ace0`
     - `019da9f5-4a31-7bf0-9ac0-f836f2307537`
     - `019daf30-4f25-78f2-bb4f-1dabbd464cc5`

2. `tasks`
   - `matchedSessions=6`、`selectedFiles=8`、`failures=8`、`repeatedReads=5`
   - 良好的次级验证目标，因为它与看板共享相同的 Rust/TS 后端界面，但行使的是任务 API 而非看板 UI

3. `feature-explorer`
   - `matchedSessions=6`、`selectedFiles=7`、`failures=6`、`repeatedReads=4`
   - 最佳交叉校验目标，用于评估 `History Analysis` 的 prompt 结构是否已接近现有文件/会话分析流程的质量
   - 代表性已恢复会话：
     - `019daf79-02ec-71a2-832d-8e87b62e060a`
     - `019da5f2-e28c-7361-8978-11dfde7f2c4f`
     - `019da900-d2f6-7f03-a752-15a4feae8ec3`

4. `spec`
   - `matchedSessions=6`、`selectedFiles=4`、`failures=2`、`repeatedReads=4`
   - 有用的低噪声目标，用于查看同一检索流水线在更小、更结构化的界面上是否表现更好

5. `mcp`
   - `matchedSessions=4`、`selectedFiles=8`、`failures=8`、`repeatedReads=6`
   - 有用的压力案例，因为它具有密集的后端热点以及大量路径解析失败

跨特性、高频但更嘈杂的会话：

- `019dad6c-1d0f-7781-81ad-1cdbceac12e2`
  - 出现在 `7` 个特性画像中（`kanban-workflow`、`acp`、`codebases`、`health`、`mcp`、`traces`、`workspaces`）
  - 可能作为弱/噪声证据有用，但因为跨越界面过多，不适合作为首个验证目标

- `019daf46-1a5b-7001-8a17-df4a7053ace0`
  - 出现在 `3` 个聚焦特性画像中（`kanban-workflow`、`mcp`、`tasks`）
  - 更适合作为热点验证候选，因为它虽仍被共享，但更牢固地锚定在当前看板/任务后端集群上

推荐验证顺序：

1. `kanban-workflow`
2. `feature-explorer`
3. `tasks`
4. `mcp`
5. `spec`

## 相关文件

- `src/core/harness/task-adaptive.ts`
- `src/core/harness/transcript-sessions.ts`
- `src/app/api/feature-explorer/shared.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-task-adaptive.ts`
- `src/core/kanban/task-adaptive.ts`

## 观察

- 对于 `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`，已恢复的会话包含来自 `2026-04-21` 的当前 JIT/Task-Adaptive Harness 工作。
- 已恢复的失败信号是有用的产品数据，而不仅仅是调试噪声。示例包括：
  - 错误的路径读取
  - 针对 `[]` 路径的 shell glob 失败
  - 反复尝试读取同一文件
- `Feature Explorer` 已经暴露了 `JIT Context` 尚未呈现的上下文类别：
  - 特性链接
  - 页面链接
  - 文件统计
  - 带有 prompt/工具/诊断摘要的文件信号
  - 按会话数排序的顶部特性

## 参考

- `docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md`
- `docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md`

## 解决方案

- 2026-04-22：在以仅含仓库根目录的输入重新验证实时 `POST /api/harness/task-adaptive` 路径后关闭。
- 验证请求：
  - `workspaceId=default`
  - `repoPath=/Users/phodal/ai/routa-js/.routa/repos/phodal--routa`
  - `taskLabel=为 Kanban 建立可持久化的流动事件模型`
  - `taskType=implementation`
- 验证结果：
  - `featureId=kanban-workflow`
  - `selectedFiles=16`
  - `matchedSessionIds=6`
  - 不再返回旧的 `No task-adaptive files could be resolved from the current request.` 空状态失败
- 剩余可见的看板 UX 问题在 `#516` 中单独跟踪；此仓库根目录兜底缺口本身已不再开启。
