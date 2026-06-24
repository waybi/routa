---
status: generated
purpose: Routa.js 的自动生成路由与 API 界面索引。
sources:
  - src/app/**/page.tsx
  - api-contract.yaml
  - src/app/api/**/route.ts
  - crates/routa-server/src/api/**/*.rs
update_policy:
  - "通过 `routa feature-tree generate` 或经由 Feature Explorer UI 重新生成。"
  - "在此 frontmatter 块中手动编辑语义化的 `feature_metadata` 字段。"
  - "`feature_metadata.features[].source_files` 会根据声明的页面/API 重新生成。"
  - "请勿手动编辑下方生成的端点或路由表。"
feature_metadata:
  schema_version: 1
  capability_groups:
    - id: workspace-coordination
      name: 工作区协同
      description: 工作区范围内的导航、概览以及跨界面协同。
    - id: agent-execution
      name: Agent 执行
      description: 以会话为中心的 Agent 运行、恢复以及可追溯的执行上下文。
    - id: kanban-automation
      name: 看板自动化
      description: 任务流转、泳道自动化以及工作流推进。
    - id: team-collaboration
      name: 团队协作
      description: 工作区内的多 Agent 与多会话协作。
    - id: governance-settings
      name: 治理与设置
      description: Harness、fluency、MCP、设置以及平台治理界面。
  features:
    - id: workspace-overview
      name: 工作区概览
      group: workspace-coordination
      summary: 选定工作区及其范围内各界面的入口。
      status: shipped
      pages:
        - /workspace/:workspaceId
        - /workspace/:workspaceId/overview
      domain_objects:
        - activity
        - codebase
        - note
        - workspace
      source_files:
        - src/app/workspace/[workspaceId]/overview/page.tsx
        - src/app/workspace/[workspaceId]/page.tsx
    - id: feature-explorer
      name: 功能浏览器
      group: workspace-coordination
      summary: 检查工作区功能界面以及由会话支撑的文件活动。
      status: evolving
      pages:
        - /workspace/:workspaceId/feature-explorer
      apis:
        - GET /api/feature-explorer
        - GET /api/feature-explorer/{featureId}
        - GET /api/feature-explorer/{featureId}/apis
        - GET /api/feature-explorer/{featureId}/files
      source_files:
        - crates/routa-server/src/api/feature_explorer.rs
        - src/app/api/feature-explorer/[featureId]/apis/route.ts
        - src/app/api/feature-explorer/[featureId]/files/route.ts
        - src/app/api/feature-explorer/[featureId]/route.ts
        - src/app/api/feature-explorer/route.ts
        - >-
          src/app/workspace/[workspaceId]/feature-explorer/feature-explorer-page-client.tsx
        - src/app/workspace/[workspaceId]/feature-explorer/page.tsx
    - id: session-recovery
      name: 会话恢复
      group: agent-execution
      summary: 恢复、检查并继续工作区范围内的 Agent 会话。
      status: shipped
      pages:
        - /workspace/:workspaceId/sessions
        - /workspace/:workspaceId/sessions/:sessionId
      apis:
        - DELETE /api/sessions/{id}
        - GET /api/sessions
        - GET /api/sessions/{id}
        - GET /api/sessions/{id}/history
        - GET /api/sessions/{id}/transcript
        - GET /api/sessions/{sessionId}/context
        - GET /api/sessions/{sessionId}/reposlide-result
        - GET /api/sessions/{sessionId}/reposlide-result/download
        - PATCH /api/sessions/{id}
        - POST /api/sessions/{id}/disconnect
        - POST /api/sessions/{sessionId}/fork
      domain_objects:
        - session
        - trace
        - workspace
      related_features:
        - team-runs
        - workspace-overview
      source_files:
        - crates/routa-server/src/api/sessions.rs
        - src/app/api/sessions/[sessionId]/context/route.ts
        - src/app/api/sessions/[sessionId]/disconnect/route.ts
        - src/app/api/sessions/[sessionId]/fork/route.ts
        - src/app/api/sessions/[sessionId]/history/route.ts
        - src/app/api/sessions/[sessionId]/reposlide-result/download/route.ts
        - src/app/api/sessions/[sessionId]/reposlide-result/route.ts
        - src/app/api/sessions/[sessionId]/route.ts
        - src/app/api/sessions/[sessionId]/transcript/route.ts
        - src/app/api/sessions/route.ts
        - src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx
        - src/app/workspace/[workspaceId]/sessions/page.tsx
    - id: kanban-workflow
      name: 看板工作流
      group: kanban-automation
      summary: >-
        通过泳道流转、自动化以及具备 git 感知的执行来协调任务。
      status: shipped
      pages:
        - /workspace/:workspaceId/kanban
      apis:
        - GET /api/kanban/boards
        - GET /api/kanban/boards/{boardId}
        - GET /api/kanban/events
        - GET /api/kanban/export
        - PATCH /api/kanban/boards/{boardId}
        - POST /api/kanban/boards
        - POST /api/kanban/decompose
        - POST /api/kanban/import
      domain_objects:
        - board
        - task
        - workflow
        - workspace
      related_features:
        - session-recovery
      source_files:
        - crates/routa-server/src/api/kanban.rs
        - src/app/api/kanban/boards/[boardId]/route.ts
        - src/app/api/kanban/boards/route.ts
        - src/app/api/kanban/decompose/route.ts
        - src/app/api/kanban/events/route.ts
        - src/app/api/kanban/export/route.ts
        - src/app/api/kanban/import/route.ts
        - src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx
        - src/app/workspace/[workspaceId]/kanban/page.tsx
    - id: team-runs
      name: 团队运行
      group: team-collaboration
      summary: 在工作区内编排并检查多 Agent 团队运行。
      status: shipped
      pages:
        - /workspace/:workspaceId/team
        - /workspace/:workspaceId/team/:sessionId
      domain_objects:
        - session
        - team-run
        - workspace
      related_features:
        - session-recovery
      source_files:
        - src/app/workspace/[workspaceId]/team/[sessionId]/page.tsx
        - src/app/workspace/[workspaceId]/team/page.tsx
    - id: harness-console
      name: Harness 控制台
      group: governance-settings
      summary: >-
        检查仓库信号、治理界面以及与适应度相关的运行时状态。
      status: evolving
      pages:
        - /settings/harness
        - /workspace/:workspaceId/spec
      apis:
        - GET /api/fitness/architecture
        - GET /api/fitness/plan
        - GET /api/fitness/report
        - GET /api/fitness/runtime
        - GET /api/fitness/specs
        - GET /api/harness/agent-hooks
        - GET /api/harness/automations
        - GET /api/harness/codeowners
        - GET /api/harness/design-decisions
        - GET /api/harness/github-actions
        - GET /api/harness/hooks
        - GET /api/harness/hooks/preview
        - GET /api/harness/instructions
        - GET /api/harness/repo-signals
        - GET /api/harness/spec-sources
        - POST /api/fitness/analyze
      domain_objects:
        - fitness
        - harness
        - spec
      source_files:
        - crates/routa-server/src/api/fitness.rs
        - crates/routa-server/src/api/harness.rs
        - src/app/api/fitness/analyze/route.ts
        - src/app/api/fitness/architecture/route.ts
        - src/app/api/fitness/plan/route.ts
        - src/app/api/fitness/report/route.ts
        - src/app/api/fitness/runtime/route.ts
        - src/app/api/fitness/specs/route.ts
        - src/app/api/harness/agent-hooks/route.ts
        - src/app/api/harness/automations/route.ts
        - src/app/api/harness/codeowners/route.ts
        - src/app/api/harness/design-decisions/route.ts
        - src/app/api/harness/github-actions/route.ts
        - src/app/api/harness/hooks/preview/route.ts
        - src/app/api/harness/hooks/route.ts
        - src/app/api/harness/instructions/route.ts
        - src/app/api/harness/repo-signals/route.ts
        - src/app/api/harness/spec-sources/route.ts
        - src/app/settings/harness/page.tsx
        - src/app/workspace/[workspaceId]/spec/page.tsx
        - src/client/hooks/use-harness-settings-data.ts
