# Entrix: Stop Classifying Explicit Check Failures as Infra UNKNOWN

## Goal

Make `entrix run` distinguish "the checker ran and said **fail**" from "the checker could not run". Today both collapse into `ResultState::Unknown`, which is excluded from scoring and — for hard gates — never blocks. A rule violation that exits non-zero is therefore invisible in the score and in `hard_gate_blocked`.

## Why This Plan Exists

Observed 2026-09-22 on `main@958ce21a`, `target/debug/entrix run --tier normal --parallel`:

- `ts_backend_core_arch_cycles` printed `"summaryStatus": "fail"`, `failedRuleCount: 1` (a real `src/core` import cycle, since fixed in `2c133d55`) and exited non-zero.
- entrix reported it as `UNKNOWN`, listed it under `INFRA ERRORS`, and the `backend_architecture` dimension scored 100 %. `FINAL SCORE: 95.0%  PASS`.

Reproduced the classification in a throwaway unit test (`cargo test -p entrix probe_real_test_failure -- --nocapture`, reverted afterwards):

```text
PROBE vitest-fail  ("Tests  3 failed | 10 passed", exit 1)          -> state=Unknown infra=true
PROBE arch-fail    ('{"summaryStatus": "fail"}', exit 1)            -> state=Unknown infra=true
PROBE cargo-fail   ("test result: FAILED. 2 passed; 1 failed", 101) -> state=Unknown infra=true
```

So this is not one misconfigured metric. **Every** `pattern`-bearing metric whose tool exits non-zero on failure — vitest, cargo test, Playwright, the arch-rule runner — is classified as infra noise when it fails. 52 of the 65 metrics in `docs/fitness/` carry a `pattern` (`rg -c '^\s+pattern:' docs/fitness/*.md docs/fitness/runtime/*.md`).

### Why nobody noticed

| Path | Verdict logic | Effect |
|---|---|---|
| `git push` → `.husky/pre-push` → `tools/hook-runtime` | `fitness.ts:64-87` `evaluateMetric`: **non-zero exit ⇒ failed**, pattern only consulted on exit 0 | Correct. This is why pre-push actually blocks on failing tests. |
| `entrix run` (manual, AGENTS.md "run before PR") | `runner.rs:179-190` + `runner/support.rs:47-55` | Non-zero + pattern miss ⇒ `Unknown` ⇒ dropped from score |
| CI `defense.yaml:256` `entrix run --tier normal --scope ci --dimension X` | same as above | Dimension jobs stay green on real failures unless the metric is a hard gate **and** happens to reach `Fail` |

The two evaluators disagree, and the one that guards the repo (hook-runtime) is not the one that produces the report people read.

### Hard gates are affected too

`scoring.rs:41-44` builds `hard_gate_failures` from `r.state == ResultState::Fail && r.hard_gate`. An `Unknown` hard gate is not a failure. `ts_test_pass_full` is `hard_gate: true`; under `entrix run` a genuinely failing vitest suite (non-zero exit, no `Tests N passed` line) would be `Unknown`, not `Fail`, so `hard_gate_blocked` stays `false`. The pre-push hook masks this locally; CI does not have that mask.

## Decision

| Option | Verdict | Reason |
|---|---|---|
| A. Delete the `pattern_exit_mismatch ⇒ infra` short-circuit entirely | Rejected | Loses the legitimate case `8631e223` was written for: `npm audit` DNS failure, missing binary (127), tool crash with no recognisable output. Those *should* stay `Unknown`. |
| B. Add an explicit `fail_pattern` per metric; match ⇒ `Fail` regardless of exit code | **Do** | Opt-in, zero behaviour change for metrics that do not declare it, and it names the failure signal in the rulebook where reviewers can see it. |
| C. Heuristic: non-zero exit **with substantive stdout** ⇒ `Fail`, non-zero **with empty/only-stderr-noise** ⇒ `Unknown` | **Do, as default when no `fail_pattern`** | Matches how hook-runtime already behaves, restores parity between the two evaluators, and covers the 52 existing metrics without editing each one. Infra signals (127, "command not found", npm-audit network needles) still win first. |
| D. Treat `Unknown` hard gates as blocking | **Do** | An unrunnable hard gate is not evidence of health. `hard_gate_blocked` must be true when a hard gate is `Unknown`; the CLI already prints the reason under `INFRA ERRORS`. |
| E. Make hook-runtime call `entrix run` instead of its own evaluator | Out of scope | Larger refactor; and hook-runtime's exit-code-first rule is the correct one — this plan moves entrix toward it, not the reverse. |

## Constraints

