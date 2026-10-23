---
title: "Next.js task APIs suffer head-of-line blocking from heavy task list serialization"
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

# Next.js task APIs suffer head-of-line blocking from heavy task list serialization

## What Happened

Dogfood on the local Next.js dev server showed `GET /api/tasks/{taskId}/changes` taking tens of seconds.

The slow user-visible request was:

```text
http://localhost:3000/api/tasks/0e6a0433-543d-454b-b136-67bde25f37cc/changes
```

The first suspicion was ACP provider blocking, but route inspection and timing showed a broader Next.js API queueing problem.

## Measurements

Local measurements on 2026-04-09:

| Request | Backend | Observed time |
|---|---:|---:|
| `GET /api/tasks/{id}/changes` | Next.js `localhost:3000` | `1.55s` to `2.71s` when mostly isolated |
| `GET /api/tasks/{id}/changes` | Next.js `localhost:3000` | `15.91s` when issued beside task list refresh |
| `GET /api/tasks?workspaceId=default` | Next.js `localhost:3000` | `14.32s` to `15.42s` |
| `GET /api/tasks/{id}` | Next.js `localhost:3000` | `14.76s` while cold or queued; `0.59s` warm |
| `GET /api/tasks/{id}/changes` | Rust/Axum `127.0.0.1:3210` | `0.12s` warm |
| `GET /api/tasks?workspaceId=default` | Rust/Axum `127.0.0.1:3210` | `0.067s` |
| `git status --porcelain -uall` in the task worktree | local git | `0.03s` |

The Next.js task list response was approximately `840KB`. The sampled workspace had 21 serialized tasks with `deliveryReadiness` and 12 task worktrees.

## Current Diagnosis

`/api/tasks/{taskId}/changes` is not directly calling ACP.

The immediate route work is:

1. read task
2. read worktree
3. read codebase
4. run local git summary
5. call `buildTaskDeliveryReadiness(task, system)`, which resolves worktree/codebase again and runs delivery git status
6. optionally list committed changes since base

For the sampled task, local git commands were tens of milliseconds, so the worktree itself was not the dominant bottleneck.

The larger blocker is `GET /api/tasks?workspaceId=default` in the Next.js runtime:

1. `src/app/api/tasks/route.ts` lists workspace tasks.
2. It serializes every task with `serializeTask(task, system)`.
3. Each serialization builds evidence summary, story readiness, INVEST validation, and delivery readiness.
4. Those summaries perform per-task artifact/board/worktree/codebase reads and local git checks.
5. In the dogfood environment, Next.js was configured with a remote `DATABASE_URL` for Neon/Postgres, so N+1 store reads are network-sensitive.
6. Node/Next route code also uses synchronous git execution (`execSync` through `gitExecSync`), so CPU or git work can block the server worker event loop.

When the Kanban page refreshes task list, a simultaneous `/changes` request waits behind that heavier request and inherits the visible latency.

## Why This Matters

The file changes tab can look broken even when the changes endpoint and git repository are healthy.

This also obscures root cause: the browser network waterfall points at `/api/tasks/{id}/changes`, while the actual pressure may come from a neighboring Kanban refresh or task-list hydration request on the same Next.js dev server.

## Deduplication Note

The narrower Rust-side analysis record has been merged into this issue as a
supporting backend parity note. The authoritative active tracker for this task
API performance family is this file plus GitHub issue `#406`.

## Proposed Fix

- Keep `GET /api/tasks?workspaceId=...` on a lean list path; use explicit expansion or task detail for expensive fields.
- Do not compute `deliveryReadiness` for every task in the list hot path by default.
- Batch board, artifact, worktree, and codebase reads used by task-derived summaries.
- Cache codebase/worktree context inside a single `/changes` request instead of resolving it and then resolving it again inside `buildTaskDeliveryReadiness`.
- Prefer async process execution or an isolated worker boundary for git probes that can run on hot HTTP paths.
- Consider using the Rust/Axum backend for local-first Kanban APIs during development, or keep Next.js on a local DB when dogfooding queue-sensitive flows.

## 2026-04-09 Local Mitigation

Applied a minimal compatibility-preserving mitigation on the Next.js task list path:

- `GET /api/tasks?workspaceId=default` no longer computes `deliveryReadiness` by default.
- Callers can still request the legacy expanded behavior with `?expand=deliveryReadiness`.
- Single-task detail, status transition guards, ready-task APIs, and task changes APIs still compute delivery readiness.
- Task list serialization now uses a request-scoped view of codebases, worktrees, boards, and artifacts.
- Artifact stores now expose `listByWorkspace(workspaceId)` so the task-list path can summarize task artifacts without one query per card.

Hot-reloaded local measurement on the same Next dev server:

| Request | Observed time after mitigation |
|---|---:|
| `GET /api/tasks?workspaceId=default` | `0.033s` to `0.112s` |
| `GET /api/tasks?workspaceId=default&expand=deliveryReadiness` | `14.89s` |
| `GET /api/tasks/{id}/changes`, with no expanded task-list request ahead of it | `1.83s` |

That confirms delivery-readiness fan-out was the task-list head-of-line blocker in the sampled workspace.

## 2026-04-09 Slow API Sensor

Added route-level timing to the affected Next.js task APIs:

- `GET /api/tasks`
- `GET /api/tasks/{taskId}`
- `GET /api/tasks/{taskId}/changes`

Each response now includes `Server-Timing: routa-route;dur=...`, `x-routa-route`, and `x-routa-route-duration-ms`.