---

# Routa.js — 产品功能规范

多 Agent 协同平台。本文档自动生成自：
- 前端路由：`src/app/**/page.tsx`
- 契约 API：`api-contract.yaml`
- Next.js API 路由：`src/app/api/**/route.ts`
- Rust API 路由：`crates/routa-server/src/api/**/*.rs`
- 功能元数据：本文件中的 `feature_metadata` frontmatter（`source_files` 会重新生成）

---

## 前端页面

| 页面 | 路由 | 源文件 | 说明 |
|------|-------|-------------|-------------|
| 首页 | `/` | `src/app/page.tsx` | 以工作区优先的着陆页，用于选择工作区、连接 Provider 以及… |
| A2A 协议测试页 | `/a2a` | `src/app/a2a/page.tsx` | 用于 Agent-to-Agent（A2A）协议的交互式测试界面 |
| AG-UI 协议测试页 | `/ag-ui` | `src/app/ag-ui/page.tsx` | 用于测试 AG-UI 协议集成的独立页面 |
| Canvas | `/canvas/:id` | `src/app/canvas/[id]/page.tsx` | 按 ID 打开已保存 canvas 产物的查看页面，包括静态导出… |
| 调试 / ACP 回放 | `/debug/acp-replay` | `src/app/debug/acp-replay/page.tsx` | 用于回放 ACP transcript 并检查会话事件序列的调试界面 |
| MCP 工具 | `/mcp-tools` | `src/app/mcp-tools/page.tsx` | 快捷路由，重定向至 MCP 工具设置界面以进行浏览… |
| 消息页 — 通知与 PR Agent 执行历史 | `/messages` | `src/app/messages/page.tsx` | 展示：- 带筛选的所有通知 - 来自后端的 PR Agent 执行历史… |
| 设置页 | `/settings` | `src/app/settings/page.tsx` | 为所有 Routa 设置提供整页 UI：- Provider（默认 Agent Provider… |
| 设置 / Agents | `/settings/agents` | `src/app/settings/agents/page.tsx` | 用于安装、发现和管理 ACP 兼容 Agent 运行时的设置页面 |
| 设置 / Fitness | `/settings/fitness` | `src/app/settings/fitness/page.tsx` | 兼容性路由，将适应度配置请求转发至 fluency… |
| 设置 / Fluency | `/settings/fluency` | `src/app/settings/fluency/page.tsx` | 用于仓库 fluency 分析、适应度快照以及 harnessability… 的设置页面 |
| 设置 / Harness | `/settings/harness` | `src/app/settings/harness/page.tsx` | Harness 控制台的设置入口，包括仓库信号、设计决策… |
| 设置 / MCP | `/settings/mcp` | `src/app/settings/mcp/page.tsx` | 用于管理 MCP 服务器、工具以及传输层配置的设置页面 |
| 设置 / 计划任务 | `/settings/schedules` | `src/app/settings/schedules/page.tsx` | 支持工作区感知的计划管理页面，用于触发器、周期性运行以及计划… |
| 设置 / 专家 | `/settings/specialists` | `src/app/settings/specialists/page.tsx` | 用于配置专家人设、绑定以及模型感知专家… 的设置页面 |
| 设置 / Webhooks | `/settings/webhooks` | `src/app/settings/webhooks/page.tsx` | 用于配置 GitHub webhook 接入并检查 webhook… 的设置页面 |
| 设置 / 工作流 | `/settings/workflows` | `src/app/settings/workflows/page.tsx` | 用于定义可复用工作流并审阅以工作流为中心的执行… 的设置页面 |
| Trace 页 | `/traces` | `src/app/traces/page.tsx` | 用于浏览和分析 Agent Trace 记录的整页视图 |
| 工作区页（服务端组件包装器） | `/workspace/:workspaceId` | `src/app/workspace/[workspaceId]/page.tsx` | 该服务端组件为静态导出提供 generateStaticParams，并重定向… |
| 代码库 / RepoSlide | `/workspace/:workspaceId/codebases/:codebaseId/reposlide` | `src/app/workspace/[workspaceId]/codebases/[codebaseId]/reposlide/page.tsx` | 工作区范围内的 RepoSlide 界面，用于生成和审阅演示文稿输出… |
| 工作区 / Feature Explorer | `/workspace/:workspaceId/feature-explorer` | `src/app/workspace/[workspaceId]/feature-explorer/page.tsx` |  |
| 工作区 / 看板 | `/workspace/:workspaceId/kanban` | `src/app/workspace/[workspaceId]/kanban/page.tsx` | 工作区范围内任务协调的主看板，用于泳道自动化以及 Git 感知… |
| 工作区 / 概览 | `/workspace/:workspaceId/overview` | `src/app/workspace/[workspaceId]/overview/page.tsx` | 工作区入口路由，目前重定向至会话界面，同时… |
| 工作区 / 会话 | `/workspace/:workspaceId/sessions` | `src/app/workspace/[workspaceId]/sessions/page.tsx` | 工作区范围内的会话索引，用于浏览、筛选和打开 Agent 执行… |
| 工作区会话页（服务端组件包装器） | `/workspace/:workspaceId/sessions/:sessionId` | `src/app/workspace/[workspaceId]/sessions/[sessionId]/page.tsx` | 该服务端组件为静态导出提供 generateStaticParams，并渲染… |
| 工作区 / Spec | `/workspace/:workspaceId/spec` | `src/app/workspace/[workspaceId]/spec/page.tsx` | 用于本地 docs/issues 记录的密集 issue 关系看板 |
| 工作区 / 团队 | `/workspace/:workspaceId/team` | `src/app/workspace/[workspaceId]/team/page.tsx` | 工作区范围内的团队运行索引，用于多 Agent 协作与协调… |
| 工作区 / 团队 | `/workspace/:workspaceId/team/:sessionId` | `src/app/workspace/[workspaceId]/team/[sessionId]/page.tsx` | 用于检查特定工作区团队运行及其协调会话… 的详情页面 |

---

