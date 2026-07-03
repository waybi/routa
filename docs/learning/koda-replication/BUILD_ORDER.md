# Koda 施工序列

## 依赖拓扑

```
Phase 0: types + EventBus          ← 零外部依赖，所有人依赖它
Phase 1: Store 接口 + InMemory 参考 ← 依赖 Phase 0
Phase 2: Task 生命周期 + BgWorker   ← 依赖 Phase 1
Phase 3: ACP Provider Adapter       ← 依赖 Phase 0 类型
Phase 4: Workflow Executor          ← 依赖 Phase 1-2
Phase 5: Kanban + Orchestrator + MCP ← 依赖 Phase 2-4
Phase 6: API 路由壳                 ← 依赖 Phase 0-5 core stub
Phase 7: 页面 + 前端壳              ← 依赖 Phase 6 API 端点
```

**规矩**：下一层不完、上一层不动。每层独立可验证。

---

## Phase 0: 类型底座 + EventBus

### 依赖
无。

### 文件清单

| 操作 | 骨架文件 | 参考 Routa 源文件 |
|------|---------|------------------|
| 复制 | `src/core/models/agent.ts` | 同路径 |
| 复制 | `src/core/models/task.ts` | 同路径 |
| 复制 | `src/core/models/background-task.ts` | 同路径 |
| 复制 | `src/core/models/kanban.ts` | 同路径 |
| 复制 | `src/core/models/workspace.ts` | 同路径 |
| 复制 | `src/core/models/message.ts` | 同路径 |
| 复制 | `src/core/models/artifact.ts` | 同路径 |
| 复制 | `src/core/models/note.ts` | 同路径 |
| 复制 | `src/core/models/codebase.ts` | 同路径 |
| 复制 | `src/core/models/schedule.ts` | 同路径 |
| 复制 | `src/core/models/worktree.ts` | 同路径 |
| 复制 | `src/core/models/canvas-artifact.ts` | 同路径 |
| 复制 | `src/core/models/task-requirements.ts` | 同路径 |
| 复制 | `src/core/models/index.ts` | 同路径 |
| stub | `src/core/events/event-bus.ts` | 同路径 |
| 复制 | `src/core/events/index.ts` | 同路径 |

`models/` 下 14 个文件全部是纯类型定义 + 工厂函数，可直接复制。

`events/event-bus.ts` 接口保留，`InMemoryEventBus` 实现 stub：

```typescript
export interface EventBus {
  emit(event: AgentEvent): void;
  on(key: string, handler: EventHandler): void;
  off(key: string): void;
  subscribe(key: string, handler: EventHandler, options?: SubscribeOptions): void;
  preSubscribe(key: string, eventTypes: AgentEventType[]): void;
}

export class InMemoryEventBus implements EventBus {
  emit(event: AgentEvent): void { throw new Error("not implemented"); }
  on(key: string, handler: EventHandler): void { throw new Error("not implemented"); }
  off(key: string): void { throw new Error("not implemented"); }
  subscribe(key: string, handler: EventHandler, options?: SubscribeOptions): void { throw new Error("not implemented"); }
  preSubscribe(key: string, eventTypes: AgentEventType[]): void { throw new Error("not implemented"); }
}
```

### 验收标准
- [ ] `npx tsc --noEmit` 通过
- [ ] `EventBus` 接口编译无错误
- [ ] types 无外部模块依赖（不 import store/workflow/kanban）

### 禁止事项
- ❌ EventBus 不依赖任何 models 之外的模块
- ❌ 不能在 models/ 里加运行时行为

---

## Phase 1: Store 接口层

### 依赖
Phase 0（models + EventBus）

### 文件清单

