---
title: "Next.js 任务 API 因繁重的任务列表序列化产生队头阻塞"
date: "2026-04-09"
status: resolved
severity: high
area: "kanban"
tags: [api, kanban, performance, nextjs, fitness-candidate]
github_issue: 406
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/406"
resolved_at: "2026-04-12"
related_issues:
  - "docs/issues/2026-04-07-task-changes-api-performance.md"
  - "docs/issues/2026-03-19-kanban-initial-refresh-storm.md"
  - "docs/issues/2026-04-09-rust-tasks-api-performance-analysis.md"
fitness_tracking:
  dimension: "performance"
  rulebook: "docs/fitness/runtime/performance.md"
  proposed_metric: "task_api_latency_probe"
---

# Next.js 任务 API 因繁重的任务列表序列化产生队头阻塞

## 发生了什么

在本地 Next.js 开发服务器上做 dogfood 时，发现 `GET /api/tasks/{taskId}/changes` 耗时长达数十秒。

用户可见的慢请求是：

```text
http://localhost:3000/api/tasks/0e6a0433-543d-454b-b136-67bde25f37cc/changes
```

最初怀疑是 ACP Provider 阻塞，但路由检查和计时表明这是一个更广泛的 Next.js API 排队问题。

## 测量数据

2026-04-09 的本地测量：

| 请求 | 后端 | 观测耗时 |
|---|---:|---:|
| `GET /api/tasks/{id}/changes` | Next.js `localhost:3000` | 基本隔离时为 `1.55s` 到 `2.71s` |
| `GET /api/tasks/{id}/changes` | Next.js `localhost:3000` | 与任务列表刷新一同发出时为 `15.91s` |
| `GET /api/tasks?workspaceId=default` | Next.js `localhost:3000` | `14.32s` 到 `15.42s` |
| `GET /api/tasks/{id}` | Next.js `localhost:3000` | 冷启动或排队时为 `14.76s`；预热后为 `0.59s` |
| `GET /api/tasks/{id}/changes` | Rust/Axum `127.0.0.1:3210` | 预热后为 `0.12s` |
| `GET /api/tasks?workspaceId=default` | Rust/Axum `127.0.0.1:3210` | `0.067s` |
| 在任务工作树中执行 `git status --porcelain -uall` | 本地 git | `0.03s` |

Next.js 任务列表响应约为 `840KB`。采样的工作区有 21 个带 `deliveryReadiness` 的序列化任务和 12 个任务工作树。

## 当前诊断

`/api/tasks/{taskId}/changes` 并未直接调用 ACP。

该路由直接的工作是：

1. 读取任务
2. 读取工作树
3. 读取代码库
4. 运行本地 git 摘要
5. 调用 `buildTaskDeliveryReadiness(task, system)`，它会再次解析工作树/代码库并运行 delivery git status
6. 可选地列出自基线以来已提交的变更

对于采样的任务，本地 git 命令仅为数十毫秒，因此工作树本身并不是主要瓶颈。

更大的阻塞来自 Next.js 运行时中的 `GET /api/tasks?workspaceId=default`：

1. `src/app/api/tasks/route.ts` 列出工作区任务。
2. 它使用 `serializeTask(task, system)` 序列化每个任务。
3. 每次序列化都会构建证据摘要、story readiness、INVEST 校验和 delivery readiness。
4. 这些摘要会对每个任务执行 artifact/board/工作树/代码库读取以及本地 git 检查。
5. 在 dogfood 环境中，Next.js 被配置为使用一个远程的 Neon/Postgres `DATABASE_URL`，因此 N+1 存储读取对网络敏感。
6. Node/Next 路由代码还使用同步 git 执行（通过 `gitExecSync` 调用 `execSync`），因此 CPU 或 git 工作会阻塞服务器 worker 的事件循环。

当看板页面刷新任务列表时，一个同时发出的 `/changes` 请求会排在那个更重的请求后面，并继承可见的延迟。

## 为什么这很重要

即使 changes 端点和 git 仓库都健康，文件变更标签页也可能看起来像坏了一样。

这还会掩盖根因：浏览器网络瀑布图指向 `/api/tasks/{id}/changes`，而实际压力可能来自同一 Next.js 开发服务器上相邻的看板刷新或任务列表注水请求。

## 去重说明

