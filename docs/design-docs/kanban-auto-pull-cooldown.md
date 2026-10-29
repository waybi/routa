---
title: Kanban Auto-Pull Cooldown
---

# Kanban Auto-Pull Cooldown

Opening a kanban board checks out the registered branch of the main checkout and pulls it. To avoid
a `git pull` on every board open, a successful pull starts a 10 minute cooldown
(`PULL_COOLDOWN_MS` in `src/core/git/pull-cooldown.ts`).

## Trigger path

Board opens → `PATCH /api/clone/branches` with `pull=true` → checkout succeeds →
`pullWithCooldown(repoPath, pull)`. Without `pull` (or `pull=false`) nothing is read or written.

## Cooldown key

`<absolute repo path>@@<branch>`.

- The branch is the current branch after checkout, resolved inside the module (the requested
  `branch` can be a remote name or a commit, so it is not used).
- Detached HEAD (`git` returns `HEAD`): the short commit id is used instead.
- If the branch cannot be resolved (error, null): the key is just the absolute path.

Switching branches therefore never hits the previous branch's record.

## Storage

JSON file `~/.routa/kanban-pull-cooldown.json`; override with `ROUTA_PULL_COOLDOWN_FILE`
(same pattern as `kanban-model-tiers.json`). Format:
`{ "version": 1, "entries": { "<key>": <epoch ms of last successful pull> } }`.

- Loaded lazily once per process; entries older than the cooldown or non-numeric are dropped.
- Written after each successful pull through a serial queue: write `<file>.<pid>.tmp`, then
  `rename` (atomic). Expired entries are pruned on write.
- All IO is async (`fs/promises`).
- **This is a deletable cache: deleting the file only causes one extra pull.** A sqlite table was
  rejected because web and desktop backends would both need a table and a migration.

## Failure handling

- Missing or empty file: treated as no records, no log.
- Invalid JSON, unexpected format, other read errors, or write errors: never thrown; one
  `console.warn` per kind per process; the cooldown keeps working in memory.
- A failed pull is never recorded (memory or file). Concurrent calls for the same key share one pull.

## Manual pull is unaffected

`POST /api/workspaces/{id}/codebases/{id}/git/pull` does not use this module and always pulls.

## Out of scope

Changing the 10 minute window, the frontend same-tab dedupe, the Rust/Axum backend, cooldown on
manual pull, a cleanup job.

## Change Log

| Date | Change | Effect | Commit |
|---|---|---|---|
| 2026-10-29 | Key changed to path + branch; persisted to JSON file | Branch switch pulls once per branch; cooldown survives restart | see git log (`feat(kanban): pull cooldown keyed by branch and persisted`) |
