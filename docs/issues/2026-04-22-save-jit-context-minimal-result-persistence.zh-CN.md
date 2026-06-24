---
title: "History Analysis 应保存任务自适应的最小化历史记忆结果，而非依赖通用的 update_task"
date: "2026-04-22"
kind: issue
status: resolved
severity: medium
area: "kanban"
tags: ["jit-context", "history-analysis", "mcp", "kanban"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-jit-context-needs-repo-root-context-discovery.md"
github_issue: 519
github_state: closed
github_url: "https://github.com/phodal/routa/issues/519"
---

# History Analysis 应保存任务自适应的最小化历史记忆结果，而非依赖通用的 update_task

## 发生了什么

`Open History Analysis` 能够启动一个专门的分析师会话，但生成的结构化分析结果往往无法回写到卡片详情上。

当前行为表现为：

- 卡片详情仍然渲染来自 `JIT Context` 的检索/处理数据
- 仅当 `task.jitContextSnapshot.analysis` 存在时，已保存分析的 UI 才会被填充
- 当前的历史分析师提示词要求模型调用通用的 `update_task` 工具，并附带一个较大的 `jitContextAnalysis` 负载
- 实际操作中，已启动的分析会话可能停留在规划模式，或始终未能持久化最终结果

其结果是：用户能够看到分析会话页面，但重新打开卡片时，无法稳定地看到已保存的结构化结果。

## 期望行为

History Analysis 应当拥有一条专用的保存路径：

- 分析师从卡片读取已有的检索/处理上下文
- 分析师只产出可复用的结果字段
- 分析师调用一个聚焦的 `save_history_memory_context` MCP 工具
- 重新打开卡片时立即显示已保存的结果

保存的负载应当刻意保持精简，并针对后续规划/实现会话中的复用进行优化。

## 复现上下文

- 环境：web
- 触发方式：打开一个看板卡片，打开 `JIT Context`，启动 `Open History Analysis`，然后重新打开卡片详情

验证期间观察到的本地状态：

- 多个演示卡片存在 `jitContextSnapshot`
- `jitContextSnapshot.analysis` 始终为空
- 已启动的历史分析会话未能稳定地将最终结果回写到任务

## 可能的原因

- `update_task` 过于通用，无法强烈地表明"保存最终 JIT 结果"是强制要求
- 当前的分析 schema 过于庞大，并将可复用的结果字段与 UI 中已展示的、面向过程的推理细节混在一起
- 专家提示词的复杂度可能增加了模型持续推理而不调用保存路径的概率

## 改进方向

引入一个专用的 MCP 工具 `save_history_memory_context`，它只为特定任务持久化最小化的可复用结果。

建议保存的结构：

- `summary`
- `topFiles`
- `topSessions`
- `recommendedContextSearchSpec`
- `reusablePrompts`
- 可选的 `updatedAt`

面向过程的数据，例如匹配的文件、警告、失败和历史摘要，应继续来自现有的 `JIT Context` 检索 UI，不应在已保存的分析中重复存放。

## 相关文件

- `src/core/models/task.ts`
- `src/core/tools/agent-tools.ts`
- `src/core/mcp/mcp-tool-executor.ts`
- `src/core/mcp/routa-mcp-tool-manager.ts`
- `src/core/mcp/mcp-server-profiles.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `resources/specialists/tools/history-summary-analyst.yaml`
- `resources/specialists/locales/en/tools/history-summary-analyst.yaml`
- `resources/specialists/locales/zh-CN/tools/history-summary-analyst.yaml`

## 观察

- UI 已经具备足够的过程数据来解释上下文是如何恢复的。
- 缺失的环节是一条可靠的、仅保存结果的路径，它能在卡片重新打开后存活，并可被后续会话复用。
- 一旦只保留最小化的可复用字段，现有的已保存分析渲染就可以被简化。

## 验证

- 2026-04-22：在 `http://localhost:3000/workspace/default/kanban?boardId=4e8e567c-e308-48cd-a4f6-e3d8e1d17839&taskId=bc897ba8-b85f-49ce-9564-81acde182001` 上验证
- `JIT Context -> Open History Analysis` 在 `/workspace/default/sessions/24bcb54f-bd07-46ec-8509-4f5f42b822bd` 打开了一个新的会话页面
- 会话历史确认了一次真实的 `save_history_memory_context` MCP 工具调用
- 随后 `GET /api/tasks/bc897ba8-b85f-49ce-9564-81acde182001` 显示 `task.jitContextSnapshot.analysis` 已被持久化，包含 `summary`、`topFiles`、`topSessions`、`reusablePrompts` 和 `recommendedContextSearchSpec`
- 重新打开卡片详情并展开 `JIT Context` 后，UI 中显示了 `Saved History Analysis`，包括已保存的摘要、top files、top sessions 和可复用提示词
- 2026-04-22：后续的提示词审计发现 `Open History Analysis` 仍在生成的提示词中嵌入了一个完整的 JSON 示例，这又把分析师拉回到在聊天中回显负载的倾向，而不是把 `save_history_memory_context` 当作首要的保存路径
- 通过将生成的提示词简化为以下方式来修复：
  - 明确要求调用工具
  - 点名重要的工具字段
  - 禁止把负载倾倒回聊天中
- 回归覆盖：
  - `npx vitest run 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-detail-and-prompts.test.tsx'`
  - `npx tsc --noEmit`
  - `npx eslint 'src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx' 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-detail-and-prompts.test.tsx'`

## 参考

- `docs/issues/2026-04-21-jit-context-needs-repo-root-context-discovery.md`

## 解决方案

- 2026-04-22：在线上验证确认这条专用的最小化保存路径正常工作后关闭。
- 在线上应用中通过以下内容验证：
  - 任务 `bc897ba8-b85f-49ce-9564-81acde182001`
  - 历史分析会话 `24bcb54f-bd07-46ec-8509-4f5f42b822bd`
- 证据：
  - 会话记录中包含一次真实的 `save_history_memory_context` MCP 工具调用
  - 保存的负载会持久化回写到 `task.jitContextSnapshot.analysis`
  - 存储的结果包含预期的最小化可复用结构（`summary`、`topFiles`、`topSessions`、`reusablePrompts`、`recommendedContextSearchSpec`）
- 任何剩余的卡片详情可见性问题现在都归属于看板界面问题 `#516`，而不属于保存路径本身。