| 操作 | 骨架文件 | 参考 Routa 源文件 |
|------|---------|------------------|
| 保留 | `src/core/store/task-store.ts` | 同路径 — TaskStore 接口 + InMemoryTaskStore |
| 保留 | `src/core/store/agent-store.ts` | 同路径 |
| 保留 | `src/core/store/background-task-store.ts` | 同路径，重点关注 `listReadyToRun()` 依赖就绪检查 |
| 保留 | `src/core/store/kanban-board-store.ts` | 同路径 |
| 保留 | `src/core/store/note-store.ts` | 同路径 |
| 保留 | `src/core/store/artifact-store.ts` | 同路径 |
| 保留 | `src/core/store/conversation-store.ts` | 同路径 |
| 保留 | `src/core/store/acp-session-store.ts` | 同路径 |
| 保留 | `src/core/store/schedule-store.ts` | 同路径 |
| stub | `src/core/store/custom-mcp-server-store.ts` | 同路径 — 接口保留，去掉 PG/SQLite 实现 |
| stub | `src/core/store/github-webhook-store.ts` | 同路径 — 接口保留，去掉三方实现 |
| stub | `src/core/store/specialist-store.ts` | 同路径 — 接口保留，去掉 PG 实现 |
| 保留 | `src/core/store/index.ts` | 同路径 |

### 处理规则

**保留** = 接口 + InMemory 实现一起搬。Routa 的 InMemory*Store 本身就是轻量参考实现，骨架仓库直接当参考。

**Stub** = 只保留接口签名，移除 Postgres/SQLite 具体实现。

### 验收标准
- [ ] 所有 Store 接口编译通过
- [ ] `InMemory*Store` 可实例化，基本 CRUD 不抛异常
- [ ] `BackgroundTaskStore.listReadyToRun()` 正确判断依赖就绪

### 禁止事项
- ❌ Store 接口不能 import `db/` 下的 PG/SQLite 实现
- ❌ 不能依赖 Phase 2+ 模块

---

## Phase 2: Task 生命周期 + BackgroundWorker

### 依赖
Phase 0 + Phase 1

### 文件清单

| 操作 | 骨架文件 | 参考 Routa 源文件 |
|------|---------|------------------|
| stub | `src/core/background-worker/index.ts` | 同路径 — BackgroundTaskWorker 类骨架 |
| stub | `src/core/worker/types.ts` | 同路径 — Worker 接口 |
| stub | `src/core/worker/registry.ts` | 同路径 — WorkerRegistry stub |
| stub | `src/core/worker/local-worker.ts` | 同路径 — LocalWorker stub |
| stub | `src/core/worker/docker-worker.ts` | 同路径 — DockerWorker stub |
| 复制 | `src/core/worker/index.ts` | 同路径 |
| stub | `src/core/sandbox/types.ts` | 同路径 — Sandbox 接口 |
| stub | `src/core/sandbox/manager.ts` | 同路径 — SandboxManager stub |
| stub | `src/core/sandbox/permissions.ts` | 同路径 |
| 复制 | `src/core/sandbox/index.ts` | 同路径 |
| stub | `src/core/chat-message.ts` | 同路径 — ChatMessage 类型保留 |
| stub | `src/core/session-history.ts` | 同路径 |
| stub | `src/core/session-transcript.ts` | 同路径 |
| stub | `src/core/task-run-ledger.ts` | 同路径 |
| stub | `src/core/tool-call-name.ts` | 同路径 |

### 验收标准
- [ ] BackgroundTaskWorker 可实例化，轮询骨架不抛异常
- [ ] WorkerRegistry 可注册/查询 worker
- [ ] Task 状态机（ENQUEUED → IN_PROGRESS → COMPLETED）接口定义正确

### 禁止事项
- ❌ BackgroundWorker 不直接操作数据库（走 Store 接口）
- ❌ Worker 不直接 import ACP/Kanban 模块

---

## Phase 3: ACP Provider Adapter

### 依赖
Phase 0 类型（models/）

### 文件清单

