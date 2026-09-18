---
title: "entrix npm_audit_critical hard gate fails on Next.js unauthenticated RCE advisory"
date: "2026-09-18"
kind: issue
status: open
severity: critical
area: "dependencies"
tags: ["npm-audit", "nextjs", "entrix", "security"]
reported_by: "agent"
related_issues: []
github_issue: null
github_state: null
github_url: null
---

# entrix npm_audit_critical hard gate fails on Next.js unauthenticated RCE advisory

## What Happened

Running `./target/debug/entrix run --tier fast` on `main` (local, 1 commit ahead of
`origin/main`) fails the `npm_audit_critical` hard gate. `npm audit` reports a
critical advisory against the installed `next` version range plus several
high/moderate advisories in unrelated packages pulled in transitively.

## Expected Behavior

`npm audit --audit-level=critical` (or equivalent, as run by
`docs/fitness/security.md`'s `npm_audit_critical` check) reports zero critical
findings so the entrix fast-tier hard gate passes.

## Reproduction Context

- Environment: local dev checkout, branch `main`
- Command: `./target/debug/entrix run --tier fast`
- Observed: `SECURITY` dimension scores 0%, `npm_audit_critical: FAIL [HARD GATE]`

## Findings (from `npm audit` output captured during the run)

- **Critical**: `next` 9.5.6-canary.0 - 10.0.7 || 14.3.0-canary.0 - 15.5.23 ||
  15.6.0-canary.0 - 16.3.2 — "Next.js: Unauthenticated Remote Code Execution on
  windows-hosted servers" (GHSA-p293-qw3h-jr36), plus a related AVIF Image
  Optimization RCE advisory (GHSA-2xp9-vwfh-vxw4) that depends on vulnerable
  `sharp`.
- **High**: `@ai-sdk/provider-utils` 4.0.0-beta.10 - 4.0.32 (Uncontrolled Resource
  Consumption, GHSA-866g-f22w-33x8), pulled in via `@ai-sdk/anthropic`,
  `@ai-sdk/gateway`, `@ai-sdk/openai`, and `ai`.
- **High**: `@tiptap/core` <=3.30.4.
- **High**: `sharp` <0.35.4 (libheif issues, GHSA-g89c-p67h-r497 /
  GHSA-2jg2-4ch7-h545).
- **High**: `smol-toml` <=1.7.0 (DoS via malformed TOML, GHSA-7w5x-hrqm-74c2).
- **Moderate**: `qs` 2.2.5 - 6.15.3 (array-limit bypass GHSA-x5fp-wj9c-mxmx;
  isBuffer DoS GHSA-4mjr-xmp4-gh2g).
- **Moderate/Low**: `nanoid` (zero-size generator loop, GHSA-2v37-7h3g-55p8) and
  others.
- Total per `npm audit`: 20 vulnerabilities (5 low, 7 moderate, 7 high, 1
  critical). `npm audit fix` reports fixes available for most.

## Why This Matters / Risk Notes

- Production (`routa-prod`, pm2, port 3000) currently runs `next@16.2.3` per
  project memory. The critical advisory's affected range (`16.3.2` and below in
  the `16.x` line) needs to be checked precisely against the locked version.
- Project memory also records that `node_modules` previously broke from an
  interrupted install (missing `@next/swc-darwin-arm64` / `better-sqlite3`
  native binding). A blind `npm audit fix` or major-version bump risks
  repeating that breakage and could affect the running production service.
- This gate failure is unrelated to and predates the current uncommitted diff
  (DSH provider tier resolution, dev-executor tier tuning, agent-trigger
  prompt schema docs); it was intentionally NOT bundled into that commit set
  per user decision on 2026-09-18.

## Verification Plan (for whoever picks this up)

1. Confirm exact locked `next` version in `package-lock.json` and whether it
   falls inside the vulnerable range for GHSA-p293-qw3h-jr36.
2. Evaluate `npm audit fix` (non-force) first; check for remaining criticals.
3. If a major bump is required (e.g. `next`, `sharp`), do it on a throwaway
   branch, run `npm run build` / relevant Playwright and vitest suites, and
   only then restart `routa-prod` via `pm2 restart routa-prod` after a
   successful `next build`.
4. Re-run `entrix run --dry-run` and `entrix run --tier fast` until
   `npm_audit_critical` and the overall SECURITY dimension pass.

## Resolution

_Not yet resolved — tracked for follow-up._
