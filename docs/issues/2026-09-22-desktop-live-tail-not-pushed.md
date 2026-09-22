---
title: "Desktop (Axum) backend does not push kanban:session-tail; card captions freeze after the seed fetch"
date: "2026-09-22"
kind: issue
status: open
severity: low
area: "desktop"
tags: ["kanban", "desktop", "sse", "live-tail", "backend-parity", "follow-up"]
reported_by: "claude"
related_issues: []
github_issue: null
github_state: null
github_url: null
---

# Desktop backend does not push `kanban:session-tail`; card captions freeze after the seed fetch

## What Happened

The Kanban board's per-card "what the agent is saying" caption moved from a
10 s poll of `GET /api/sessions/:id/tail` to a server push:
`pushNotification` → `SessionTailPublisher` (300 ms trailing / 1 s max-wait
debounce) → `kanban:session-tail` frame on `/api/kanban/events`. Landed in
`cb0d63ea`, `d7bd49f2`, `4c92e75e`.

Only the Next.js backend emits the frame. The Axum backend has the matching
`/tail` endpoint (`89b59157`) but nothing publishes `kanban:session-tail`.

The shared frontend (`use-kanban-live-tails.ts`) seeds each newly-live
session with one `/tail` fetch and then relies on pushes. On desktop that
means a card shows the agent's line as of the moment it went live and never
updates again.

## Expected Behavior

Desktop and web preserve the same behavior (`docs/ARCHITECTURE.md`
cross-backend invariant): a running card's caption refreshes as the agent
produces output, on both backends.

## Reproduction Context

- Environment: desktop (Tauri + Axum)
- Trigger: open the Kanban board while a card's session is running; watch the
  caption under the card. It fills once, then stays static while the agent
  keeps talking.
- Web is unaffected: verified 2026-09-22 by capturing two
  `kanban:session-tail` frames 28 s apart on `/api/kanban/events` during a
  live dsh run.

## Why This Might Happen

- `crates/routa-core/src/acp/mod.rs:261 push_to_history` is the single point
  every notification passes through (mirrors Next's `pushNotification`), but
  `AcpManager` holds no `EventBus` reference — `grep event_bus
  crates/routa-core/src/acp/mod.rs` returns nothing — so there is no path from
  "message arrived" to the Kanban SSE fan-out in `crates/routa-server/src/api/kanban.rs`.
- The Kanban SSE route only translates `EventBus` events
  (`translate_agent_event_to_kanban_payload` /
  `translate_agent_event_to_lifecycle_payload`); nothing on the Rust side
  emits an event for individual agent messages.
- Deliberately deferred on 2026-09-22: wiring requires either threading an
  `EventBus` into `AcpManager` (touches every constructor and its tests) or a
  server-layer per-session subscribe on session create; the desktop build was
  not running locally to validate either.

## Relevant Files

- `crates/routa-core/src/acp/mod.rs` — `push_to_history` (L261), `spawn_history_mirror` (L518)
- `crates/routa-server/src/api/kanban.rs` — SSE fan-out, `translate_agent_event_to_*`
- `crates/routa-server/src/api/session_tail.rs` — extraction already mirrored; reuse for the push payload
- `src/core/kanban/session-tail-publisher.ts` — reference implementation to mirror (debounce semantics, chunk concat, whole-message replace)
- `src/core/acp/http-session-store.ts` — Next hook site (`pushNotification`)
- `src/app/workspace/[workspaceId]/kanban/use-kanban-live-tails.ts` — consumer; explains why desktop degrades to "seed once" rather than blank

## Observations

- Debounce constants (300 ms / 1 s) were chosen from dsh's measured cadence in
  `routa.db` (291 sessions, 2746 chunk gaps, median 13.7 s, 0% under 750 ms)
  plus the assumption that Claude SDK `text_delta` gaps sit under 300 ms. Keep
  the Rust numbers identical so the two backends coalesce the same way.
- Frame shape to mirror (from `KanbanSessionTailEvent`):
  `{ type: "kanban:session-tail", workspaceId, sessionId, tail, updateType, timestamp }`.
  `tail` is already normalized/capped at 240 chars by the shared extractor.

## References

- `docs/exec-plans/completed/kanban-ux-feedback.md` — Follow-ups, first bullet
- Commits: `cb0d63ea` (publisher), `d7bd49f2` (frontend consumer), `4c92e75e` (doc)

## Issue Hygiene
- 2026-09-22 (later): scope widened. The Axum backend now also lacks `kanban_events` persistence and `Last-Event-ID` replay (`482ec20d` on Next). Same root cause — no `EventBus`/broadcaster hook on `AcpManager`, and `crates/routa-server/src/api/kanban.rs` translates EventBus events only. Mirror both `session-tail-publisher.ts` and the persist/replay in `kanban-event-broadcaster.ts` + `api/kanban/events/route.ts` in one pass.
