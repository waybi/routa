# Kanban UX Feedback: Loading States, Failure Surfacing, Completion Notifications, and Payload Diet

## Goal

Make the Kanban page tell the user what is happening. Every asynchronous action must show an in-flight state and surface its failure; agent completion must reach the user even when the tab is not in the foreground; the page must stop downloading data it does not render so that clicks feel immediate.

## Why This Plan Exists

Measured on 2026-09-21 against the running Web build (`next start`, board `312b1f5a`, workspace `e3c231ef`) using `agent-browser` for the interaction walkthrough and `curl` for payload measurement.

### Silent failures (verified at runtime)

Intercepted `POST /api/tasks` in the browser to return HTTP 500 after a 2.5 s delay, then clicked "创建" in the manual-create modal:

| Moment | What the user sees | What actually happened |
|---|---|---|
| Click | Button still reads "创建", not disabled, no spinner | Request sent |
| +2.5 s | No change | Server returned 500 |
| After failure | Modal still open, button unchanged, **no error text anywhere on the page** | Error logged to browser console only |

Root cause: `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx:2103-2105` calls `void createTaskCard()` with no `try/catch` and no pending flag; `src/app/workspace/[workspaceId]/kanban-create-modal.tsx:255-257` has no "creating" state.

Same pattern, confirmed by reading the code:

| Action | Location | Failure path |
|---|---|---|
| Delete card | `kanban-tab.tsx:1723-1725` | `console.error` only; comment literally says "keep the modal open so the user can retry" but the user is never told it failed |
| Kanban agent submit | `kanban-tab.tsx:447-449` | `console.error` only |
| Prompt send after session creation | `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx:452-454` | `void acp.promptSession(...).catch(console.error)` — session panel opens empty, user is not told the message was dropped |
| Persist board provider | `kanban-tab.tsx:389, 408, 423` | `console.error` only (best-effort by design, but no indicator) |

### No in-flight feedback

- Agent submit: button text becomes `"..."` and the textbox disables (`kanban-tab-content.tsx:119-127`); measured ~3 s before the side panel appears. No explanation of what is being waited on.
- Refresh button (`kanban-tab-header.tsx:90-96`): plain `onClick={onRefresh}`, no spinning/disabled state. (Code-only evidence; not runtime-confirmed.)
- Manual create / delete: see above.

### Completion never reaches the user

The backend knows when an agent finishes:

- `src/core/acp/http-session-store.ts:671-686` — on `agent_completed` it records `terminalState = "completed"` and emits `AgentEventType.AGENT_COMPLETED`.
- `src/core/kanban/agent-trigger.ts:821` — lane automation emits `AGENT_COMPLETED` / `AGENT_FAILED`.
- `src/core/kanban/workflow-orchestrator.ts:70, 225, 671, 860` — consumes them for orchestration.

The frontend never hears about it:

- `grep -rn "terminalState\|RoutaSessionActivity" src/app/workspace src/client` → **0 matches** (excluding tests).
- The Kanban SSE channel (`src/client/hooks/use-kanban-events.ts`, server side `src/core/kanban/kanban-event-broadcaster.ts:3-21`) carries only two event types: `kanban:changed` (entity/action/resourceId, no lifecycle semantics) and `fitness:changed`. The only `EventBus → KanbanEventBroadcaster` bridge is `setupFileChangeBridge` in `src/core/routa-system.ts:404-420`, and it bridges `FILE_CHANGES` only.
- `src/client/components/notification-center.tsx` defines a complete `NotificationProvider` / `useNotifications` / bell UI, but `grep -rn "NotificationProvider\|useNotifications\|addNotification" src` (excluding the component itself, its stories, and tests) → **0 matches**. It is never mounted.
- No `new Notification(`, title flashing, or audio cue found in `src/app` or `src/client`.

### Card status cannot distinguish "working" from "idle"

