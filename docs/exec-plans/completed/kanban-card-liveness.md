# Kanban Card Liveness: Working, May Be Stuck, or Failed — Without Opening the Card

**Status: shipped on Web (Next.js).** Commits `044dfabd` (server heartbeat), `9634eb62` (card face), `33f62901` (i18n move). Desktop (Axum) does not push the new event yet — see Follow-ups.

## Problem

Observed 2026-10-14 on TopBI Board (workspace `e3c231ef`), card `d7de5675`: the agent was writing output (the "Live Session" caption updated), but both pills on the card read "Starting". The only way to tell whether it was working, stuck, or broken was to open the card.

Root causes, verified read-only:

- **Stale process status.** The board fetches `GET /api/sessions` once and refetches only on `kanban:changed`. At that moment the dev session was `ready` on the server (`curl /api/sessions?workspaceId=e3c231ef…` → `b1275868 ready active`), while the card still held the creation-time `connecting` snapshot.
- **No activity time on the client.** Activity timestamps live in server memory (`HttpSessionStore.sessionActivities`). The persisted `laneSessions[].lastActivityAt` is written only on lifecycle events; it was `null` for the running dev lane in `routa.db`.
- **30 s window flapped.** The previous rule called a card idle after 30 s of silence. dsh's median gap between message chunks is 13.7 s and tool runs (builds, tests) are much longer, so a healthy run kept flipping to idle.
- **Duplicate pill.** The GitHub-sync pill also echoed `connecting` as "Starting".

## What Shipped

```text
ACP notification ─▶ HttpSessionStore.recordSessionActivity / setSessionAcpStatus / setSessionTerminalState
                       └─▶ SessionActivityPublisher (≤1 routine frame / session / 10 s; urgent frames immediate)
                              └─▶ kanban:session-activity on /api/kanban/events (not persisted)
                                     └─▶ kanban-page-client merges into sessions (newer lastActivityAt wins)
                                            └─▶ describeCardActivity → pill + caption + left border, re-aged every 15 s
```

- **Event `kanban:session-activity`**: `acpStatus`, `acpError`, `lastActivityAt`, `lastEventType`, `lastToolName`, `lastToolStatus`, `terminalState`, `terminalReason`. Urgent (sent at once): process status change, `error`, `turn_complete`, terminal state, first activity. Not written to `kanban_events`, so heartbeats never crowd lifecycle frames out of the bounded replay window.
- **`GET /api/sessions`** returns the same fields, so a refetch after an SSE reconnect lands on current state.
- **Card states** (`kanban-card-status.ts`):

| State | Rule | Card face |
|---|---|---|
| working | alive and last activity ≤ 3 min ago, or a tool still running ≤ 6 min | pulsing green dot, green left border, "running Bash · active 12s ago" |
| may be stuck | alive, mid-turn, silent > 3 min (> 6 min while a tool runs) | orange pill and border, "silent for 5 min" |
| idle | last event was `turn_complete` | grey, "turn finished, waiting" |
| failed | process error, runtime error, watchdog timeout, failed lane | red pill and border, "error: <reason>", Rerun button |
| starting | `connecting` and no activity yet | blue, "waiting for first output" |

  Thresholds sit below the default 10 min watchdog (`board-session-supervision.ts`), so the card warns before the run is killed. The caption's tooltip shows the exact last-activity time.
- The sync pill now shows GitHub sync state only.
- Strings live in `kanbanCardActivity` in the tail dictionaries (`*-extended.ts` were at the 1600-line budget).

## Verification

- Unit: `npx vitest run src/core/kanban src/core/acp 'src/app/workspace/[workspaceId]/kanban' src/client/hooks src/app/api/sessions src/i18n` → 119 files, 807 tests passed. New: `session-activity-publisher.test.ts` (6, incl. "heartbeats are not persisted"), `http-session-store-activity.test.ts` (2), `kanban-session-activity.test.ts` (3), `kanban-card-status.test.ts` (+6), `kanban-card.test.tsx` (+3: working with tool, may be stuck, failure reason).
- `npx tsc --noEmit` 0 errors; eslint clean; `entrix run --tier fast` all PASS except `npm_audit_critical` (dependency advisories, lockfile untouched by this change).
- `npm run build` from a clean worktree of `33f62901`: exit 0; built `api/kanban/events` route and kanban page contain `kanban:session-activity`.

## Follow-ups

- Desktop (Axum) backend does not emit `kanban:session-activity`; desktop cards keep the old behaviour. Same gap as `docs/issues/2026-09-22-desktop-live-tail-not-pushed.md` — mirror `session-activity-publisher.ts` in the same pass.
- Thresholds are constants; if boards with long-running tools want different values, read them from the board's `devSessionSupervision`.

## Change Log

| Date | Change | Effect | Commit |
|---|---|---|---|
| 2026-10-14 | Heartbeat event + card liveness states | Card shows working / may be stuck / failed with reason and last-activity age; no more permanent "Starting" | `044dfabd`, `9634eb62`, `33f62901` |
