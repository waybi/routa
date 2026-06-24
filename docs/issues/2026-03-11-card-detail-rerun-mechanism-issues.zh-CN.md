---
title: "卡片详情重跑机制问题"
date: 2026-03-11
status: resolved
severity: high
area: kanban
components: [kanban, mcp-tools, agent-trigger]
resolved_date: 2026-03-11
---

# 卡片详情重跑机制问题

## 问题摘要

卡片详情重跑（Card Detail Rerun）机制存在多个问题：

1. **`update_card` 工具在 MCP 工具页面不可见** —— 该工具已注册，但未显示在 http://localhost:3000/mcp-tools
2. **Agent 提示词缺少 MCP 工具访问权限** —— 从卡片详情触发的 Agent 没有正确配置工具访问权限
3. **重跑机制未提供任务上下文** —— 被触发的 Agent 没有收到正确的任务信息

## 解决方案

所有问题均已修复：

1. **将 `update_card` 和 `move_card` 加入 essential 模式** —— 这两个工具现已在 `routa-mcp-tool-manager.ts` 中以 essential 模式注册，并被纳入 `mcp-tool-executor.ts` 的 `ESSENTIAL_TOOL_NAMES`
2. **增强 `buildTaskPrompt`，加入工具使用说明** —— 提示词现在包含：
   - 供 Agent 配合 `update_card` 使用的卡片 ID
   - 可用 MCP 工具及其描述的列表
   - 工具使用的分步说明
3. **将卡片上下文加入任务提示词** —— 提示词现在包含卡片 ID、优先级、标签以及 GitHub issue URL

## 根本原因

### 1. `update_card` 工具在 MCP 工具页面不可见

**位置：** `src/core/mcp/routa-mcp-tool-manager.ts`（第 1005-1027 行）

`update_card` 工具确实在 `registerTools()` 方法中注册了，但仅在 **“full” 模式** 下注册：

```typescript
// Full mode: All tools
if (this.toolMode === "full") {
  // ... other tools ...
  this.registerUpdateCard(server);  // ← Only registered in full mode
}
```

然而，`/mcp-tools` 处的 MCP 工具页面默认采用 **“essential” 模式**，该模式只包含 12 个核心协调工具。`update_card` 工具属于看板工具，被排除在 essential 模式之外。

**证据：**
- `src/app/mcp-tools/page.tsx` 第 73 行：`const [essentialMode, setEssentialMode] = useState(true);`
- `src/core/mcp/routa-mcp-tool-manager.ts` 第 95-120 行：essential 模式只注册 Task（1 个）、Agent（7 个）、Note（5 个）和 Artifact（6 个）工具

### 2. Agent 提示词配置问题

**位置：** `src/core/kanban/agent-trigger.ts`

`triggerAssignedTaskAgent()` 函数创建了一个 ACP 会话，但：

1. **未指定工具模式** —— 创建会话时没有指定应可用哪些 MCP 工具
2. **提示词过于通用** —— `buildTaskPrompt()` 函数（第 18-30 行）生成的只是一段简单文本提示词，没有任何工具使用说明
3. **未注入 specialist 系统提示词** —— 虽然该函数接受 `task.assignedSpecialistId`，但它并没有加载或注入 specialist 的系统提示词，而该提示词本应包含工具使用说明

```typescript
// Current implementation (line 33-75)
export async function triggerAssignedTaskAgent(params: {
  origin: string;
  workspaceId: string;
  cwd: string;
  branch?: string;
  task: Task;
}): Promise<{ sessionId?: string; error?: string }> {
  const { origin, workspaceId, cwd, branch, task } = params;
  const provider = task.assignedProvider ?? "opencode";
  const role = task.assignedRole ?? "CRAFTER";

  // Creates session but doesn't specify tool mode or load specialist prompt
  const newSessionResponse = await fetch(`${origin}/api/acp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: uuidv4(),
      method: "session/new",
      params: {
        cwd,
        branch,
        provider,
        role,
        workspaceId,
        specialistId: task.assignedSpecialistId,  // ← Passed but not used properly
        name: `${task.title} · ${provider}`,
      },
    }),
  });
  // ...
}
```

### 3. 未加载 specialist 系统提示词

**位置：** `src/app/api/acp/route.ts`（第 576-600 行）

ACP 路由在创建会话时确实会加载 specialist 系统提示词：

```typescript
// ── Load specialist system prompt ──────────────────────────────
let specialistSystemPrompt: string | undefined;