`http-session-store.ts:59`: `acpStatus?: "connecting" | "ready" | "error"`. `kanban-card.tsx:113-119` maps `ready` → `live`. `ready` means the ACP process is alive, not that the agent is producing output. A finished agent waiting for its next prompt renders identically to one mid-task.

(The card that was `RUNNING` during the walkthrough — session `6c4ae710` — was verified via `session_messages` row count rising 532 → 541 in 20 s, so that instance was correct. The model itself lacks an idle/completed state.)

### The page is doing hidden work

Captured via `performance.getEntriesByType("resource")` on first load plus fetch logging while idle:

| Request | Size / latency | Frequency |
|---|---|---|
| `GET /api/tasks?workspaceId=…` | **1965 KB** for 8 cards | Initial load, then on every `kanban:changed` SSE event (full refetch via `onInvalidate`) |
| `GET /api/sessions/{id}/history?consolidated=true` | **1046 KB**, 3.2 s | Every 10 s per live session (`kanban-tab.tsx:84` `LIVE_SESSION_TAIL_POLL_MS = 10_000`, loop at `:1029-1080`) — only to extract the last line for the card's live-tail caption |
| `GET /api/fitness/runtime?codebaseId=…` | small, 3.2 s on first call | `use-runtime-fitness-status.ts:9` `RUNTIME_FITNESS_POLL_MS = 5_000`; observed **8 calls in ~6 s** while idle |
| `GET /api/workspaces/…/codebases/changes` | 12 KB, 1.9 s | Twice on first load |
| `GET /api/clone/branches` | 1 KB, 3.0 s | First load |

Per-card breakdown of the 1965 KB (largest card `bda9afe7`, 520 KB total): `laneSessions` 241 KB, `jitContextSnapshot` 124 KB, `comments` 56 KB, `comment` 54 KB. These fields are rendered only in the detail panel, never in the column list.

Reproduce:

```bash
curl -s "http://localhost:3000/api/tasks?workspaceId=e3c231ef-3efd-4bf5-b9d7-89911bdea32b" | wc -c
```

Note on the fitness poll: `useRuntimeFitnessStatus` is mounted once (`kanban-tab.tsx:656`), yet 8 calls landed in 6 s. The effect at `use-runtime-fitness-status.ts:94-105` re-fires on `[enabled, fetchStatus, queryString, refreshNonce, refreshSignal]`; the excess is most likely dependency churn (e.g. `refreshSignal` bumped by the SSE refresh burst) rather than duplicate mounts. Confirm before fixing — this is the one measured number in this plan without a pinned root cause.

## Constraints

- **Web and Desktop parity.** Any new SSE event type or `/api/tasks` response shape change must land on both `src/` (Next) and `crates/routa-server/` (Axum). `crates/routa-server/src/api/kanban.rs` and `crates/routa-server/src/api/tasks.rs` are the Rust counterparts. Do not ship a Next-only contract.
- **No UI-side decision shortcuts.** Toasts and notifications inform; they must not add buttons that call kanban write APIs directly (board decisions stay LLM-driven — existing project constraint).
- **i18n.** Every new user-facing string goes through `t(...)`. This plan also retires the one existing violation (`window.confirm` at `kanban-tab.tsx:1746`).
- **Characterization tests first** for anything touching `moveTask` / `patchTask` / SSE consumption (`kanban-tab.test.tsx`, `use-kanban-events.test.tsx` already exist — extend, do not bypass).
- **Baby-step commits**: one phase item per commit where possible; ≤10 files, ≤1000 lines.

## Phases

### Phase 1 — Feedback primitives (target: 1 week)

Goal: every click produces a visible reaction within 100 ms, every failure produces visible text within 3 s.