Requests slower than `ROUTA_SLOW_API_THRESHOLD_MS` are recorded to:

```text
~/.routa/projects/<project-slug>/runtime/slow-api-requests.jsonl
```

The default threshold is `1000ms`. Set `ROUTA_API_TIMING_LOG_ALL=1` while dogfooding to record every monitored task API request.

## 2026-10-23 Landing Probe Off the Main Thread

The 2026-09-22 `deliveryLanding` list probe (`src/core/kanban/task-delivery-landing.ts`, see
`docs/exec-plans/active/kanban-done-merge-visibility.md`) brought synchronous git back onto the
`GET /api/tasks` hot path: every `done` card with a worktree ran `isGitRepository`, `getRepoRefSha` and
`getRepoLandingStatus` through `gitExecSync` (about 5–6 `execFileSync` calls per card), and only
`landedOnBase === true` was cached. TopBI cards go through Gerrit and never land on the local base, so
they were re-probed on every request. The slow-request log recorded 125 `/api/tasks` requests over 1 s
since 2026-10-21 (worst 24 s); a TopBI list took 1.47–1.62 s, and a 4 KB `/api/kanban/boards` request
fired beside it waited 1–5 s.

Fix:

- `src/core/git/git-landing-probe.ts` runs git with async `execFile` only. One
  `git cat-file --batch-check` resolves `HEAD` and every candidate base ref
  (`origin/<base>`, `<base>`, `origin/main`, `main`, `origin/master`, `master`) to shas;
  `rev-list --count` and `merge-base --is-ancestor` then run against those shas, so the answer belongs
  to exactly those refs. Semantics match `getRepoLandingStatus`.
- Results are cached for both `true` and `false`, keyed by worktree path + `HEAD` sha + resolved base
  ref name and sha (+ local base branch sha when the probe falls back to it). A new commit or a moved
  base misses the cache, so a stale "unmerged +N" cannot be served. Results computed while a git command
  failed unexpectedly, or with an unborn `HEAD`, are not cached. A hit costs one git process.
- At most 8 landing probes run at once per process; each probe runs its git commands one after another.

Measured on the live data (read-only `routa.db`, real worktrees, machine load 13–16, 3 rounds each):

| Probe set | Before (sync) | After, cold cache | After, warm cache |
|---|---:|---:|---:|
| TopBI, 15 done cards (5 with a live worktree) | 0.82–1.08 s, main thread blocked the whole time | 0.14–0.26 s, longest main-thread block 6–23 ms | 43–58 ms |
| All workspaces, 124 done cards (10 with a live worktree) | 1.34–2.06 s, blocked the whole time | 0.27–0.44 s, longest block 29–41 ms | 78–182 ms |

Old and new probes returned byte-identical results on both sets.

The all-projects overview (`kanban-overview.tsx`) was the visible victim: it unmounts when the user switches
back to the single board, so every switch to "全部项目" re-fetched tasks + boards for all 6 workspaces and
showed "loading" for 0.76–4.1 s. `use-kanban-overview-data.ts` now keeps the last ready data per workspace
and the last workspace list in a module-level cache: a switch back renders the cached rows at once and
refreshes them in the background (later request still wins, aborts are not failures, SSE refresh
unchanged). Only a workspace that was never loaded shows "loading".

## Fitness Follow-Up

Existing performance fitness lives in `docs/fitness/runtime/performance.md`, but the current `web_route_performance_smoke` is a page/navigation smoke. It does not assert task API latency or task-list payload/derivation budgets.

Add a `task_api_latency_probe` after the API shape is fixed. Suggested advisory budgets:

| Probe | Target budget |
|---|---:|
| `GET /api/tasks?workspaceId=<fixture>` lean list | p95 `< 1000ms` on local fixture |
| `GET /api/tasks/{id}` detail hydration | p95 `< 1000ms` on local fixture |
| `GET /api/tasks/{id}/changes` with one small committed change | p95 `< 1000ms` on local fixture |
| Task list payload for 25 cards | `< 250KB` unless explicitly expanded |

The probe should run against deterministic fixture data instead of the developer's real remote Neon database.

## Issue Hygiene

- 2026-04-28: synced local status after confirming GitHub issue `#406` was closed on 2026-04-12. The performance-fitness probe remains a follow-up improvement, not an active incident tracker.

## Relevant Files

- `src/app/api/tasks/route.ts`
- `src/app/api/tasks/[taskId]/route.ts`
- `src/app/api/tasks/[taskId]/changes/route.ts`
- `src/core/kanban/task-derived-summary.ts`
- `src/core/kanban/task-delivery-readiness.ts`
- `src/core/kanban/task-delivery-landing.ts`
- `src/core/git/git-landing-probe.ts`
- `src/core/git/git-utils.ts`
- `src/app/workspace/[workspaceId]/kanban/use-kanban-overview-data.ts`
- `docs/fitness/runtime/performance.md`

## 变更记录

| 日期 | 改了什么 | 效果数字 | 提交号 |
|---|---|---|---|
| 2026-10-23 | `deliveryLanding` 探测改异步 git、并发上限 8、按 HEAD+基线 sha 缓存（含未合入）；「全部项目」总览按工作区缓存，切回先显示旧数据再后台刷新 | TopBI 15 张卡探测 0.82–1.08 s（全程堵主线程）→ 冷 0.14–0.26 s、热 43–58 ms，主线程最长被占 ≤23 ms | 见本提交 |