if (specialistId) {
  let specialist: { systemPrompt?: string; roleReminder?: string } | null | undefined;
  
  if (isPostgres()) {
    // Load from database
  } else {
    specialist = loadSpecialistsSync().find(s => s.id === specialistId.toLowerCase());
  }
  
  if (specialist?.systemPrompt) {
    let prompt = specialist.systemPrompt;
    if (specialist.roleReminder) {
      prompt += `\n\n---\n**Reminder:** ${specialist.roleReminder}`;
    }
    specialistSystemPrompt = prompt;
  }
}
```

然而，specialist 系统提示词应当包含说明：哪些 MCP 工具可用以及如何使用它们，尤其是 `update_card`。

## 影响

1. **Agent 无法更新卡片** —— 即使 Agent 知道应当更新卡片，该工具也不可用
2. **Agent 行为不佳** —— 由于系统提示词中没有正确的工具说明，Agent 不清楚自己具备哪些能力
3. **工具可用性不一致** —— MCP 工具页面展示的是一组工具，而 Agent 拿到的却是另一组工具

## 推荐修复方案

### 修复 1：将 `update_card` 加入 essential 模式（若卡片 Agent 需要）

**文件：** `src/core/mcp/routa-mcp-tool-manager.ts`

如果分配到卡片的 Agent 需要更新卡片，请将 `update_card` 加入 essential 模式：

```typescript
if (this.toolMode === "essential") {
  // ... existing essential tools ...
  
  // Kanban tools (for card-assigned agents)
  this.registerUpdateCard(server);
}
```

### 修复 2：创建卡片 Agent 会话时指定工具模式

**文件：** `src/core/kanban/agent-trigger.ts`

在创建会话时加入工具模式配置：

```typescript
const newSessionResponse = await fetch(`${origin}/api/acp`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: uuidv4(),
    method: "session/new",
    params: {
      cwd,
      branch,
      provider,
      role,
      workspaceId,
      specialistId: task.assignedSpecialistId,
      name: `${task.title} · ${provider}`,
      toolMode: "full",  // ← Add this to ensure all tools are available
    },
  }),
});
```

### 修复 3：增强 `buildTaskPrompt`，加入工具使用说明

**文件：** `src/core/kanban/agent-trigger.ts`

更新提示词以包含工具使用说明：

```typescript
export function buildTaskPrompt(task: Task): string {
  const labels = task.labels.length > 0 ? `Labels: ${task.labels.join(", ")}` : "Labels: none";
  return [
    `You are assigned to Kanban task: ${task.title}`,
    "",
    task.objective,
    "",
    `Priority: ${task.priority ?? "medium"}`,
    labels,
    task.githubUrl ? `GitHub Issue: ${task.githubUrl}` : "GitHub Issue: local-only",
    "",
    "## Available Tools",
    "",
    "You have access to MCP tools including:",
    "- update_card: Update this card's title, description, priority, or labels",
    "- move_card: Move this card to a different column",
    "- create_note: Create notes for documentation",
    "- git_commit: Commit your changes",
    "",
    "Start implementation work immediately. Use update_card to track progress.",
    "Report completion using report_to_parent when done.",
  ].join("\n");
}
```

### 修复 4：确保 specialist 提示词包含工具说明

**文件：** specialist 配置文件或数据库

确保 specialist 系统提示词（尤其是 CRAFTER 和 DEVELOPER 角色）包含关于可用 MCP 工具及其使用时机的说明。

## 测试计划

1. **测试 `update_card` 可见性：**
   - 访问 http://localhost:3000/mcp-tools
   - 关闭 “Essential” 模式（切换到 “Full” 模式）
   - 确认 `update_card` 出现在看板分类中

2. **测试卡片 Agent 的工具访问权限：**
   - 在看板上创建一张卡片
   - 将其分配给一个 Agent（provider + specialist）
   - 点击 “Run” 或 “Rerun”
   - 检查该 Agent 的会话 Trace，确认：
     - MCP 工具可用
     - Agent 尝试使用 `update_card` 或其他工具
     - 工具调用成功

3. **测试 specialist 提示词注入：**
   - 使用某个 specialist 创建一个会话
   - 确认首条提示词包含该 specialist 的系统提示词
   - 检查工具使用说明是否存在

## 相关文件

- `src/core/mcp/routa-mcp-tool-manager.ts` —— 工具注册
- `src/core/kanban/agent-trigger.ts` —— Agent 触发逻辑
- `src/app/api/acp/route.ts` —— ACP 会话管理
- `src/app/mcp-tools/page.tsx` —— MCP 工具界面
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx` —— 卡片详情界面
- `src/core/tools/kanban-tools.ts` —— 看板工具实现

## 后续步骤

1. 确定工具模式策略：卡片 Agent 应使用 “essential” 还是 “full” 模式？
2. 如果选用 “essential”，则将必要的看板工具加入 essential 模式
3. 更新 `triggerAssignedTaskAgent` 以指定工具模式
4. 增强 `buildTaskPrompt`，加入工具使用说明
5. 审查并更新 specialist 系统提示词
6. 端到端测试完整流程