范围更窄的 Rust 侧分析记录已合并到本 issue 中，作为后端语义对等的支撑性说明。本任务 API 性能问题族的权威活动追踪记录是本文件加上 GitHub issue `#406`。

## 建议修复

- 让 `GET /api/tasks?workspaceId=...` 保持精简的列表路径；对昂贵字段使用显式展开或任务详情。
- 默认情况下不要在列表热路径中为每个任务计算 `deliveryReadiness`。
- 批量化任务衍生摘要所使用的 board、artifact、工作树和代码库读取。
- 在单个 `/changes` 请求内缓存代码库/工作树上下文，而不是先解析一次、然后在 `buildTaskDeliveryReadiness` 内再次解析。
- 对可能运行在热点 HTTP 路径上的 git 探测，优先使用异步进程执行或隔离的 worker 边界。
- 考虑在开发期间对 local-first 的看板 API 使用 Rust/Axum 后端，或在 dogfood 队列敏感流程时让 Next.js 使用本地数据库。

## 2026-04-09 本地缓解

在 Next.js 任务列表路径上应用了一个保留兼容性的最小缓解措施：

- `GET /api/tasks?workspaceId=default` 默认不再计算 `deliveryReadiness`。
- 调用方仍可通过 `?expand=deliveryReadiness` 请求旧的展开行为。
- 单任务详情、状态流转守卫、ready-task API 以及任务 changes API 仍会计算 delivery readiness。
- 任务列表序列化现在使用代码库、工作树、board 和 artifact 的请求级视图。
- Artifact 存储现在暴露了 `listByWorkspace(workspaceId)`，因此任务列表路径可以汇总任务 artifact，而无需对每张卡片做一次查询。

在同一 Next 开发服务器上热重载后的本地测量：

| 请求 | 缓解后观测耗时 |
|---|---:|
| `GET /api/tasks?workspaceId=default` | `0.033s` 到 `0.112s` |
| `GET /api/tasks?workspaceId=default&expand=deliveryReadiness` | `14.89s` |
| `GET /api/tasks/{id}/changes`，前面没有展开的任务列表请求 | `1.83s` |

这证实了在采样的工作区中，delivery-readiness 的扇出是任务列表的队头阻塞源。

## 2026-04-09 慢 API 传感器

为受影响的 Next.js 任务 API 添加了路由级计时：

- `GET /api/tasks`
- `GET /api/tasks/{taskId}`
- `GET /api/tasks/{taskId}/changes`

每个响应现在都包含 `Server-Timing: routa-route;dur=...`、`x-routa-route` 和 `x-routa-route-duration-ms`。

慢于 `ROUTA_SLOW_API_THRESHOLD_MS` 的请求会被记录到：

```text
~/.routa/projects/<project-slug>/runtime/slow-api-requests.jsonl
```

默认阈值为 `1000ms`。在 dogfood 时设置 `ROUTA_API_TIMING_LOG_ALL=1` 可记录每一个受监控的任务 API 请求。

## 适应度函数后续

现有的性能适应度函数位于 `docs/fitness/runtime/performance.md`，但当前的 `web_route_performance_smoke` 是一个页面/导航冒烟测试。它不会断言任务 API 延迟，也不会断言任务列表的负载/派生预算。

在 API 形态修复后，添加一个 `task_api_latency_probe`。建议的参考预算：

| 探针 | 目标预算 |
|---|---:|
| `GET /api/tasks?workspaceId=<fixture>` 精简列表 | 本地 fixture 上 p95 `< 1000ms` |
| `GET /api/tasks/{id}` 详情注水 | 本地 fixture 上 p95 `< 1000ms` |
| `GET /api/tasks/{id}/changes`，带一个小的已提交变更 | 本地 fixture 上 p95 `< 1000ms` |
| 25 张卡片的任务列表负载 | 除非显式展开，否则 `< 250KB` |

该探针应针对确定性的 fixture 数据运行，而非开发者真实的远程 Neon 数据库。

## Issue 卫生

- 2026-04-28：在确认 GitHub issue `#406` 已于 2026-04-12 关闭后，同步了本地状态。性能适应度探针仍是一个后续改进项，而非活动的事故追踪记录。

## 相关文件

- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/app/api/tasks/[taskId]/changes/route.ts`
- `src/core/kanban/task-derived-summary.ts`
- `src/core/kanban/task-delivery-readiness.ts`
- `src/core/git/git-utils.ts`
- `docs/fitness/runtime/performance.md`
