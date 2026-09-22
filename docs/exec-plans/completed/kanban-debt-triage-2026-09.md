# Kanban Debt Triage: Un-skip Orchestrator Tests, Persist Board Events, Fail Fast on Misplaced Canonical YAML

**Status: shipped 2026-09-22.** Ten commits, `84734bec..3abb56e4` (interleaved with
another agent's done≠merged work on the same branch).

## Outcome

| Item | Result | Evidence |
|---|---|---|
| 1. Misplaced-YAML error | Shipped. Gate names the case, points at `update_card`, drops the "regenerate" suffix. | `84734bec`; 12 tests in `task-contract-readiness.test.ts` |
| 2. Un-skip suites | Shipped. All three `describe.skip` removed; 16 tests live again. Repo-wide `describe.skip\|it.skip\|test.skip` in `src/**/*.test.*` → **0**. | `3c29aba5` `1777e984` `5b6c42f9`; suite 1837 pass / 23 skip → **1951 pass / 0 skip** |
| 3. Event persistence | Shipped (Next). `kanban_events` table on pg+sqlite; every frame persisted with its SSE `id:`; replay on `Last-Event-ID`, `?lastEventId`, or `?since`; client resumes on manual reconnect and coalesces invalidates. | `f553559a` `061d4369` `9fe2eb61` `482ec20d` `3abb56e4`; 34 new tests |

Verified against the live build (`npx next build --webpack` + `next start` on :3000):

```
sqlite3 routa.db ".schema kanban_events"           → table + index present
3 × PATCH /api/tasks/:id (no SSE client attached)   → 3 rows in kanban_events
curl -H "Last-Event-ID: <row1>" .../events?ws=…     → connected + 2 replayed frames, ids match db
curl .../events?ws=…&since=<now-1h>                 → 3 replayed frames
curl .../events?ws=…&since=<now+1h>                 → connected only
browser first connect (hooked EventSource ctor)     → ?since=60min-ago
```

### What Item 2 actually found

The tracker called the suites "flaky". They were not. Un-skipping and running each
three times gave identical results every time:

| Suite | Un-skipped result | Cause |
|---|---|---|
| `workflow-orchestrator.test.ts` | 9/9 pass, no change needed | Skipped alongside the others, never re-checked. Six months of zero coverage on the file that drives every lane transition. |
| `agent-trigger.test.ts` | 2 deterministic failures | `97a1c50d` moved the prompt from a second `fetch` to `dispatchSessionPrompt`; `f039909d` removed the A2A lane path the other test asserted. |
| `kanban-tab.test.tsx` | 5 deterministic failures | `5bc6694b` added detail hydration fetch + provider persist; `38b1cb60` added tabs. Tests predated both. |

### Deferred

- **Rust does not persist or replay `kanban:events`.** Table and frame shape are frozen
  below; the Axum port is mechanical. Tracked in
  `docs/issues/2026-09-22-desktop-live-tail-not-pushed.md` alongside the session-tail gap.
- **Rust has no contract gate at all** (`require_canonical_story` is defined in
  `crates/routa-core/src/models/kanban.rs:29` and never read), so Item 1 had nothing to
  mirror. Pre-existing parity gap, not introduced here.
- `kanban-tab.test.tsx` is 3261 lines (budget 1600). Pre-existing; grew by ~40 lines here.

---


## Goal

Land the three items chosen from the 2026-09-22 issue sweep that a Kanban user is
most likely to be hurt by, in the order of least effort to most:

1. **Fail fast when the canonical YAML is in a comment instead of the description.**
   Follow-up to the prompt fix in `73a44bf5`; turns a hint into an enforced rule.
2. **Un-skip the three `describe.skip` blocks** that hide 16 tests, including the entire
   `KanbanWorkflowOrchestrator` suite (9 tests over a 966-line file that drives every
   lane transition).
3. **Persist `kanban:*` board events** so a page reload or server restart does not erase
   the last hour of what happened to a card.

## Why This Plan Exists

All three were surfaced by `python3 .github/scripts/issue-scanner.py --check` on
2026-09-22 and re-verified against code and a live board the same day.

### Item 1 — misplaced YAML

The contract gate reads exactly one field:
`src/core/kanban/task-contract-readiness.ts:96` — `parseCanonicalStory(task.objective)`.
An agent that writes the YAML into a comment and calls `move_card` gets
`Canonical story YAML is missing` and retries. TopBI card `d5e0a0a2` bounced
three times this way on 2026-09-21. `73a44bf5` told the agent about it in the prompt;
nothing in the tool layer catches the mistake, so a model that skims the prompt still
loops until `buildContractLoopBreakerMessage` stops it after N attempts.

### Item 2 — skipped tests are not flaky

The tracker `2026-03-29-flaky-test-suite-skipped.md` calls them flaky. They are not.
Removing the three `describe.skip` and running the suites three times in a row on
2026-09-22 gave the **identical** 7 failures each time (`Tests 7 failed | 61 passed`):

| Suite | Result | Root cause |
|---|---|---|
| `workflow-orchestrator.test.ts` | **9/9 pass** | Nothing wrong. Was skipped 2026-03-29 alongside the others and never re-checked. |
| `agent-trigger.test.ts` | 2 fail | Test expects the prompt to go out as a second `fetch`; `97a1c50d` (2026-04-03) moved it to `dispatchSessionPrompt`, which the file already mocks but never arms. Stale mock, not timing. |
| `kanban-tab.test.tsx` | 5 fail | Component now fires `GET /api/tasks/:id` (detail hydration, `5bc6694b`) and `PATCH /api/kanban/boards/:id` (provider persist) on open; the tests' `fetch` mock throws `Unexpected fetch` on both. Plus one artifact-gate fixture and a few i18n label lookups drifted. |

So this is "update six mocks", not "chase a race".

### Item 3 — events live in memory only

`docs/issues/2026-04-21-kanban-event-persistence.md:35-39`: events exist only on the
in-process EventBus; a WebSocket drop loses them, a restart loses everything, a
reconnecting client cannot catch up. Verified today:

- `sqlite3 routa.db ".tables"` — no `kanban_events` table (19 tables, none for board events).
- `src/app/api/kanban/events/route.ts:13` — SSE `attach` only; no replay, no `Last-Event-ID`.
- `src/core/kanban/flow-ledger.ts` computes flow diagnosis in memory (`analyzeFlowForTasks`); it has no store behind it.

The two frames I added this week (`kanban:task-lifecycle` in `c8288313`,
`kanban:session-tail` in `cb0d63ea`) are likewise transient — the notification bell
keeps them in `localStorage`, which is per-browser.

## Decision

| Question | Decision | Why |
|---|---|---|
| Order | 1 → 2 → 3 | Effort ascends; each is independently shippable. |
| Item 1 scope | Detect "YAML present in a comment, absent from objective" and return a **specific** error naming `update_card` + description. Do **not** auto-lift the YAML into the description. | Auto-lifting silently changes a gated field; the prompt already says who is responsible for writing it. A precise error is enough to break the loop on the first bounce. |
| Item 1 entry points | Both `KanbanTools.moveCard` (`src/core/tools/kanban-tools.ts:359`) and `PATCH /api/tasks/:id` (`src/app/api/tasks/[taskId]/route.ts:454`) | Both call `buildTaskContractTransitionErrorFromRules`; fix the helper so both get it. |
| Item 2 scope | Un-skip all three, fix the stale mocks, delete the `// See: ...flaky` comments. | If it passes 3× deterministically it is not flaky; leaving the label invites the next person to skip again. |
| Item 3 backend | Next.js first; Rust in a follow-up issue. | Web is what is in daily use here. Table shape and frame shape are frozen so the Rust port is mechanical. |
| Item 3 scope | `kanban_events` table (SQLite + Postgres), write on every `broadcast()`, replay on SSE connect via `Last-Event-ID` / `?since=`, 7-day retention. | Enough to survive reload/restart and to let the bell rebuild from server truth. Dashboards (WIP / lead time) stay in `2026-03-19-kanban-flow-observability-and-control-gaps.md`. |
| Item 3 storage | One row per frame, `payload` as JSON text, indexed on `(workspace_id, created_at)`. | Frames are already JSON-serialized for SSE; no second schema to maintain. |

## Constraints

- **Both backends stay in contract.** Item 1 changes an error string agents key on; mirror the wording in `crates/routa-core/src/models/task.rs` (the only Rust file that emits `Canonical story YAML is missing`). Item 3 defers Rust but freezes the table and frame shape in this doc.
- **LLM-driven decisions.** Item 1 adds no UI button; it only sharpens the error the agent already receives.
- **Characterization first for Item 3.** Extend `src/core/kanban/__tests__/kanban-event-broadcaster.test.ts` and `src/client/hooks/__tests__/use-kanban-events.test.tsx` before touching the broadcaster.
- **Baby steps.** One commit per item at minimum; Item 3 splits into schema → write path → replay → client.
- **Do not touch** files another agent has uncommitted edits in. As of this writing: `crates/routa-server/src/api/tasks/{dto,handlers}.rs`, `crates/routa-server/src/application/tasks.rs`, `src/app/api/tasks/[taskId]/route.ts` and its test, `kanban-tab-panels.tsx`, `kanban-tab.tsx`, `chat-panel.tsx`, the three i18n files. Item 1's PATCH-route entry is reached through the shared helper, so the route file itself does not need editing.

## Current Evidence (file:line)

| Surface | Location | Now |
|---|---|---|
| Gate reads objective only | `src/core/kanban/task-contract-readiness.ts:96` | `parseCanonicalStory(task.objective)` |
| Generic error text | `task-contract-readiness.ts:103,137` | "Canonical story YAML is missing. Add exactly one ```yaml``` block…" |
| Loop breaker | `task-contract-readiness.ts:163-175` | counts prior gate-note comments; fires after threshold |
| Comment shape | `src/core/models/task.ts:170-177` | `TaskCommentEntry { body, source?: "update_card" \| "legacy_import", … }` |
| moveCard gate call | `src/core/tools/kanban-tools.ts:359` | `buildTaskContractTransitionErrorFromRules(...)` |
| PATCH gate call | `src/app/api/tasks/[taskId]/route.ts:454` | same helper |
| Orchestrator skip | `src/core/kanban/__tests__/workflow-orchestrator.test.ts:13-14` | `describe.skip`, comment claims timing issues; passes 9/9 when un-skipped |
| Agent-trigger skip | `src/core/kanban/__tests__/agent-trigger.test.ts:687-688` | `describe.skip`; 2 stale-mock failures |
| Kanban-tab skip | `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx:1881-1882` | `describe.skip`; 5 stale-mock failures |
| `dispatchSessionPrompt` mocked but unarmed | `agent-trigger.test.ts:10-19, 843` | `vi.fn()` never given a rejection in the JSON-RPC test |
| Broadcaster | `src/core/kanban/kanban-event-broadcaster.ts:broadcast()` | writes to live controllers only |
| SSE route | `src/app/api/kanban/events/route.ts:13` | `attach` only |
| Schema (pg) | `src/core/db/schema.ts` | no events table |
| Schema (sqlite) | `drizzle-sqlite/` | no events table |

## Design

### Item 1 — targeted error for misplaced YAML

In `task-contract-readiness.ts`, extend `buildTaskContractReadiness` (or add a sibling
`detectMisplacedCanonicalYaml(task)`) so that when `parseCanonicalStory(task.objective).hasYamlBlock`
is false, it scans `task.comments` (newest first, `source === "update_card"` or any) for
a ```yaml block that parses as a canonical story. If found:

```
Cannot move task to "Todo": the canonical story YAML is in a comment, not in the card
description. The gate reads only the description. Call update_card with the YAML as the
description, then retry move_card.
```

This message replaces the generic one only in that case. It does **not** count toward
the loop breaker (`countContractGateFailures`) — the point is to make attempt #1 the last
one, not to accelerate the cutoff.

Rust: **no mirror needed.** Verified 2026-09-22 that `require_canonical_story` is only
defined in `crates/routa-core/src/models/kanban.rs:29` and never read — the Axum backend
has no contract gate at all, so there is no error string to sharpen. Desktop parity for
the gate itself is a separate (pre-existing) gap, not introduced here.

### Item 2 — un-skip and repair

- `workflow-orchestrator.test.ts`: remove `describe.skip` and the two comment lines. No other change.
- `agent-trigger.test.ts`:
  - "emits AGENT_FAILED when session/prompt returns a JSON-RPC error payload": drop the
    second `fetch` mock; arm `dispatchSessionPromptMock.mockRejectedValueOnce(new Error(...))`
    with the JSON-RPC error message; keep the `setTimeout(0)` flush.
  - "uses A2A transport for A2A-configured automation steps": the `fetch` mock returns
    `undefined` and the code calls `.json()` on it. Either the A2A branch should not be
    fetching (check `agent-trigger.ts:686` gating) or the mock needs a session-create response.
    Fix whichever the code proves.
- `kanban-tab.test.tsx` "card detail manual runs" (5 tests): extend the shared fetch mock
  to answer `GET /api/tasks/:id` (return the fixture task) and
  `PATCH /api/kanban/boards/:id` (return `{ ok: true }`); update the artifact-gate fixture
  to include a `screenshot` artifact where the test expects the move to succeed; re-check
  the three i18n label selectors against current `en-extended.ts`.
- Update `docs/issues/2026-03-29-flaky-test-suite-skipped.md` → `resolved`, noting they were
  deterministic mock drift.

### Item 3 — persisted board events

**Table** (identical columns in `src/core/db/schema.ts` and `drizzle-sqlite/`):

```
kanban_events
  id            text  PK        -- uuid
  workspace_id  text  not null  -- index (workspace_id, created_at)
  type          text  not null  -- "kanban:changed" | "kanban:task-lifecycle" | "kanban:session-tail" | "fitness:changed"
  resource_id   text  null      -- taskId / sessionId / boardId when present
  payload       text  not null  -- the exact JSON frame sent over SSE
  created_at    integer not null (epoch ms)
```

**Write path.** `KanbanEventBroadcaster.broadcast()` gains an optional `persist` hook
(injected store; no-op in tests). Every frame except `connected` is written after fan-out.
`kanban:session-tail` frames are written too — they are already debounced to ≤1/s per
session, and they are what lets a reconnecting board redraw captions without a seed fetch.

**Retention.** A daily sweep (`setInterval` in `routa-system.ts`, alongside the existing
scheduler) deletes rows older than 7 days. Constant `KANBAN_EVENT_RETENTION_DAYS = 7`.

**Replay.** `GET /api/kanban/events?workspaceId=…` honours `Last-Event-ID` (standard
EventSource reconnect header) or `?since=<epoch ms>`. On connect, after the `connected`
frame, it streams stored rows newer than that cursor in `created_at` order, each with an
SSE `id:` line set to the row id, then switches to live. Cap replay at 500 rows.

**Client.** `use-kanban-events.ts`: `EventSource` already sends `Last-Event-ID` on
auto-reconnect when frames carry `id:`. Add `id:` to the SSE writer. No client code change
is needed for the reconnect case; for a fresh page load the hook may pass
`?since=<now - 1h>` so the bell can rebuild. `use-task-lifecycle-notifications.ts` already
dedupes on `taskId:phase:timestamp`, so replayed frames do not double-toast.

**Frame contract freeze (for the Rust follow-up):** `payload` is byte-for-byte the object
`KanbanWorkspaceEvent` already serializes. No new fields.

## Implementation Steps

Item 1 (~1 h)
1. Add `detectMisplacedCanonicalYaml` + wire into `buildTaskContractTransitionErrorFromRules`.
2. Tests in `task-contract-readiness.test.ts`: YAML in comment → specific message; YAML nowhere → generic message; YAML in objective → no error; loop-breaker count unaffected by the misplaced case.
3. ~~Mirror in Rust~~ — no Rust gate exists (see Design). Skipped.
4. Commit `fix(kanban): name the misplaced-YAML case in the contract gate error`.

Item 2 (~half day)
5. Un-skip orchestrator; run 3×; commit `test(kanban): un-skip workflow-orchestrator suite`.
6. Repair `agent-trigger.test.ts` mocks; commit.
7. Repair `kanban-tab.test.tsx` mocks + fixtures; commit.
8. Resolve `2026-03-29-flaky-test-suite-skipped.md`; commit with the sweep.

Item 3 (~1–2 days)
9. Characterization tests for current broadcaster + hook behaviour.
10. Schema + migration (pg + sqlite); `KanbanEventStore` with `append`, `listSince`, `pruneOlderThan`.
11. Broadcaster persist hook; wire store in `routa-system.ts`; retention sweep.
12. SSE route replay (`Last-Event-ID` / `?since=`) + `id:` lines.
13. Client: optional `since` on fresh load; verify no double-toast.
14. Update `2026-04-21-kanban-event-persistence.md` → note Next done, open a Rust follow-up issue.

## Verification

```bash
# Item 1
npx vitest run src/core/kanban/__tests__/task-contract-readiness.test.ts
cargo test -p routa-core canonical
# manual: on a backlog card, add a comment containing a ```yaml story block, leave the
# description as prose, call move_card → error must name update_card + description.

# Item 2 — must pass three times in a row
for i in 1 2 3; do npx vitest run \
  src/core/kanban/__tests__/workflow-orchestrator.test.ts \
  src/core/kanban/__tests__/agent-trigger.test.ts \
  "src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx" 2>&1 | grep -E "Tests "; done
grep -rn "describe.skip" src/core/kanban/__tests__ "src/app/workspace/[workspaceId]/kanban/__tests__" | wc -l   # → 0

# Item 3
sqlite3 routa.db "select type, count(*) from kanban_events group by type"
curl -sN -H "Last-Event-ID: <some-row-id>" "http://localhost:3000/api/kanban/events?workspaceId=<ws>" | head -20
# → replayed frames before live ones, each with an id: line
# reload the board mid-run → bell shows events from before the reload
```

## Risks

- **Item 1 false positive.** A comment that quotes an *old* YAML for discussion would trigger the misplaced-YAML message even though the agent knows it is outdated. Mitigation: only consider comments newer than `task.updatedAt` of the objective field if that timestamp exists; otherwise accept the false positive — the message still points at the right fix.
- **Item 2 uncovers a real bug.** If a repaired test fails for a code reason rather than a mock reason, stop, file it under `docs/issues/`, and leave that one test skipped with a pointer. Do not paper over it.
- **Item 3 write amplification.** `kanban:changed` fires on every comment append; a busy agent produces a few rows per minute — trivial for SQLite. `session-tail` is bounded by the 1 s max-wait. Retention keeps the table small. If Postgres deployments object, the persist hook is injectable and can be disabled per driver.
- **Item 3 replay + dedupe.** `use-task-lifecycle-notifications` dedupes by `taskId:phase:timestamp`; `use-kanban-events` does not dedupe `kanban:changed`, so a replay of 50 changes triggers 50 `onInvalidate` calls → 50 board refetches. Mitigation: coalesce `onInvalidate` during replay (single call after the replay window closes). Add this to step 12.
- **Other agent in the tree.** Item 2's `kanban-tab.test.tsx` and Item 1's PATCH route are adjacent to files with uncommitted edits by another session. Re-check `git status` before each commit; if a needed file is dirty, stop and coordinate rather than stash.