## API 契约端点

### A2a (8)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/a2a/card` | A2A Agent 卡片 | `src/app/api/a2a/card/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| POST | `/api/a2a/message` | 通过 A2A 协议发送消息 | `src/app/api/a2a/message/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/rpc` | A2A SSE 流 | `src/app/api/a2a/rpc/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| POST | `/api/a2a/rpc` | A2A JSON-RPC | `src/app/api/a2a/rpc/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/sessions` | 列出 A2A 会话 | `src/app/api/a2a/sessions/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/tasks` | 列出 A2A 任务 | `src/app/api/a2a/tasks/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| GET | `/api/a2a/tasks/{id}` | 按 ID 获取 A2A 任务 | `src/app/api/a2a/tasks/[id]/route.ts` | `crates/routa-server/src/api/a2a.rs` |
| POST | `/api/a2a/tasks/{id}` | 更新 / 响应 A2A 任务 | `src/app/api/a2a/tasks/[id]/route.ts` | `crates/routa-server/src/api/a2a.rs` |

### A2ui (2)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/a2ui/dashboard` | 获取 A2UI v0.10 仪表盘数据 | `src/app/api/a2ui/dashboard/route.ts` | `crates/routa-server/src/api/a2ui.rs` |
| POST | `/api/a2ui/dashboard` | 向仪表盘添加自定义 A2UI 消息 | `src/app/api/a2ui/dashboard/route.ts` | `crates/routa-server/src/api/a2ui.rs` |

### Acp (15)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/acp` | ACP SSE 流 | `src/app/api/acp/route.ts` | `crates/routa-server/src/api/acp_routes.rs` |
| POST | `/api/acp` | ACP JSON-RPC 端点 | `src/app/api/acp/route.ts` | `crates/routa-server/src/api/acp_routes.rs` |
| POST | `/api/acp/docker/container/start` | 为 OpenCode agent 启动 Docker 容器 | `src/app/api/acp/docker/container/start/route.ts` | `crates/routa-server/src/api/acp_docker.rs` |
| POST | `/api/acp/docker/container/stop` | 停止 Docker 容器 | `src/app/api/acp/docker/container/stop/route.ts` | `crates/routa-server/src/api/acp_docker.rs` |
| GET | `/api/acp/docker/containers` | 列出 OpenCode agent 的 Docker 容器 | `src/app/api/acp/docker/containers/route.ts` | `crates/routa-server/src/api/acp_docker.rs` |
| POST | `/api/acp/docker/pull` | 拉取 Docker 镜像 | `src/app/api/acp/docker/pull/route.ts` | `crates/routa-server/src/api/acp_docker.rs` |
| GET | `/api/acp/docker/status` | 获取 Docker 守护进程状态 | `src/app/api/acp/docker/status/route.ts` | `crates/routa-server/src/api/acp_docker.rs` |
| DELETE | `/api/acp/install` | 卸载 ACP agent | `src/app/api/acp/install/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/install` | 安装 ACP agent | `src/app/api/acp/install/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| GET | `/api/acp/registry` | 列出 ACP 注册表中的 agent | `src/app/api/acp/registry/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/registry` | 在 ACP 注册表中注册 agent | `src/app/api/acp/registry/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| GET | `/api/acp/runtime` | 获取 ACP 运行时状态 | `src/app/api/acp/runtime/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/runtime` | 启动 ACP 运行时 | `src/app/api/acp/runtime/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| GET | `/api/acp/warmup` | 获取 ACP 预热状态 | `src/app/api/acp/warmup/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |
| POST | `/api/acp/warmup` | 触发 ACP 预热 | `src/app/api/acp/warmup/route.ts` | `crates/routa-server/src/api/acp_registry.rs` |

### Ag-Ui (1)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| POST | `/api/ag-ui` | 处理 AG-UI 协议请求（SSE 流） | `src/app/api/ag-ui/route.ts` | `crates/routa-server/src/api/ag_ui.rs` |

### Agents (5)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/agents` | 列出 agent（或通过 id 查询参数获取单个） | `src/app/api/agents/route.ts` | `crates/routa-server/src/api/agents.rs` |
| POST | `/api/agents` | 创建新 agent | `src/app/api/agents/route.ts` | `crates/routa-server/src/api/agents.rs` |
| DELETE | `/api/agents/{id}` | 删除 agent | `src/app/api/agents/[id]/route.ts` | `crates/routa-server/src/api/agents.rs` |
| GET | `/api/agents/{id}` | 按 ID 获取 agent（REST 风格路径参数） | `src/app/api/agents/[id]/route.ts` | `crates/routa-server/src/api/agents.rs` |
| POST | `/api/agents/{id}/status` | 更新 agent 状态 | `src/app/api/agents/[id]/status/route.ts` | `crates/routa-server/src/api/agents.rs` |

### Background-Tasks (7)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/background-tasks` | 列出后台任务 | `src/app/api/background-tasks/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| POST | `/api/background-tasks` | 创建后台任务 | `src/app/api/background-tasks/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| DELETE | `/api/background-tasks/{id}` | 取消后台任务 | `src/app/api/background-tasks/[id]/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| GET | `/api/background-tasks/{id}` | 按 ID 获取后台任务 | `src/app/api/background-tasks/[id]/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| PATCH | `/api/background-tasks/{id}` | 更新后台任务（仅限 PENDING） | `src/app/api/background-tasks/[id]/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| POST | `/api/background-tasks/{id}/retry` | 重试失败的后台任务 | `src/app/api/background-tasks/[id]/retry/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |
| POST | `/api/background-tasks/process` | 处理下一个待处理的后台任务 | `src/app/api/background-tasks/process/route.ts` | `crates/routa-server/src/api/background_tasks.rs` |

### Canvas (5)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/canvas` | 列出工作区的 canvas 产物 | `src/app/api/canvas/route.ts` | `crates/routa-server/src/api/canvas.rs` |
| POST | `/api/canvas` | 创建 canvas 产物 | `src/app/api/canvas/route.ts` | `crates/routa-server/src/api/canvas.rs` |
| DELETE | `/api/canvas/{id}` | 删除 canvas 产物 | `src/app/api/canvas/[id]/route.ts` | `crates/routa-server/src/api/canvas.rs` |
| GET | `/api/canvas/{id}` | 按 ID 获取 canvas 产物 | `src/app/api/canvas/[id]/route.ts` | `crates/routa-server/src/api/canvas.rs` |
| POST | `/api/canvas/specialist` | 直接根据专家提示生成 canvas 产物 | `src/app/api/canvas/specialist/route.ts` | `crates/routa-server/src/api/canvas.rs` |