| 操作 | 骨架文件 | 参考 Routa 源文件 |
|------|---------|------------------|
| 复制 | `src/core/acp/provider-adapter/types.ts` | 同路径 — IProviderAdapter + NormalizedSessionUpdate 纯类型 |
| stub | `src/core/acp/provider-adapter/base-adapter.ts` | 同路径 — BaseProviderAdapter 骨架 |
| stub | `src/core/acp/provider-adapter/claude-adapter.ts` | 同路径 — normalize() stub |
| stub | `src/core/acp/provider-adapter/opencode-adapter.ts` | 同路径 |
| stub | `src/core/acp/provider-adapter/standard-acp-adapter.ts` | 同路径 |
| stub | `src/core/acp/provider-adapter/docker-opencode-adapter.ts` | 同路径 |
| stub | `src/core/acp/provider-adapter/trace-recorder.ts` | 同路径 |
| 复制 | `src/core/acp/provider-adapter/index.ts` | 同路径 — 工厂 + 单例保留 |
| 复制 | `src/core/acp/protocol-types.ts` | 同路径 — 纯 JsonRpcMessage 类型 |
| stub | `src/core/acp/acp-process.ts` | 同路径 — JSON-RPC over stdio 骨架 |
| stub | `src/core/acp/acp-process-manager.ts` | 同路径 |
| stub | `src/core/acp/acp-session-manager.ts` | 同路径 |
| stub | `src/core/acp/acp-installer.ts` | 同路径 |
| stub | `src/core/acp/acp-presets.ts` | 同路径 |
| stub | `src/core/acp/acp-registry.ts` | 同路径 |
| stub | `src/core/acp/acp-warmup.ts` | 同路径 |
| stub | `src/core/acp/agent-instance-factory.ts` | 同路径 |
| stub | `src/core/acp/api-based-providers.ts` | 同路径 |
| stub | `src/core/acp/claude-code-process.ts` | 同路径 |
| stub | `src/core/acp/claude-code-sdk-adapter.ts` | 同路径 |
| stub | `src/core/acp/execution-backend.ts` | 同路径 |
| stub | `src/core/acp/http-session-store.ts` | 同路径 |
| stub | `src/core/acp/lifecycle-notifier.ts` | 同路径 |
| stub | `src/core/acp/mcp-config-generator.ts` | 同路径 |
| stub | `src/core/acp/mcp-setup.ts` | 同路径 |
| stub | `src/core/acp/opencode-process.ts` | 同路径 |
| stub | `src/core/acp/opencode-sdk-adapter.ts` | 同路径 |
| stub | `src/core/acp/pending-acp-creations.ts` | 同路径 |
| stub | `src/core/acp/process-config.ts` | 同路径 |
| stub | `src/core/acp/processer.ts` | 同路径 |
| stub | `src/core/acp/prompt-response.ts` | 同路径 |
| stub | `src/core/acp/provider-model-args.ts` | 同路径 |
| stub | `src/core/acp/provider-registry.ts` | 同路径 |
| stub | `src/core/acp/routa-acp-agent.ts` | 同路径 |
| stub | `src/core/acp/runner-http-server.ts` | 同路径 |
| stub | `src/core/acp/runner-routing.ts` | 同路径 |
| stub | `src/core/acp/runtime-manager.ts` | 同路径 |
| stub | `src/core/acp/session-db-persister.ts` | 同路径 |
| stub | `src/core/acp/session-notification-retention.ts` | 同路径 |
| stub | `src/core/acp/session-prompt.ts` | 同路径 |
| stub | `src/core/acp/session-write-buffer.ts` | 同路径 |
| stub | `src/core/acp/terminal-manager.ts` | 同路径 |
| stub | `src/core/acp/utils.ts` | 同路径 |
| 复制 | `src/core/acp/index.ts` | 同路径 |
| 复制 | `src/core/acp/agent-event-bridge/types.ts` | 同路径 |
| stub | `src/core/acp/agent-event-bridge/agent-event-bridge.ts` | 同路径 |
| 复制 | `src/core/acp/agent-event-bridge/index.ts` | 同路径 |
| 复制 | `src/core/acp/docker/types.ts` | 同路径 — 纯接口 |
| stub | `src/core/acp/docker/detector.ts` | 同路径 |
| stub | `src/core/acp/docker/docker-opencode-adapter.ts` | 同路径 |
| stub | `src/core/acp/docker/process-manager.ts` | 同路径 |
| stub | `src/core/acp/docker/utils.ts` | 同路径 |
| 复制 | `src/core/acp/docker/index.ts` | 同路径 |

### 防腐层（四层桥接）架构回顾

```
外部协议 → normalize() → 内部统一模型 → EventBus → Store
   ↑                                    ↑
 每加一家厂商                       内部代码不动
 只写一个 Adapter
```

`IProviderAdapter` 接口 = 栅栏，所有外部协议差异被隔在栅栏外面。

### 验收标准
- [ ] `IProviderAdapter` 接口编译通过
- [ ] `getProviderAdapter("claude")` 返回 stub adapter，不抛异常
- [ ] `normalize()` 返回 `NormalizedSessionUpdate` 类型一致

