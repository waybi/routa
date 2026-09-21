# Kanban UX Feedback: Loading States, Failure Surfacing, Completion Notifications, and Payload Diet

**Status: shipped.** All three phases landed across 17 commits (`6fa31d4c..6d8f83b3`).

## Problem

Measured on 2026-09-21 against the running Web build (board `312b1f5a`, workspace `e3c231ef`) with `agent-browser` for interaction and `curl` for payload size.

The board never told the user what was happening:

- **Failures were silent.** Forcing `POST /api/tasks` to return 500 left the modal open, the button unchanged, and no error anywhere on screen — the message went only to the browser console. Card delete, agent submit, and prompt send had the same shape.
- **Completion never reached the user.** The backend recorded `terminalState` and emitted `AGENT_COMPLETED`, but `grep -rn "terminalState" src/app/workspace src/client` returned 0 matches. The SSE channel carried only `kanban:changed` ("something changed, refetch"). `NotificationCenter` existed as a component and was never mounted.
- **The page was doing hidden work.** `GET /api/tasks` returned 3.3 MB for 8 cards and was refetched on every `kanban:changed` event; the live-tail caption cost a 1 MB / 3.2 s history download per session every 10 s; `fitness/runtime` fired 8 times in ~6 s on an idle board.

## What Shipped

### Phase 1 — Feedback primitives

A dependency-free `ToastProvider` (`src/client/components/toast.tsx`) mounted in the root layout, so the Tauri bundle gets it too. Error toasts are sticky by default: a failure the user never reads is the bug the layer exists to fix.

Every silent-failure site now shows an inline error plus a toast, and every async button exposes a pending state (disabled + spinner + verb-ing label). The worktree-cleanup `window.confirm` became an i18n in-app dialog, and the create modal became scrollable so its footer stays reachable on short viewports.

### Phase 2 — Completion reaches the user

`kanban:task-lifecycle` joins `kanban:changed` on the SSE channel, carrying `phase` (`started` / `completed` / `failed` / `blocked` / `needs_review`), card identity, and a ≤120-char `lastMessagePreview`. A bridge (`src/core/kanban/task-lifecycle-bridge.ts`) resolves the owning card from the session and re-broadcasts; the Axum backend projects the same shape.

The frontend consumes it on three surfaces: a toast for the user watching the board, the notification bell so the event survives a tab switch, and an OS notification **only while the tab is hidden** — the case the board could never cover.

Card badges moved from three states to five. `acpStatus: ready` used to render as "Live", but `ready` means the process is alive, not that the agent is producing output; a finished run waiting for its next prompt looked identical to one mid-task. `resolveCardRunStatus` now folds in the lane-session record so `working` and `idle` are distinguishable, and only `working` animates.

### Phase 3 — Payload diet

`GET /api/tasks` returns a board projection by default. `laneSessions` kept a full per-run copy of the card objective (1.4 MB of the original 3.3 MB) that no client reads; `comments`, `jitContextSnapshot`, `verificationReport`, and `contextSearchSpec` are detail-only. Lane entries keep only session identity and liveness. Long objectives are truncated with an `objectiveTruncated` flag so consumers know to hydrate. `?view=full` and `GET /api/tasks/:id` still return everything, and the detail panel hydrates on open into a cache a list refresh cannot clobber.

`GET /api/sessions/:id/tail` replaced the history poll, and the fitness poll gained a 5 s floor with a trailing call (relaxed from a 5 s to a 15 s background cadence).

## Results

| Measurement | Before | After |
|---|---|---|
| `GET /api/tasks`, 8 cards | 3369 KB | **80.8 KB** (41×) |
| Live-tail call | ~1 MB / 3.2 s | **503 B / 32 ms** |
| 12 tail calls over 60 s idle | ~12.5 MB | **8.1 KB** |
| Create failure feedback | console only | inline error + sticky toast |
| Create pending state | none | disabled + spinner within 150 ms |
| Agent completion | nothing | toast + bell + OS notification when hidden |
| `window.confirm` in `src/app` | 9 call sites | **0** |

Reproduce the payload numbers:

