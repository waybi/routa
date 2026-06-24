---
title: "Issue #100 实现分析 — 看板 Agent 多任务创建与列流转自动化"
date: 2026-03-09
kind: analysis
status: resolved
resolved_at: "2026-04-03"
area: kanban
github_issue: 100
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/100"
---

# Issue #100 的实现状态分析

## 执行摘要

**总体进度：约 60% 完成**

看板 Agent 功能（#100）已完成大量基础性工作，但仍有若干关键组件尚未实现。多 Agent 协调、列流转和任务拆解的核心基础设施已经存在，但 Agent 之间的产物通信以及部分自动化功能仍然缺失。

---

## ✅ 已实现的功能

### 1. 看板 Agent 专家（Phase 1）✅
- **文件**: `resources/specialists/kanban-agent.md`
- **状态**: 完全实现
- **能力**:
  - 从自然语言进行任务拆解
  - 通过 `decompose_tasks` 工具批量创建任务
  - 针对任务粒度与优先级排序的清晰指南
  - 包含示例工作流

### 2. 任务拆解工具（Phase 1）✅
- **MCP 工具**: `decompose_tasks`，在 `routa-mcp-tool-manager.ts` 中注册（第 1120-1148 行）
- **API 端点**: `/api/kanban/decompose`（完全实现）
- **后端**: `KanbanTools.decomposeTasks()`，位于 `src/core/tools/kanban-tools.ts`（第 372-411 行）
- **状态**: 功能完整
- **特性**:
  - 接受包含 title、description、priority、labels 的任务数组
  - 在指定列（默认: backlog）批量创建任务
  - 返回已创建的卡片 ID

### 3. 列流转事件（Phase 2）✅
- **事件类型**: `COLUMN_TRANSITION`，在 `AgentEventType` 枚举中定义
- **发射器**: `emitColumnTransition()`，位于 `src/core/kanban/column-transition.ts`
- **处理器**: `ColumnTransitionHandler` 类（第 57-107 行）
- **状态**: 完全实现
- **特性**:
  - 卡片在列之间移动时发射事件
  - 监听流转并触发列自动化
  - 支持 `transitionType`: entry、exit、both
  - 已与 `KanbanWorkflowOrchestrator` 集成

### 4. 列自动化配置 ✅
- **接口**: `KanbanColumnAutomation`，位于 `src/core/models/kanban.ts`（第 9-26 行）
- **状态**: 完全实现
- **字段**:
  - `enabled`、`providerId`、`role`、`specialistId`、`specialistName`
  - `transitionType`: entry | exit | both ✅
  - `requiredArtifacts`: screenshot | test_results | code_diff ✅（已定义但未强制执行）
  - `autoAdvanceOnSuccess`: boolean ✅
- **UI**: 列自动化设置面板，位于 `kanban-tab.tsx`（第 827-853 行）

### 5. Desk Check Agent 专家（Phase 3 — 部分）✅
- **文件**: `resources/specialists/desk-check.md`
- **状态**: 已定义专家，但产物请求工具缺失
- **能力**:
  - 用于代码质量的评审清单
  - 可读取 Agent 对话
  - 在发现问题时可将卡片移回 Dev
  - **缺失**: `request_artifact` 与 `provide_artifact` 工具

### 6. 工作流编排（Phase 4 — 部分）✅
- **类**: `KanbanWorkflowOrchestrator`，位于 `src/core/kanban/workflow-orchestrator.ts`
- **状态**: 已实现自动推进，缺少产物强制校验
- **特性**:
  - 跟踪每张卡片的活跃自动化
  - 在 Agent 成功时自动推进卡片（第 185-211 行）
  - 发射流转事件以实现链式自动化
  - **缺失**: 流转前的产物要求校验

---

## ❌ 缺失的功能

### 1. Agent 之间的产物通信（Phase 3）❌

**所需工具**（来自 issue 规范）:
```typescript
request_artifact: tool({
  description: 'Request an artifact from another agent',
  inputSchema: z.object({
    toAgentId: z.string(),
    artifactType: z.enum(['screenshot', 'test_results', 'code_diff', 'logs']),
    context: z.string().optional(),
  }),
});

provide_artifact: tool({
  description: 'Provide an artifact in response to a request',
  inputSchema: z.object({
    requestId: z.string(),
    artifactType: z.enum(['screenshot', 'test_results', 'code_diff', 'logs']),
    content: z.string(), // base64 for images, text for others
  }),
});
```

