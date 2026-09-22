# Refactor Playbook

This document defines refactor rules for large-file and hotspot cleanup in Routa.js.

## Core Rules

1. Start every refactor with `entrix` analysis, then decide scope from evidence instead of intuition.
2. Prioritize files that exceed budget first. In-budget files are secondary unless tied to an active bug or feature.
3. For oversized files, extract logic out of the source file instead of adding more branching inside it.
4. Use concept boundaries and workflow clustering for extraction; do not split by arbitrary line ranges.
5. Write tests for the target extracted module first, then move logic. No move before behavior is covered.
6. Prefer the highest-ROI, lowest-risk split first: extract only one or two high-coupling modules per pass before considering broader decomposition.

## Analysis-First Workflow

Run these before changing code:

```bash
entrix analyze long-file --json
cargo run -q -p routa-cli -- harness budget --config docs/fitness/file_budgets.json --changed-only --base "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}"
cargo run -q -p routa-cli -- harness budget --config docs/fitness/file_budgets.json --changed-only --base "${ROUTA_FITNESS_CHANGED_BASE:-HEAD}" --overrides-only
```

Triage order:

1. Files with budget violations.
2. Among violators, prefer larger over-budget deltas.
3. If still tied, prefer higher-change files from `entrix analyze long-file` history signals (for example `commitCount`).

## Test-First Extraction Rule

Before moving any block out of a long file:

1. Create or extend characterization tests that lock current behavior of the block being extracted.
2. Place tests around the new target module boundary, not only the old monolithic file.
3. Confirm tests fail when behavior changes and pass for the current behavior baseline.

Only after those checks pass, move logic into the new file.

## Concept Clustering Strategy

When choosing what to extract, group by concept and lifecycle:

- One workflow boundary at a time (for example bootstrap, navigation, session orchestration, streaming sync).
- Keep top-level route/page files as orchestration shells.
- Avoid creating generic `utils` buckets when the real complexity is a concrete branch or workflow.
- Prefer one cohesive extraction per commit over broad mixed rewrites.

## Move Sequence (Default)

1. Identify one over-budget file and one cluster to extract.
2. Add target-module tests first.
3. Create destination module with explicit interfaces.
4. Move one cohesive logic cluster.
5. Keep entry file behavior and API shape stable.
6. Remove dead code and re-run tests/lint/fitness checks.

## Declaration-Only and Test Files

The budget (`docs/fitness/file_budgets.json`, default ≤ 1600 lines) applies to every `.ts/.tsx` under `src/`, including type dictionaries and `__tests__`. These files carry no runtime branching, so the Test-First Extraction Rule does not apply; the risk is purely structural (a missing brace, a lost import). Split them by their own natural seams and verify with counts.

### Type dictionaries (`src/i18n/types-*.ts`)

Pattern already in use: `TailTranslationDictionarySections` lives in `types-tail.ts` and is composed via `extends`. Repeat it:

1. Measure section sizes: `grep -nE "^  [a-zA-Z]+: \{$" <file>` and diff consecutive line numbers; take the largest self-contained top-level section.
2. Move that section's body into `types-<section>.ts` as `export interface <Section>TranslationDictionarySections { ... }`.
3. In the origin file, add the import and append the new interface to the `extends` list. Locale objects (`zh-extended.ts` / `en-extended.ts`) do not change: the type is composed, the value is not.
4. Verify: `npx tsc --noEmit` (any locale key drift surfaces here) and `npx vitest run src/i18n`.

Worked example (2026-09-22): `types-extended.ts` 1621 → 1203 lines by lifting the 421-line `harness` section into `types-harness.ts` (428 lines). Zero locale edits.

### Test files (`__tests__/*.test.tsx`)

1. Map `describe` blocks: `grep -nE "^describe\(" <file>` with sizes. If one block dominates, map its `it(` cases the same way and look for a thematic run (same component, same mock shape, same feature).
2. Lift shared fixtures (board/task factories) into a small `*-fixtures.ts` next to `test-utils.ts`. Keep it free of `vitest`/`react` imports so `vi.mock` factories can also import it.
3. Each new test file re-declares its own `vi.hoisted` / `vi.mock` block. Mocks are per-module in vitest and cannot be shared through an import; copying them is correct, not duplication to eliminate.
4. Each new file imports only what its cases use. Run `tsc` after the split; it names every import you dropped that a case still needs (`Cannot find name 'afterEach'`).
5. Verify by count before running: `grep -cE "^\s*it\("` on the original at `HEAD` must equal the sum over the new files. Then run the new files together, then the whole `__tests__` directory.

Worked example (2026-09-22): `kanban-tab-detail-and-prompts.test.tsx` 2114 → 1078 lines. Moved the 4 prompt/modal cases (no fetch mock needed) to `kanban-prompts-and-modal.test.tsx` (131) and the 8 JIT-context cases to `kanban-card-detail-jit-context.test.tsx` (922); fixtures to `kanban-detail-fixtures.ts` (40). `it()` count 30 → 4 + 8 + 18 = 30; 36 files / 171 tests in the directory still pass.

Pitfalls hit in that pass, all caught by `tsc` or the vitest transform step before any test ran: off-by-one on the slice that copied the fixture object (duplicated the `const` line, lost the closing `};`), and dropping the closing `});` of the last `vi.mock` factory. Slice by asserting the exact text of the first and last line you intend to move, not by line number alone.

## Done Criteria

A refactor is done only when all are true:

1. Extracted behavior is covered by tests at the new boundary.
2. No regression in existing behavior.
3. File budget pressure is reduced (or at minimum not worsened for legacy frozen hotspots).
4. The top-level file is simpler as an orchestration shell, not just redistributed complexity.
