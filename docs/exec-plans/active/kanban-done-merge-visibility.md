# Kanban Done ≠ Merged: Delivery-State Visibility and Merge Readiness

## Goal

Make "this card is done but its branch has not landed on the base branch" a first-class, visible state on the Kanban board, and give the operator a one-click, conflict-aware way to land all done branches into the base. Do **not** auto-merge on entry to `done`.

## Why This Plan Exists

Observed on workspace `e3c231ef-3efd-4bf5-b9d7-89911bdea32b`, board `312b1f5a-f1d6-4e51-b0da-334944e64609` (codebase `topbi`, base branch `feat/coder-query`), 2026-09-22:

- All 8 cards are in `done` with `status: COMPLETED`.
- All 8 worktrees are `status: "active"`, branches `issue/<taskId>`, base `feat/coder-query`.
- `git branch --merged feat/coder-query` contains none of them; `git ls-remote --heads origin issue/*` is empty. Each branch is 1–3 commits ahead of base.
- Nothing on the board shows this. The only record is the final message of the `kanban-pr-publisher` session (e.g. `608fd367-18d9-4f5f-b7b3-521fd1c3ee90`), which reads "PR/MR URL: 无 —— 发布被阻塞".

The publisher is blocked for two independent reasons that will recur on this codebase:

1. Remote is Gerrit (`ssh://ouweibing@gerrit.topgamesinc.com:27000/topbi`). `pr-publisher.yaml` and `/api/tasks/{taskId}/pr-run` only handle GitHub/GitLab (`pr-run/route.ts:88-92` returns 400 otherwise). For Gerrit repos the `done` column automation is effectively a no-op.
2. Local `feat/coder-query` is 34 non-merge commits ahead of `origin/feat/coder-query`. Pushing `refs/for/feat/coder-query` would open 36 Gerrit Changes, so the publisher correctly refused.

A real sequential merge test (throwaway worktree, `git merge --no-ff` in board order) showed **7 of 8 branches merge cleanly; `issue/c5320340` conflicts** on three files also touched by `issue/d5e0a0a2`:

```text
docs/plans/2026-09-ai-query-monthly-plan.md            (touched by 3 branches)
docs/plans/evidence/2026-09-w3-error-paths/matrix.md   (touched by 2)
docs/plans/evidence/2026-09-w3-error-paths/defects.md  (touched by 2)
```

`src/server/app.ts` was also touched by 2 branches and happened not to conflict. Conflicts across parallel cards are structural, not accidental, so an unattended auto-merge would stall on the first real board and leave the base half-merged.

## Decision

| Option | Verdict | Reason |
|---|---|---|
| A. Auto-merge on `done` entry | **Rejected** | Review Guard validates a card against its own AC, not against sibling branches. First conflict blocks the column with no one holding context. |
| B. Surface "unmerged" state on the card | **Do first** | Zero-risk; turns a silent failure into a visible one. Most of the git probing already exists. |
| C. Workspace-level merge-readiness panel with conflict prediction + ordered one-click merge | **Do second** | Codifies the manual `merge-tree` probe; stops at the first conflicting card instead of guessing. |
| D. Gerrit `refs/for/` publish path in `pr-publisher` | Out of scope here | Separate plan; blocked anyway until the 34 local base commits are pushed. |

## Constraints

- Web (Next.js) and desktop (Rust/Axum) must keep the same API shape. Rust currently has **no** `delivery_readiness` / `delivery_snapshot` implementation (`rg -l 'delivery_readiness|DeliveryReadiness|delivery_snapshot' crates` → empty), so any new endpoint is Next-first and must be registered in `api-contract.yaml` or it only shows up as "Extra in Next.js" in `npm run api:check`.
- No new git state machine on `Worktree`. `WorktreeStatus` stays `creating | active | error | removing` (`src/core/models/worktree.ts:9`). Merge state is derived from git at read time, then frozen into the existing `deliverySnapshot`, never stored as a separate mutable column.
- All UI strings through i18n.
- Merge actions are explicit operator actions (POST), never triggered by column automation.

## Current Evidence (file/line map)

