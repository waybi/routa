# Routa Phase 6 设计拆解：API 路由壳

> **本文定位**：教学设计 / HTTP 与协议边界解剖笔记，不是 187 个 `route.ts` 的 API 手册。目标是解释浏览器、桌面端和 agent 协议请求怎样穿过传输边界，进入 Phase 0–5 已建立的 core seam，同时保持稳定的参数、状态码、响应 envelope、流式生命周期与双后端产品语义。
>
> 阅读顺序沿用 Phase 0–4：**业务痛点 → 如果不管会怎样腐烂 → 当前设计怎么堵 → Before / After → 权衡与边界**。全文只用少数代表路由说明架构，不逐项背端点。
>
> 涉及源码行为的代码片段分四类标记：**真实代码摘录**（可按 `file:line` 回查）、**基于真实代码的简化**（省略无关字段）、**假设反例**（说明没有该设计时会怎样，非 Routa 历史代码）、**目标建议**（Koda 骨架施工方向，不代表 Routa 当前已完成）。纯概念图、问题清单和流程摘要使用 `text` 块，不冒充源码。

## 目录

- [「你在这里」锚点](#anchor-here)
- [总体业务场景](#anchor-scene)
  - [完整对象依赖图](#anchor-object-map)
  - [设计动机与设计哲学](#anchor-philosophy)
- [问题 1：API 路由为什么应该是薄壳，而不是第二套业务层](#anchor-q1)
- [问题 2：URL、query、path、body 参数怎样在系统边界收敛](#anchor-q2)
- [问题 3：领域错误与结果怎样稳定映射成 HTTP status 与 JSON envelope](#anchor-q3)
- [问题 4：REST、SSE、ACP/MCP 为什么不能用同一种 stub 策略](#anchor-q4)
- [问题 5：Next.js 与 Axum 怎样靠 API contract 保持产品语义一致](#anchor-q5)
- [四个可迁移模式](#anchor-patterns)
- [Koda Phase 6 施工边界与 Phase 7 交棒](#anchor-next)
- [学习笔记](#anchor-notes)
- [证据审计附录](#anchor-audit)
- [一句话带走](#anchor-takeaway)

---

<a id="anchor-here"></a>
## 「你在这里」锚点

```text
Routa 全局施工图：

  models → store → worker → acp → workflows → kanban/orchestration → api → app
     ↑        ↑        ↑       ↑        ↑              ↑             ↑      ↑
  Phase 0  Phase 1  Phase 2 Phase 3  Phase 4        Phase 5       Phase 6 Phase 7
  领域词汇  数据端口  运行策略  协议适配   流程编译       产品协调       入站边界  页面壳
```

前五个阶段已经把内部能力分开：

```text
Phase 0：对象和事件用什么语言表达；
Phase 1：数据事实通过什么端口保存和查询；
Phase 2：后台作业怎样调度、恢复和收敛；
Phase 3：provider 差异怎样归一化；
Phase 4：声明式 workflow 怎样编译成任务图；
Phase 5：Kanban、Orchestrator、MCP 怎样协调这些能力。
```

Phase 6 不应再发明一套 Task、Session 或 Workflow 规则。它要解决的是另一类问题：

> **外部世界用 URL、HTTP method、header、query、JSON、SSE 和 JSON-RPC 说话；内部世界用 Store port、domain service、runtime manager 和领域对象说话。谁负责翻译这两种语言，又怎样阻止传输细节与业务规则互相污染？**

当前 Web 入口是 Next.js App Router 的 `src/app/api/**/route.ts`，桌面/local server 入口则由 Axum router 装配。`docs/ARCHITECTURE.md:47-64` 明确了两个运行面，`docs/ARCHITECTURE.md:68-91` 又把 API/Transport 放在 Domain Services 与 Stores 之上。

这里还要说明一处学习序列现状：当前目录没有已纳入 HEAD 的 Phase 5 解剖文档。本课不补写 Phase 5，也不猜测它的内部行为；只把当前源码已经暴露的 core seam 当作 API 可以调用的能力。

**Phase 6 只解决一个核心矛盾：请求入口必须知道 HTTP/协议，但不应该因此成为第二套业务系统。**

---

<a id="anchor-scene"></a>
## 总体业务场景：同一个“创建 Task”，要跨过两种语言

浏览器提交：

**基于业务场景的请求示例：**

```http
POST /api/tasks
Content-Type: application/json

{
  "title": "实现登录页",
  "objective": "用户可以登录",
  "workspaceId": "ws-1"
}
```

HTTP 世界关心：

```text
body 是不是合法 JSON？
必填字段是否存在？
创建成功是 200 还是 201？
冲突是 409 还是普通 200 + error？
响应字段怎样命名？
```

领域世界关心：

```text
怎样创建合法 Task？
默认 board 与 column 是什么？
是否要同步 GitHub issue？
保存到哪个 TaskStore adapter？
进入自动化列后是否触发 session？
```

API route 是两种语言相遇的地方。它必须做翻译，却不能把所有领域决策重新实现一遍。

<a id="anchor-object-map"></a>
### 完整对象依赖图

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Routa API 入站边界全景                                │
└──────────────────────────────────────────────────────────────────────────────┘

【1. 调用方：同一产品，不同运行表面】

 Browser / Next.js UI                 Tauri static UI / local client
          │                                      │
          │ resolveApiPath + desktopAwareFetch    │
          ▼                                      ▼
 http://localhost:3000/api/*           http://127.0.0.1:3210/api/*
          │                                      │
          ▼                                      ▼

【2. Inbound Adapter：把传输语言翻译成应用输入】

 Next.js Route Handler                      Axum Handler
 src/app/api/**/route.ts                    crates/routa-server/src/api/**
          │                                      │
          ├─ method / path / query                ├─ Router / Path / Query
          ├─ header / JSON body                   ├─ HeaderMap / Json
          ├─ boundary validation                  ├─ boundary validation
          └─ HTTP / SSE / JSON-RPC response       └─ HTTP / SSE / JSON response
          │                                      │
          ▼                                      ▼

【3. Composition Root：提供已组装能力】

 getRoutaSystem()                           AppState
 src/core/routa-system.ts                   crates/routa-core/src/state.rs
          │                                      │
          ▼                                      ▼

【4. 内部稳定边界】

 Store ports / Domain services / Runtime managers / Protocol adapters
 TaskStore · WorkflowExecutor · Kanban queue · ACP runtime · MCP server
          │
          ▼
 Persistence / process / filesystem / provider

【5. 出站翻译】

 Domain result / error / event stream
          │
          ├─ JSON envelope + HTTP status
          ├─ SSE frames + headers + cleanup
          └─ JSON-RPC id/result/error + session headers
          ▼
 Client

【6. 双后端共同验收】

              api-contract.yaml
                     │
         shared tests/api-contract suites
             ┌───────┴────────┐
             ▼                ▼
       BASE_URL=:3000    BASE_URL=:3210
       Next.js backend   Axum backend
```

整张图压成一句话：

> **API 是入站 Adapter：它把外部传输翻译成内部能力调用，再把内部结果翻译回稳定的 HTTP 或协议契约；Composition Root 决定背后是谁执行，shared contract tests 检查两套实现中已经被用例覆盖的外部行为。**

<a id="anchor-philosophy"></a>
### 设计动机与设计哲学

API route 容易变胖，因为它天然站在所有东西的交叉口：

```text
框架 request
参数校验
鉴权与 workspace scope
领域 service
Store
外部 GitHub
事件广播
SSE
错误码
响应 DTO
```

如果没有边界纪律，“站在交叉口”很快会变成“拥有所有职责”。Routa 的 ADR 0006 给出目标方向：长而行为密集的入口应采用 **orchestration shell + domain hooks**，顶层只负责流程路由，implementation mass 留在稳定模块（`docs/adr/0006-orchestration-shell-pattern.md:16-17`）。

这里要区分三件事：

```text
薄 handler      = 解析传输输入 → 调用一个稳定用例 → 翻译输出
编排 shell      = 可以协调多个已命名步骤，但不内联每步规则
肥 route        = 业务判断、状态突变、外部副作用、错误映射和 DTO 全挤在入口
```

并非每个 route 都必须“delegate”。`/api/health` 没有领域用例需要调用，它只构造最小健康响应，仍然可以是薄壳。薄不等于必须多一层 class；薄的标准是：**传输入口没有承担会随业务独立变化的大块实现。**

五镜头可以这样验收：

| 镜头 | API 边界要问什么 |
|---|---|
| **分** | HTTP 解析、应用用例、领域规则、持久化、响应投影分别由谁负责？ |
| **稳** | route 文件名和 URL 变化时，领域规则是否不动；领域规则变化时，HTTP 契约是否可控？ |
| **向** | route 是否向内依赖 core seam，而 core 是否完全不知道 NextRequest/NextResponse？ |
| **约** | status、envelope、header、SSE lifecycle、JSON-RPC error 是否有可执行契约？ |
| **权** | 一个三十行 CRUD route 是否真的值得再造 service；一个六百行跨系统 route 是否还配叫 Adapter？ |

后面五个问题依次检查这五格。

---

<a id="anchor-q1"></a>
## 问题 1：API 路由为什么应该是薄壳，而不是第二套业务层

> **本节验证的设计判断**：入口可以协调，但不应拥有领域规则。业务越重，越要把稳定工作流抽到 route 之外，否则 Web 与 desktop、REST 与 MCP 会各自长出一套实现。

### 先看薄壳：`/api/health`

**真实代码摘录：`src/app/api/health/route.ts:9-18`**

```typescript
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { status: "ok", timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
```

它不是 delegate，因为没有领域服务可委托；但它是薄 route shell：

```text
没有 Store
没有业务状态机
没有跨系统副作用
没有复杂错误恢复
只定义健康响应本身
```

这也是 YAGNI：为了这五行再造 `HealthService`，只会把同一事实拆到两个文件。

### 再看半薄壳：`/api/tasks/ready`

**真实代码摘录：`src/app/api/tasks/ready/route.ts:25-38`**

```typescript
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const workspaceId = requireWorkspaceId(searchParams.get("workspaceId"));

  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const system = getRoutaSystem();
  const tasks = await system.taskStore.findReadyTasks(workspaceId);

  return NextResponse.json({
    tasks: await Promise.all(tasks.map((task) => serializeTask(task, system))),
  });
}
```

核心查询是薄的：`findReadyTasks` 决定谁 ready，route 没有复制依赖算法。

但整个文件并非纯 delegate。`serializeTask()` 在 `tasks/ready/route.ts:41-72` 中继续协调 evidence、story readiness、INVEST、delivery readiness，并手写完整 DTO 与 Date 转换。

因此准确结论不是“这个 route 很坏”，而是：

```text
查询规则边界：清楚，已在 Store；
响应投影边界：仍在 route；
整体：接近薄壳，但不是纯透传。
```

### 当前反面教材：`/api/tasks`

`src/app/api/tasks/route.ts` 同时承担：

```text
GET 查询分支与后置过滤                 :188-232
POST JSON/body 规范化                  :235-351
默认 board 与 codebase 选择            :353-378
GitHub issue 重复检查与创建             :360-409
Task 创建、保存、广播                  :411-455
自动化列判断与 workflow transition      :457-472
DELETE 单项/批量两套行为                :477-510
富化响应 DTO                           :513 起
```

这不能称为薄 delegate。底层能力虽然已经拆成 `createGitHubIssue()`、`processKanbanColumnTransition()`、`buildTaskEvidenceSummary()` 等模块，但 route 仍决定：

```text
何时调用谁
哪一步失败后怎样继续
怎样汇总状态
何时持久化
何时发事件
最终返回什么
```

它是一个**编排肥壳**，不是“所有算法都内联”的上帝函数；这个区分很重要。真正的重构方向不是把每个三行 helper 再拆一次，而是按稳定工作流分支抽取：

```text
listTasksUseCase
createTaskUseCase
serializeTaskProjection
removeTasksUseCase
```

### `/api/sessions` 的另一种肥法

`src/app/api/sessions/route.ts` 没有 GitHub 与 Kanban 副作用，却把产品派生规则写进 transport：

- `deriveSessionStatus()` 根据活跃进程、ACP 状态、七天阈值和 resume 能力推导四态（`:16-47`）；
- `hasExplicitTeamRunMarker()` 用 specialist、role 和名称启发式识别 team run（`:72-95`）；
- `listTeamRuns()` 建父子图、递归统计 descendants 并防环（`:97-142`）；
- GET 再按 workspace、parent、surface、limit 分支投影（`:144-195`）。

这些规则可以被 CLI、MCP 或 desktop handler 复用，却目前只住在 Next.js route。于是双后端 parity 只能靠重新实现并测试，而不能共享同一 TypeScript 用例。

### Before / After

```text
❌ 肥 route
NextRequest
  → 业务启发式
  → 多 Store / 外部系统
  → 状态突变
  → 事件
  → 大型 DTO
```

```text
✅ 目标薄壳
NextRequest
  → parse + validate TransportInput
  → useCase.execute(CanonicalInput)
  → presenter.toHttp(ApplicationResult)
```

### 五镜头判断

- **分**：route 只保留 transport 与应用步骤编排；领域启发式、跨系统 workflow 与响应投影各有稳定住所。
- **稳**：同一 Task 创建或 session 汇总规则从 route 抽出后，可被 Next.js、Axum、MCP 与测试复用。
- **向**：入口依赖应用用例；应用用例不反向 import `NextRequest`、`NextResponse` 或 Axum extractor。
- **约**：characterization tests 先锁住调用顺序、状态突变与响应形状，再移动实现质量。
- **权**：`/api/health` 级别的薄入口无需 service；跨多个 Store、外部系统和事件的 route 则已超过合理 Adapter 质量。

### 你以后怎么用

触发信号：

```text
□ route test 需要 mock 5 个以上 core 模块；
□ 同一个 handler 同时写 Store、外部 API 和 EventBus；
□ route-local helper 出现递归、状态机或领域启发式；
□ desktop handler 正在复制同一批规则；
□ 响应 DTO 的派生查询比 handler 本身还多。
```

配方：

```text
1. 先按 workflow branch 划分，不先造 generic utils；
2. route 只保留 transport input/output；
3. 把“做什么、按什么顺序”抽成应用用例；
4. 把纯响应投影抽成 presenter/serializer；
5. characterization tests 先锁住旧行为；
6. 让 Next.js 与 Axum 从外部契约上执行同一语义。
```

别过度：健康检查、固定配置快照、单 Store CRUD 若只有十几行，直接留在 route 更清楚。

**一句话带走**：薄壳不等于零代码，而是让入口只翻译和协调，不再拥有可独立演化的业务规则。

---

<a id="anchor-q2"></a>
## 问题 2：URL、query、path、body 参数怎样在系统边界收敛

> **本节验证的设计判断**：HTTP 输入只有在边界完成解析、校验和规范化后，才应该进入 core；TypeScript 的 `as` 只能骗过编译器，不能把外部字符串变成合法领域值。

### 同一个 workspaceId，至少有三种入口

```text
query:  /api/tasks?workspaceId=ws-1
path:   /api/workspaces/ws-1
body:   { workspaceId: "ws-1" }
header: Routa-Workspace-Id: ws-1    （MCP）
```

外部输入的共同特点是：**类型系统不拥有它。** URL 中的一切都是字符串或缺失，JSON body 是 `unknown`，header 也可能为空白。

`tasks` route 使用一个最小 canonicalizer：

**真实代码摘录：`src/app/api/tasks/route.ts:160-164`**

```typescript
function requireWorkspaceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
```

它把多个外部形状压成内部二选一：

```text
合法非空 workspaceId
或 null
```

### JSON 解析错误必须在边界收口

`POST /api/tasks` 明确处理 malformed JSON：

**真实代码摘录：`src/app/api/tasks/route.ts:235-241`**

```typescript
let body: Record<string, unknown>;
try {
  body = await request.json() as Record<string, unknown>;
} catch {
  return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
}
```

但 `POST /api/workspaces` 在当前快照直接 `await request.json()`（`src/app/api/workspaces/route.ts:32-37`），没有 route 级 catch。解析异常会向框架错误层冒泡，而不是稳定收敛成与 tasks 相同的 400 envelope。

这不是说所有 route 必须复制相同 try/catch；恰恰相反，它暴露了统一边界策略的价值：

```text
parse JSON
  → 失败：BadRequest
  → 成功：unknown body
  → schema/canonicalizer
  → CanonicalInput
```

### `as` 不是校验

`GET /api/workspaces` 当前把 query 直接断言成 `WorkspaceStatus`，非空就传给 Store（`src/app/api/workspaces/route.ts:21-27`）。运行时传入：

```text
?status=banana
```

TypeScript 不会在生产环境替你拒绝它。

对比 `GET /api/tasks` 的 status 分支：

**真实代码摘录：`src/app/api/tasks/route.ts:209-216`**

```typescript
} else if (status) {
  const taskStatus = status.toUpperCase() as TaskStatus;
  if (!Object.values(TaskStatus).includes(taskStatus)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
  }
  tasks = await system.taskStore.listByStatus(workspaceId, taskStatus);
}
```

它完成了三步：

```text
normalize case
validate closed enum
只把合法值交给 Store
```

但也要诚实指出边界：若请求同时带 `assignedTo` 与非法 `status`，代码优先进入 assignee 分支，status 不会被检查。可见“有校验代码”不等于“整个输入组合已经形成统一 schema”。

### 如果不收敛会怎样腐烂

```text
同一个 status 在 tasks 中被拒绝，在 workspaces 中却进入 Store；
malformed JSON 在一个 route 稳定返回 400，在另一个 route 冒泡；
core 被迫继续防御空白 ID、非法枚举和互相冲突的参数组合。
```

### 当前堵法与边界

当前已出现可复用的局部堵法：`requireWorkspaceId`、JSON parse catch、enum normalize + membership check。反证是这些机制尚未形成统一 schema，`assignedTo` 还会使 tasks 的 status 分支被跳过，workspaces 也保留了未校验入口。

### Before / After

```text
❌ 每个 route 各自断言、trim、猜优先级
外部脏输入 → Store / domain

✅ 统一边界收敛
unknown → parse → normalize → validate → CanonicalInput → use case
```

### Canonical Input 的真正目标

边界校验不只是多报几个 400。它要让 core 不必防御 HTTP 的所有脏形状：

```typescript
// ❌ 假设反例：core 继续理解 HTTP 脏输入
execute({ workspaceId: "   ", status: "pending", labels: "bug" });

// ✅ 目标建议：进入 core 前已收敛
execute({
  workspaceId: "ws-1",
  status: TaskStatus.PENDING,
  labels: ["bug"],
});
```

### 五镜头判断

- **分**：route/schema 负责“输入是否合法”；领域用例负责“合法输入意味着什么”。
- **稳**：同一个 `workspaceId` / `status` 规则应有共享入口，而不是每个 route 重新写 trim 和 enum 检查。
- **向**：core 接收 `CanonicalInput`，不 import `NextRequest`、`URLSearchParams` 或 HeaderMap。
- **约**：malformed JSON、空白 ID、非法枚举、字段冲突都应有明确负向用例。
- **权**：对简单 route，局部函数足够；只有重复与漂移已经出现时才引入 schema library 或共享 parser。

### 你以后怎么用

```text
1. 把 request body 当 unknown；
2. 分开 parse error 与 validation error；
3. string 先 trim/case normalize，再做 enum/range 校验；
4. 对冲突参数定义优先级或直接拒绝；
5. 只把 canonical value 交给 use case；
6. 每个边界至少一个正向、一个负向测试。
```

别过度：不要为一个只接受单个可选布尔值的内部 debug route 引入三百行 schema；但也不要用 `as DomainType` 冒充运行时安全。

**一句话带走**：边界校验的终点不是“返回 400”，而是保证 core 从此只看见合法、唯一解释的输入。

---

<a id="anchor-q3"></a>
## 问题 3：领域错误与结果怎样稳定映射成 HTTP status 与 JSON envelope

> **本节验证的设计判断**：HTTP status 与响应 body 共同组成行动契约。相同的 `{}`、相同的 200，无法表达列表、创建、冲突、删除和协议失败之间的不同语义。

### 一个域已经有多种成功形状

以 `src/app/api/tasks/route.ts` 为例：

```text
GET 成功       → 200 { tasks: [...] }                     :228-232
POST 成功      → 201 { task: {...} }                      :474
DELETE workspace → 200 { deleted: true, deletedCount }    :483-491
DELETE task     → 200 { deleted: true }                   :498-510
```

失败也不是一个笼统 error：

```text
缺 workspaceId / title / objective → 400
非法 status / priority             → 400
同一 GitHub issue 已导入          → 409                 :360-368
```

因此 BUILD_ORDER 中的通用模板：

**真实代码摘录：`docs/learning/koda-replication/BUILD_ORDER.md:375-392`（节选）**

```typescript
return NextResponse.json({ data: result });
```

只能是形状示意，不能成为所有路由的真实契约。否则前端必须同时兼容：

```text
{ tasks }
{ task }
{ data }
{ deleted }
```

骨架的目标不是强行把所有历史 API 改成 `{ data }`；Phase 6 依赖 Phase 7 页面，优先任务是**保留既有外部形状**。

### 错误翻译应该集中在哪

领域错误与 HTTP status 不是一一自动对应：

```text
InputInvalid        → 400
NotFound            → 404
Conflict            → 409
UnsupportedRuntime  → 501 或协议级 error
UnexpectedFailure   → 500
```

目标建议可以采用显式结果：

```typescript
type CreateTaskResult =
  | { kind: "created"; task: Task }
  | { kind: "github_issue_conflict"; taskId: string }
  | { kind: "invalid_input"; message: string };
```

route 再做传输翻译：

```text
created               → 201 { task }
github_issue_conflict → 409 { error }
invalid_input         → 400 { error }
```

这样 REST、MCP 和 CLI 可以对同一领域结果使用不同外部表达，而不复制领域判断。

### “任意端点不 500”为什么不是完整验收

BUILD_ORDER 的动机是对的：骨架 route 不应因为 core 是 stub 就到处抛未捕获异常。但若只把所有失败改成空对象或 501，会掩盖三种问题：

1. **输入错误本应是 400**，不是“不支持”；
2. **资源冲突本应是 409**，不是伪成功；
3. **协议错误可能要求 JSON-RPC code**，不能只看 HTTP status。

更可执行的验收矩阵是：

| route 类型 | 最小成功契约 | 最小失败契约 |
|---|---|---|
| list | 200 + 命名数组 envelope | 缺 scope → 400 |
| get | 200 + 命名实体 envelope | 不存在 → 404 |
| create | 201 + 创建实体 | 非法输入 → 400；冲突 → 409 |
| delete | 200/204 + 明确删除语义 | 缺 ID → 400；不存在策略需声明 |
| health | 200 + status/timestamp + no-store | 服务不可用策略需声明 |
| protocol | 按协议握手/错误 envelope | transport 与 method error 分开 |
| SSE | 200 stream + headers + cleanup | 建流前错误可用 JSON/status |

### Before / After

```text
❌ 一个通用空壳
所有成功 → 200 { data: {} }
所有失败 → 501 {}

✅ operation 级契约
list/create/delete 各保留自己的 status 与 envelope；
invalid/not-found/conflict/unsupported 分别翻译；
协议错误再保留协议 envelope。
```

### 当前边界与反证

不同 route 可以共享 `NextResponse.json` 这一编码机制，但不能由此推出 payload 与 status 也应统一。相反，tasks 域本身已经证明一个 URL 域内存在列表、创建、单删、批删和冲突等多种行动语义。

### 五镜头判断

- **分**：领域 Result 表达业务结果；HTTP translator 决定 status、body 与 headers。
- **稳**：外部 envelope 一旦被 Phase 7/client 消费，就应比内部 Store 与 provider 实现更稳定。
- **向**：领域层不返回 `NextResponse`；transport 层不重新判断业务冲突。
- **约**：正向与负向测试必须同时断言 status 和 body 关键字段。
- **权**：不需要全仓强制一个 envelope；需要的是每个 operation 的精确、可执行契约。

### `/api/health` 的小契约也不能缩丢

当前真实响应不仅是：

**基于真实代码的简化：`src/app/api/health/route.ts:13-17`**

```json
{ "status": "ok" }
```

还包含：

```text
timestamp: ISO string
Cache-Control: no-store
```

因此“原样保留”与“验收 status 至少为 ok”要分清：后者是最低断言，不是完整 body 的精确描述。

### 你以后怎么用

```text
1. 先为每个 operation 写 status + envelope 表；
2. 用领域 Result 区分 invalid/not-found/conflict/unsupported；
3. presenter 负责 Date、枚举和字段投影；
4. 不用 catch-all 把所有失败改成 200；
5. 负向测试同时断言 status 与 body；
6. 不声明的 header 与排序，不让客户端偷偷依赖。
```

**一句话带走**：status 告诉客户端发生了哪类结果，envelope 告诉它怎样读取结果；两者少一个，契约都不完整。

---

<a id="anchor-q4"></a>
## 问题 4：REST、SSE、ACP/MCP 为什么不能用同一种 stub 策略

> **本节验证的设计判断**：协议网关不只是“返回 JSON 的特殊 API”。它拥有握手、请求关联、session、流式传输、重放、心跳与清理等时间契约；空对象或裸 501 会破坏客户端状态机。

### 先分四种完全不同的 route

| 类型 | 代表 | 核心契约 |
|---|---|---|
| REST snapshot | `/api/health`、`/api/tasks` | request/response，完成后连接结束 |
| SSE channel | `/api/notes/events` | 持续字节流、attach/detach、stream headers |
| ACP gateway | `/api/acp` | POST JSON-RPC + GET session/update SSE |
| MCP Streamable HTTP | `/api/mcp` | session ID、JSON-RPC、POST/GET/DELETE/OPTIONS |

它们都使用 HTTP，但生命周期完全不同。

### ACP：同一路径，两套传输契约

`GET /api/acp` 的正常成功路径不是 JSON snapshot。

**基于真实代码的简化：`src/app/api/acp/route.ts:241-280`**

```typescript
const stream = new ReadableStream<Uint8Array>({
  async start(controller) {
    const lastEventId = request.headers.get("last-event-id")
      ?? request.nextUrl.searchParams.get("lastEventId");
    // 从持久化历史重放，再 attach live SSE
    // 每 30 秒发送 heartbeat
  },
  cancel(reason) {
    cleanup(`stream canceled: ${reason}`);
  },
});
```

清理逻辑在 `acp/route.ts:218-239`：

```text
只执行一次
清 heartbeat timer
detachSse(sessionId)
flushAgentBuffer(sessionId)
```

响应 headers 在 `acp/route.ts:304-312`：

```text
Content-Type: text/event-stream
Cache-Control: no-cache, no-store, must-revalidate
Connection: keep-alive
X-Accel-Buffering: no
```

`POST /api/acp` 则解析 `method / params / id`（`:319-329`），`initialize` 返回同一 id 对应的 capabilities result（`:333-345`）。正常 JSON-RPC 形状是：

**基于真实代码的简化：**

```json
{ "jsonrpc": "2.0", "id": 7, "result": { } }
```

或：

```json
{ "jsonrpc": "2.0", "id": 7, "error": { "code": -32601, "message": "..." } }
```

所以：

```text
GET 空 JSON  → 浏览器以为请求结束，没有实时流；
POST 空 JSON → 客户端找不到 id/result/error，无法关联请求。
```

同时不要绝对化“ACP GET 都是 SSE”：缺 sessionId 可返回 400，ownership 冲突可返回 409，`probe=1` 返回 204。准确契约是：**正常成功的订阅路径是 SSE；建流之前的校验失败仍可用普通 HTTP 响应。**

### MCP：session 本身就是协议状态

`src/app/api/mcp/route.ts:88-122` 创建 `WebStandardStreamableHTTPServerTransport`：

```text
sessionIdGenerator 生成 ID
initialize 后 sessions.set(sid, transport)
transport close 后 sessions.delete(sid)
enableJsonResponse 允许 POST 返回 JSON
```

后续 POST 在 `mcp/route.ts:227-256` 读取 `Mcp-Session-Id`，补齐协议要求的 Accept header，再把完整 request 交给 transport。

GET 在 `mcp/route.ts:411-432` 要求有效 session，并允许 server-initiated SSE；DELETE 在 `:439-449` 终止同一 transport；OPTIONS 在 `:456-467` 返回 204 和 CORS headers。

因此 MCP 的 stub 不能只是：

```typescript
// ❌ 假设反例
return Response.json({}, { status: 501 });
```

它至少要决定：

```text
initialize 是否仍可完成？
不支持的 tools/call 用 HTTP 501 还是 JSON-RPC error？
GET 没 session 返回什么？
DELETE 未找到 session 返回什么？
OPTIONS 是否仍为 204 并保留 CORS？
Mcp-Session-Id 是否仍暴露？
```

### 如果统一成空 JSON / 裸 501 会怎样腐烂

```text
ACP GET：客户端拿不到持续 session/update，replay 与 cleanup 全部消失；
ACP POST：请求 id 无法和 result/error 对应；
MCP：Mcp-Session-Id 生命周期断裂，GET/DELETE 不再作用于同一 transport；
SSE：表面 200，却在第一帧前就结束，形成最难诊断的伪成功。
```

### 当前堵法与边界

当前 route 已按 method 分开 JSON-RPC、SSE、session terminate 与 CORS preflight，并在正常流路径保留 replay、heartbeat 和 cleanup。反证是并非所有 GET 都是 SSE：建流前仍有 400/409/204，MCP 也有 404 与 OPTIONS 204；所以应保留“按操作区分”的契约，而不是强制所有响应同构。

### Before / After

```text
❌ 能力缺失 → 所有 handler 返回 501 {}

✅ 能力缺失 → 协议仍合法
handshake 保留；unsupported 使用协议 error；
stream 在建流前明确拒绝；terminate/preflight 保留既有语义。
```

### Koda 的协议 stub 应怎样分档

**目标建议：**

```text
档 A：可无 runtime 完成的协议握手
  ACP initialize → 返回最小 capabilities
  MCP OPTIONS     → 保留 204 + CORS

档 B：需要真实进程/工具 runtime 的方法
  session/new / session/prompt / tools/call
  → 返回协议合法的“unsupported”错误
  → HTTP status 是否 501 由协议/client contract 明确

档 C：流式订阅
  没有可运行 session 时，在建流前返回明确错误
  不伪造一个立即结束的空 SSE 成功流
```

### 五镜头判断

- **分**：REST DTO、SSE transport、JSON-RPC method 与 runtime execution 不是一层职责。
- **稳**：协议 envelope 与 header 比具体 provider/runtime 更稳定，stub 也必须遵守它们。
- **向**：route/transport 依赖 ACP/MCP runtime seam；领域模块不依赖 SSE controller。
- **约**：协议测试必须覆盖 id、error code、session header、media type、replay/cleanup，而不只 status。
- **权**：Koda 不必运行真实 provider，但“没有 runtime”不能成为破坏协议形状的理由。

### 你以后怎么用

```text
1. 先画状态机，不先写 handler；
2. 分开 handshake、command、stream、terminate；
3. 对流式 route 明确 attach、replay、heartbeat、cleanup；
4. 对 JSON-RPC 保留 id/result/error；
5. 对 session protocol 保留 session header 生命周期；
6. stub 的是能力，不是协议。
```

**一句话带走**：REST 可以返回一个结果，协议网关还要维持一段对话；stub 掉执行能力，也不能 stub 掉对话语法。

---

<a id="anchor-q5"></a>
## 问题 5：Next.js 与 Axum 怎样靠 API contract 保持产品语义一致

> **本节验证的设计判断**：双后端共享的是外部产品契约，不是同一份源码。共享 suite 可以让两边接受同一把尺，但只能证明尺子真正量过的部分。

### 当前机制不是双响应 diff

`tests/api-contract/helpers.ts:14-28` 只有一个 `BASE_URL`，`api()` 每次把请求发给一个目标。

`tests/api-contract/run.ts:5-9` 给出的运行方式是：

```text
BASE_URL=http://localhost:3000 ...  # Next.js
BASE_URL=http://localhost:3210 ...  # Rust
```

runner 在 `run.ts:37-45` 注册同一组 suites：

**真实代码摘录：`tests/api-contract/run.ts:37-45`（节选）**

```typescript
const suites = [
  workspaces,
  agents,
  tasks,
  notes,
  sessions,
  skills,
  schema-validation,
];
```

因此 parity 的真实形状是：

```text
同一套断言
   ├─ 对 Next.js 跑一次
   └─ 对 Axum 跑一次
```

不是：

```text
一次请求两个后端 → 逐字节 diff 两份响应
```

共享 oracle 的优点是允许实现细节不同；缺点是，断言没有写到的差异不会自动出现。

### 覆盖边界必须诚实

例如 session suite 在 `tests/api-contract/test-sessions.ts:17-31` 只请求：

```text
GET /api/sessions
```

并检查 200 与 `sessions` 是数组。它没有由此证明：

```text
session detail
history
transcript
context
disconnect
fork
```

全部 parity。

因此共享 contract tests 的正确表述是：

> **两个后端在同一套已执行用例和断言覆盖到的可观察行为上接受同一把尺。**

不是：

> 两个后端的全部 API 已被证明完全相同。

### 一个已确认的契约执行缺口

`api-contract.yaml:2223-2239` 把 `getWorkspace` 的 200 body 声明为裸 `Workspace`。

Axum handler 在 `crates/routa-server/src/api/workspaces.rs:49-68` 返回：

**基于真实代码的简化：**

```json
{
  "workspace": { },
  "codebases": [ ]
}
```

共享测试在 `tests/api-contract/test-workspaces.ts:54-60` 使用：

**真实代码摘录：`tests/api-contract/test-workspaces.ts:54-60`（节选）**

```typescript
const workspace = data.workspace ?? data;
```

这同时接受裸对象与 wrapper，等于主动放宽了 contract，因而无法抓住该 shape 漂移。

create 路径还有另一种宽松：contract 只声明 200，但测试在 `test-workspaces.ts:39` 接受 200 或 201。当前 Axum create 实际返回 200，不能说它已经违约；准确结论是：**测试允许未来或另一后端返回 contract 未声明的 201。**

### Contract、实现、测试是三层，不是一层

```text
api-contract.yaml
  = 我们声明什么

Next.js / Axum handlers
  = 我们实际做什么

shared tests
  = 我们真正检查了什么
```

三者可能分别漂移：

```text
contract 写对，实现写错，测试太宽 → 漂移漏过
contract 写旧，实现和测试一致 → 测试绿但文档错
contract 与实现都对，测试没覆盖 → 没有回归证据
```

### Before / After

```text
❌ 宽松 parity
同一测试同时接受裸对象和 wrapper；
实际 200/201 都算通过；
未覆盖 route 也被口头算作一致。

✅ 精确 parity
同一 operation 只有一个声明 shape；
实际 status 对应自己的 schema；
两个 backend 分别通过同一组精确断言；
覆盖矩阵公开未测范围。
```

### 当前边界与反证

共享 suite 并非无效：它确实让两个后端接受同一组行为断言，schema-validation 也扩大了部分结构检查。反证只说明它不是直接双响应 diff，也没有自动穷举全部 surface；不能由此否定已经覆盖的 contract tests。

### 怎样让 parity 更可信

```text
1. 每个关键 operation 固定一个精确成功 schema；
2. 至少一个负向 status + body；
3. 测试不写 d.workspace ?? d 这类双形状兼容；
4. 实际返回 201 就按 201 schema 校验，不借 200 schema；
5. route inventory 与 contract operation 建覆盖矩阵；
6. 协议/SSE 另写 header、frame 与 lifecycle tests；
7. 只对真正覆盖的行为作 parity 声明。
```

### 五镜头判断

- **分**：contract 声明、backend 实现、test oracle 三层互相校验，不能互相冒充。
- **稳**：外部 API shape 是 Web/Desktop 之间最稳定的共同边界。
- **向**：两套实现都指向契约；契约不应由某个 backend 的偶然 shape 反向决定。
- **约**：宽松 fallback 会让测试从“执法”退化为“兼容历史漂移”。
- **权**：穷举全部 187 个 route 成本很高，应优先覆盖核心路径和高风险协议，但未覆盖部分必须透明。

### 你以后怎么用

```text
1. 用 machine-readable contract 固定 operation、status 与唯一 response shape；
2. 同一 suite 分别运行在每个 backend；
3. 不写同时接受两种互斥 shape 的 fallback 断言；
4. 每个核心 operation 至少覆盖正向、负向和关键不变量；
5. 用覆盖矩阵明确哪些 route 尚未被共享 suite 量到。
```

别过度：共享 suite 不需要逐字节比较数据库 ID、时间戳等非确定值；应比较契约承诺的可观察语义。

**一句话带走**：共享 suite 让两个后端用同一把尺，但尺子没量到的地方，绿色测试不能替你证明一致。

---

<a id="anchor-patterns"></a>
## 四个可迁移模式

### 模式 1：Thin Inbound Adapter / Orchestration Shell

#### 是什么

生活类比：餐厅服务员负责听懂客人、把菜单交给后厨、再端回成品；服务员不应该在桌边重新发明整套菜谱。

```text
TransportInput → Application Use Case → TransportOutput
```

#### Before / After

```typescript
// ❌ 假设反例：route 同时拥有业务与基础设施
parseBody();
createGitHubIssue();
saveTask();
startAgent();
emitEvent();
serializeEverything();

// ✅ 目标建议
const input = parseCreateTaskRequest(request);
const result = await createTaskUseCase.execute(input);
return presentCreateTask(result);
```

#### Routa 证据

- 薄壳：`src/app/api/health/route.ts:13-17`；
- 半薄壳：`src/app/api/tasks/ready/route.ts:25-72`；
- 编排肥壳：`src/app/api/tasks/route.ts:188-510`；
- 产品规则肥壳：`src/app/api/sessions/route.ts:16-195`。

#### 你以后怎么用

触发：route 同时出现多个 Store、外部 API、事件、递归或领域状态机。

配方：按 workflow branch 抽 use case；route 留 parse/call/present；serializer 与领域规则分开。

不用：固定健康响应或十几行单 Store CRUD。

**一句话带走**：入口负责翻译，应用用例负责完成事情。

---

### 模式 2：Boundary Validation + Canonical Input

#### 是什么

生活类比：机场安检不是把危险品带上飞机后再提醒机长，而是在登机口前把允许的输入形状收敛好。

#### Before / After

**基于真实代码的简化 + 目标建议：**

```typescript
// ❌ 编译器相信，运行时没检查
const status = query.get("status") as WorkspaceStatus;

// ✅ 外部字符串先规范化再验证
const status = parseWorkspaceStatus(query.get("status"));
if (!status.ok) return badRequest(status.message);
```

#### Routa 证据

- workspaceId canonicalizer：`src/app/api/tasks/route.ts:160-164`；
- malformed JSON → 400：`tasks/route.ts:235-240`；
- enum normalize + validate：`tasks/route.ts:209-216`；
- 当前漂移：`workspaces/route.ts:21-37`。

#### 你以后怎么用

```text
unknown → parse → normalize → validate → CanonicalInput
```

不用：已由框架强类型构造且不会越过系统边界的内部对象。

**一句话带走**：`as` 只改编译器的看法，validation 才改变输入能不能进系统。

---

### 模式 3：Error Translation + Stable Response Contract

#### 是什么

领域层说“冲突”“不存在”“不支持”，HTTP Adapter 把它翻译成 status、body 和 headers。

#### Before / After

```text
❌ 所有失败 → 500 或 200 {}
✅ Invalid → 400
   Missing → 404
   Conflict → 409
   Unsupported → 受协议约束的错误
```

#### Routa 证据

`src/app/api/tasks/route.ts:188-510` 展示 list/create/delete 各自不同 envelope；重复 GitHub issue 使用 409（`:360-368`）；health 还要求 no-store（`health/route.ts:13-17`）。

#### 你以后怎么用

先定义应用 Result，再为每个 transport 写 translator；测试同时断言 status 与 body，不让 catch-all 吞掉领域差异。

不用：不会失败、没有输入、没有领域结果分支的固定 snapshot route。

**一句话带走**：领域错误说发生了什么，transport translator 决定客户端怎样知道。

---

### 模式 4：Cross-Backend Contract Test

#### 是什么

同一套外部行为用例分别运行在两个实现上，让实现技术不同但产品语义一致。

```text
Contract suite → Next.js
              → Axum
```

#### Before / After

```text
❌ Web test 只测 Web，Desktop test 另写一套宽松规则
✅ 同一 operation、同一输入、同一精确断言分别执行
```

#### Routa 证据

- 单目标 runner：`tests/api-contract/helpers.ts:14-28`；
- 共享 suites：`tests/api-contract/run.ts:37-45`；
- 当前宽松 shape：`tests/api-contract/test-workspaces.ts:54-60`；
- Axum wrapper：`crates/routa-server/src/api/workspaces.rs:49-68`。

#### 你以后怎么用

```text
1. 先立 machine-readable contract；
2. 每个核心 operation 写正向、负向、不变量；
3. 同一 suite 跑所有 backend；
4. 不接受两种互斥 shape；
5. 用覆盖矩阵公开未测 operation。
```

不用：两个后端本来就是不同产品、没有共享外部语义时，不要为了“统一”制造假 parity。

**一句话带走**：共享测试证明的是共同断言，不是两份源码天然等价。

---

<a id="anchor-next"></a>
## Koda Phase 6 施工边界与 Phase 7 交棒

BUILD_ORDER 当前写法需要从“按 API 域”再细化到“按 route 类型”。推荐施工矩阵：

### A. 原样保留：无 core 依赖的 bootstrap/snapshot

```text
/api/health
  GET 200
  body 至少包含 status="ok" 与 timestamp
  Cache-Control: no-store
```

### B. 薄 delegate：Phase 0–5 stub 已能回答的领域 route

```text
list   → 命名数组 envelope，例如 { tasks: [] }
get    → 命名实体 envelope；不存在返回既有 404
create → 若 InMemory core 可创建，返回既有 201 + 实体
         若核心能力明确缺失，不伪造成功对象
delete → 保留 deleted/deletedCount 形状
```

这里不能把所有 route 改成 `{ data: ... }`，也不能让创建 route“自动返回空对象”。

### C. 协议 stub：保留协议，禁用能力

```text
ACP initialize → 可返回最小 capabilities
ACP runtime method → JSON-RPC error，保留 id
MCP OPTIONS → 204 + CORS
MCP unsupported command → 保留 JSON-RPC / session contract
```

HTTP 501 可以作为 transport status 的一部分，但不能替代协议 envelope。

### D. 流式 route：不伪造成功流

没有运行 session 时：

```text
在建立 stream 前返回明确错误
```

若保留流：

```text
Content-Type: text/event-stream
必要 cache/buffering headers
attach/detach
abort/cancel cleanup
若承诺 replay，则保留 Last-Event-ID 语义
```

### Phase 6 验收建议

```text
□ 每个保留 route 能编译；
□ list/get/create/delete 的 status 与 envelope 符合既有契约；
□ malformed JSON、缺 workspaceId、非法 enum 有稳定 400；
□ conflict 保留 409，不改成 200 或 501；
□ health 保留 timestamp 与 no-store；
□ ACP/MCP unsupported 保留 JSON-RPC id/error；
□ SSE 不用空 JSON 或立即结束的假成功流替代；
□ CORS/Accept/session headers 按协议保留；
□ Koda contract suite 只声明它实际覆盖的 parity；
□ 所有明确不支持的能力可诊断，不产生未捕获 500。
```

### 向 Phase 7 交棒

Phase 7 页面与 client 不应该知道 Koda 内部哪些 core 是 stub。它只依赖：

```text
稳定 URL
稳定 method
稳定 status
envelope 字段存在
错误可诊断
流式能力明确支持或明确拒绝
```

交棒关系：

```text
Phase 7 page/hook
  → resolveApiPath + desktopAwareFetch
  → Phase 6 stable endpoint
  → Phase 0–5 core seam
```

Phase 7 不应：

```text
❌ 为同一端点同时兼容 {data}/{tasks}/裸数组三种 shape
❌ 遇到 501 当空成功
❌ 把 SSE endpoint 当普通 fetch.json()
❌ 在 UI 重新推导 session continuity 或 Task readiness
❌ 直接 import provider/runtime 实现绕过 API
```

---

<a id="anchor-notes"></a>
## 学习笔记

```text
1. 为什么 /api/health 可以没有 service，却仍然是好薄壳？


2. /api/tasks/ready 哪部分已经委托正确，哪部分仍留在 route？


3. `as WorkspaceStatus` 为什么不是边界校验？


4. 201 {task}、409 {error}、200 {tasks} 各自表达什么行动语义？


5. 为什么 ACP GET 的 400/204 例外不推翻“正常订阅是 SSE”？


6. MCP 的 Mcp-Session-Id 为什么属于协议契约，而不是内部实现细节？


7. shared contract tests 为什么不能证明全部 route parity？


8. Koda 应该 stub 掉的是 runtime 能力，还是协议外壳？
```

---

<a id="anchor-audit"></a>
## 证据审计附录

### 快照

```text
revision: 34eb1ed58d48fd121c87c5915a8ff09035f1b3a4
初始已存在未跟踪文件：phase4-analysis.md
调查中检测到外部并行新增：phase5-analysis.md
本轮写入：phase6-analysis.md 与执行计划
```

`phase4-analysis.md` 以 SHA-256 `5f6ab5b832d80d1006aa8f58e855e8817a69b62de99e8f927b6d005ed75cc1d0` 锁定；本轮不修改 Phase 4/5。

### 编排统计

```text
Finder lanes: 6
Finder transient failures: 1（L5 gateway fetch failed）
Finder retries: 1（成功）
原始候选: 24
去重后候选: 16
重复/低增量省略: 8

第一轮 Verifier attempts: 16
  严格通过结构与证据 gate: 1 confirmed
  输出枚举/字段不符合模板: 14
  worktree 创建失败: 1

第二轮自适应 Verifier attempts: 6
  用于替代第一轮中 6 个主干候选的不合格 attempt
  confirmed: 6

最终候选级账本（总数 = 去重后 16）：
  claim_confirmed: 7
  claim_refuted: 0
  inconclusive: 9
  candidate_invalid: 0

attempt 级记录（总数 = 22 次验证调用）：
  合格 confirmed attempts: 7
  结构不合格 attempts: 14
  tool/worktree failed attempts: 1
```

严格 gate 的意义是：即使 Verifier 的自然语言看起来支持候选，只要没有使用规定的 `claim_result` 枚举、缺必填字段，或结构与 reason 不一致，就不能由主协调者“顺手修好”。第二轮只替代 6 个同一候选的失败 attempt，不新增候选；正文只综合最终候选账本中的 7 条确认声明。

### 截断与失败

```text
Finder 报告的读取截断计数合计: 5
Verifier transport/worktree failure: 1
未取消 Agent: 0
未 harvest Agent: 0
```

截断 lane 通过定向读取补查；但任何依赖未完整字段的候选都没有进入确认结论。

### 覆盖缺口

本轮没有逐项检查：

```text
全部 187 个 route.ts
全部 Axum handler
所有 protocol SDK 内部行为
所有 API contract operation
真实运行中的 Next.js/Rust 双后端响应
Phase 5 未跟踪分析文档
```

因此本文只能说明代表性边界与已确认的契约缺口，不能当作“全 API 审计通过报告”。

---

<a id="anchor-takeaway"></a>
## 一句话带走

> **Phase 6 的本质不是把 187 个 route 编译通过，而是守住入站边界：普通 REST 要稳定解析输入、调用 core、翻译 status/envelope；SSE 与 ACP/MCP 还要保留流、会话和协议状态机；Next.js 与 Axum 再用同一套精确契约检查已覆盖的产品语义。Koda 可以 stub 执行能力，但不能把边界契约一起 stub 掉。**
