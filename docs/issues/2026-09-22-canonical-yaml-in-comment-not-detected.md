---
title: "Contract gate cannot tell 'YAML written to a comment' from 'YAML missing', so agents loop"
date: "2026-09-22"
kind: issue
status: resolved
resolved_at: "2026-09-22"
severity: medium
area: "kanban"
tags: ["kanban", "canonical-contract", "move_card", "agent-loop", "error-message"]
reported_by: "claude"
related_issues:
  - "2026-05-22-canonical-contract-comment-only-refinement-loop.md"
github_issue: null
github_state: null
github_url: null
---

# Contract gate cannot tell "YAML written to a comment" from "YAML missing", so agents loop

## What Happened

TopBI card `d5e0a0a2` was bounced from Todo three times on 2026-09-21. Each time the
backlog-refiner agent had produced a valid canonical story YAML — and each time it had
written it into a **comment** (via `update_card` with a comment payload), not into the
card **description**. The gate replied `Canonical story YAML is missing` all three times.

The message is technically true (the description has no YAML) and completely unhelpful
(the YAML is right there, one field over). The agent read "missing", produced the YAML
again, put it in the same wrong place, and got the same error.

`73a44bf5` added a sentence to the prompt saying comments do not count. That reduces the
frequency; it does not stop a model that skims.

## Expected Behavior

When the description has no canonical YAML block but a recent comment on the same card
contains one that parses, the gate should say so:

> Cannot move task to "Todo": the canonical story YAML is in a comment, not in the card
> description. The gate reads only the description. Call `update_card` with the YAML as
> the description, then retry `move_card`.

One bounce, one precise instruction, done.

## Reproduction Context

- Environment: web (Next.js); the Rust gate has the same blind spot
- Trigger: on a Backlog card with prose in the description, add a comment containing a
  ```yaml canonical story block, then call `move_card` → `todo`.
- Observed: `Cannot move task to "Todo": Canonical story YAML is missing. Add exactly one
  ```yaml``` block with the canonical story contract. Regenerate the canonical YAML in
  Backlog before retrying.`

## Why This Might Happen

- `src/core/kanban/task-contract-readiness.ts:96` parses only `task.objective`. It never
  looks at `task.comments`, so it cannot distinguish the two cases.
- The loop breaker (`countContractGateFailures`, `task-contract-readiness.ts:163`) counts
  prior gate-note comments and cuts off after a threshold — it stops the bleeding after N
  attempts but does nothing to make attempt #1 succeed.
- `update_card` accepts both a `description` and a `comment` field; the tool description
  does not say which one the gate reads.

## Relevant Files

- `src/core/kanban/task-contract-readiness.ts` — gate, error builders, loop breaker
- `src/core/kanban/canonical-story.ts:163` — `parseCanonicalStory`, reusable on comment bodies
- `src/core/models/task.ts:170` — `TaskCommentEntry` (`body`, `source`, `createdAt`)
- `src/core/tools/kanban-tools.ts:359` — `moveCard` gate call
- `src/app/api/tasks/[taskId]/route.ts:454` — PATCH gate call (same helper)
- `crates/routa-core/src/models/task.rs` — Rust gate; only file emitting the same string

## Observations

- Plan and design: `docs/exec-plans/active/kanban-debt-triage-2026-09.md`, Item 1.
- Decision recorded there: return a targeted error, do **not** auto-move the YAML into
  the description (that would silently edit a gated field).

## References

- `2026-05-22-canonical-contract-comment-only-refinement-loop.md` — the prompt-side fix, resolved 2026-09-22 in `73a44bf5`

## Issue Hygiene
- 2026-09-22: resolved in `84734bec`. `buildTaskContractReadiness` scans comments when the description has no block; the transition error names the misplaced case, points at `update_card` + description, and drops the "Regenerate" suffix that caused the loop. The gate's own bounce note cannot re-trigger it. 12 tests. Rust has no contract gate to mirror.
