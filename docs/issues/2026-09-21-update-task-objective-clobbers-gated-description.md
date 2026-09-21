---
title: "update_task.objective silently clobbers gate-validated card description (same field, no guards)"
date: "2026-09-21"
kind: issue
status: investigating
severity: high
area: "kanban"
tags: ["kanban", "mcp-tools", "canonical-contract", "update-task", "update-card", "data-loss"]
reported_by: "claude"
related_issues:
  - "2026-05-22-canonical-contract-comment-only-refinement-loop.md"
  - "2026-09-20-kanban-design-retrospective-topbi-run.md"
github_issue: null
github_state: null
github_url: null
---

# update_task.objective silently clobbers gate-validated card description

## What Happened

On the TopBI board (`312b1f5a`), card `71051574-68cd-48bb-b197-81b241253e88` lost its
canonical story YAML after a successful backlog refinement. The backlog lane session
(`19c88638-9e46-4df8-b78a-504c6623836e`) made two consecutive successful tool calls:

1. `update_card` (message_index 17) wrote a 2842-char `description` containing the full
   canonical ```yaml story contract. Result: success, description persisted.
2. `update_task` (message_index 20) wrote a 92-char one-sentence `objective` plus
   `scope` / `acceptanceCriteria`. Result: success, `updatedFields: ["objective", ...]`.

Both calls returned success. The second call replaced the first call's content entirely,
because `update_card.description` and `update_task.objective` both write the same DB
column `tasks.objective`. No warning, no error, no version conflict.

Downstream, the Todo entry gate (`requireCanonicalStory: true`) rejected the card for
"missing canonical YAML", and the Todo orchestrator recorded the wrong diagnosis
"backlog 梳理未完成" (refinement HAD completed — its write was clobbered) into two rounds
of rejection notes on card `c5320340`. The board logged 3 cards bouncing todo↔backlog.

## Expected Behavior

Either:
- a story-description write path exists exactly once, or
- both aliases enforce the same guards: `update_card.description` runs a
  description-freeze check (dev/review/blocked/done) and a contract-gate validation
  before writing; `update_task.objective` must not be able to bypass them.

## Reproduction Context

- Environment: web (Next.js backend, sqlite store)
- Trigger: any kanban lane agent calling `update_card` (description with YAML) followed
  by `update_task` (objective present) on the same card. Prompt guidance in
  `agent-trigger.ts` actively instructs agents to use both tools ("update_card is not a
  story-readiness tool ... Use `update_task` for those fields"), so the two-call
  sequence is the recommended pattern, and `update_task`'s schema exposes `objective`.

Evidence recovery (re-runnable):

```bash
sqlite3 routa.db "SELECT message_index, event_type FROM session_messages
  WHERE session_id='19c88638-9e46-4df8-b78a-504c6623836e' ORDER BY message_index;"
# msg 17 tool_call update_card rawInput.description = 2842 chars incl. canonical YAML
# msg 21 tool_call_update update_task result updatedFields includes "objective"
sqlite3 routa.db "SELECT length(objective) FROM tasks
  WHERE id='71051574-68cd-48bb-b197-81b241253e88';"  # → 92 chars today
```

## Why This Might Happen

- `src/core/tools/kanban-tools.ts:494` — `updateCard`: `task.objective = params.description`,
  guarded by `DESCRIPTION_FROZEN_STAGES` (L458-462) and contract-gate validation
  (L464-491, `resolveCurrentOrNextContractGate` + `buildTaskContractReadiness`).
- `src/core/tools/agent-tools.ts:891` — `updateTask`: `task.objective = updates.objective`,
  **no freeze check, no contract gate**.
- `src/core/mcp/mcp-task-write-boundary.ts:9` — `objective` is on the kanban-planning
  allowlist, so the profile boundary does not intercept it either; and per
  `agent-trigger.ts:47` most lanes do not even run under the `kanban-planning` profile.
- Net effect: the same field has one guarded door and one unguarded door, and the
  prompts direct agents through both doors in sequence.

Impact beyond the observed data loss:

1. Description freeze (dev onward) is bypassable via `update_task.objective` — a story
   contract believed frozen during review can be rewritten silently.
2. Contract-gate-validated YAML can be replaced with arbitrary text; the failure only
   surfaces later at move time as a misleading "YAML missing" symptom.
3. Bounce loops burn lane sessions (~3 min each + LLM cost); `loopBreakerThreshold: 2`
   then pushes the card to blocked.
4. Wrong diagnoses propagate through multi-agent review notes and steer future rounds
   toward re-running refinement, which can hit the same overwrite again.

## Relevant Files

- `src/core/tools/kanban-tools.ts` (updateCard guards, DESCRIPTION_FROZEN_STAGES)
- `src/core/tools/agent-tools.ts` (updateTask unguarded objective write)
- `src/core/mcp/mcp-task-write-boundary.ts` (profile allowlist)
- `src/core/kanban/task-contract-readiness.ts` (gate helpers)
- `src/core/kanban/agent-trigger.ts` (prompt guidance recommending both tools)

## Observations

- `update_task` supports `expectedVersion` optimistic locking; `update_card` does not —
  parallel lane writes to card text have no conflict detection on the update_card path.
- Related earlier issue `2026-05-22-canonical-contract-comment-only-refinement-loop.md`
  fixed a sibling symptom (comment-only refinement) at the prompt level; this failure
  mode is tool-level and cannot be fixed by prompts alone.

## References

- Board: workspace `e3c231ef-3efd-4bf5-b9d7-89911bdea32b`, board `312b1f5a-f1d6-4e51-b0da-334944e64609`