- `entrix` is published to crates.io (`cargo-release.yml:117`) and PyPI (`pip install entrix` in `defense.yaml:250`, `ci-red-fixer.yml:94`); the metric YAML schema is a public contract. New field must be optional; parser must ignore unknown keys as it does today.
- Existing tests in `runner/tests.rs:81-111` (`non_zero_exit_is_unknown`, `command_not_found_is_unknown`, `npm_audit_dns_failure_is_unknown`) encode the infra cases that must **keep** returning `Unknown`. `non_zero_exit_is_unknown` uses `echo 'checker crashed'; exit 1` — under Option C that output is substantive, so this test must be rewritten to assert the *intended* infra case (empty output, or output matching an infra needle) rather than deleted.
- `docs/fitness/GUIDE.md:152` and `README.md:314` document the `pattern` field; the new field and the changed default must be documented in both.
- `hook-runtime` stays untouched.

## Current Evidence (file/line map)

| Surface | Location | Current behaviour |
|---|---|---|
| Verdict | `crates/entrix/src/runner.rs:174-190` | `passed = success && pattern_matched`; else `is_infra_failure(...) ? Unknown : Fail` |
| Infra heuristic | `crates/entrix/src/runner/support.rs:47-88` | Line 53-55: `if pattern_exit_mismatch { return true; }` — fires **before** any content inspection |
| Mismatch flag | `runner.rs:185` | `!success && !pattern.is_empty() && !pattern_matched` |
| Scoring | `crates/entrix/src/scoring.rs:28-44` | `Unknown` excluded from `passed`/`total`; `hard_gate_failures` requires `state == Fail` |
| Scoring test locking exclusion | `scoring.rs:171-183` `test_score_dimension_ignores_unknown_and_skipped` | Keep — exclusion from *score* is still right; blocking is the separate fix (Option D) |
| Report | `crates/entrix/src/terminal.rs:263-272` | Prints `INFRA ERRORS: a, b, c` after the summary; does not change exit code |
| `is_infra_error` | `crates/entrix/src/model.rs:305-307` | `state == Unknown && !passed` |
| YAML parse | `crates/entrix/src/evidence.rs:174-178` | `pattern` read as optional string; add `fail_pattern` alongside |
| Metric struct | `crates/entrix/src/model.rs:165-182` | Add `pub fail_pattern: String` (empty = unset) |
| Origin | `8631e223` "fix(entrix): treat infra failures as unknown" (2026-04-14) | Introduced `is_infra_failure` and the short-circuit together |
| Rulebook consumer that motivated this | `docs/fitness/backend-architecture.md:29-33` + `scripts/fitness/check-backend-architecture.ts:50` | pattern `pass\|skipped`, script passes cargo's non-zero code through |
| Correct reference behaviour | `tools/hook-runtime/src/fitness.ts:64-87` | exit ≠ 0 ⇒ failed; pattern only on exit 0; `*_test_pass` trusts exit code |

## Design

### 1. `fail_pattern` (Option B)

```yaml
  - name: ts_backend_core_arch_cycles
    command: npm run test:arch:backend-core -- --suite cycles --json 2>&1
    pattern:      '"summaryStatus":\s*"(pass|skipped)"'
    fail_pattern: '"summaryStatus":\s*"fail"'
```

Verdict order in `runner.rs`:

```text
timed out                          → Fail (unchanged)
success && pattern ok              → Pass
fail_pattern set && matches        → Fail          ← new, wins over infra heuristic
is_infra_failure(...)              → Unknown
else                               → Fail
```

### 2. Default classification when `fail_pattern` is absent (Option C)

Replace `support.rs:53-55` with:

```rust
if pattern_exit_mismatch && output.trim().is_empty() {
    return true;   // ran, produced nothing, exited non-zero: cannot tell → infra
}
```

then the existing 127 / "command not found" / npm-audit-network checks. Result: non-zero + pattern miss + **any** output ⇒ `Fail`. This is exactly hook-runtime's rule plus the infra needles.

Rationale for "any output" rather than a smarter heuristic: every tool we run (vitest, cargo, playwright, eslint, the arch DSL runner) prints a summary on failure. A tool that dies before printing anything is the infra case. Trying to pattern-match "does this output look like a failure" is what `fail_pattern` is for.

### 3. Unknown hard gates block (Option D)

`scoring.rs:41-44`:

```rust
.filter(|r| r.hard_gate && matches!(r.state, ResultState::Fail | ResultState::Unknown))
```

`hard_gate_failures` stays a `Vec<String>` of metric names; terminal already prints `INFRA ERRORS` so the reader can see *why* the gate blocked. Score exclusion for `Unknown` is unchanged.

### Explicitly not in this plan

- Making hook-runtime delegate to entrix.
- Changing `SCORABLE_*` states (Unknown still does not count toward the percentage).
- Fixing `ts_test_coverage` (62 % vs 80 % threshold) — that is a real FAIL today and is tracked separately.
- Adding `fail_pattern` to all 52 metrics. Only `backend-architecture.md` gets it in this PR as the worked example; Option C covers the rest.