1. **Global toast layer.**
   - Add a toast provider mounted in `src/app/layout.tsx` (or `DesktopAppShell`, `src/client/components/desktop-app-shell.tsx:75`, so Tauri gets it too). `sonner` is acceptable; a ~60-line in-house component is also fine — pick whichever keeps the desktop bundle happy.
   - Expose `toast.success / toast.error / toast.info / toast.loading(id)`.
   - Rule going forward: any `console.error` in `src/app/workspace/**` or `src/client/components/**` that is reachable from a user action must be paired with a `toast.error`.

2. **Wire the silent-failure sites** (table above):
   - `kanban-tab.tsx:2104` → wrap `createTaskCard` in try/catch; pass `creating` down; `toast.success(t.kanbanCreate.created)` on success, `toast.error` + inline red text on failure.
   - `kanban-tab.tsx:1724` → `toast.error` + inline text in the delete confirm dialog.
   - `kanban-tab.tsx:448` → `toast.error`.
   - `kanban-page-client.tsx:453` → `toast.error` and render a "message not sent — retry" affordance in the agent panel.

3. **Three-state buttons.** Convention: `idle → pending (disabled + spinner + verb-ing label) → idle`.
   - `kanban-create-modal.tsx:255` — add `creating` prop.
   - `kanban-tab-content.tsx:127` — replace `"..."` with spinner + `t.kanban.creatingSession`; add a one-line hint under the input during the ~3 s wait.
   - `kanban-tab-header.tsx:90` — spin `RefreshCw` while `onRefresh` is in flight (requires `onRefresh` to return a promise or a `refreshing` prop).
   - Delete dialog already has `isDeleting`; add failure text only.

4. **Housekeeping.**
   - `kanban-tab.tsx:1746` `window.confirm(...)` → project confirm dialog + i18n key.
   - `kanban-create-modal.tsx:133` → add `max-h-[90vh] overflow-y-auto` (the "创建" button sat at `y=633` in a 633 px viewport during the walkthrough and was unclickable by pointer).

Verification: repeat the intercepted-500 walkthrough for create / delete / agent submit; each must show red text within 3 s and restore the button. `grep -rn "window.confirm\|window.alert" src/app` → 0.

### Phase 2 — Completion reaches the user (target: 2 weeks)

1. **New SSE event type** in `kanban-event-broadcaster.ts`:

   ```ts
   type KanbanTaskLifecycleEvent = {
     type: "kanban:task-lifecycle";
     workspaceId: string;
     taskId: string;
     taskTitle: string;
     sessionId: string;
     phase: "started" | "completed" | "failed" | "blocked" | "needs_review";
     columnId: string;
     lastMessagePreview?: string; // ≤120 chars, feeds Phase 3.2
     timestamp: string;
   };
   ```

   Mirror the type in `crates/routa-server/src/api/kanban.rs`.

2. **Bridge.** Add `setupTaskLifecycleBridge` next to `setupFileChangeBridge` in `routa-system.ts`, subscribing to `AGENT_COMPLETED` / `AGENT_FAILED` and to the orchestrator's column transitions (`workflow-orchestrator.ts` — wherever a card is auto-moved to `review` / `blocked`). Resolve `taskId` from the session's kanban context (`src/core/kanban/session-kanban-context.ts`).

3. **Frontend consumption.** `use-kanban-events.ts` gains `onTaskLifecycle`. In `kanban-page-client.tsx`:
   - `completed` → `toast.success` with a click-through that opens the card detail.
   - `failed` → persistent `toast.error`.
   - `needs_review` → `toast.info`.
   - All → `addNotification(...)`.

4. **Mount `NotificationProvider`** in the app shell; place the bell in the top bar next to the Docker status indicator.

5. **Browser notifications** when `document.visibilityState === "hidden"`: request permission once on first Kanban visit; `new Notification(title, { body, tag: taskId })` on `completed` / `failed`. Respect denial silently.