### Clone (9)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/clone` | 列出已克隆的仓库 | `src/app/api/clone/route.ts` | `crates/routa-server/src/api/clone.rs` |
| PATCH | `/api/clone` | 切换已克隆仓库的分支 | `src/app/api/clone/route.ts` | `crates/routa-server/src/api/clone.rs` |
| POST | `/api/clone` | 克隆 GitHub 仓库 | `src/app/api/clone/route.ts` | `crates/routa-server/src/api/clone.rs` |
| DELETE | `/api/clone/branches` | 删除本地分支 | `src/app/api/clone/branches/route.ts` | `crates/routa-server/src/api/clone_branches.rs` |
| GET | `/api/clone/branches` | 获取分支信息 | `src/app/api/clone/branches/route.ts` | `crates/routa-server/src/api/clone_branches.rs` |
| PATCH | `/api/clone/branches` | 检出分支 | `src/app/api/clone/branches/route.ts` | `crates/routa-server/src/api/clone_branches.rs` |
| POST | `/api/clone/branches` | 拉取远程分支 | `src/app/api/clone/branches/route.ts` | `crates/routa-server/src/api/clone_branches.rs` |
| POST | `/api/clone/local` | 加载已有的本地 git 仓库 | `src/app/api/clone/local/route.ts` | `crates/routa-server/src/api/clone_local.rs` |
| POST | `/api/clone/progress` | 带 SSE 进度的克隆 | `src/app/api/clone/progress/route.ts` | `crates/routa-server/src/api/clone_progress.rs` |

### Codebases (3)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/codebases/{id}` | 删除代码库 | `src/app/api/codebases/[codebaseId]/route.ts` | `crates/routa-server/src/api/codebases.rs` |
| PATCH | `/api/codebases/{id}` | 更新代码库元数据 | `src/app/api/codebases/[codebaseId]/route.ts` | `crates/routa-server/src/api/codebases.rs` |
| POST | `/api/codebases/{id}/default` | 将代码库设为默认 | `src/app/api/codebases/[codebaseId]/default/route.ts` | `crates/routa-server/src/api/codebases.rs` |

### Debug (1)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/debug/path` | 调试端点 — 返回解析后的二进制路径（仅桌面端） | `src/app/api/debug/path/route.ts` | `crates/routa-server/src/api/debug.rs` |

### Files (1)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/files/search` | 在代码库中搜索文件 | `src/app/api/files/search/route.ts` | `crates/routa-server/src/api/files.rs` |

### Fitness (6)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| POST | `/api/fitness/analyze` | 运行 Harness fluency 分析，并返回一个或多个 profile 的增量 harnessability 基线 | `src/app/api/fitness/analyze/route.ts` | `crates/routa-server/src/api/fitness.rs` |
| GET | `/api/fitness/architecture` | 获取某个仓库上下文的后端架构质量报告 | `src/app/api/fitness/architecture/route.ts` | `crates/routa-server/src/api/fitness.rs` |
| GET | `/api/fitness/plan` | 为某个仓库上下文构建可执行的适应度计划 | `src/app/api/fitness/plan/route.ts` | `crates/routa-server/src/api/fitness.rs` |
| GET | `/api/fitness/report` | 读取已持久化的 Harness fluency 快照及其增量 harnessability 基线负载 | `src/app/api/fitness/report/route.ts` | `crates/routa-server/src/api/fitness.rs` |
| GET | `/api/fitness/runtime` | 读取某个仓库上下文的最新 Entrix 运行时适应度状态与产物摘要 | `src/app/api/fitness/runtime/route.ts` | `crates/routa-server/src/api/fitness.rs` |
| GET | `/api/fitness/specs` | 检查 docs/fitness 源文件及解析后的指标元数据 | `src/app/api/fitness/specs/route.ts` | `crates/routa-server/src/api/fitness.rs` |

### Git (3)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/git/commit` | 获取 git 提交元数据与变更文件 | `src/app/api/git/commit/route.ts` | `crates/routa-server/src/api/git.rs` |
| GET | `/api/git/log` | 列出本地仓库的 git 提交历史 | `src/app/api/git/log/route.ts` | `crates/routa-server/src/api/git.rs` |
| GET | `/api/git/refs` | 列出本地仓库的 git 引用 | `src/app/api/git/refs/route.ts` | `crates/routa-server/src/api/git.rs` |

### Github (8)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/github` | 列出活动的 GitHub 虚拟工作区 | `src/app/api/github/route.ts` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/file` | 从已导入的 GitHub 仓库读取文件 | `src/app/api/github/file/route.ts` | `crates/routa-server/src/api/github.rs` |
| POST | `/api/github/import` | 将 GitHub 仓库导入为虚拟工作区（zipball 下载） | `src/app/api/github/import/route.ts` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/issues` | 列出工作区代码库的 GitHub issue | `src/app/api/github/issues/route.ts` | `crates/routa-server/src/api/github.rs` |
| POST | `/api/github/pr-comment` | 在 GitHub pull request 上发表评论 | `src/app/api/github/pr-comment/route.ts` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/pulls` | 列出工作区代码库的 GitHub pull request | `src/app/api/github/pulls/route.ts` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/search` | 在已导入的 GitHub 仓库中搜索文件 | `src/app/api/github/search/route.ts` | `crates/routa-server/src/api/github.rs` |
| GET | `/api/github/tree` | 获取已导入 GitHub 仓库的文件树 | `src/app/api/github/tree/route.ts` | `crates/routa-server/src/api/github.rs` |

### Graph (1)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/graph/analyze` | 分析仓库模块依赖并返回图快照 | `src/app/api/graph/analyze/route.ts` | `crates/routa-server/src/api/graph.rs` |

### Harness (13)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/harness/agent-hooks` | 读取并校验 agent hook 生命周期配置 | `src/app/api/harness/agent-hooks/route.ts` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/automations` | 检查仓库定义的自动化定义、待处理发现项以及运行时计划状态 | `src/app/api/harness/automations/route.ts` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/codeowners` | 解析 CODEOWNERS 并报告所选仓库的归属覆盖情况 | `src/app/api/harness/codeowners/route.ts` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/design-decisions` | 检测所选仓库的架构与 ADR 设计决策来源 | `src/app/api/harness/design-decisions/route.ts` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/github-actions` | 检查仓库的 GitHub Actions 工作流文件 | `src/app/api/harness/github-actions/route.ts` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/hooks` | 检查 hook 运行时 profile、绑定的 hook 文件以及解析后的指标 | `src/app/api/harness/hooks/route.ts` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/hooks/preview` | 为已配置的 profile 运行 hook 运行时预览 | `src/app/api/harness/hooks/preview/route.ts` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/instructions` | 读取 Harness 视图所用的仓库指南文档 | `src/app/api/harness/instructions/route.ts` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/repo-signals` | 检测所选仓库中由 YAML 驱动的构建与测试 Harness 界面 | `src/app/api/harness/repo-signals/route.ts` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/spec-sources` | 检测所选仓库的规范与规划来源系统 | `src/app/api/harness/spec-sources/route.ts` | `crates/routa-server/src/api/harness.rs` |
| GET | `/api/harness/templates` | 列出某个仓库上下文的 Harness 模板 | `src/app/api/harness/templates/route.ts` | `crates/routa-server/src/api/harness_templates.rs` |
| GET | `/api/harness/templates/doctor` | 为某个仓库上下文运行 Harness 模板诊断 | `src/app/api/harness/templates/doctor/route.ts` | `crates/routa-server/src/api/harness_templates.rs` |
| GET | `/api/harness/templates/validate` | 为某个仓库上下文校验 Harness 模板 | `src/app/api/harness/templates/validate/route.ts` | `crates/routa-server/src/api/harness_templates.rs` |

