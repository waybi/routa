# Routa Phase 7 设计拆解：页面 + 前端壳

> **本文定位**：教学设计 / 页面入口与前端运行边界解剖笔记，不是 29 个页面与百余个组件的 UI 清单。目标是解释 Next.js 页面怎样把 URL 变成产品入口、React hook 怎样把后端协议变成可渲染状态、同一套前端又怎样在 Web 与 Tauri 两种运行面连接后端。
>
> 阅读顺序沿用 Phase 0–6：**业务痛点 → 如果不管会怎样腐烂 → 当前设计怎么堵 → Before / After → 权衡与边界**。全文只用首页、Kanban、ACP client 和 backend bridge 等代表切片说明架构，不逐组件讲 UI。
>
> 涉及源码行为的代码片段分四类标记：**真实代码摘录**（可按 `file:line` 回查）、**基于真实代码的简化**（省略无关字段）、**假设反例**（说明没有该设计时会怎样，非 Routa 历史代码）、**目标建议**（Koda 骨架施工方向，不代表 Routa 当前已完成）。纯概念图、问题清单和流程摘要使用 `text` 块，不冒充源码。
>
> 本文事实基线是 Git 快照 `34eb1ed58d48fd121c87c5915a8ff09035f1b3a4`，调查时相关工作区脏状态指纹为 `469cfdc9c6fbf21261aae9d65d9a361f7b5f619b76cf4562bdfc364f49ba0bed`。24 条候选经独立复核后，21 条确认、3 条反驳；被反驳的数字或范围不会包装成现状事实。

## 目录