### 禁止事项
- ❌ Adapter 之间不能互相耦合（每个独立）
- ❌ 不能改 IProviderAdapter 接口签名

---

## Phase 4: Workflow Executor

### 依赖
Phase 0 + Phase 1（TaskStore, EventBus）

### 文件清单

| 操作 | 骨架文件 | 参考 Routa 源文件 |
|------|---------|------------------|
| 复制 | `src/core/workflows/workflow-types.ts` | 同路径 — 纯类型 |
| stub | `src/core/workflows/workflow-executor.ts` | 同路径 — `trigger()` stub，重点关注依赖就绪检查逻辑 |
| stub | `src/core/workflows/workflow-loader.ts` | 同路径 — YAML 加载骨架 |
| stub | `src/core/workflows/workflow-store.ts` | 同路径 — 接口 + InMemory 参考 |
| 复制 | `src/core/workflows/index.ts` | 同路径 |

### 关键逻辑

`workflow-executor.ts` 核心流程：
1. `trigger()` → 创建 WorkflowRun → group steps by `parallel_group`
2. 计算 `dependsOnTaskIds`
3. `background-task-store.listReadyToRun()` 判断依赖就绪（`every(dep.status === "COMPLETED")`）

### 验收标准
- [ ] `trigger(workflowDef)` 可调用不抛异常
- [ ] `parallel_group` 分组逻辑正确
- [ ] `dependsOnTaskIds` 计算正确

### 禁止事项
- ❌ WorkflowExecutor 不假设有任意外部 agent 进程
- ❌ 不直接 import ACP 模块

---

## Phase 5: Kanban + Orchestrator + MCP

### 依赖
Phase 0-4

### 文件清单

**Kanban（38 文件 → 全部 stub）**：

| 操作 | 骨架文件 | 参考 Routa 源文件 |
|------|---------|------------------|
| 复制 | `src/core/kanban/flow-ledger-types.ts` | 同路径 — 纯类型 |
| stub | `src/core/kanban/column-transition.ts` | 同路径 — 事件发射 + handler 注册 |
| stub | `src/core/kanban/boards.ts` | 同路径 — 默认 board 构建 |
| stub | `src/core/kanban/transition-gates.ts` | 同路径 — 门禁检查 |
| stub | `src/core/kanban/agent-trigger.ts` | 同路径 |
| stub | `src/core/kanban/task-session-transition.ts` | 同路径 |
| stub | `src/core/kanban/workflow-orchestrator.ts` | 同路径 |
| stub | `src/core/kanban/workflow-orchestrator-singleton.ts` | 同路径 |
| stub | (其余 30 个 kanban 文件) | 同路径 |

**Orchestrator（7 文件）**：

| 操作 | 骨架文件 | 参考 Routa 源文件 |
|------|---------|------------------|
| stub | `src/core/orchestration/orchestrator.ts` | 同路径 — RoutaOrchestrator 骨架 |
| stub | `src/core/orchestration/orchestrator-singleton.ts` | 同路径 |
| stub | `src/core/orchestration/completion-memory.ts` | 同路径 |
| stub | `src/core/orchestration/delegation-depth.ts` | 同路径 |
| stub | `src/core/orchestration/specialist-prompts.ts` | 同路径 |
| stub | `src/core/orchestration/task-block-parser.ts` | 同路径 |
| 复制 | `src/core/orchestration/index.ts` | 同路径 |

**MCP（15 文件 → 全部 stub）**：

| 操作 | 骨架文件 | 参考 Routa 源文件 |
|------|---------|------------------|
| 复制 | `src/core/mcp/mcp-server-profiles.ts` | 同路径 — 纯类型 + const |
| stub | `src/core/mcp/routa-mcp-server.ts` | 同路径 |
| stub | `src/core/mcp/routa-mcp-tool-manager.ts` | 同路径 |
| stub | `src/core/mcp/mcp-tool-executor.ts` | 同路径 |
| stub | (其余 11 个 mcp 文件) | 同路径 |
| 复制 | `src/core/mcp/index.ts` | 同路径 |

**其他模块（Stub）**：