| Surface | Location | Current behavior |
|---|---|---|
| Worktree status enum | `src/core/models/worktree.ts:9` | No `merged` state; service only creates/validates/removes (`git-worktree-service.ts:192-316`) |
| Done column automation | board `312b1f5a` `columns[done].automation.steps` | `kanban-pr-publisher` → `kanban-done-reporter`; publisher prompt in `resources/specialists/locales/zh-CN/workflows/kanban/pr-publisher.yaml` — push + open PR/MR, explicitly "不移动卡片", no merge |
| Manual PR trigger | `src/app/api/tasks/[taskId]/pr-run/route.ts:82-92` | `detectPrPlatform` → 400 unless GitHub/GitLab |
| Delivery readiness | `src/core/kanban/task-delivery-readiness.ts:23-38, 87` | Already computes `ahead/behind/commitsSinceBase/hasCommitsSinceBase/canCreatePullRequest` via `getRepoDeliveryStatus` (`src/core/git/git-utils.ts:811`) |
| Delivery snapshot | `src/core/kanban/task-delivery-snapshot.ts:15-56`; captured at `src/app/api/tasks/[taskId]/route.ts:519-520` on `review`/`done` transitions | Freezes `baseSha/headSha/commits` so base..HEAD survives a later merge. **Has no notion of "was it merged".** |
| Readiness in list API | `src/app/api/tasks/route.ts:200,532` | `deliveryReadiness` is **expand-only** (`?expand=deliveryReadiness`) since 5928fc14 — the default list view the board fetches does not carry it (full probe ran `git status`+`git remote` per card, ~15 s on 21 cards) |
| Card detail badge | `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx:486-492` | Shows commit count only; no merged/unmerged signal |
| Git helpers | `src/core/git/git-utils.ts` | Has `getRepoRefSha`, `getRepoCommitChanges`, `getRepoDeliveryStatus`, `deleteBranch`; **no** `merge-tree` / `merge-base --is-ancestor` / `merge` helpers |
| Contract | `api-contract.yaml:3807-3890` (`/api/tasks/{taskId}/changes*`), `:4792-4852` (`/api/worktrees/{id}*`) | No merge-related paths registered |

## Design

### Phase 1 — Delivery state on the card (Option B)

Add a derived field to `TaskDeliveryReadiness`:

```ts
landedOnBase: boolean | null;   // null = could not determine (no baseRef / not a git repo)
```

Computed in `getRepoDeliveryStatus` via `git merge-base --is-ancestor HEAD <baseRef>` (exit 0 → true). This is a single read-only git call and needs no new state.

Extend `TaskDeliverySnapshot` with an optional `landedAt?: string` set the first time `landedOnBase` flips to `true` for a snapshot that already has `headSha` (checked on any readiness build, not only transitions). Rationale: after the branch is merged and the worktree removed, `headSha` alone tells you what landed; `landedAt` tells you when.

UI: in `kanban-card.tsx` (board tile) and `kanban-card-detail.tsx:486` (badge row), when `columnId === "done"` and `deliveryReadiness.hasCommitsSinceBase && landedOnBase === false`, render an amber badge `t.kanbanDetail.unmerged` ("未合入基线" / "Not merged to base"). When `landedOnBase === true`, render a muted `t.kanbanDetail.merged`.

Column header: count of done cards with `landedOnBase === false`, shown next to the existing card count.

**Correction made during implementation.** The board tile never receives `deliveryReadiness`: `GET /api/tasks` gates it behind `?expand=deliveryReadiness` because the full probe (`git status`, upstream ahead/behind, remote URL) took ~15 s on a 21-card workspace (`docs/issues/2026-04-09-next-task-api-head-of-line-blocking.md`). Re-enabling it for the badge would reopen that incident. Instead Phase 1 adds a second, cheap projection:

```ts
// src/core/kanban/task-delivery-landing.ts
deliveryLanding?: { landedOnBase: boolean | null; commitsSinceBase: number; branch?; baseBranch? }
```

Backed by `getRepoLandingStatus` (`git-utils.ts`): `rev-parse --verify` + `rev-list --count` + `merge-base --is-ancestor`, no `status`/`remote`. Measured on a real task worktree: 57 ms vs 159 ms for the full path. It runs only for cards where `columnId === "done" && worktreeId` is set, is always on in the default list view, and `resolveCardMergeState` prefers it over `deliveryReadiness` when both are present. `landedOnBase` is still also added to `deliveryReadiness` so the detail view (which does get the full probe) agrees with the tile.