6. **Five-state card status.** Extend the `laneSessions` entry shape (assembled via `src/core/kanban/task-lane-history.ts`) with `terminalState` and `lastActivityAt` from `RoutaSessionActivity`. Rewrite `kanban-card.tsx:113` `getStatusLabel` to `starting / working (activity ≤ 30 s) / idle / completed / failed`; add matching i18n keys and dot styles.

Verification: run a card through `dev`; with the tab in the foreground observe toast + bell badge; with the tab hidden observe an OS notification. `curl /api/kanban/events` shows `kanban:task-lifecycle` frames. Both backends emit identical JSON (add a parity test alongside the existing cross-backend contract tests).

### Phase 3 — Payload diet (target: 4 weeks)

1. **List endpoint slimming.** `GET /api/tasks?workspaceId=` (`src/app/api/tasks/route.ts:188`, Rust `crates/routa-server/src/api/tasks.rs`) omits `laneSessions`, `jitContextSnapshot`, `comments`, `comment` by default; detail panel fetches `GET /api/tasks/{id}` (already exists, `kanban-tab.tsx:548 fetchTaskById`). Add `?include=full` for callers that genuinely need everything (MCP `list_tasks` consumers — audit `src/core/tools/kanban-tools.ts` before flipping the default there). Target: 8 cards < 100 KB.

2. **Kill the live-tail poll.** Delete the `LIVE_SESSION_TAIL_POLL_MS` loop (`kanban-tab.tsx:1029-1080`). Feed `liveSessionTails` from the `lastMessagePreview` field of `kanban:task-lifecycle` (Phase 2.1) plus a lightweight `agent_message` relay, or add `GET /api/sessions/{id}/tail` returning only the last agent message. No more `history?consolidated=true` from the board view.

3. **Fitness poll.** First pin the cause of 8 calls / 6 s (see note above). Then: raise `RUNTIME_FITNESS_POLL_MS` to 15 s, pause on `visibilityState === "hidden"` (the live-tail loop already does this at `:1030`; the fitness hook takes `isPageVisible` but verify it gates the interval), and dedupe by query key.

4. **First-paint skeleton.** Render column skeletons as soon as `boards` + slim `tasks` arrive; let `fitness/runtime` (3.2 s), `codebases/changes` (1.9 s), `clone/branches` (3.0 s) resolve independently in the status bar without blocking the card grid.

Verification: `curl … /api/tasks | wc -c` < 100 KB with the same 8 cards. Idle the board for 60 s with DevTools Network open: < 10 requests (baseline ≈ 20+). Lighthouse TBT on the board route drops measurably (record before/after in this file).

## Acceptance Criteria (whole plan)

1. Offline / forced-500: create, delete, agent-submit each show a red error within 3 s and restore the button.
2. Every async button changes appearance within 100 ms of click.
3. Agent finishes a card → foreground: toast + bell badge; background: OS notification.
4. `curl /api/tasks | wc -c` < 100 KB for 8 cards.
5. 60 s idle → < 10 network requests.
6. `grep -rn "window.confirm\|window.alert" src/app` → 0 results.
7. Both backends pass the same SSE-shape and `/api/tasks`-shape parity tests.

## Non-Goals

- Redesigning the card layout or column semantics.
- Changing how agents make board decisions (stays LLM-driven via MCP tools).
- Server-side session history compaction (separate concern; tracked in `kanban-write-tool-ack-returns.md` and follow-ups).
- Mobile layout.

## Evidence Log

- 2026-09-21 walkthrough: `agent-browser` session `ux`, screenshots kept in `/tmp/kanban-*.png` (not committed, per repo policy). Intercepted-500 create test: `window.__hits === 1`, modal remained open, `document.body.innerText.includes("模拟")` → `false`.
- Payload measurement: `curl -s …/api/tasks | python3 -c '...'` per-field sizes recorded in the "hidden work" table above.
- Session liveness check: `sqlite3 routa.db "select count(*), max(created_at) from session_messages where session_id like '6c4ae710%'"` → 532 → 541 over 20 s.