- [「你在这里」锚点](#anchor-here)
- [总体业务场景](#anchor-scene)
  - [一条页面请求的完整路径](#anchor-flow)
  - [完整对象依赖图](#anchor-object-map)
  - [设计动机与设计哲学](#anchor-philosophy)
- [问题 1：page.tsx 为什么是路由入口，不等于薄页面](#anchor-q1)
- [问题 2：为什么长页面要拆成编排壳、领域 hook 与渲染叶子](#anchor-q2)
- [问题 3：Web 与 Tauri 怎样共享同一套 API 调用代码](#anchor-q3)
- [问题 4：普通 CRUD、SSE、ACP 与 RPC 为什么不能共用一个 client 模板](#anchor-q4)
- [问题 5：Koda 为什么不能一边原样保留页面、一边删除全部组件](#anchor-q5)
- [五个可迁移模式](#anchor-patterns)
- [尚未证实与需要裁决的边界](#anchor-gaps)
- [Koda Phase 7 施工边界](#anchor-build)
- [Phase 7 如何完成全链路闭环](#anchor-handoff)
- [学习笔记](#anchor-notes)
- [证据审计附录](#anchor-audit)
- [一句话带走](#anchor-takeaway)

---

<a id="anchor-here"></a>
## 「你在这里」锚点

```text
Routa 全局施工图：

  models → store → worker → acp → workflows → kanban/orchestration → api → app/client
     ↑        ↑        ↑       ↑        ↑              ↑             ↑       ↑
  Phase 0  Phase 1  Phase 2 Phase 3  Phase 4        Phase 5       Phase 6 Phase 7
  领域词汇  数据端口  运行策略  协议适配   流程编译       产品协调       入站边界  产品入口
```

前七层已经回答：

```text
Phase 0：对象和事件用什么语言表达；
Phase 1：事实通过什么端口保存和查询；
Phase 2：后台作业怎样调度和恢复；
Phase 3：provider 差异怎样归一化；
Phase 4：workflow 怎样编译为任务图；
Phase 5：Kanban、Orchestrator、MCP 怎样协调能力；
Phase 6：HTTP、SSE、JSON-RPC 怎样稳定暴露这些能力。
```

Phase 7 面对的是最后一种翻译：

> **用户只看见页面、按钮、加载状态与实时变化；系统内部却是 URL 参数、HTTP envelope、SSE event、JSON-RPC session 和不同运行时。谁负责把这些技术事实收敛成稳定的产品体验？**

Phase 7 不是“把 UI 画出来”这么简单。它至少包含四层：

| 层 | 负责什么 | 不负责什么 |
|---|---|---|
| `src/app/**/page.tsx` | URL 入口、server/client 边界、静态参数 | 重写领域规则 |
| 页面编排壳 | 组合状态、数据源、事件与大区块 | 亲自绘制每个叶子控件 |
| `src/client/hooks/` | 把协议结果变成 React state/actions | 决定后端业务政策 |
| `src/client/*-client.ts` 与 bridge | URL、transport、JSON-RPC、SSE | 持有页面展示状态 |

Phase 6 的交棒契约是：

```text
稳定 URL + method + status + envelope + stream semantics
```

Phase 7 的任务则是：

```text
把这些 transport contract 变成可导航、可加载、可恢复、可实时刷新的产品入口。
```

---

<a id="anchor-scene"></a>
## 总体业务场景：用户打开 Kanban 后发生了什么

用户访问：

```text
/workspace/ws-1/kanban
```

浏览器表面上只是在打开一个页面。真实链路却是：

```text
URL
 ↓
Next.js App Router 匹配 page.tsx
 ↓
Server page 壳选择 Client Component
 ↓
页面编排壳读取 workspaceId、连接 hooks
 ↓
HTTP 请求加载 board/tasks/sessions/specialists
 ↓
resolveApiPath + desktopAwareFetch 选择 Web 或 Tauri 后端
 ↓
Phase 6 API 返回稳定 envelope
 ↓
React state 驱动 KanbanTab 与叶子组件
 ↓
EventSource 收到 kanban:changed / fitness:changed
 ↓
onInvalidate → refresh key → 重新查询事实
```

这里同时存在三种时间尺度：

```text
路由时间：进入哪个页面？
请求时间：当前数据加载成功还是失败？
会话时间：页面打开期间，后端事实怎样持续变化？
```

只保留 `page.tsx` 文件名，并不能自动保留这三种行为。

<a id="anchor-flow"></a>
### 一条页面请求的完整路径

以 Kanban 为例，真实 `page.tsx` 很薄（`src/app/workspace/[workspaceId]/kanban/page.tsx:1-16`）：

```typescript
/** 真实代码摘录 */
import { KanbanPageClient } from "./kanban-page-client";

export async function generateStaticParams() {
  if (process.env.ROUTA_BUILD_STATIC === "1") {
    return [{ workspaceId: "__placeholder__" }];
  }
  return [];
}

export default function WorkspaceKanbanPage() {
  return <KanbanPageClient />;
}
```

它做了两件事：

1. 为静态桌面构建提供 placeholder route；
2. 把交互行为交给 `KanbanPageClient`。

后者不是叶子 UI，而是 513 行的客户端编排壳。它持有 boards、tasks、sessions、specialists、repo changes、refresh key 等页面级状态，并在 `kanban-page-client.tsx:371-374` 接入实时失效通知：

```typescript
/** 真实代码摘录 */
useKanbanEvents({
  workspaceId,
  onInvalidate: handleKanbanInvalidate,
});
```

最终它把组织好的状态和 actions 传给更大的 `KanbanTab`，再由 tab、panel、modal 与 card 叶子渲染。

<a id="anchor-object-map"></a>
### 完整对象依赖图

```text
┌──────────────────────────────────────────────────────────────────────────┐
│                    Routa Phase 7 前端全景                                │
└──────────────────────────────────────────────────────────────────────────┘

【1. 路由与全局壳】

URL
 │
 ▼
src/app/**/page.tsx
 ├─ Server Component page
 ├─ generateStaticParams
 └─ Client Component boundary
             │
             ▼
src/app/layout.tsx
 ├─ ThemeInitializer
 └─ I18nProvider


【2. 页面编排】

*-page-client.tsx / large client page
 ├─ URL params
 ├─ page-level state
 ├─ domain hooks
 ├─ invalidation wiring
 └─ layout composition
             │
             ▼
Tab / panel / modal / card / editor


【3. React 状态适配】

src/client/hooks
 ├─ useWorkspaces       HTTP state + actions
 ├─ useNotes            HTTP CRUD + SSE
 ├─ useKanbanEvents     SSE invalidation side effect
 ├─ useAgentsRpc        JSON-RPC state
 ├─ useSkills           SkillClient state
 ├─ useAcp              ACP session/provider orchestration
 └─ useHarness...       多端点 query state
             │
             ▼
protocol clients / desktopAwareFetch


【4. 传输与运行时】

resolveApiPath(path, base?)
             │
             ├─ Web HTTP runtime → /api/...
             ├─ configured backend → https://host/api/...
             └─ Tauri static → http://127.0.0.1:3210/api/...
             │
             ▼
Phase 6 Next.js / Axum API contract
             │
             ▼
Phase 0–5 core seam
```

最重要的分界不是“前端”和“后端”，而是：

```text
page 决定入口；
hook 决定 React 如何观察能力；
client 决定怎样说协议；
bridge 决定请求送去哪个运行面；
API 决定 transport contract；
core 决定业务语义。
```

<a id="anchor-philosophy"></a>
### 设计动机与设计哲学

Phase 7 要防四种腐烂：

| 风险 | 如果没有边界 |
|---|---|
| 页面即全部前端代码 | URL、请求、状态、渲染、协议全挤进一个文件 |
| hook 与 transport 混为一层 | 每个组件重复处理 loading/error/SSE/reconnect |
| Web/Tauri 各写一套请求 | 每个 endpoint 出现运行时分支和 base URL 拼接 |
| 删除 UI 时只看目录名 | 页面保留但 import 全断，骨架无法编译 |

对应的控制手段是：

```text
App Router boundary       → URL 与组件树接缝
Orchestration shell       → 页面级状态与行为集中
Domain hooks              → React 状态契约
Protocol clients          → JSON-RPC/SSE/REST 语义
Runtime-aware API bridge  → 双运行面路径统一
```

#### 五镜头验收

| 镜头 | 当前结构 | 想挡住什么 | 已确认边界 |
|---|---|---|---|
| **分** | page / shell / hook / client / component 分层 | 一个文件同时管 URL、协议和渲染 | 分层并不均匀，仍有胖页面与胖 hook |
| **稳** | URL、hook return shape、API envelope 是接缝 | UI 重写时能力入口消失 | 每个 hook 的 shape 不相同 |
| **向** | page → hook/client → API → core | Client Component 直接依赖 runtime/core | page.tsx 仅一处运行时 core import，但子树仍有例外 |
| **约** | i18n、loading/error、stream cleanup | UI 字符串与协议行为四散 | Kanban 有一套并行文案字典 |
| **权** | refresh throttle、reconnect、provider/session state | 实时事件风暴与会话失控 | 进程断开后靠客户端重连，不是 durable stream |

---

<a id="anchor-q1"></a>
## 问题 1：`page.tsx` 为什么是路由入口，不等于薄页面

> **本节验证的设计判断**：Next.js 规定 `page.tsx` 是 URL 入口，却不规定它必须薄。是否是“壳”，要看它有没有把交互编排委派出去，不能只看文件名。

### BUILD_ORDER 的原始印象不完全成立

BUILD_ORDER 写道页面层有 31 个 `page.tsx`，且“每文件 5–30 行”。当前快照实测：

```text
page.tsx 总数：29
≤ 30 行：18
> 30 行：11
```

代表性胖页面：

```text
src/app/ag-ui/page.tsx  891 行
src/app/page.tsx        597 行
src/app/a2a/page.tsx    544 行
```

因此不能把现状描述成“所有 page 都是 5–30 行薄壳”。准确说法是：

> **多数页面入口较薄，但一部分 page.tsx 本身就是大型 Client Component。**

### 两种合法形态

#### 形态 A：Server page 壳 + Client 编排壳

Kanban 使用：

```text
page.tsx（16 行）
  ├─ route identity
  ├─ static placeholder params
  └─ <KanbanPageClient />
           ↓
kanban-page-client.tsx（513 行）
  ├─ state
  ├─ fetch
  ├─ events
  └─ composition
```

收益：

- server-only 构建逻辑不会泄漏进客户端 bundle；
- URL 入口稳定；
- 客户端行为可以单独测试与重构；
- 静态桌面路由 placeholder 有明确落点。

#### 形态 B：`page.tsx` 自身就是 Client Component

首页是 597 行的大型客户端页面。它不是“错误文件名”，只是把 URL 入口与交互编排放在同一文件。

这种形态在页面简单时成立；一旦状态、弹窗、请求和产品分支增长，路由入口就很难保持可读。

### `page.tsx` 对 core 的真实耦合

当前 29 个 `page.tsx` 中，只有两个直接 import `@/core`：

1. `src/app/settings/fluency/page.tsx:7` 运行时 import `getCurrentRoutaRepoRoot`；
2. `src/app/traces/page.tsx:25` 使用 `import type { TraceRecord }`，编译后擦除。

因此页面入口层只有一处真实运行时 core 耦合。

但“page.tsx 只有一处”不能推导出“整个页面子树只依赖 API”。例如：

```text
kanban-page-client.tsx:27
  → runtime import resolveKanbanAutomationStep from @/core/kanban/...
```

这说明审计依赖方向时必须区分：

```text
page.tsx 文件层
vs
整个 app Client Component 子树
```

### Before / After

```text
❌ 只按文件名判断
page.tsx = 页面壳
*-client.tsx = 业务代码
```

```text
✅ 按职责判断
Route entry       → URL / server boundary / static params
Orchestration     → state / events / actions / composition
Rendering leaf    → props → UI
Protocol boundary → HTTP / SSE / JSON-RPC
```

### 这是什么模式

- **App Router Convention**：文件系统承载 URL；
- **Server/Client Boundary**：用 `"use client"` 明确运行位置；
- **Humble Entry Point**：路由入口尽量只决定装配；
- **Facade Component**：Client page 为下游 UI 提供页面级门面。

**一句话带走**：`page.tsx` 只保证“这个 URL 从这里进入”，是否薄壳要看行为是否已经交给稳定的客户端编排边界。

---

<a id="anchor-q2"></a>
## 问题 2：为什么长页面要拆成编排壳、领域 hook 与渲染叶子

> **本节验证的设计判断**：长行为页面不能只按视觉区域切组件。真正稳定的边界是“谁持有状态、谁执行领域动作、谁只负责渲染”。

### 只做 UI 切片会怎样腐烂

假设把 2000 行 Kanban 只拆成：

```text
Header.tsx
Sidebar.tsx
Main.tsx
Modal.tsx
```

视觉上变小了，但如果每个组件仍自己：

- fetch tasks；
- 监听 SSE；
- 维护 selected task；
- stage/commit Git；
- 切换 provider；
- 处理 loading/error；

那么行为仍然分散，只是藏进更多文件。

### 当前堵法：两层编排 + 领域 hook + 叶子组件

Kanban 当前有两层较大的编排对象：

```text
kanban-page-client.tsx  513 行
kanban-tab.tsx         2243 行
```

第一层关心整个 workspace 页面：

```text
boards / tasks / sessions / specialists
repo changes / repo sync
refreshKey
SSE invalidation
DesktopAppShell 装配
```

第二层关心 Kanban 交互现场：

```text
selected card
panel/modal state
agent input
Git operations
keyboard shortcuts
task run / fitness state
```

它们再把渲染下放给 tab panels、modals、card、detail 与 `components/` 叶子。

### Domain hooks 不是“hooks/ 目录里的文件”

Finder 最初报告 `kanban/hooks/` 只有两个 domain hook：

```text
hooks/use-git-operations.ts
hooks/use-keyboard-shortcuts.ts
```

独立复核找到两个反例：

```text
use-runtime-fitness-status.ts
use-task-runs.ts
```

它们位于 Kanban 目录顶层，同样是 domain hook。因此准确结论是：

```text
hooks/ 子目录：2 个 hook
Kanban 页面域合计：至少 4 个本地 domain hook
```

这个反例说明：

> **架构角色由行为决定，不由目录名决定。**

### 实时 invalidation 是独立 hook

`useKanbanEvents` 返回 `void`，它不是数据 hook，而是副作用接线器（`src/client/hooks/use-kanban-events.ts:14`）：

```typescript
/** 真实代码摘录 */
export function useKanbanEvents({
  workspaceId,
  onInvalidate,
}: UseKanbanEventsOptions): void {
  // connect EventSource and invoke callback
}
```

它连接（`use-kanban-events.ts:33-36`）：

```typescript
const es = new EventSource(
  resolveApiPath(
    `api/kanban/events?workspaceId=${encodeURIComponent(workspaceId)}`,
    base,
  ),
);
```

事件政策是：

```text
connected（非首次） → invalidate
kanban:changed       → 立即 invalidate
fitness:changed      → 最多 750ms 节流后 invalidate
error                → 3 秒后重连
```

页面无需理解 SSE payload 的每种业务字段。它只收到一个稳定信号：

```text
“本地缓存的页面事实可能过期，请重取。”
```

这是 **invalidation**，不是把 EventBus 事件一比一复制进 React state。

### Hook return shape 是局部契约，不是全局模板

八个 `src/client/hooks` 没有统一返回形状：

| Hook | 形状 |
|---|---|
| `useKanbanEvents` | `void`，纯副作用 |
| `useWorkspaces` | workspaces/loading + CRUD actions |
| `useNotes` | notes/loading/error/connected + CRUD actions |
| `useFileSearch` | query/results/loading/error + search |
| `useAgentsRpc` | agents/loading/error + RPC actions |
| `useSkills` | 多类 skill state + 12 actions |
| `useAcp` | 9 个 state 字段 + 18 个 actions |
| `useHarnessSettingsData` | 11 个 QueryState + 2 个 reload actions |

Finder 原报告把 `useAcp` actions 说成 15 个；独立复核确认是 18 个。数字偏差不改变核心事实，却足以推翻“统一 stub 模板”。

### `useAcp` 为什么是胖 hook

`BrowserAcpClient` 管底层协议：

```text
JSON-RPC request id
action method encoding
HTTP response
ReadableStream SSE parsing
EventSource attach/reconnect
session/update dispatch
```

`useAcp` 则在其上管理 React 与产品状态：

```text
provider discovery / merge / availability
selected provider localStorage
connected/loading/error/auth/docker state
session create/resume/fork/select
prompt/cancel/user-input
terminal write/resize
teardown cleanup
```

这条边界可以概括为：

```text
Client = 怎样与协议端点说话
Hook   = 页面怎样观察并操纵这段会话
```

并不是所有 endpoint 都值得再包一层 client。简单 workspace/notes/harness hook 直接使用 `desktopAwareFetch`，而 ACP/RPC/Skill 因协议或复用复杂度拥有专用 client。

### Before / After

```text
❌ 组件自己处理全部行为
Card → fetch + SSE + Git + provider + modal + render
```

```text
✅ 按变化原因分层
Page shell
  → domain hooks / protocol clients
  → stable state + actions
  → rendering components
```

### 这是什么模式

- **Orchestration Shell + Domain Hooks**：编排与领域动作分开；
- **Container / Presentational Split**：状态容器与渲染叶子分开；
- **Invalidation over Event Mirroring**：事件只触发重取权威事实；
- **Adapter Hook**：把 imperative client 转成 declarative React contract。

**一句话带走**：前端拆分的目标不是让每个文件更短，而是让状态所有权、领域动作和渲染职责各自只有一个清楚落点。

---

<a id="anchor-q3"></a>
## 问题 3：Web 与 Tauri 怎样共享同一套 API 调用代码

> **本节验证的设计判断**：双运行面不应该污染每一个 hook。运行时差异应集中在“路径规范化”和“后端地址选择”两道桥上。

### 两种运行环境的路径不同

Web 开发或部署时：

```text
浏览器 origin
  + /api/tasks
```

Tauri 静态资源模式时，页面可能从 `tauri://` 加载，API 却由本地 Rust server 提供：

```text
tauri://localhost 页面
  → http://127.0.0.1:3210/api/tasks
```

如果每个 hook 自己判断：

```typescript
// ❌ 假设反例
const url = isTauri
  ? `http://127.0.0.1:3210/api/tasks`
  : `/api/tasks`;
```

那么运行面数量会乘以 endpoint 数量：

```text
m 个运行面 × n 个调用点
```

### 第一道桥：`resolveApiPath`

`src/client/config/backend.ts:67-79` 的规则是：

```text
1. 输入已是 http:// 或 https:// → 原样返回；
2. 否则确保路径以 / 开头；
3. 不以 /api/ 开头且不等于 /api → 自动补 /api；
4. explicitBaseUrl 优先，否则读取 configured backend；
5. 没有 base URL → 返回相对 /api/...；
6. 有 base URL → 返回 origin + /api/...。
```

真实代码（`backend.ts:67-79`）：

```typescript
/** 真实代码摘录 */
export function resolveApiPath(path: string, explicitBaseUrl?: string): string {
  const value = path.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  const normalizedPath = value.startsWith("/") ? value : `/${value}`;
  const apiPath = normalizedPath.startsWith(`${API_PREFIX}/`)
    || normalizedPath === API_PREFIX
    ? normalizedPath
    : `${API_PREFIX}${normalizedPath}`;
  const baseUrl = normalizeBaseUrl(explicitBaseUrl)
    || getConfiguredBackendBaseUrl();
  if (!baseUrl) return apiPath;
  return `${baseUrl}${apiPath}`;
}
```

### 配置后端的优先级

`getConfiguredBackendBaseUrl()` 的顺序是：

```text
URL query ?backend=
  ↓ 命中后写回 localStorage
localStorage: routa.backendBaseUrl
  ↓
NEXT_PUBLIC_ROUTA_BACKEND_BASE_URL
```

配置值还会经过 `normalizeBaseUrl()`：

```text
只接受 http: / https:
只保留 parsed.origin
去掉 path、query 与尾部差异
```

这让所有调用方拿到的是 origin，而不是任意路径片段。

### 第二道桥：`desktopAwareFetch`

Tauri 检测不是只看一个全局变量。持久化 marker 位于 `diagnostics.ts:24-38`，聚合运行时判断位于 `diagnostics.ts:40-54`，两者共同支持：

```text
window.__TAURI__
window.__TAURI_INTERNALS__
query runtime=tauri 写入的 localStorage marker
```

静态桌面模式还要求：

```text
isTauriRuntime() && !isHttpLikeRuntime()
```

`getDesktopApiBaseUrl()` 的政策（`diagnostics.ts:129-136`）：

```text
非 Tauri                    → ""
Tauri + configured backend  → configured origin
Tauri + HTTP/HTTPS runtime   → ""
Tauri static                 → http://127.0.0.1:3210
```

最终 `desktopAwareFetch` 只有一层薄包装（`diagnostics.ts:145-151`）：

```typescript
/** 真实代码摘录 */
export function desktopAwareFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  const base = getDesktopApiBaseUrl();
  return fetch(resolveApiPath(path, base), options);
}
```

### 为什么需要两道桥，而不是一个函数

`resolveApiPath` 是纯 URL 政策：

```text
path normalization + configured origin
```

`desktopAwareFetch` 是运行时 transport convenience：

```text
识别 Tauri backend + 调 fetch
```

EventSource 不能使用 `desktopAwareFetch`，但仍可复用前者：

```typescript
new EventSource(resolveApiPath(eventPath, getDesktopApiBaseUrl()));
```

因此两层分开后：

```text
fetch 使用两层
EventSource 复用 URL 层
JSON-RPC client 复用 URL 层
```

### 已确认的约束执行情况

在 `src/app` 与 `src/client` 的前端调用范围内，独立扫描没有发现裸写：

```text
fetch("/api/...")
fetch('/api/...')
fetch(`/api/...`)
```

唯一类似模式位于服务端 `src/app/api/a2ui/dashboard/route.ts:29-35`，它使用 `req.nextUrl.origin` 从一个 route 调另一些 API route，不属于浏览器/桌面前端绕过。

### Before / After

```text
❌ 运行时分支散落
useNotes → if Tauri
useTasks → if Tauri
AcpClient → if Tauri
EventSource → if Tauri
```

```text
✅ 差异集中
path → resolveApiPath
fetch → desktopAwareFetch
stream URL → resolveApiPath(path, getDesktopApiBaseUrl())
```

### 这是什么模式

- **Gateway / Facade**：所有 API URL 从同一入口规范化；
- **Environment Adapter**：Tauri 静态资源模式被封装；
- **Policy + Mechanism Split**：URL 政策与 fetch 机制分开；
- **Functional Core, Imperative Shell（局部）**：路径变换集中为可测试函数。

**一句话带走**：双后端前端不应到处知道“3210”；它只应该知道逻辑 API 路径，由 bridge 决定这次请求落到当前 origin 还是本地 Rust server。

---

<a id="anchor-q4"></a>
## 问题 4：普通 CRUD、SSE、ACP 与 RPC 为什么不能共用一个 client 模板

> **本节验证的设计判断**：前端通信不能被简化成“都是 fetch”。不同协议拥有不同生命周期、错误形状和清理义务，stub 时必须保留这些差异。

### 普通 HTTP hook：一次请求，一次状态更新

`useWorkspaces`、`useFileSearch`、`useHarnessSettingsData` 等主要使用：

```text
mount/manual action
  → desktopAwareFetch
  → response.ok / json
  → data/loading/error
```

它们没有长期连接，也不需要维护 request id 或 session cursor。

### Notes/Kanban：HTTP 事实 + SSE 失效通知

这类 hook 把两条通道分工：

```text
HTTP → 查询/修改权威事实
SSE  → 通知事实可能已变化
```

SSE 断开后需要：

```text
close old EventSource
visibility/teardown 判断
重连 timer
cleanup timer
```

这不是“请求失败后再点一次按钮”的普通 fetch 语义。

### ACP client：JSON-RPC + 两种 SSE

`BrowserAcpClient` 使用双通道：

```text
POST /api/acp
  → JSON-RPC request/response
  → prompt response 可能本身是 text/event-stream ReadableStream

GET /api/acp?sessionId=...
  → EventSource
  → 持续 session/update notification
```

`newSession()` 成功后会 `attachSession()` 建立 session SSE。`prompt()` 则检查响应 `Content-Type`：

```text
text/event-stream → ReadableStream parser
其他              → 普通 JSON-RPC response
```

这意味着 ACP stub 不能只写：

```typescript
// ❌ 假设反例
async prompt() {
  return {};
}
```

否则 hook 仍可能认为：

- session 已连接；
- prompt 已被接受；
- update 将从 stream 到达；
- cancel/terminal 可继续调用。

骨架必须明确选择：

```text
A. 保留最小可运行 session/stream contract；
B. 明确返回结构化 unsupported error，并让 hook 落入可诊断状态。
```

### RPC client：同一 JSON-RPC，两个 transport

`RoutaRpcClient` 封装 JSON-RPC 2.0，但 transport 由运行时选择：

```text
Tauri runtime
  → __TAURI_INTERNALS__.invoke("rpc_call")
  → fallback __TAURI__.core.invoke("rpc_call")

Web runtime
  → POST /api/rpc
```

它导出单例：

```typescript
export const rpc = new RoutaRpcClient();
```

`useAgentsRpc` 只关心：

```text
rpc.call("agents.list", params)
rpc.call("agents.create", params)
...
```

因此 hook 不需要知道当前 transport 是 IPC 还是 HTTP。

### Skill client：注释与实现不应混为一谈

`skill-client.ts` 文件头声称可通过 ACP 与 REST 工作，但当前实现只发现 REST 调用：

```text
GET  /api/skills
GET  /api/skills/catalog
POST /api/skills/clone
...
```

全文没有 `rpc.call`、JSON-RPC envelope 或 ACP client 调用。准确描述应是：

> 当前 `SkillClient` 是带本地缓存的 REST client；“ACP”只存在于注释声明，不是已验证执行路径。

### Client 与 hook 的边界不是“一切都必须有 client 类”

当前分布是：

| 域 | Hook 是否直接请求 | 专用 client |
|---|---:|---|
| workspace | 是 | 无 |
| notes | 是，另建 EventSource | 无 |
| harness settings | 是 | 无 |
| ACP | 否 | `BrowserAcpClient` |
| agents RPC | 否 | `RoutaRpcClient` |
| skills | 否 | `SkillClient` |

这不是必然的架构违规。专用 client 的提取信号应是：

```text
□ 协议编码/解码复杂；
□ 多个 hook/页面复用；
□ 存在长期 session；
□ 存在 transport 切换；
□ 需要缓存、重连、request id 或 cursor。
```

简单 CRUD 若只有一个稳定消费方，hook 直接调用统一 bridge 更少层。

### Before / After

```text
❌ 全部统一成 fetchJson<T>()
HTTP CRUD / SSE / JSON-RPC / IPC 都假装同一生命周期
```

```text
✅ 共享 URL bridge，保留协议差异
REST        → desktopAwareFetch
SSE         → EventSource + resolveApiPath
ACP         → BrowserAcpClient
Tauri/Web RPC → RoutaRpcClient
```

### 这是什么模式

- **Protocol Adapter**：ACP/RPC client 隔离协议细节；
- **Transport Strategy**：RPC 在 IPC 与 HTTP 间选择；
- **Long-lived Connection Manager**：SSE attach/reconnect/cleanup；
- **Declarative Hook Facade**：React 消费稳定 state/actions，而非原始 transport。

**一句话带走**：可以统一的是 URL 与运行时选择，不能抹平的是一次 HTTP、持续 SSE、JSON-RPC session 与 Tauri IPC 各自不同的生命周期契约。

---

<a id="anchor-q5"></a>
## 问题 5：Koda 为什么不能一边原样保留页面、一边删除全部组件

> **本节验证的设计判断**：骨架裁剪必须沿依赖图切，不是按目录批量删。页面是否能保留，取决于其 import 的组件、hook 和类型是否也有替代物。

### BUILD_ORDER 当前存在一组互相冲突的要求

它同时写道：

```text
页面层：31 个 page.tsx 全保留
components/**：全部删除
hooks/*.ts：全部 stub
```

当前事实是：

```text
page.tsx 实际 29 个
src/client/components 生产 .tsx 约 104 个
多个设置页与页面客户端直接 import 这些组件
```

例如设置页面会 import：

```text
SettingsRouteShell
SettingsPageHeader
WorkflowPanel
```

如果删除组件而不改页面：

```text
TypeScript module resolution 失败
→ 页面无法编译
→ “保留路由壳”没有成立
```

因此真正可行的二选一是：

```text
方案 A：保留页面 + 保留其最小组件闭包
方案 B：删除具体组件 + 把 page.tsx 改写成新的最小空壳
```

不能声称“原样保留页面”同时“删除全部组件”。

### Hook 也依赖组件目录

独立扫描确认两处 hook → component 依赖：

```text
use-acp.ts
  → 运行时 import loadDockerOpencodeAuthJson
    from ../components/settings-panel

use-harness-settings-data.ts
  → import type PlanResponse, TierValue
    from @/client/components/harness-execution-plan-flow
```

如果直接删除 components：

- 第一处立即造成运行时/编译依赖断裂；
- 第二处虽然编译后擦除，TypeScript 仍需解析类型源文件。

正确裁剪应先把稳定的非 UI 能力移到非组件模块：

```text
loadDockerOpencodeAuthJson
  → config/provider utility

PlanResponse / TierValue
  → client/types 或 protocol contract
```

这不是为了“架构漂亮”，而是让删除边界真实可执行。

### Utils 也不是绝对零组件依赖

`src/client/utils` 有 14 个非测试 `.ts` 文件。只有 `diagnostics.ts` 调用 fetch，且没有 React hook；但存在两处 type-only component import：

```text
repo-selection-storage.ts
  → RepoSelection from components/repo-picker

onboarding.ts
  → provider setting types from components/settings-panel-shared
```

type-only import 不产生运行时耦合，却仍表示类型所有权放错层：

```text
稳定 storage/config 类型
  不应由可删除 UI 组件拥有
```

所以“utils 原样保留、components 全删”同样需要先搬类型。

### i18n 也有两套边界

全局 i18n 是自研 React Context：

```text
I18nContextValue
  ├─ locale
  ├─ setLocale
  └─ t: TranslationDictionary
```

`useTranslation()` 只是读取 Context；`t` 不是 `t("key")` 函数，而是嵌套字典对象：

```typescript
// 当前调用形态
const { t } = useTranslation();
t.common.save;
```

Kanban 目录另有独立：

```text
i18n/kanban-session-copy.ts
  ├─ en 字典
  ├─ zh-CN 字典
  └─ getKanbanSessionCopy(language)
```

它没有接入全局 `I18nContext`。因此骨架若保留 Kanban session 文案，要选择：

```text
复刻并行 domain copy
或
统一迁入全局 dictionary
```

不能假设删除 UI 后 i18n 会自动消失；错误、空状态和 unsupported 提示仍是 UI-facing strings。

### 页面空壳仍需要行为契约

“空壳”不是：

```typescript
// ❌ 假设反例
export default function Page() {
  return null;
}
```

它至少应保留：

```text
route 可访问
workspace/session path params 可读取
loading / empty / unsupported / error 状态可区分
i18n 字符串来源明确
API 请求经过 bridge
SSE/ACP unsupported 不伪装成空成功
```

### Before / After

```text
❌ 按目录裁剪
保留 app/page.tsx
删除 client/components
stub 所有 hooks 为同一种空对象
```

```text
✅ 按依赖闭包裁剪
选择最小页面行为
  → 定义页面需要的 hook shape
  → 保留/重写最小组件
  → 移出组件拥有的稳定类型与工具
  → 再删除其余 UI
```

### 这是什么模式

- **Dependency Closure**：保留节点必须连同必要依赖一起保留；
- **Stable Dependency Principle**：稳定类型不由易删 UI 拥有；
- **Strangler Skeleton**：以最小可运行页面替代完整 UI，而非留下断裂 import；
- **Contract Stub**：stub 保留调用方可见 shape 与失败语义。

**一句话带走**：前端骨架不是“留下 page 文件、删掉 component 文件”，而是沿着每个页面的最小可运行依赖闭包重新切一条编译和行为都成立的边界。

---

<a id="anchor-patterns"></a>
## 五个可迁移模式

### 模式 1：路由入口与客户端编排分离

#### 是什么

```text
page.tsx
  → route/server/static concerns
*-page-client.tsx
  → state/events/actions/composition
```

#### 适用信号

```text
□ 页面需要 generateStaticParams 或 server metadata；
□ 交互树必须使用 hooks；
□ 页面在 Web 与静态桌面构建都存在；
□ 路由入口希望保持稳定。
```

#### 别过度

只有少量静态内容、没有客户端状态时，不必机械增加 `*-page-client.tsx`。

---

### 模式 2：编排壳 + Domain Hooks + 渲染叶子

#### 是什么

```text
Shell       → 持有页面级 state 与组合顺序
Domain Hook → 封装一种变化原因与 actions
Leaf        → props 驱动渲染
```

#### 检查清单

```text
□ 谁拥有 selected/loading/error？
□ 谁负责 fetch、SSE 与 cleanup？
□ 谁负责业务动作？
□ 谁只需要 props？
□ 同一状态是否被多个组件重复维护？
```

#### 别过度

一个 action 只用一次、逻辑不到几行时，不必为“hook 化”再造抽象。

---

### 模式 3：路径政策与 transport 机制分离

#### 是什么

```text
resolveApiPath
  → 路径 + base URL

desktopAwareFetch
  → 当前运行时 + fetch
```

#### 收益

- EventSource 也能复用路径政策；
- Tauri 默认端口只在一处；
- configured backend 有单一优先级；
- 调用方不出现环境分支。

#### 别过度

若产品只有一个同源 Web 后端，直接相对 URL 可能足够。

---

### 模式 4：用 invalidation 连接实时事件与权威查询

#### 是什么

```text
SSE event
  → mark stale / invalidate
  → HTTP refetch
  → authoritative state
```

而不是：

```text
每种后端 event
  → 在浏览器复制完整领域状态机
```

#### 适用信号

```text
□ 事件只说明“某域变化”；
□ HTTP endpoint 能返回当前权威快照；
□ 事件可能合并、丢失或重复；
□ 页面不需要逐事件审计历史。
```

#### 别过度

高频协同编辑若每次都全量重取，应改用 patch/CRDT/增量 stream。

---

### 模式 5：按协议生命周期设计 stub

#### 是什么

```text
REST list stub  → 稳定 empty envelope
REST get stub   → 真实 404/unsupported
SSE stub        → 明确拒绝或保留 attach/cleanup
JSON-RPC stub   → 保留 id/error envelope
Hook stub       → 保留每个 hook 自己的 return shape
```

#### 核心原则

```text
空数据 ≠ 未实现
未实现 ≠ 连接成功
连接成功 ≠ 流会产生事件
```

#### 别过度

骨架不需要模拟完整 provider，只需诚实表达能力边界。

---

<a id="anchor-gaps"></a>
## 尚未证实与需要裁决的边界

### 1. 页面保留策略尚未选择

当前 BUILD_ORDER 同时要求原样保留页面和删除全部组件，已确认不可同时成立。Koda 施工前必须裁决：

```text
A. 教学优先：重写 29 个最小页面壳，删除具体 UI；
B. 体验优先：保留最小组件闭包，让核心页面仍可交互；
C. 只保留 3–5 个代表页面，其余明确 404/unsupported。
```

本文建议 A，但这是目标建议，不是已由用户裁决的产品决策。

### 2. Kanban 的最小空壳到底保留多少

需要明确：

```text
□ 只显示空列？
□ 是否保留创建卡片入口？
□ 是否保留 SSE invalidation？
□ 是否保留 ACP provider/session 面板？
□ unsupported automation 显示什么？
```

“空看板无崩溃”不足以决定这些契约。

### 3. 并行 i18n 字典是否复刻

全局 `TranslationDictionary` 与 Kanban session copy 当前并存。骨架可：

```text
复刻现状
或
统一文案入口
```

统一会改变设计，不应在“机械裁剪”中顺手完成。

### 4. Client Component 对 core 的剩余运行时 import

`page.tsx` 层几乎不依赖 core，但 Kanban、session、team 等 Client Component 子树仍有运行时 core import。Phase 7 骨架应逐项决定：

```text
纯函数是否迁入 client？
类型是否改为 import type？
业务能力是否必须经 API？
```

本轮没有全量验证每一处 import 的可迁移归属，因此不能宣称 client/core 已完全解耦。

### 5. 全部 29 个页面的空态与错误态契约

本轮按架构代表切片调查，没有逐页验证：

```text
loading
empty
400/404/409
501 unsupported
network failure
SSE disconnected
```

施工规约仍需按页面族生成 acceptance matrix。

`inconclusive` 不等于“没有问题”，也不等于“已证实有问题”。它只表示当前证据不足以决定施工契约。

---

<a id="anchor-build"></a>
## Koda Phase 7 施工边界

BUILD_ORDER 的 Phase 7 应从“按目录处理”改为“按最小垂直页面切片处理”。

### A. 全局壳：保留最小完整体

```text
src/app/layout.tsx
src/app/globals.css（若最小页面需要）
src/i18n/context.tsx
src/i18n/use-translation.ts
必要 locale 字典
ThemeInitializer 的最小替代或保留
```

验收：

```text
□ RootLayout 可渲染 children；
□ locale/context 不抛错；
□ UI-facing strings 不硬编码；
□ 删除组件后全局壳 import 仍闭合。
```

### B. API bridge：原样保留行为，增加契约测试

```text
src/client/config/backend.ts
src/client/utils/diagnostics.ts
```

关键测试：

```text
□ tasks → /api/tasks；
□ /api/tasks 保持不重复前缀；
□ 完整 https:// URL 原样返回；
□ explicit base 优先；
□ query backend > storage > env；
□ Tauri static → 127.0.0.1:3210；
□ Tauri HTTP runtime → relative origin；
□ EventSource URL 与 fetch URL 使用同一规则。
```

### C. 页面：改写为最小路由壳，不声称原样复制

建议保留代表页面：

```text
/
/workspace/[workspaceId]
/workspace/[workspaceId]/kanban
/workspace/[workspaceId]/sessions
/workspace/[workspaceId]/sessions/[sessionId]
/settings
/settings/agents
/settings/mcp
/traces
/messages
```

其他页面可保留同类最小壳，但每个都必须：

```text
□ 无悬空 component import；
□ 能读取必要 path/query params；
□ 只通过 API/client 获取能力；
□ 显示明确 empty/unsupported/error 状态；
□ 静态桌面 placeholder route 可构建。
```

### D. Hooks：逐个保留签名，不统一返回空对象

示意：

```typescript
/** 目标建议：仅说明逐 hook 保形，不是完整实现 */

useKanbanEvents(...) => void

useWorkspaces() => {
  workspaces: [],
  loading: false,
  fetchWorkspaces: async () => {},
  createWorkspace: async () => null,
  archiveWorkspace: async () => {},
}

useAcp() => {
  connected: false,
  sessionId: null,
  updates: [],
  providers: [],
  selectedProvider: null,
  loading: false,
  error: "ACP is unavailable in this skeleton",
  // 其余 actions 仍按原接口存在，并明确拒绝或 no-op
}
```

注意：

```text
查询型 action 可以安全返回空；
创建/发送/取消等命令不能伪造成功；
stream hook 必须 cleanup；
unsupported 要可诊断。
```

### E. Protocol clients：按协议裁剪

```text
BrowserAcpClient
  → 保留 public interface、JSON-RPC error shape、disconnect cleanup
  → 若不实现 runtime，所有 command 明确 unsupported

RoutaRpcClient
  → 保留 Tauri IPC / HTTP transport selection
  → 方法错误保留 RpcError code/data

SkillClient
  → 保留 REST path + cache contract
  → 删除未实现 ACP 的误导性承诺，或真正实现后再声明
```

### F. Components：删除前先拆出稳定依赖

前置迁移：

```text
provider auth/config utility
  从 settings-panel 移出

PlanResponse / TierValue
  从 harness component 移到 client/types

RepoSelection
  从 repo-picker 移到 client/types

onboarding provider setting types
  从 settings-panel-shared 移到 client/types
```

随后：

```text
保留每个最小页面所需的少量壳组件
删除完整产品 UI 组件
```

不能先删目录再用大量临时类型断言补洞。

### G. Phase 7 验收矩阵

```text
编译
□ npx tsc --noEmit 通过；
□ 无 unresolved @/client/components import；
□ Client Component 不 import server-only core runtime。

路由
□ 首页可访问；
□ workspace/kanban/session/settings 代表路由可访问；
□ 静态 placeholder 构建成功；
□ 未支持页面明确 404 或 unsupported，不空白。

数据
□ 所有 HTTP 调用经 desktopAwareFetch/resolveApiPath；
□ list empty envelope 正确渲染空态；
□ 400/404/409/501 不被吞成空成功；
□ request abort/teardown 不留下状态更新。

实时/协议
□ Kanban SSE URL 走 runtime bridge；
□ EventSource unmount 时关闭；
□ reconnect timer unmount 时清理；
□ ACP unsupported 不显示 connected；
□ RPC IPC/HTTP 选择仍成立。

i18n
□ UI-facing strings 来自选定字典系统；
□ 空态、错误态、unsupported 同样走 i18n；
□ 不在组件里新增硬编码中英文。
```

### 禁止事项

```text
❌ 直接删除 components/ 后保留悬空页面 import；
❌ 所有 hook 共用 `{ data: [], loading: false }`；
❌ 501 当作 empty success；
❌ EventSource 用普通 fetch.json() 替代；
❌ ACP stub 返回假 sessionId 或假 connected；
❌ 在每个 hook 重复 Tauri base URL 判断；
❌ 把稳定协议类型留在将删除的 UI 组件中；
❌ 为了编译通过使用大面积 `as any`。
```

---

<a id="anchor-handoff"></a>
## Phase 7 如何完成全链路闭环

Phase 7 是最后一层，不再向 Phase 8 交棒。它要把前七层串成一个最小可观察闭环：

```text
用户打开 /workspace/ws-1/kanban
  ↓
page.tsx 建立 route/server boundary
  ↓
Client shell 调用 hook
  ↓
resolveApiPath + desktopAwareFetch
  ↓
Phase 6 stable API
  ↓
Phase 1 Store / Phase 5 capability
  ↓
empty data 或真实最小结果
  ↓
Hook 映射为 loading/empty/error
  ↓
页面渲染可理解状态
```

若保留实时链路：

```text
Phase 0/5 event
  ↓
Phase 6 SSE route
  ↓
useKanbanEvents
  ↓
invalidate
  ↓
HTTP refetch authoritative state
  ↓
页面更新
```

若 ACP 未实现：

```text
用户尝试启动 session
  ↓
BrowserAcpClient / hook command
  ↓
Phase 6 JSON-RPC unsupported error
  ↓
useAcp.error
  ↓
页面显示“当前骨架不支持 ACP runtime”
```

而不是：

```text
返回空对象
  ↓
UI 误显示 connected
  ↓
永远等不到 session/update
```

### Phase 7 完成的判据

不是“页面文件都在”，而是：

```text
入口存在
+ 依赖闭合
+ transport 诚实
+ state 可解释
+ 双运行面路径一致
+ 未支持能力明确拒绝
```

至此，Koda 的七阶段依赖拓扑闭环：

```text
领域词汇
  → 可替换事实端口
  → 运行生命周期
  → provider 防腐层
  → workflow 编译
  → 协调与 agent capability
  → 稳定 transport contract
  → 可观察产品入口
```

---

<a id="anchor-notes"></a>
## 学习笔记

### 1. `page.tsx` 是 URL contract，不是薄壳保证

```text
文件名由框架规定
职责厚度由设计决定
```

审计时要看是否存在 `"use client"`、是否持有状态、是否 delegate，而不是只数 page 文件。

### 2. 目录名不是架构角色

```text
hooks/ 里的是 hook
≠
只有 hooks/ 里的才是 domain hook
```

Kanban 顶层两个 `use-*.ts` 就推翻了按目录统计角色的结论。

### 3. Hook 的 interface 是页面与能力之间的 port

后端有 Store port，前端也有 hook contract：

```text
data + loading + error + actions
```

但它们按域不同，不应强行统一。

### 4. 实时 UI 优先 invalidation，而不是复制后端状态机

```text
事件通知变化
HTTP 返回权威快照
```

这牺牲一点额外请求，换来前端状态更少、事件丢失后更易恢复。

### 5. Bridge 统一运行时，不统一所有协议

```text
URL/base policy 可以共享
SSE/JSON-RPC/IPC lifecycle 不能抹平
```

### 6. `import type` 仍然是裁剪依赖

它不会进入运行时 bundle，但删除源文件时 TypeScript 仍需解析模块。类型所有权也是依赖设计。

### 7. “空”与“未实现”必须分开

```text
[]  = 查询成功，当前没有对象
501 = 能力未实现
error envelope = 协议拒绝
```

页面若把三者画成同一个空状态，就破坏了 Phase 6 的 contract。

### 8. 胖 hook 不一定错误

`useAcp` 胖，是因为它围绕一个稳定身份——ACP session/provider lifecycle——集中状态。真正要检查的是：

```text
底层协议是否仍在 client？
状态是否围绕同一生命周期？
调用方是否因此变简单？
测试边界是否可建立？
```

### 9. 删除 UI 应先迁移稳定类型和纯能力

```text
先拆 dependency ownership
再删叶子
```

否则“UI 删除”会把 config、storage 与 protocol type 一起误删。

### 10. 五镜头自测

```text
分：route、shell、hook、client、leaf 各负责什么？
稳：页面重写后哪些 URL、hook shape、protocol contract 必须不变？
向：Client Component 是否绕过 API 直接依赖 core runtime？
约：i18n、空态、错误态、stream cleanup 是否可验证？
权：重连、节流、session 与 transport fallback 的保证到哪里？
```

---

<a id="anchor-audit"></a>
## 证据审计附录

### 快照

```text
revision:
34eb1ed58d48fd121c87c5915a8ff09035f1b3a4

dirty-state fingerprint（调查时相关路径）：
469cfdc9c6fbf21261aae9d65d9a361f7b5f619b76cf4562bdfc364f49ba0bed
```

调查期间工作区已有未提交的 Phase 4–6 文档；Finder 全部只读，没有修改共享状态。一个补充 Verifier 在隔离 worktree 中执行，发现 worktree HEAD 与目标 revision 不同，但验证目标文件在两 revision 间无差异，因此该候选证据未受影响；此偏差已记录而未静默忽略。

### Finder lanes

| Lane | 镜头 | 候选数 | 结果 |
|---|---|---:|---|
| `lane-app-shell` | page 拓扑与 server/client 分界 | 4 | 4 confirmed |
| `lane-bridge` | Web/Tauri 通信桥 | 4 | 4 confirmed |
| `lane-hooks` | hooks 职责与 return shape | 4 | 3 confirmed / 1 refuted |
| `lane-clients` | ACP/RPC/Skill client | 4 | 4 confirmed |
| `lane-kanban-orch` | 编排壳与 domain hooks | 4 | 3 confirmed / 1 refuted |
| `lane-policy` | i18n 与删除边界 | 4 | 3 confirmed / 1 refuted |

### 总账

```json
{
  "claim_confirmed": 21,
  "claim_refuted": 3,
  "inconclusive": 0,
  "candidate_invalid": 0,
  "coverage_gaps": 5,
  "failures": 0,
  "cancelled_agents": 0,
  "truncations": 1
}
```

唯一 Finder truncation 发生在 `kanban-page-client.tsx` 的初次输出；其关键行随后由独立 Verifier 重新读取确认，没有用截断内容直接下结论。

### 三条被反驳的候选

#### 1. Hook return shape 数字不准确

候选声称 `useAcp` 有 15 个 actions；独立复核确认是 18 个。修正后的结论：

```text
hook 没有统一 return shape；stub 必须逐个保形。
```

#### 2. Kanban 只有两个 domain hook

候选只统计 `kanban/hooks/`，遗漏目录顶层：

```text
use-runtime-fitness-status.ts
use-task-runs.ts
```

修正后的结论：

```text
子目录有 2 个，页面域至少有 4 个本地 domain hook。
```

#### 3. 删除 components 后页面仍可原样保留

候选低估了页面、hook、utils 对组件模块的 import。修正后的结论：

```text
必须先重写页面或保留最小组件闭包，并迁移稳定类型/工具，才能删除其余 UI。
```

### 覆盖缺口

1. 未逐页验证 29 个页面的 loading/empty/error/unsupported 行为；
2. 未全量裁决所有 Client Component → `@/core` import 的迁移归属；
3. 未验证后端 SSE replay、Last-Event-ID 与跨重启保证；
4. 未运行 Koda 骨架编译，因为本任务只生成 Routa 解剖文档；
5. 未对 UI 做浏览器视觉 walkthrough，因为本文分析架构，不修改或验收 UI。

### 未检查范围

```text
src/client/a2ui/**
src/client/canvas-runtime/**
src/client/canvas-sdk/**
src/client/office-document-viewer/**
全部 104 个生产组件的逐文件行为
全部 page client 的逐入口 contract matrix
```

这些范围没有被缺省解释为安全或无需迁移。

---

<a id="anchor-takeaway"></a>
## 一句话带走

> **Phase 7 的核心不是“保留页面、删掉组件”，而是建立最后一道产品边界：`page.tsx` 稳住 URL 与运行位置，编排壳和 domain hooks 把 API/事件变成可解释的 React 状态，protocol client 保留 REST、SSE、JSON-RPC 与 IPC 各自的生命周期，`resolveApiPath + desktopAwareFetch` 则让同一套前端在 Web 与 Tauri 上落到正确后端；Koda 只有沿这条最小依赖闭包裁剪，页面空壳才会既能编译，也不伪造能力。**