`landedAt` on the snapshot is added as a pure helper (`markTaskDeliveryLanded`) but **not yet persisted** from any read path — writing on GET would be a side effect in a hot path; the Phase 2 land endpoint is the natural writer.

Known quirk carried into Phase 2: `resolveBaseRef` prefers `origin/<base>` over the local branch, so `commitsSinceBase` on this board reads 33–37 (distance to the stale remote) rather than 1–3 (distance to local `feat/coder-query`). `landedOnBase` already falls back to the local branch; the count does not. The badge only tests `> 0` so it is unaffected, but the merge-readiness panel must not display this number without the same fallback.

### Phase 2 — Merge readiness panel (Option C)

New endpoints (Next-first, registered in `api-contract.yaml`, Rust stubs return 501 until ported):

```text
GET  /api/workspaces/{workspaceId}/merge-readiness?boardId=
     → { baseBranch, baseSha, baseAheadOfRemote, cards: [{ taskId, branch, headSha,
         commitsSinceBase, landedOnBase, conflictsWith: taskId[], files: string[] }] }

POST /api/workspaces/{workspaceId}/merge-readiness/land
     body { taskIds: string[], order?: "board" | "created", removeWorktree?: boolean }
     → { landed: taskId[], stoppedAt?: { taskId, conflictingFiles } }
```

Conflict prediction: for each candidate branch, `git merge-tree --write-tree <accumulated> issue/<id>`; on non-zero exit record the conflicting files and mark subsequent candidates as "after conflict". Accumulated tree updates only on success. This is exactly the manual probe run on 2026-09-22 and costs one git call per card.

Landing: run in a **temporary detached worktree** on the base branch (`git worktree add --detach`), `git merge --no-ff --no-edit` in the requested order, stop at the first conflict and `merge --abort`, then fast-forward the real base ref only if everything requested succeeded. Never touch the operator's checkout. On success and `removeWorktree: true`, call `GitWorktreeService.removeWorktree(id, { deleteBranch: false })` — branch deletion stays manual until the remote has the commits.

Guards (all return 409 with a machine-readable reason):

- base branch has uncommitted changes in the primary checkout
- any target card has a `laneSessions[].status === "running"` (card `c5320340` had one at time of writing)
- `landedOnBase === true` already (idempotent skip, not error)

UI: a "合并就绪" button on the done column header opens a modal listing cards in board order with badges `clean / conflict(files) / blocked-after`, a checkbox per card, and a single "按顺序合入" action. Result panel shows what landed and where it stopped.

### Explicitly not in this plan

- Auto-merge on `done` (rejected above).
- Gerrit `refs/for/` publishing in `pr-publisher`.
- Pushing the 34 local `feat/coder-query` commits — operational prerequisite, tracked outside Routa.
- Rust port of Phase 2 endpoints beyond 501 stubs.

## Implementation Steps

Phase 1 — **landed on `main` 2026-09-22** as three commits: `991d078c` (core `landedOnBase` + `landedAt`), `98c57f7f` (i18n + badges + column count), `dbc447f9` (`deliveryLanding` list probe). Original step list kept for traceability:

1. `src/core/git/git-utils.ts`: add `isRefAncestor(repoPath, ref, ancestorOf)`; wire `landedOnBase` into `RepoDeliveryStatus` / `getRepoDeliveryStatus`.
2. `src/core/kanban/task-delivery-readiness.ts`: pass `landedOnBase` through `mapReadiness`; null on the three early-return branches.
3. `src/core/models/task.ts` + `task-delivery-snapshot.ts`: optional `landedAt` on snapshot; set when `landedOnBase` becomes true and snapshot `headSha` exists.
4. `src/core/git/__tests__/git-utils.test.ts`, `src/core/kanban/__tests__/task-delivery-readiness.test.ts`: fixtures for merged / unmerged / no-base.
5. i18n keys `kanbanDetail.unmerged`, `kanbanDetail.merged` in `src/i18n/types-extended.ts`, `src/i18n/locales/en-extended.ts`, `src/i18n/locales/zh-extended.ts`.
6. `kanban-card.tsx`, `kanban-card-detail.tsx`: badges; column header count.
7. Characterization test on `GET /api/tasks` asserting the new field is present and nullable.

Phase 2 (one PR per endpoint, then one for UI):