| 操作 | 骨架文件 | 参考 Routa 源文件 |
|------|---------|------------------|
| stub | `src/core/notes/crdt-document-manager.ts` | 同路径 — Yjs CRDT 骨架 |
| stub | `src/core/notes/crdt-note-store.ts` | 同路径 |
| stub | `src/core/notes/note-event-broadcaster.ts` | 同路径 |
| stub | `src/core/git/git-operations.ts` | 同路径 |
| stub | `src/core/git/git-worktree-service.ts` | 同路径 |
| stub | `src/core/git/git-error-handler.ts` | 同路径 |
| stub | `src/core/git/git-utils.ts` | 同路径 |
| 复制 | `src/core/git/index.ts` | 同路径 |

### 验收标准
- [ ] ColumnTransition 事件导向列移动逻辑接口正确
- [ ] TransitionGates 门禁检查接口定义
- [ ] CRDT DocumentManager `updateContent()` + `applyUpdate()` 接口保留

### 禁止事项
- ❌ Kanban 不直接操作数据库（走 Store）
- ❌ Orchestrator 不直接 import provider adapter 实现

---

## Phase 6: API 路由壳

### 依赖
Phase 0-5（所有 core stub 就绪）

### 路由清单（按域分组）

每个域保留 handler 签名 + 参数校验 + 响应结构，core 调用落到 stub 自动返回空数据。

**高优先级 API 域**（核心业务路径）：

| API 域 | 端点数 | 处理方式 |
|--------|--------|---------|
| `/api/agents` | 4 | 薄 delegate 保留 |
| `/api/tasks` | 12 | 内联业务逻辑提取到 core，路由变薄 delegate |
| `/api/sessions` | 10 | 同上 |
| `/api/kanban` | 7 | 同上 |
| `/api/workspaces` | 30+ | 薄 delegate 保留 |
| `/api/acp` | 9 | 协议网关 → 返回 501 |
| `/api/mcp` | 3 | 协议网关 → 返回 501 |
| `/api/a2a` | 6 | 薄 delegate 保留 |
| `/api/schedules` | 4 | 薄 delegate 保留 |
| `/api/workflows` | 3 | 薄 delegate 保留 |
| `/api/notes` | 3 | 薄 delegate 保留 |
| `/api/skills` | 4 | 薄 delegate 保留 |
| `/api/sandboxes` | 6 | 薄 delegate 保留 |
| `/api/traces` | 4 | 薄 delegate 保留 |
| `/api/webhooks` | 4 | 薄 delegate 保留 |
| `/api/github` | 8 | 薄 delegate 保留 |
| `/api/fitness` | 9 | 薄 delegate 保留 |
| `/api/harness` | 15 | 薄 delegate 保留 |
| `/api/shared-sessions` | 9 | 薄 delegate 保留 |
| `/api/health` | 1 | 原样保留（无依赖） |
| 其余 | ~20 | 薄 delegate 保留 |

