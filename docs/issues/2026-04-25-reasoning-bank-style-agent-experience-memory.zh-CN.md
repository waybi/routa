---
title: "为 Agent 经验学习添加 ReasoningBank 风格的策略记忆"
date: "2026-04-25"
kind: issue
status: open
severity: medium
area: "agent-memory"
tags:
  - agent-memory
  - trace-learning
  - kanban
  - task-adaptive-harness
  - reasoning-bank
  - agent-experience
reported_by: "codex"
github_issue: 535
github_state: open
github_url: "https://github.com/phodal/routa/issues/535"
related_issues:
  - "docs/issues/2026-04-17-generic-trace-learning-session-analysis-foundation.md"
  - "docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md"
  - "docs/issues/2026-04-22-save-jit-context-minimal-result-persistence.md"
  - "docs/issues/2026-04-16-global-kanban-flow-learning-via-agent-specialist.md"
references:
  - "https://research.google/blog/reasoningbank-enabling-agents-to-learn-from-experience/"
  - "https://arxiv.org/abs/2509.25140"
  - "https://github.com/google-research/reasoning-bank"
---

# 为 Agent 经验学习添加 ReasoningBank 风格的策略记忆

## 发生了什么

Google Research 的 ReasoningBank 工作描述了一种 Agent 记忆闭环：它从成功与失败的轨迹中提炼出可复用的推理策略，然后在未来任务开始前检索这些策略记忆。

Routa 已经具备若干相邻的能力：

- 工作区级别的 Trace 与会话历史
- 用于匹配文件、会话和功能上下文的任务自适应历史记忆
- 通过 `save_history_memory_context` 保存的 `jitContextSnapshot.analysis`
- 从重复运行结果中提炼出的学习型 playbook
- 看板泳道会话、交接、恢复原因，以及评审收敛信号

然而，Routa 尚未拥有一个一等公民级别的策略记忆层，用以捕获以下这类经验教训：

- 哪种推理捷径帮助某个任务收敛
- 哪条失败路径下次应当避免
- 在采取行动之前应检查哪个校验器或交接信号
- 反复出现的开发/评审或待办/待处理循环应如何改变未来的 Agent 行为

当前的记忆面大多以上下文条目和工具流为导向。它们帮助 Agent 知道该去哪里查找，但并不能持续地教会 Agent 如何从过往的成功与失败中进行推理。

## 期望行为

Routa 应提供一个工作区级别的 Reasoning Bank / Experience Bank，用以存储从 Agent 运行中提炼出的、紧凑且可直接用于提示词的策略记忆。

每条记忆项都应既可供人阅读、又可供机器使用，其最小结构类似于：

- `title`
- `description`
- `content`
- `outcome`：`success`、`failure` 或 `mixed`
- `sourceTaskIds`
- `sourceSessionIds`
- `tags`：功能、文件、路由、API、泳道、Provider
- `confidence`
- `evidenceCount`

在看板/ACP Agent 开始一个任务之前，Routa 应检索出最相关的 1-3 条策略记忆，并将其与现有的 `Relevant History Memory` 分开注入。

## 为什么这很重要

如果没有策略记忆，即使 Routa 已经拥有足以阻止失败的全部证据，Agent 仍可能重复代价高昂的失败模式：

- 在此前某次会话已经识别出正确的代码面之后，仍重复进行大范围的仓库扫描
- 评审 Agent 凭空猜测运行时环境配置，而不是请求泳道交接
- 开发 Agent 反复运行同一条失败的命令，却不去解读失败信号
- 由于缺失契约字段而导致待办/待处理循环，而这些字段在先前的任务中早已暴露

ReasoningBank 的核心产品启示在于：失败不仅仅是糟糕的运行；它们是为未来护栏提供的高价值反事实数据。

## 建议方向

### M0：轻量级探针

添加一个仅 TypeScript 的小型 Reasoning Memory 领域，并在看板任务提示词中使用它。

建议范围：