### Health (1)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/health` | 健康检查 — 返回服务状态 | `src/app/api/health/route.ts` | `crates/routa-server/src/lib.rs` |

### Kanban (8)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/kanban/boards` | 列出工作区的看板 | `src/app/api/kanban/boards/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| POST | `/api/kanban/boards` | 创建看板 | `src/app/api/kanban/boards/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| GET | `/api/kanban/boards/{boardId}` | 按 ID 获取看板 | `src/app/api/kanban/boards/[boardId]/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| PATCH | `/api/kanban/boards/{boardId}` | 更新看板 | `src/app/api/kanban/boards/[boardId]/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| POST | `/api/kanban/decompose` | 将自然语言输入拆解为多个看板任务 | `src/app/api/kanban/decompose/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| GET | `/api/kanban/events` | 通过 SSE 流式推送看板工作区事件 | `src/app/api/kanban/events/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| GET | `/api/kanban/export` | 将看板导出为 YAML | `src/app/api/kanban/export/route.ts` | `crates/routa-server/src/api/kanban.rs` |
| POST | `/api/kanban/import` | 从 YAML 导入看板 | `src/app/api/kanban/import/route.ts` | `crates/routa-server/src/api/kanban.rs` |

### Mcp (6)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/mcp` | 终止 MCP 会话 | `src/app/api/mcp/route.ts` | `crates/routa-server/src/api/mcp_routes.rs`, `crates/routa-server/src/api/mcp_routes/rmcp_service.rs`, `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/delegation.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/notes_workspace.rs` |
| GET | `/api/mcp` | MCP SSE 流 | `src/app/api/mcp/route.ts` | `crates/routa-server/src/api/mcp_routes.rs`, `crates/routa-server/src/api/mcp_routes/rmcp_service.rs`, `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/delegation.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/notes_workspace.rs` |
| POST | `/api/mcp` | MCP Streamable HTTP（JSON-RPC） | `src/app/api/mcp/route.ts` | `crates/routa-server/src/api/mcp_routes.rs`, `crates/routa-server/src/api/mcp_routes/rmcp_service.rs`, `crates/routa-server/src/api/mcp_routes/tool_catalog.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/agents_tasks.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/delegation.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/events_kanban.rs`, `crates/routa-server/src/api/mcp_routes/tool_executor/notes_workspace.rs` |
| GET | `/api/mcp/tools` | 列出 MCP 工具 | `src/app/api/mcp/tools/route.ts` | `crates/routa-server/src/api/mcp_tools.rs` |
| PATCH | `/api/mcp/tools` | 更新 MCP 工具配置 | `src/app/api/mcp/tools/route.ts` | `crates/routa-server/src/api/mcp_tools.rs` |
| POST | `/api/mcp/tools` | 执行 MCP 工具 | `src/app/api/mcp/tools/route.ts` | `crates/routa-server/src/api/mcp_tools.rs` |

### Mcp-Server (3)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/mcp-server` | 停止 MCP 服务器 | `src/app/api/mcp-server/route.ts` | `crates/routa-server/src/api/mcp_server_mgmt.rs` |
| GET | `/api/mcp-server` | 获取 MCP 服务器状态 | `src/app/api/mcp-server/route.ts` | `crates/routa-server/src/api/mcp_server_mgmt.rs` |
| POST | `/api/mcp-server` | 启动 MCP 服务器 | `src/app/api/mcp-server/route.ts` | `crates/routa-server/src/api/mcp_server_mgmt.rs` |

### Mcp-Servers (4)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/mcp-servers` | 删除自定义 MCP 服务器 | `src/app/api/mcp-servers/route.ts` | `crates/routa-server/src/api/mcp_servers.rs` |
| GET | `/api/mcp-servers` | 列出自定义 MCP 服务器（或通过 id 查询参数获取单个） | `src/app/api/mcp-servers/route.ts` | `crates/routa-server/src/api/mcp_servers.rs` |
| POST | `/api/mcp-servers` | 创建新的自定义 MCP 服务器 | `src/app/api/mcp-servers/route.ts` | `crates/routa-server/src/api/mcp_servers.rs` |
| PUT | `/api/mcp-servers` | 更新已有的自定义 MCP 服务器 | `src/app/api/mcp-servers/route.ts` | `crates/routa-server/src/api/mcp_servers.rs` |

### System Memory (6)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/memory` | 系统内存监控重置的已弃用别名 | `src/app/api/memory/route.ts` | `crates/routa-server/src/api/memory.rs` |
| GET | `/api/memory` | 运行时内存统计的已弃用别名 | `src/app/api/memory/route.ts` | `crates/routa-server/src/api/memory.rs` |
| POST | `/api/memory` | 运行时内存清理的已弃用别名 | `src/app/api/memory/route.ts` | `crates/routa-server/src/api/memory.rs` |
| DELETE | `/api/system/memory` | 清除运行时内存监控历史 | `src/app/api/system/memory/route.ts` | `crates/routa-server/src/api/memory.rs` |
| GET | `/api/system/memory` | 获取运行时内存监控统计 | `src/app/api/system/memory/route.ts` | `crates/routa-server/src/api/memory.rs` |
| POST | `/api/system/memory` | 触发运行时内存清理 | `src/app/api/system/memory/route.ts` | `crates/routa-server/src/api/memory.rs` |

### Notes (6)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/notes` | 通过查询参数删除笔记 | `src/app/api/notes/route.ts` | `crates/routa-server/src/api/notes.rs` |
| GET | `/api/notes` | 列出笔记或通过 noteId 获取单个 | `src/app/api/notes/route.ts` | `crates/routa-server/src/api/notes.rs` |
| POST | `/api/notes` | 创建或更新笔记 | `src/app/api/notes/route.ts` | `crates/routa-server/src/api/notes.rs` |
| DELETE | `/api/notes/{workspaceId}/{noteId}` | 通过路径参数删除笔记 | `src/app/api/notes/[workspaceId]/[noteId]/route.ts` | `crates/routa-server/src/api/notes.rs` |
| GET | `/api/notes/{workspaceId}/{noteId}` | 通过工作区 + 笔记 ID 获取笔记 | `src/app/api/notes/[workspaceId]/[noteId]/route.ts` | `crates/routa-server/src/api/notes.rs` |
| GET | `/api/notes/events` | 笔记变更事件的 SSE 流 | `src/app/api/notes/events/route.ts` | `crates/routa-server/src/api/notes.rs` |

### Polling (4)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/polling/check` | 运行轮询检查（GET） | `src/app/api/polling/check/route.ts` | `crates/routa-server/src/api/polling.rs` |
| POST | `/api/polling/check` | 运行轮询检查（POST） | `src/app/api/polling/check/route.ts` | `crates/routa-server/src/api/polling.rs` |
| GET | `/api/polling/config` | 获取轮询配置 | `src/app/api/polling/config/route.ts` | `crates/routa-server/src/api/polling.rs` |
| POST | `/api/polling/config` | 更新轮询配置 | `src/app/api/polling/config/route.ts` | `crates/routa-server/src/api/polling.rs` |

