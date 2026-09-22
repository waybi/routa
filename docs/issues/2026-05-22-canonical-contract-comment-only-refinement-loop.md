---
title: "Canonical contract gate can loop when backlog refinement only writes comments"
date: "2026-05-22"
kind: issue
status: resolved
resolved_at: "2026-09-22"
severity: medium
area: "kanban"
tags: ["canonical-contract", "backlog", "prompts", "kanban"]
github_issue: null
github_state: null
github_url: null
created_at: 2026-05-22
updated_at: 2026-05-22
---

## What happened

A QuantDinger workflow card repeatedly failed the canonical story contract gate with a
"Canonical story YAML is missing" error.

The card's backlog refinement notes claimed the story had been refined, but the persisted task
`objective` still contained only a short prose sentence. The canonical YAML was not written back to
the card description/objective, so the gate was correctly rejecting the transition while the agent
looped through comment-only updates.

## Why it matters

The contract gate is meant to stop malformed backlog stories before downstream lanes begin work.
If the prompt allows agents to treat comments or completion notes as refinement evidence, Routa can
produce a false sense of progress and burn repeated lane attempts without changing the gated field.

## Fix direction

- Keep the canonical contract gate strict.
- Make backlog/contract-gated prompts explicit that the YAML must be persisted in the card
  description via `update_card`.
- State that comments, progress notes, and completion summaries do not satisfy the contract gate.
- Add a prompt regression test so future prompt edits do not remove this instruction.

## Issue Hygiene

- 2026-09-22: reviewed, still active and reproduced. TopBI card `d5e0a0a2` bounced three times on 2026-09-21 for exactly this pattern. `resources/specialists/locales/*/workflows/kanban/backlog-refiner.yaml` says to use `update_card` but does not state that comments/progress notes do not satisfy the gate, and no prompt regression test exists. `40ccc829` closed a related hole (update_task.objective bypassing the gate) but not this one.
- 2026-09-22: resolved. All three `backlog-refiner.yaml` variants (root, `locales/en`, `locales/zh-CN`) now state that the gate reads only `task.objective`, that comments / progress notes / completion summaries do NOT satisfy it, and that the YAML must be persisted via `update_card` before `move_card`. Regression test `src/core/specialists/__tests__/backlog-refiner-contract-prompt.test.ts` loads the bundled prompts and asserts the instruction per locale (verified to fail when the zh-CN line is removed). Tool-layer enforcement (auto-lifting YAML from comments) was not in scope.