- 将候选策略记忆存储在工作区/任务存储中，或一个本地 JSON 支撑的服务里
- 按工作区、仓库路径、功能/文件线索、路由/API 线索、泳道、Provider 以及文本重叠度进行检索
- 渲染一个新的提示词区块，例如 `## Relevant Strategy Memory`
- 将 top-k 保持在较低水平，以避免提示词被噪声膨胀
- 围绕检索与提示词渲染添加特征化测试

2026-04-28 的实现进展：

- 添加了 `src/core/harness/reasoning-memory.ts`，用于在 `.routa/projects/{project}/reasoning-memory/memories.json` 下提供 JSON 支撑的项目本地策略记忆。
- 添加了按任务文本、功能/文件线索、泳道、Provider、标签、任务 ID 和会话 ID 进行的检索评分。
- 添加了有上限的 `## Relevant Strategy Memory` 提示词渲染。
- 将检索到的策略记忆注入看板任务提示词中，并与已保存的历史记忆和泳道经验记忆分开。
- 在 `src/core/harness/__tests__/reasoning-memory.test.ts` 和 `src/core/kanban/__tests__/agent-trigger.test.ts` 中添加了聚焦的特征化测试。

2026-04-29 的实现进展：

- 为 `search_reasoning_memories` 和 `save_reasoning_memory` 添加了 MCP 执行与注册路径。
- 在核心的看板规划与团队协调 MCP profile 中暴露了这两个工具。
- 添加了覆盖策略记忆搜索/保存的 executor、manager 和真实工具参数测试。
- 修复了 `resolveRepoRoot(repoPath)`，使得直接的仓库路径调用不会先初始化 Routa 系统/数据库。

### M1：闭环

添加一条专门的提取/保存路径：

- `search_reasoning_memories`
- `save_reasoning_memory`
- `promote_session_to_reasoning_memory`
- 可选的 `consolidate_reasoning_memories`

提取器应优先采用确定性信号：

- 测试与校验裁定
- 任务泳道会话状态
- 评审结果
- 恢复原因
- Trace 错误与失败的工具调用

LLM-as-judge 可以对经验教训进行总结和分类，但不应成为唯一的成功/失败信号。

### M2：记忆感知的扩展

利用 Routa 的多 Agent 与看板自动化模型来支持 ReasoningBank 风格的扩展：

- 并行扩展：为一张高风险卡片创建多个候选会话，然后对比成功与失败的路径
- 串行扩展：watchdog 重试 / Ralph 循环 / 评审退回所产生的精炼历史，被提炼为记忆
- 记忆反馈：高置信度的策略记忆会对后续重试以及未来的相似任务产生偏置引导

## 验收标准

- 一个任务可以同时接收上下文记忆和策略记忆，而不会将二者混为一谈。
- 至少有一个失败或已恢复的看板泳道会话可以被转化为一条预防性策略记忆。
- 检索是工作区级别的，并尊重仓库/功能/文件线索。
- 提示词注入被限制在少量高置信度项之内。
- 现有的 `TaskJitContextAnalysis` 和学习型 playbook 行为继续正常工作。
- 在添加公开 API 面之前，先记录好 Web 端与桌面端的领域语义。

## 相关文件

- `docs/ARCHITECTURE.md`
- `src/core/models/task.ts`
- `src/core/kanban/context-preload.ts`
- `src/core/kanban/agent-trigger.ts`
- `src/core/trace/trace-playbook.ts`
- `src/core/trace/run-outcome.ts`
- `src/core/orchestration/orchestrator.ts`
- `src/core/mcp/mcp-tool-executor.ts`
- `src/core/mcp/routa-mcp-tool-manager.ts`
- `crates/routa-core/src/trace/`
- `crates/routa-server/src/api/`

## 备注

不要为该功能复用 `/api/memory`；该端点目前代表的是运行时记忆监控。请使用一个明确的产品/领域名称，例如 `reasoning-memory`、`experience-memory` 或 `reasoning-bank`。

不要存储私有的思维链。请存储简洁的操作性理由、有证据支撑的经验教训，以及预防性的指导。