### Providers (2)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/providers` | 列出已配置的 LLM Provider | `src/app/api/providers/route.ts` | `crates/routa-server/src/api/providers.rs` |
| GET | `/api/providers/models` | 列出已配置 Provider 的可用模型 | `src/app/api/providers/models/route.ts` | `crates/routa-server/src/api/provider_models.rs` |

### Review (1)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| POST | `/api/review/analyze` | 使用唯一的公开 PR Reviewer 专家分析 git diff | `src/app/api/review/analyze/route.ts` | `crates/routa-server/src/api/review.rs` |

### Rpc (2)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| POST | `/api/rpc` | 通用 JSON-RPC 端点 | `src/app/api/rpc/route.ts` | `crates/routa-server/src/api/rpc.rs` |
| GET | `/api/rpc/methods` | 列出可用的 RPC 方法 | `src/app/api/rpc/methods/route.ts` | `crates/routa-server/src/api/rpc.rs` |

### Sandboxes (8)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/sandboxes` | 列出所有活动的沙箱容器 | `src/app/api/sandboxes/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes` | 创建新的沙箱容器 | `src/app/api/sandboxes/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| DELETE | `/api/sandboxes/{id}` | 停止并移除沙箱容器 | `src/app/api/sandboxes/[id]/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| GET | `/api/sandboxes/{id}` | 按 ID 获取沙箱信息 | `src/app/api/sandboxes/[id]/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/{id}/execute` | 在沙箱中执行代码并以 NDJSON 流式返回结果 | `src/app/api/sandboxes/[id]/execute/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/{id}/permissions/apply` | 重建沙箱并将权限约束应用到其策略 | `src/app/api/sandboxes/[id]/permissions/apply/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/{id}/permissions/explain` | 预览应用权限约束后生效的沙箱策略 | `src/app/api/sandboxes/[id]/permissions/explain/route.ts` | `crates/routa-server/src/api/sandbox.rs` |
| POST | `/api/sandboxes/explain` | 在不创建沙箱的情况下解析并说明生效的沙箱策略 | `src/app/api/sandboxes/explain/route.ts` | `crates/routa-server/src/api/sandbox.rs` |

### Schedules (8)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/schedules` | 列出计划任务 | `src/app/api/schedules/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| POST | `/api/schedules` | 创建新的计划 | `src/app/api/schedules/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| DELETE | `/api/schedules/{id}` | 删除计划 | `src/app/api/schedules/[id]/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| GET | `/api/schedules/{id}` | 按 ID 获取计划 | `src/app/api/schedules/[id]/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| PATCH | `/api/schedules/{id}` | 更新计划 | `src/app/api/schedules/[id]/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| POST | `/api/schedules/{id}/run` | 触发计划立即运行 | `src/app/api/schedules/[id]/run/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| GET | `/api/schedules/tick` | 获取计划任务的 tick 状态 | `src/app/api/schedules/tick/route.ts` | `crates/routa-server/src/api/schedules.rs` |
| POST | `/api/schedules/tick` | 手动触发计划 tick | `src/app/api/schedules/tick/route.ts` | `crates/routa-server/src/api/schedules.rs` |

### Sessions (10)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/sessions` | 列出 ACP 会话 | `src/app/api/sessions/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| DELETE | `/api/sessions/{id}` | 删除会话 | `src/app/api/sessions/[sessionId]/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{id}` | 按 ID 获取会话 | `src/app/api/sessions/[sessionId]/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| PATCH | `/api/sessions/{id}` | 更新会话元数据 | `src/app/api/sessions/[sessionId]/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| POST | `/api/sessions/{id}/disconnect` | 断开并终止活动会话进程 | `src/app/api/sessions/[sessionId]/disconnect/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{id}/history` | 获取会话的消息历史 | `src/app/api/sessions/[sessionId]/history/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{id}/transcript` | 获取会话的首选 transcript 负载 | `src/app/api/sessions/[sessionId]/transcript/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{sessionId}/context` | 获取会话的层级上下文 | `src/app/api/sessions/[sessionId]/context/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{sessionId}/reposlide-result` | 读取从会话 transcript 中提取的 RepoSlide 结果负载 | `src/app/api/sessions/[sessionId]/reposlide-result/route.ts` | `crates/routa-server/src/api/sessions.rs` |
| GET | `/api/sessions/{sessionId}/reposlide-result/download` | 下载已完成会话生成的 RepoSlide PPTX 产物 | `src/app/api/sessions/[sessionId]/reposlide-result/download/route.ts` | `crates/routa-server/src/api/sessions.rs` |

### Shared-Sessions (12)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/shared-sessions` | 列出共享会话 | `src/app/api/shared-sessions/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions` | 创建共享会话 | `src/app/api/shared-sessions/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| DELETE | `/api/shared-sessions/{sharedSessionId}` | 关闭共享会话 | `src/app/api/shared-sessions/[sharedSessionId]/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{sharedSessionId}` | 获取共享会话及其参与者与审批 | `src/app/api/shared-sessions/[sharedSessionId]/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{sharedSessionId}/approvals/{approvalId}` | 批准或拒绝待处理的共享会话提示 | `src/app/api/shared-sessions/[sharedSessionId]/approvals/[approvalId]/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{sharedSessionId}/join` | 加入共享会话 | `src/app/api/shared-sessions/[sharedSessionId]/join/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{sharedSessionId}/leave` | 离开共享会话 | `src/app/api/shared-sessions/[sharedSessionId]/leave/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{sharedSessionId}/messages` | 列出共享会话消息 | `src/app/api/shared-sessions/[sharedSessionId]/messages/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{sharedSessionId}/messages` | 发送共享会话消息 | `src/app/api/shared-sessions/[sharedSessionId]/messages/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{sharedSessionId}/participants` | 列出共享会话参与者 | `src/app/api/shared-sessions/[sharedSessionId]/participants/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| POST | `/api/shared-sessions/{sharedSessionId}/prompts` | 发送共享会话提示 | `src/app/api/shared-sessions/[sharedSessionId]/prompts/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |
| GET | `/api/shared-sessions/{sharedSessionId}/stream` | 通过 SSE 流式推送共享会话事件 | `src/app/api/shared-sessions/[sharedSessionId]/stream/route.ts` | `crates/routa-server/src/api/shared_sessions.rs`, `crates/routa-server/src/api/shared_sessions/store.rs` |