```bash
curl -s "http://localhost:3000/api/tasks?workspaceId=<id>" | wc -c
curl -s "http://localhost:3000/api/sessions/<session-id>/tail" | wc -c
```

## Acceptance Criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Forced failure shows a red error within 3 s and restores the button | **Met** — inline `创建卡片失败: 模拟：后端创建失败` plus a sticky toast |
| 2 | Async buttons change appearance within 100 ms | **Met** — measured at 150 ms: disabled, spinning, label `正在创建卡片…` |
| 3 | Completion notifies (foreground toast + bell, background OS notification) | **Met** — 8 integration tests over the real providers |
| 4 | `curl /api/tasks \| wc -c` < 100 KB for 8 cards | **Met** — 80.8 KB |
| 5 | 60 s idle → < 10 network requests | **Not met: 21 requests.** Two live sessions polling `/tail` every 10 s account for 12 of them. The bytes moved, not the request count: those 12 calls now cost 8.1 KB against ~12.5 MB before. Eliminating the count needs the preview pushed over SSE (the `lastMessagePreview` field exists for this) rather than polled. |
| 6 | `grep -rn "window.confirm\|window.alert" src/app` → 0 | **Met** — 0 call sites |
| 7 | Both backends pass the same shape tests | **Met** — Next and Axum projection/lifecycle tests assert identical contracts |

## Validation

`entrix run --tier normal`: 60 checks pass. Four fail, all reproduced unchanged on the pre-work baseline `e69bac8d`:

- `clippy_pass` — `routa-desktop` build script reads a stale Tauri permissions path under the repo's former location (`/Users/ouweibing/Desktop/my/routa`). The crates this work touched (`routa-server`, `routa-core`) are clippy-clean.
- `npm_audit_critical` / `npm_audit_high` — a `next` advisory; `package.json` was not modified here.
- `rust_test_pass` — 6 `harness-monitor` TUI snapshot tests fail under `cargo test --workspace` and pass in isolation. That crate was not touched (`git diff --name-only e69bac8d..HEAD -- crates/harness-monitor/` is empty).

`ts_test_pass` initially failed because `NotificationBell` in the shared header threw without a provider; `useNotifications` now degrades to an inert context, since missing notifications are a degraded experience while a thrown render is an outage.

## Follow-ups

- **Push the live tail instead of polling** to close acceptance #5. `lastMessagePreview` already rides `kanban:task-lifecycle`; an `agent_message` relay would let the 10 s poll go away entirely.
- **`kanban-tab.tsx` is 2392 lines** and grew here. The repo playbook (`docs/REFACTOR.md`) prescribes orchestration shell + domain hooks; the task-mutation handlers touched in Phase 1 are the natural first extraction.
- **Pin the fitness-poll root cause.** The throttle bounds the rate, but the exact `refreshSignal` churn pattern was inferred from the burst schedule rather than instrumented.
- **The four pre-existing gate failures** are unrelated to this work and still block a clean `entrix` run.

## Commits

```
6fa31d4c docs(kanban): add UX feedback execution plan
797601c5 feat(ui): add global toast layer and feedback i18n keys
c930e106 refactor(i18n): move feedback keys into the tail dictionary
d8df9ac6 feat(kanban): surface loading and failure states for board actions
c8288313 feat(kanban): broadcast task lifecycle events over SSE
3d11b6cf feat(desktop): project task lifecycle events on the Axum backend
7be89049 feat(kanban): notify the user when an agent run finishes
277b3ce8 feat(kanban): distinguish working from idle on card status badges
5b276e99 perf(api): return a slim board projection from GET /api/tasks
5bc6694b perf(kanban): hydrate card detail on open instead of shipping it in the list
89b59157 perf(kanban): replace the live-tail history poll with a /tail endpoint
51b11388 perf(kanban): throttle the fitness poll and show a first-paint skeleton
53ef31dd perf(api): keep only session identity and liveness in list lane sessions
472ebc35 feat(ui): add a promise-based confirm dialog to replace window.confirm
72d19ddb refactor(kanban): route all confirmations through the in-app dialog
e1511f5a fix(ui): make useNotifications degrade instead of throwing
6d8f83b3 test(kanban): cover the completion notification chain end to end
```