## Implementation Steps

Each step is one commit.

1. **Characterization tests first** (`runner/tests.rs`): add three tests asserting the *current* Unknown classification for vitest-fail / arch-fail / cargo-fail outputs (the probe above, made permanent, initially with `#[should_panic]`-free assertions of `Unknown`). This locks the bug before fixing it.
2. `model.rs`: `fail_pattern: String` on `Metric` (+ `Metric::new` default empty). `evidence.rs:174`: parse `fail_pattern`. Unit test on the parser.
3. `runner.rs`: `fail_pattern` branch before `is_infra_failure`. Flip the three tests from step 1 to assert `Fail` when `fail_pattern` is set; add one asserting `Fail` for a hard gate produces `hard_gate=true` in the result.
4. `runner/support.rs`: narrow the short-circuit to empty-output only. Flip the three tests to assert `Fail` **without** `fail_pattern`. Rewrite `test_run_pattern_non_zero_exit_is_unknown` to use empty output (`exit 1` with no echo) so it still asserts the infra case honestly. `command_not_found` and `npm_audit_dns` tests unchanged and still green.
5. `scoring.rs`: hard-gate filter includes `Unknown`. New test `test_score_report_unknown_hard_gate_blocks`. `test_score_dimension_ignores_unknown_and_skipped` unchanged.
6. `docs/fitness/backend-architecture.md`: add `fail_pattern` to both `ts_backend_core_arch_*` metrics. `GUIDE.md:152` / `README.md:314`: document `fail_pattern` and the new default ("non-zero exit with output is a failure; non-zero with no output is UNKNOWN").
7. `cargo build -p entrix` so `target/debug/entrix` (used by pre-push fallback and post-commit) picks up the change; re-run `--tier normal` and record the delta in this plan.

## Verification

```bash
export PATH="$HOME/.cargo/bin:$PATH"

# unit
cargo test -p entrix runner:: scoring:: evidence::

# the three real-world shapes must now be Fail, infra shapes must stay Unknown
cargo test -p entrix -- --nocapture classification

# end-to-end on the rulebook: arch_cycles must show as FAIL (not UNKNOWN) if a cycle is reintroduced
git stash -u; git revert --no-commit 2c133d55   # reintroduce the cycle
cargo build -q -p entrix && target/debug/entrix run --tier normal --dimension backend_architecture
git revert --abort; git stash pop
# expected: "[DONE] ts_backend_core_arch_cycles: FAIL", dimension score 50.0, no INFRA ERRORS line for it

# regression: a genuinely missing tool is still UNKNOWN
printf 'metrics:\n  - name: probe\n    command: definitely-not-a-real-command-xyz\n    pattern: ok\n' > /tmp/probe.yaml
# (or rely on cargo test test_run_command_not_found_is_unknown)

# parity check with pre-push evaluator: both must fail the same metric
node --import tsx tools/hook-runtime/src/cli.ts --profile pre-push --no-fail-fast
```

Acceptance: `entrix run --tier normal` on `main` after this change shows **no** metric under `INFRA ERRORS` that has non-empty output containing a failure summary; `ts_test_coverage` remains `FAIL` (unchanged); final score reflects the real pass count.

## Risks

- **Score drops after upgrade.** Metrics that were silently `Unknown` will start counting as `Fail`. On `main@2c133d55` the only known candidate is none (the cycle is fixed), but any repo consuming the published `entrix` will see lower scores on the first run. Mitigation: call it out in the release notes as a correctness fix; `--min-score` remains the operator's knob.
- **Hard gate `Unknown` blocking CI on transient infra.** `npm_audit_critical` is `hard_gate: true`; a DNS blip in CI now blocks instead of passing. That is the intended trade — an unverified security gate should not report green — but it will surface as a new kind of red. `ci-red-fixer.yml` already exists for this class.
- **Stderr-only noise counted as "output".** Some tools print deprecation warnings to stderr and nothing to stdout before dying. Under Option C that is non-empty output ⇒ `Fail`, which is correct (the tool did run) but the excerpt shown may be unhelpful. `fail_pattern` is the escape hatch; terminal already prints the tail of output for `Fail`.
- **Published schema drift.** Older `entrix` binaries ignore `fail_pattern` (unknown keys are dropped at `evidence.rs`), so a rulebook with the new field still loads on old binaries — they just keep the old behaviour.

## Related

- `docs/exec-plans/active/kanban-done-merge-visibility.md` — the run that surfaced this.
- `8631e223` — the commit that introduced the short-circuit.
- Key memory 2026-09-22 "entrix 结果解读要看 state 不只看分数".