### Skills (7)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/skills` | 列出技能或按名称获取 | `src/app/api/skills/route.ts` | `crates/routa-server/src/api/skills.rs` |
| POST | `/api/skills` | 从磁盘重新加载技能 | `src/app/api/skills/route.ts` | `crates/routa-server/src/api/skills.rs` |
| GET | `/api/skills/catalog` | 列出注册表中可用的技能 | `src/app/api/skills/catalog/route.ts` | `crates/routa-server/src/api/skills_catalog.rs` |
| POST | `/api/skills/catalog` | 从注册表刷新本地技能目录 | `src/app/api/skills/catalog/route.ts` | `crates/routa-server/src/api/skills_catalog.rs` |
| GET | `/api/skills/clone` | 从仓库路径发现技能 | `src/app/api/skills/clone/route.ts` | `crates/routa-server/src/api/skills_clone.rs` |
| POST | `/api/skills/clone` | 克隆技能仓库 | `src/app/api/skills/clone/route.ts` | `crates/routa-server/src/api/skills_clone.rs` |
| POST | `/api/skills/upload` | 以 zip 形式上传技能 | `src/app/api/skills/upload/route.ts` | `crates/routa-server/src/api/skills_upload.rs` |

### Spec (3)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| POST | `/api/spec/feature-tree/generate` | 扫描仓库并生成 FEATURE_TREE.md + feature-tree.index.json | `src/app/api/spec/feature-tree/generate/route.ts` | `crates/routa-server/src/api/spec.rs` |
| GET | `/api/spec/issues` | 列出本地 issue 规范 | `src/app/api/spec/issues/route.ts` | `crates/routa-server/src/api/spec.rs` |
| GET | `/api/spec/surface-index` | 读取为规范分析生成的产品界面索引 | `src/app/api/spec/surface-index/route.ts` | `crates/routa-server/src/api/spec.rs` |

### Specialists (4)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/specialists` | 删除专家 | `src/app/api/specialists/route.ts` | `crates/routa-server/src/api/specialists.rs` |
| GET | `/api/specialists` | 列出已配置的专家 agent | `src/app/api/specialists/route.ts` | `crates/routa-server/src/api/specialists.rs` |
| POST | `/api/specialists` | 创建专家配置 | `src/app/api/specialists/route.ts` | `crates/routa-server/src/api/specialists.rs` |
| PUT | `/api/specialists` | 更新已有的专家 | `src/app/api/specialists/route.ts` | `crates/routa-server/src/api/specialists.rs` |

### Tasks (15)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/tasks` | 删除工作区的所有任务 | `src/app/api/tasks/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks` | 列出任务 | `src/app/api/tasks/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| POST | `/api/tasks` | 创建任务 | `src/app/api/tasks/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| DELETE | `/api/tasks/{id}` | 删除任务 | `src/app/api/tasks/[taskId]/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{id}` | 按 ID 获取任务 | `src/app/api/tasks/[taskId]/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| PATCH | `/api/tasks/{id}` | 更新任务 | `src/app/api/tasks/[taskId]/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{id}/artifacts` | 列出任务的所有产物 | `src/app/api/tasks/[taskId]/artifacts/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| POST | `/api/tasks/{id}/artifacts` | 为任务附加产物 | `src/app/api/tasks/[taskId]/artifacts/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{id}/runs` | 列出任务的规范化执行运行 | `src/app/api/tasks/[taskId]/runs/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| POST | `/api/tasks/{id}/status` | 更新任务状态 | `src/app/api/tasks/[taskId]/status/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{taskId}/changes` | 获取与任务关联的仓库或 worktree 变更 | `src/app/api/tasks/[taskId]/changes/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{taskId}/changes/commit` | 获取与任务仓库关联的单个提交的 diff | `src/app/api/tasks/[taskId]/changes/commit/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{taskId}/changes/file` | 获取与任务关联的单个变更文件的 diff | `src/app/api/tasks/[taskId]/changes/file/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/{taskId}/changes/stats` | 获取与任务关联的部分变更文件的增删行数 | `src/app/api/tasks/[taskId]/changes/stats/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |
| GET | `/api/tasks/ready` | 查找所有依赖均已满足的任务 | `src/app/api/tasks/ready/route.ts` | `crates/routa-server/src/api/tasks/changes.rs`, `crates/routa-server/src/api/tasks/dto.rs`, `crates/routa-server/src/api/tasks/evidence.rs`, `crates/routa-server/src/api/tasks/handlers.rs`, `crates/routa-server/src/api/tasks/mod.rs` |

### Test-Mcp (1)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/test-mcp` | 测试 MCP 配置 | `src/app/api/test-mcp/route.ts` | `crates/routa-server/src/api/test_mcp.rs` |

### Traces (4)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/traces` | 列出 agent 执行 Trace | `src/app/api/traces/route.ts` | `crates/routa-server/src/api/traces.rs` |
| GET | `/api/traces/{id}` | 按 ID 获取单个 Trace | `src/app/api/traces/[id]/route.ts` | `crates/routa-server/src/api/traces.rs` |
| POST | `/api/traces/export` | 以 Agent Trace JSON 格式导出 Trace 记录 | `src/app/api/traces/export/route.ts` | `crates/routa-server/src/api/traces.rs` |
| GET | `/api/traces/stats` | 获取聚合的 Trace 统计 | `src/app/api/traces/stats/route.ts` | `crates/routa-server/src/api/traces.rs` |

### Webhooks (10)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/webhooks/configs` | 删除 webhook 配置 | `src/app/api/webhooks/configs/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/configs` | 列出 webhook 配置 | `src/app/api/webhooks/configs/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| POST | `/api/webhooks/configs` | 创建 webhook 配置 | `src/app/api/webhooks/configs/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| PUT | `/api/webhooks/configs` | 更新 webhook 配置 | `src/app/api/webhooks/configs/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/github` | 列出已注册的 GitHub webhook | `src/app/api/webhooks/github/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| POST | `/api/webhooks/github` | 处理传入的 GitHub webhook 事件 | `src/app/api/webhooks/github/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| DELETE | `/api/webhooks/register` | 注销 webhook | `src/app/api/webhooks/register/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/register` | 列出 webhook 注册 | `src/app/api/webhooks/register/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| POST | `/api/webhooks/register` | 注册新的 webhook | `src/app/api/webhooks/register/route.ts` | `crates/routa-server/src/api/webhooks.rs` |
| GET | `/api/webhooks/webhook-logs` | 列出 webhook 投递日志 | `src/app/api/webhooks/webhook-logs/route.ts` | `crates/routa-server/src/api/webhooks.rs` |

### Workflows (6)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/workflows` | 列出 resources/flows/ 中的所有工作流 YAML 定义 | `src/app/api/workflows/route.ts` | `crates/routa-server/src/api/workflows.rs` |
| POST | `/api/workflows` | 创建新的工作流 YAML 文件 | `src/app/api/workflows/route.ts` | `crates/routa-server/src/api/workflows.rs` |
| DELETE | `/api/workflows/{id}` | 删除工作流 YAML 文件 | `src/app/api/workflows/[id]/route.ts` | `crates/routa-server/src/api/workflows.rs` |
| GET | `/api/workflows/{id}` | 按 ID 获取指定工作流 | `src/app/api/workflows/[id]/route.ts` | `crates/routa-server/src/api/workflows.rs` |
| PUT | `/api/workflows/{id}` | 更新工作流 YAML 文件 | `src/app/api/workflows/[id]/route.ts` | `crates/routa-server/src/api/workflows.rs` |
| POST | `/api/workflows/{id}/trigger` | 在工作区内触发工作流运行 | `src/app/api/workflows/[id]/trigger/route.ts` | `crates/routa-server/src/api/workflows.rs` |