**当前状态**: 未实现
- `routa-mcp-tool-manager.ts` 中没有 MCP 工具注册
- `AgentTools` 或 `KanbanTools` 中没有后端实现
- 没有产物存储机制

**影响**: Desk Check Agent 无法向 Dev Agent 请求截图或测试结果

### 2. 产物存储系统 ❌

**所需**: 用于产物（截图、测试结果、代码 diff）的存储层

**当前状态**:
- A2A 协议有 `A2AArtifact` 接口（`a2a-task-bridge.ts` 第 38-43 行）
- 但没有面向看板工作流的通用产物存储
- 没有与 Note 系统或独立产物存储的集成

**建议实现**:
- 方案 A: 将产物作为 Note 附件存储（复用现有 Note 系统）
- 方案 B: 创建专用的 `ArtifactStore`，类似于 `NoteStore`
- 方案 C: 将 A2A 产物系统用于看板（需要做桥接）

### 3. 截图捕获集成 ❌

**所需**: Agent 在实现过程中捕获截图的能力

**当前状态**:
- `agent-browser` 技能已存在并具备截图能力（`.agents/skills/agent-browser/`）
- 可用于浏览器自动化的 Playwright MCP 工具
- **缺失**: 与 Agent 工作流的集成以自动捕获截图
- **缺失**: 供 Agent 触发截图捕获的工具

**建议实现**:
- 添加 `capture_screenshot` MCP 工具，封装 `agent-browser screenshot`
- 将截图作为产物存储，并链接到任务/Agent
- Desk Check Agent 可通过 `request_artifact(artifactType: 'screenshot')` 进行请求

### 4. 产物要求强制校验 ❌

**所需**: 在缺少所需产物时阻止列流转

**当前状态**:
- `requiredArtifacts` 字段已存在于 `KanbanColumnAutomation` 接口中
- 在 `ColumnTransitionHandler` 或 `KanbanWorkflowOrchestrator` 中**未强制执行**

**需要的实现**:
- 在 `ColumnTransitionHandler` 中允许流转前检查 `requiredArtifacts`
- 查询产物存储以获取任务关联的产物
- 若产物缺失则拒绝流转并返回错误消息
- 在 UI 上反馈所需的产物类型

### 5. 列 Agent 命名的明确性 ❌

**Issue 中的问题**: "Column Agent" vs "Transition Agent" vs "Stage Agent"？

**当前状态**:
- 代码使用 "Column Automation" 术语
- 专家使用基于角色的名称（Desk Check Agent、Kanban Agent）
- 没有一致的命名约定

**建议**: 使用 **"Transition Agent"** 或 **"Stage Agent"**
- 更准确: Agent 是在流转时触发的，而非列本身
- 与 `transitionType` 字段（entry/exit/both）保持一致

### 6. 并行任务执行跟踪 ❌

**Issue 中的问题**: "多个任务能否同时处于 Dev 中并由不同 Agent 处理？"

**当前状态**:
- 多个 Agent 可同时活跃（代码中无硬性限制）
- `KanbanWorkflowOrchestrator` 按卡片跟踪自动化（Map<cardId, automation>）
- **缺失**: 用于展示并行 Agent 活动的仪表盘/UI
- **缺失**: 并行任务的资源限制或排队机制

**建议实现**:
- 在看板 UI 中添加 "Agent 活动面板"（依据 issue 规范）
- 按列展示活跃 Agent 及其任务分配
- 可选: 在自动化配置中为每列添加并发限制

---

## 📊 实现检查清单（来自 Issue）

### Phase 1: 看板 Agent 专家
- [x] 创建 `resources/specialists/kanban-agent.md` ✅
- [x] 添加 `decompose_tasks` 工具 ✅
- [x] 在 `kanban-tab.tsx` 中与 `handleAgentSubmit` 集成 ✅

### Phase 2: 列流转事件
- [x] 发射 `COLUMN_TRANSITION` 事件 ✅
- [x] 创建 `ColumnTransitionHandler` ✅
- [x] 基于 `KanbanColumnAutomation` 触发列 Agent ✅