1. `git-utils.ts`: `predictMergeConflicts(repoPath, baseRef, branches[])` using `merge-tree --write-tree`; `landBranches(...)` using a temp detached worktree.
2. Route `GET .../merge-readiness`; register in `api-contract.yaml`; Rust 501 stub.
3. Route `POST .../merge-readiness/land` with the three guards; contract; stub.
4. Panel component + hook under `src/app/workspace/[workspaceId]/kanban/`.
5. Playwright e2e: seed two branches with an overlapping file, assert conflict prediction and stop-at-conflict behavior.

## Verification

- `entrix run --tier fast` after Phase 1; `--tier normal` after Phase 2 (API + workflow orchestration changed).
- `npm run api:check` must show the two new paths as registered, not "Extra in Next.js".
- Manual: on board `312b1f5a`, after Phase 1 all 8 done cards show "未合入基线"; after landing 5cea679a…d5e0a0a2 via Phase 2 those flip to "已合入" and `c5320340` is reported as `conflict` with the three files above.
- Re-runnable evidence commands:

```bash
# unmerged state, per branch
cd /Users/ouweibing/Desktop/topgames/topbi
for b in 5cea679a 21624731 fb268309 632aaff4 7e93558c d5e0a0a2 c5320340 bda9afe7; do
  printf "issue/%s ahead=%s landed=%s\n" $b \
    "$(git rev-list --count feat/coder-query..issue/$b)" \
    "$(git merge-base --is-ancestor issue/$b feat/coder-query && echo yes || echo no)"
done

# conflict prediction (accumulated, board order)
tmp=$(git rev-parse feat/coder-query^{tree})
for b in 5cea679a 21624731 fb268309 632aaff4 7e93558c d5e0a0a2 c5320340 bda9afe7; do
  out=$(git merge-tree --write-tree $tmp issue/$b 2>&1) && tmp=$(echo "$out" | head -1) \
    && echo "issue/$b clean" || { echo "issue/$b CONFLICT"; echo "$out" | grep -i conflict; }
done
```

### Phase 1 verification record (2026-09-22)

- Unit: `npx vitest run src/core src/app/api/tasks 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-card-status.test.ts'` → 161 files, 1274 tests passed. New suites: `git-utils.test.ts` (+4 `landedOnBase` cases), `task-delivery-landing.test.ts` (5), `task-delivery-snapshot.test.ts` (+3 `markTaskDeliveryLanded`), `route.test.ts` (+2 list-view characterization), `kanban-card-status.test.ts` (+5 `resolveCardMergeState`).
- Runtime, dev server `npx next dev --webpack -p 3210` against the live `routa.db`: `GET /api/tasks?workspaceId=e3c231ef-…` returned `deliveryLanding.landedOnBase: false` for all 8 done cards and **no** `deliveryReadiness` key (lean path preserved); whole response 1.95 s.
- Browser (agent-browser, board `312b1f5a`): `[data-testid="kanban-card-merge-state-unmerged"]` × 8, `[data-testid="kanban-card-merge-state-merged"]` × 0, Done header renders "8 张未合入". Screenshot kept at `/tmp/routa-evidence/done-unmerged-badges.png` (not committed per repo policy).
- `entrix run --tier fast` → PASS 100 %. The four `INFRA ERRORS` it lists (`legacy_hotspot_budget_guard`, `file_line_limit`, `clippy_pass`, `ts_test_pass`) are tooling; the one real `ts_test_pass` failure (`kanban-tab.test.tsx`, 5 tests) was bisected to another agent's **uncommitted** un-skip of previously-skipped tests — the same file passes 23/23 on clean `main`.

## Risks

- `merge-tree --write-tree` requires git ≥ 2.38. Detect once and fall back to "prediction unavailable" rather than failing the panel.
- Desktop parity gap: Phase 2 endpoints will be Next-only until ported. Tauri users see a disabled button with a tooltip, not a broken one.
- `landedOnBase` adds one git subprocess per task in `GET /api/tasks`. The list already does one `getRepoDeliveryStatus` per task (`tasks/route.ts:532`); this piggybacks on the same call, so no additional process spawn.

## Related

- `docs/issues/2026-09-20-kanban-design-retrospective-topbi-run.md` — earlier retrospective on this same board.
- Key memory (2026-09-22): "Routa 看板'完成'不等于'合并'".