### 薄 delegate 模板

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const system = getRoutaSystem();
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }
  const result = await system.xxxStore.list(workspaceId);
  return NextResponse.json({ data: result });
}
```

### 验收标准
- [ ] 所有路由端点编译通过
- [ ] `/api/health` 返回 `{ status: "ok" }`
- [ ] 调用任意端点不会 500（返回空数组/空对象或 501）
- [ ] 参数校验逻辑保留（如 workspaceId 缺失返回 400）

### 禁止事项
- ❌ API 路由不直接 import provider adapter / ACP process
- ❌ 不硬编码数据库查询

---

## Phase 7: 页面 + 前端壳

### 依赖
Phase 6（所有 API 端点就绪）

### 页面层（src/app/）

**全保留**：31 个 page.tsx（每文件 5-30 行）。页面层对 `@/core/` 的直接 import 只有 2 处，页面依赖的是 `/api/*` 端点。API 返回空数据 → 页面渲染空壳。

| 页面 | 文件 | 说明 |
|------|------|------|
| `/` | `src/app/page.tsx` | 首页 — workspace 选择 |
| `/workspace/[id]/kanban` | page.tsx + kanban-page-client.tsx | 核心看板 |
| `/workspace/[id]/sessions/[id]` | page.tsx | 会话详情 |
| `/settings/**` | 各 page.tsx | 设置面板组（9 个子页） |
| `/traces` | page.tsx | Trace 浏览 |
| `/messages` | page.tsx | 通知中心 |
| 其余 10+ 页面 | 各 page.tsx | 保留路由壳 |

### 前端层（src/client/）

| 分类 | 文件 | 处理 |
|------|------|------|
| `config/backend.ts` | 1 | **原样保留** — resolveApiPath + desktopAwareFetch |
| `types/` | 1 | 保留 |
| `utils/*.ts` | ~15 | **原样保留** — 纯函数，零运行时依赖 |
| `hooks/*.ts` | 8 | **全部 stub** — 返回空 state + no-op |
| `components/**` | ~60+ | **全部删除** — 集成方按需重写 UI |
| `acp-client.ts` | 1 | 保留接口 + 空实现 |
| `rpc-client.ts` | 1 | 保留接口 + 空实现 |
| `skill-client.ts` | 1 | 保留接口 + 空实现 |

### 核心基础设施（保留完整体）

```
src/client/config/backend.ts  — resolveApiPath / getConfiguredBackendBaseUrl
src/client/utils/diagnostics.ts — desktopAwareFetch / 运行时检测
```

这两个文件构成了前端到后端的通信桥梁。全保留、不改一字。

### 验收标准
- [ ] `npm run dev` 启动，首页可访问
- [ ] `/workspace/[id]/kanban` 渲染空看板（无数据、无崩溃）
- [ ] 所有设置页渲染空配置面板
- [ ] 前端网络请求正常走 `resolveApiPath` → API 端点

### 禁止事项
- ❌ 不保留任何具体 UI 组件（组件由集成方重写）
- ❌ hooks 不保留真实实现（只留 stub 签名）

---

## 总览

| Phase | 模块 | 文件数（约） | 关键约束 |
|-------|------|------------|---------|
| 0 | types + EventBus | ~16 | 零依赖，所有人依赖它 |
| 1 | Store 接口 | ~13 | 只依赖 EventBus，不碰 DB |
| 2 | Task + Worker | ~14 | 依赖 Store 接口，不碰 ACP |
| 3 | ACP Provider Adapter | ~52 | 依赖 types，不碰 Store 实现 |
| 4 | Workflow Executor | ~5 | 依赖 Store + EventBus |
| 5 | Kanban + MCP | ~63 | 依赖所有下层 |
| 6 | API 路由壳 | ~155 | 依赖全部 core stub |
| 7 | 页面 + 前端壳 | ~31 + ~28 | 依赖 API 端点 |

**总计**：~377 个文件纳入骨架仓库，约 489 个文件（组件 + DB 实现）删除或 stub。

## 施工纪律

1. **一 Phase 一 commit** — 每个 Phase 完成后独立提交，commit message 用 Conventional Commits 格式（`feat(phase0): ...`）
2. **先编译，后功能** — 每个 Phase 完成时 `npx tsc --noEmit` 必须通过
3. **不跳 Phase** — 下一层依赖不完，上一层不动
4. **接口即栅栏** — 一旦接口定义在 Phase 0-1 中确定，后续 Phase 不能改签名

## 行为规约

以下约束来自 Routa 真实踩坑记录，每条对应一个可验证的规则。违反其中任意一条 → 要么编译不过，要么将来改 3 个以上文件。

### 对象创建

**规则 1：禁止裸构造领域对象**

所有 `models/` 下的 interface 实例必须通过对应的 `createXxx()` 工厂函数创建，禁止对象字面量 + `as` 类型断言。

```typescript
// ❌ 禁止
const task = { id: "t1", title: "x", labels: undefined, status: "pending" } as Task;

// ✅ 唯一合法方式
const task = createTask({ id: "t1", title: "x", objective: "...", workspaceId: "ws1" });
```

**为什么**：绕过工厂 → 默认值丢失（`labels` 是 `undefined` 而不是 `[]`）→ 下游 `task.labels.includes("bug")` 运行时爆炸。14 个模型 × 50+ 个消费方，一次绕过工厂的代价被放大 N 倍。

**规则 2：嵌套对象在工厂入口处 normalize 一次**

如果工厂参数里有嵌套对象（如 `contextSearchSpec`），在 `createXxx` 内部做清洗（去空字符串、去重、去 null），不要把这活留给消费方。

```typescript
// ✅ 工厂内部 normalize — 调用方零负担
export function createTask(params: { contextSearchSpec?: TaskContextSearchSpec }): Task {
  return { contextSearchSpec: normalizeTaskContextSearchSpec(params.contextSearchSpec) };
}
```

**为什么**：10 个消费模块各自清洗同一个嵌套对象 → k = 10。入口处做一次 → k = 1。

### EventBus

**规则 3：EventBus 不做持久化**

EventBus 的 4 个 Map（handlers / subscriptions / pendingEvents / waitGroups）全部在内存，不做磁盘/Redis/Database 持久化。

**为什么**：持久化是 Store 层的职责（Phase 1）。EventBus 是通知管道，崩溃丢事件可接受——Agent 重启后重新产生事件，WaitGroup 丢失由 BackgroundWorker 的超时兜底补。

**规则 4：不在业务模块里重复实现 WaitGroup**

如果某个模块需要"等 N 个异步单元全部完成" → 用 `EventBus.createWaitGroup` + `addToWaitGroup`。禁止在自己的模块里手动维护计数器 + Set + listener。

**为什么**：Orchestrator 曾经自己维护 `DelegationGroup`（60 行），和 EventBus 的 `WaitGroup` 功能几乎一样。两份代码、互相不通、加超时要改两处。

### 依赖方向

**规则 5：双向引用必须有一条是 `import type`**

两个文件互相引用时，至少其中一条是 `import type`（编译后擦除），否则产生运行时循环依赖。

```typescript
// ✅ 安全
// kanban.ts → import { TaskStatus } from "./task"            (运行时 import)
// task.ts   → import type { TaskCreationSource } from "../kanban/..."  (编译时擦除)
```

**规则 6：低 Phase 不 import 高 Phase 的模块**

```
✅ 正确方向: models/ → store/ → worker/ → acp/ → kanban/ → api/ → app/
❌ 禁止:    models/ import store/     ← Phase 0 不能依赖 Phase 1
❌ 禁止:    store/  import acp/       ← Phase 1 不能依赖 Phase 3
❌ 禁止:    EventBus import TaskStore  ← 箭头被反转，换数据库要改 EventBus
```

### 接口设计

**规则 7：`data` 字段用 `Record<string, unknown>`，不用 Union Type**

事件 payload 的 `data` 字段保持宽松类型。23 种事件类型的 payload 完全不同，缩小到 Union Type 会让新增事件类型必须改契约签名。

**为什么**：牺牲一点类型安全性（消费方自己做 `as string` 断言），换取扩展性（新增事件不改接口）。

**规则 8：优先用 `Pick` 缩小接口契约面**

函数参数能 `Pick<KanbanColumn, "id" | "stage">` 就不用完整 `KanbanColumn`（14 个字段）。缩小契约面 → 测试写 mock 更简单 → 调用方约束更少。

### 纯函数映射

**规则 9：枚举值有限时用 switch-case，不引入配置驱动**

6 列的映射关系用纯函数 `columnIdToTaskStatus()` + TypeScript 穷举检查。**不要**为了"以后可能要配置化"提前引入 JSON 配置或数据库存储。

**为什么**：switch-case 的穷举检查是编译期安全网——新增一个枚举值但忘记加 case → 编译器提醒。JSON 配置没有这个保护。

**升级边界**：当 switch-case 加到第 20 个 case，或产品说"用户要能自己创建列" → 那时再升级为配置驱动。

### 分层职责

**规则 10：不在当前层解决不属于当前层的问题**

| 问题 | 正确的 Phase | 为什么不在 Phase 0 |
|------|-------------|-------------------|
| 并发控制（两个 Agent 改同一个仓库） | Phase 5 | 需要 Store 查 BackgroundTask 数量 + Worker 调度 + 列级并发队列 |
| 数据库持久化 | Phase 1 | Phase 0 只管类型和事件，不碰 I/O |
| 超时策略 | Phase 2（BackgroundWorker） | WaitGroup 只管"等"，不管"等多久" |

**反例**：Phase 0 硬编码并发限制 → 依赖了 Phase 5 才有的 Kanban 列配置 → 违反依赖拓扑 → 要么做假实现，要么留到后面推翻重写。