### Phase 3: Desk Check Agent
- [x] 创建 `resources/specialists/desk-check.md` ✅
- [ ] 实现 `request_artifact` 工具 ❌
- [ ] 实现 `provide_artifact` 工具 ❌
- [ ] 添加截图捕获能力 ❌

### Phase 4: 工作流编排
- [x] 实现 `KanbanWorkflowOrchestrator` 类 ✅
- [x] 跨列跟踪任务进度 ✅
- [x] 处理成功时的自动推进 ✅
- [ ] 在流转前强制执行产物要求 ❌
- [ ] 发射工作流完成事件（部分完成）

---

## 🔧 推荐的实现顺序

### 优先级 1: 产物通信（关键缺口）
1. **创建产物存储**（2-3 天）
   - 定义 `Artifact` 模型，包含 `taskId`、`agentId`、`type`、`content`、`metadata`
   - 实现 `ArtifactStore`（SQLite + Postgres）
   - 添加 CRUD 操作

2. **实现 MCP 工具**（1-2 天）
   - 在 `AgentTools` 中实现 `request_artifact`
   - 在 `AgentTools` 中实现 `provide_artifact`
   - 在 `routa-mcp-tool-manager.ts` 中注册

3. **截图集成**（1 天）
   - 添加 `capture_screenshot` MCP 工具
   - 封装 `agent-browser screenshot` 命令
   - 自动存储为产物

### 优先级 2: 产物强制校验（中等）
4. **强制执行所需产物**（1 天）
   - 更新 `ColumnTransitionHandler` 以检查 `requiredArtifacts`
   - 若缺失则阻止流转
   - 在 `kanban-tab.tsx` 中添加 UI 反馈

### 优先级 3: UI 增强（低）
5. **Agent 活动面板**（2 天）
   - 按列展示活跃 Agent
   - 显示产物请求/响应
   - 链接到 Agent 会话

6. **产物预览**（1 天）
   - 在任务卡片上展示附加的产物
   - 内联预览截图
   - 下载测试结果

---

## 🚧 待解决的问题（来自 Issue）

1. **命名**: "Column Agent" vs "Transition Agent" vs "Stage Agent"？
   - **建议**: 使用 "Transition Agent"（更准确）

2. **产物存储**: 在哪里存储截图/产物？
   - **建议**: 专用的 `ArtifactStore`（方案 B）
   - 原因: 分离更清晰、更易查询、支持二进制内容

3. **失败处理**: 如果列 Agent 失败会发生什么？
   - **当前**: Agent 状态设为 ERROR，任务状态设为 BLOCKED
   - **建议**: 添加带指数退避的重试逻辑
   - 将卡片移至 "Blocked" 列并附带错误消息

4. **并行任务**: 多个任务能否同时处于 Dev 中？
   - **当前**: 可以，无硬性限制
   - **建议**: 在自动化配置中为每列添加可选的并发限制

---

## 📝 总结

**有效的功能**:
- ✅ 看板 Agent 可从自然语言拆解任务
- ✅ 列流转可触发自动化
- ✅ Agent 成功时自动推进
- ✅ 已定义 Desk Check Agent 专家

**缺失的功能**:
- ❌ Agent 之间的产物通信（`request_artifact`、`provide_artifact`）
- ❌ 产物存储系统
- ❌ 截图捕获集成
- ❌ 产物要求强制校验
- ❌ Agent 活动 UI 面板

**预计剩余工作量**: 1-2 周（与 issue 总计 2-3 周的估算相符）

**后续步骤**:
1. 实现产物存储层
2. 添加 `request_artifact` 与 `provide_artifact` MCP 工具
3. 集成截图捕获
4. 在流转中强制执行产物要求
5. 构建 Agent 活动 UI 面板

## 归档说明

本文件现已作为历史分析快照归档，而非活跃的实现跟踪记录。

- issue `#100` 的规范 GitHub 镜像为
  `docs/issues/2026-03-09-gh-100-feat-kanban-implement-kanban-agent-with-multi-task-creation-and-column-t.md`。
- 该镜像 issue 在本地已为 `resolved`，在 GitHub 上已 `closed`。
- 上述列出的缺口作为历史背景仍有参考价值，但本文档
  不应再保持 `investigating` 状态。