### Workspaces (14)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| GET | `/api/workspaces` | 列出所有工作区 | `src/app/api/workspaces/route.ts` | `crates/routa-server/src/api/workspaces.rs` |
| POST | `/api/workspaces` | 创建工作区 | `src/app/api/workspaces/route.ts` | `crates/routa-server/src/api/workspaces.rs` |
| DELETE | `/api/workspaces/{id}` | 删除工作区 | `src/app/api/workspaces/[workspaceId]/route.ts` | `crates/routa-server/src/api/workspaces.rs` |
| GET | `/api/workspaces/{id}` | 按 ID 获取工作区 | `src/app/api/workspaces/[workspaceId]/route.ts` | `crates/routa-server/src/api/workspaces.rs` |
| PATCH | `/api/workspaces/{id}` | 更新工作区（title、repoPath、branch、status、metadata） | `src/app/api/workspaces/[workspaceId]/route.ts` | `crates/routa-server/src/api/workspaces.rs` |
| POST | `/api/workspaces/{id}/archive` | 归档或取消归档工作区 | `src/app/api/workspaces/[workspaceId]/archive/route.ts` | `crates/routa-server/src/api/workspaces.rs` |
| GET | `/api/workspaces/{id}/codebases` | 列出工作区中的代码库 | `src/app/api/workspaces/[workspaceId]/codebases/route.ts` | `crates/routa-server/src/api/codebases.rs` |
| POST | `/api/workspaces/{id}/codebases` | 向工作区添加代码库 | `src/app/api/workspaces/[workspaceId]/codebases/route.ts` | `crates/routa-server/src/api/codebases.rs` |
| GET | `/api/workspaces/{id}/codebases/changes` | 列出工作区代码库的 git 变更摘要 | `src/app/api/workspaces/[workspaceId]/codebases/changes/route.ts` | `crates/routa-server/src/api/codebases.rs` |
| GET | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees` | 列出代码库的 worktree | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/worktrees/route.ts` | `crates/routa-server/src/api/worktrees.rs` |
| POST | `/api/workspaces/{workspace_id}/codebases/{codebase_id}/worktrees` | 创建新的 git worktree | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/worktrees/route.ts` | `crates/routa-server/src/api/worktrees.rs` |
| DELETE | `/api/workspaces/{workspaceId}/codebases/{codebaseId}` | 通过工作区范围的路由删除代码库 | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/route.ts` | `crates/routa-server/src/api/codebases.rs` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/reposlide` | 获取由 agent 驱动的演示文稿生成会话的 RepoSlide 启动上下文 | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/reposlide/route.ts` | `crates/routa-server/src/api/codebases.rs` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/wiki` | 为代码库生成具备架构感知的 RepoWiki 摘要负载 | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/wiki/route.ts` | `crates/routa-server/src/api/codebases.rs` |

### Worktrees (3)

| 方法 | 端点 | 说明 | Next.js | Rust |
|--------|----------|---------|---------|------|
| DELETE | `/api/worktrees/{id}` | 移除 worktree | `src/app/api/worktrees/[worktreeId]/route.ts` | `crates/routa-server/src/api/worktrees.rs` |
| GET | `/api/worktrees/{id}` | 获取单个 worktree | `src/app/api/worktrees/[worktreeId]/route.ts` | `crates/routa-server/src/api/worktrees.rs` |
| POST | `/api/worktrees/{id}/validate` | 校验磁盘上 worktree 的健康状态 | `src/app/api/worktrees/[worktreeId]/validate/route.ts` | `crates/routa-server/src/api/worktrees.rs` |

---

## 仅 Next.js 的 API 路由

### Canvas (1)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| POST | `/api/canvas/specialist/materialize` | `src/app/api/canvas/specialist/materialize/route.ts` |

### Feature-Explorer (4)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| GET | `/api/feature-explorer` | `src/app/api/feature-explorer/route.ts` |
| GET | `/api/feature-explorer/{featureId}` | `src/app/api/feature-explorer/[featureId]/route.ts` |
| GET | `/api/feature-explorer/{featureId}/apis` | `src/app/api/feature-explorer/[featureId]/apis/route.ts` |
| GET | `/api/feature-explorer/{featureId}/files` | `src/app/api/feature-explorer/[featureId]/files/route.ts` |

### Fitness (1)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| POST | `/api/fitness/run` | `src/app/api/fitness/run/route.ts` |

### Github (1)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| GET | `/api/github/access` | `src/app/api/github/access/route.ts` |

### Sessions (1)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| POST | `/api/sessions/{sessionId}/fork` | `src/app/api/sessions/[sessionId]/fork/route.ts` |

### Tasks (1)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| POST | `/api/tasks/{taskId}/pr-run` | `src/app/api/tasks/[taskId]/pr-run/route.ts` |

### Workspaces (11)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/commit` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/commit/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/commits` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/commits/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/commits/{sha}/diff` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/commits/[sha]/diff/route.ts` |
| GET | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/diff` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/diff/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/discard` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/discard/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/export` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/export/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/pull` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/pull/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/rebase` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/rebase/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/reset` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/reset/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/stage` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/stage/route.ts` |
| POST | `/api/workspaces/{workspaceId}/codebases/{codebaseId}/git/unstage` | `src/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/unstage/route.ts` |

---

## 仅 Rust 的 API 路由

### Canvas (1)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| POST | `/api/canvas/specialist/materialize` | `crates/routa-server/src/api/canvas.rs` |

### Feature-Explorer (4)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| GET | `/api/feature-explorer` | `crates/routa-server/src/api/feature_explorer.rs` |
| GET | `/api/feature-explorer/{featureId}` | `crates/routa-server/src/api/feature_explorer.rs` |
| GET | `/api/feature-explorer/{featureId}/apis` | `crates/routa-server/src/api/feature_explorer.rs` |
| GET | `/api/feature-explorer/{featureId}/files` | `crates/routa-server/src/api/feature_explorer.rs` |

### Git (11)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| POST | `/api/git/commit` | `crates/routa-server/src/api/git.rs` |
| GET | `/api/git/commits` | `crates/routa-server/src/api/git.rs` |
| GET | `/api/git/commits/{sha}/diff` | `crates/routa-server/src/api/git.rs` |
| GET | `/api/git/diff` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/discard` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/export` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/pull` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/rebase` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/reset` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/stage` | `crates/routa-server/src/api/git.rs` |
| POST | `/api/git/unstage` | `crates/routa-server/src/api/git.rs` |

### Github (1)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| GET | `/api/github/access` | `crates/routa-server/src/api/github.rs` |

### Sessions (1)

| 方法 | 端点 | 源文件 |
|--------|----------|--------------|
| POST | `/api/sessions/{session_id}/fork` | `crates/routa-server/src/api/sessions.rs` |
