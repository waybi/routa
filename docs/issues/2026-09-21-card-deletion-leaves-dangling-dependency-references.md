---
title: "Card deletion leaves dangling dependency references in other cards"
date: "2026-09-21"
kind: issue
status: investigating
severity: medium
area: "kanban"
tags: ["kanban", "dependencies", "delete-card", "canonical-contract", "data-integrity"]
reported_by: "claude"
related_issues:
  - "2026-09-21-update-task-objective-clobbers-gated-description.md"
github_issue: null
github_state: null
github_url: null
---

# Card deletion leaves dangling dependency references in other cards

## What Happened

On the TopBI board, card `71051574` (入口按钮) was deleted and recreated as
`bda9afe7`. The blocked card `c5320340` still declares the deleted id in its
canonical YAML:

```yaml
depends_on:
  - "5cea679a-3642-48dc-8ca1-b92558647c2d"
  - "71051574-68cd-48bb-b197-81b241253e88"   # ← deleted, dangling
```

Its `unblock_condition` also names the deleted id. No warning was produced at
deletion time; nothing updated or flagged the referring card.

## Expected Behavior

Deleting a card should not silently strand its referrers. At minimum:
- structured `task.dependencies` arrays should stop referencing the deleted id
  (this field feeds `/api/tasks/ready` readiness),
- cards whose canonical YAML mentions the deleted id should receive an audit
  comment so the next backlog pass refreshes the story,
- the delete response should tell the caller which cards were affected.

## Reproduction Context

- Environment: web
- Trigger: `delete_card` MCP tool or `DELETE /api/tasks/{taskId}` on a card that
  other cards reference via structured `dependencies` or canonical YAML
  `depends_on`.

Both delete paths are bare deletes today:
- `KanbanTools.deleteCard` (`src/core/tools/kanban-tools.ts:655`): get → delete → notify.
- `DELETE` route (`src/app/api/tasks/[taskId]/route.ts:672`): get → delete → notify.

## Why This Might Happen

- Dependencies live in two layers with no referential integrity: the structured
  `tasks.dependencies` JSON array and free-text canonical YAML inside
  `tasks.objective`. Neither is indexed or validated against live card ids.
- "Delete and recreate" is a natural user recovery move (used here after the
  objective-clobber incident), so dangling ids will recur.
- Downstream agents resolve `depends_on` ids via card lookups; a dangling id
  reads as "dependency not found", which can be misdiagnosed as
  "never unblockable".

## Relevant Files

- `src/core/tools/kanban-tools.ts` (deleteCard)
- `src/app/api/tasks/[taskId]/route.ts` (DELETE handler)
- `src/core/models/task.ts` (dependencies, comments helpers)
- `src/app/api/tasks/ready/route.ts` (readiness consumer of dependencies)

## Observations

- The affected card `c5320340` has structured `dependencies: []` — the ids only
  live in its YAML text, so YAML-mention detection must be part of the fix.
- Machine-editing canonical YAML is not safe (description freeze from dev
  onward; agent-authored contract), so YAML gets an audit comment instead of a
  rewrite.
