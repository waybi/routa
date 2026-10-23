import { describe, expect, it } from "vitest";

import { matchesSessionQuery } from "../../sessions-overview";
import {
  countActiveSessionsBySpecialist,
  countRunFilters,
  matchesRunFilter,
  memberSpecialistsOfRun,
  recentRunsForSpecialist,
  runFilterBucket,
  sortTeamRuns,
  type RunFilter,
} from "../team-page-model";

/**
 * F3 random cross-check for the team page v2 helpers. The judge below is
 * written from the card ("口径收紧" 3 and 4, AC3, AC5) and imports nothing
 * from the code under test. TEAM_V2_F3_PLANT=1 plants a judge bug
 * (timed_out counted as ended) to prove the check can see a difference.
 */
const SEED = 20261024;
const SAMPLES = 10_000;
const PLANT = process.env.TEAM_V2_F3_PLANT === "1";

function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RandSession {
  sessionId: string;
  workspaceId: string;
  cwd: string;
  name?: string;
  createdAt: string;
  terminalState?: string;
  acpStatus?: string;
  parentSessionId?: string;
  specialistId?: string;
}

// ---- judge, from the requirement text ----

function judgeBucket(s: RandSession): "active" | "ended" | "error" | null {
  // Terminal state wins: failed / timed_out → error, completed → ended, other terminal values → none.
  if (s.terminalState) {
    if (s.terminalState === "failed") return "error";
    if (s.terminalState === "timed_out") return PLANT ? "ended" : "error";
    if (s.terminalState === "completed") return "ended";
    return null;
  }
  if (s.acpStatus === "error") return "error";
  if (s.acpStatus === "connecting" || s.acpStatus === "ready") return "active";
  return null;
}

function judgeActiveCounts(sessions: RandSession[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of sessions) {
    if (!s.specialistId) continue;
    if (s.acpStatus !== "connecting" && s.acpStatus !== "ready") continue;
    out[s.specialistId] = (out[s.specialistId] ?? 0) + 1;
  }
  return out;
}

function judgeRecent(sessions: RandSession[], specialistId: string): string[] {
  const mine = sessions.filter((s) => s.specialistId === specialistId);
  // Newest first; equal times by session id ascending (insertion sort, no shared helper).
  const ordered: RandSession[] = [];
  for (const s of mine) {
    let i = 0;
    while (i < ordered.length) {
      const a = Date.parse(s.createdAt);
      const b = Date.parse(ordered[i].createdAt);
      if (a > b || (a === b && s.sessionId < ordered[i].sessionId)) break;
      i += 1;
    }
    ordered.splice(i, 0, s);
  }
  const targets: string[] = [];
  for (const s of ordered) {
    const target = s.parentSessionId || s.sessionId;
    if (!targets.includes(target)) targets.push(target);
    if (targets.length === 5) break;
  }
  return targets;
}

function judgeMembers(runId: string, sessions: RandSession[]): string[] {
  const out: string[] = [];
  for (const s of sessions) if (s.parentSessionId === runId && s.specialistId && !out.includes(s.specialistId)) out.push(s.specialistId);
  return out;
}

function judgeVisible(runs: RandSession[], filter: RunFilter, query: string, direction: "asc" | "desc", fallback: string): string[] {
  const needle = query.trim().toLowerCase();
  const kept = runs.filter((r) => (filter === "all" || judgeBucket(r) === filter)
    && (!needle || (r.name || fallback).toLowerCase().includes(needle) || r.sessionId.toLowerCase().startsWith(needle)));
  return kept
    .map((r, index) => ({ r, index }))
    .sort((a, b) => {
      const diff = Date.parse(a.r.createdAt) - Date.parse(b.r.createdAt);
      if (diff !== 0) return direction === "desc" ? -diff : diff;
      return a.r.sessionId < b.r.sessionId ? -1 : a.r.sessionId > b.r.sessionId ? 1 : 0;
    })
    .map(({ r }) => r.sessionId);
}

// ---- generator ----

const TERMINALS = ["completed", "failed", "timed_out", undefined, "aborted"];
const ACP = ["connecting", "ready", "error", "idle", undefined];
const SPECIALISTS = ["team-frontend-dev", "team-qa", "team-backend-dev", undefined];

function sample(rand: () => number, index: number) {
  const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const runCount = Math.floor(rand() * 9);
  const runs: RandSession[] = Array.from({ length: runCount }, (_, i) => ({
    sessionId: `run${index}-${i}`,
    workspaceId: "w",
    cwd: "",
    name: rand() < 0.15 ? undefined : `${pick(["alpha", "beta", "Gamma"])} ${i}`,
    createdAt: `2026-10-0${1 + Math.floor(rand() * 4)}T00:00:00.000Z`,
    terminalState: pick(TERMINALS),
    acpStatus: pick(ACP),
  }));
  const sessionCount = Math.floor(rand() * 13);
  const sessions: RandSession[] = Array.from({ length: sessionCount }, (_, i) => ({
    sessionId: `s${index}-${i}`,
    workspaceId: "w",
    cwd: "",
    createdAt: `2026-10-0${1 + Math.floor(rand() * 4)}T0${Math.floor(rand() * 3)}:00:00.000Z`,
    acpStatus: pick(ACP),
    specialistId: pick(SPECIALISTS),
    parentSessionId: runs.length > 0 && rand() < 0.6 ? pick(runs).sessionId : undefined,
  }));
  const filter = pick(["all", "active", "ended", "error"] as const);
  const query = rand() < 0.5 ? "" : pick(["a", "ta", "run", `run${index}-1`, "zzz", " beta "]);
  const direction = rand() < 0.5 ? "asc" as const : "desc" as const;
  return { runs, sessions, filter, query, direction };
}

describe(`F3 team page v2 random cross-check (seed ${SEED})`, () => {
  it("filter buckets, counts, live members, recent runs, run members and filter+search agree with the judge on 10,000 samples", () => {
    const rand = prng(SEED);
    let mismatches = 0;
    let firstMismatch = "";
    const note = (sampleIndex: number, what: string, actual: unknown, expected: unknown) => {
      if (JSON.stringify(actual) === JSON.stringify(expected)) return;
      mismatches += 1;
      if (!firstMismatch) firstMismatch = `sample ${sampleIndex} ${what}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`;
    };
    for (let i = 0; i < SAMPLES; i += 1) {
      const { runs, sessions, filter, query, direction } = sample(rand, i);
      note(i, "bucket", runs.map((r) => runFilterBucket(r)), runs.map(judgeBucket));
      const expectedCounts = { all: runs.length, active: 0, ended: 0, error: 0 };
      for (const r of runs) { const b = judgeBucket(r); if (b) expectedCounts[b] += 1; }
      note(i, "counts", countRunFilters(runs), expectedCounts);
      note(i, "live", Object.fromEntries([...countActiveSessionsBySpecialist(sessions).entries()].sort()), Object.fromEntries(Object.entries(judgeActiveCounts(sessions)).sort()));
      for (const id of ["team-frontend-dev", "team-qa", "team-backend-dev"]) {
        note(i, `recent ${id}`, recentRunsForSpecialist(sessions, id).map((r) => r.targetId), judgeRecent(sessions, id));
      }
      for (const r of runs) note(i, `members ${r.sessionId}`, memberSpecialistsOfRun(r.sessionId, sessions), judgeMembers(r.sessionId, sessions));
      const visible = sortTeamRuns(runs.filter((r) => matchesRunFilter(r, filter) && matchesSessionQuery(r as never, query, "Unnamed")), direction).map((r) => r.sessionId);
      note(i, `visible ${filter} ${JSON.stringify(query)} ${direction}`, visible, judgeVisible(runs, filter, query, direction, "Unnamed"));
    }
    console.info(`[team-v2-f3] seed=${SEED} samples=${SAMPLES} plant=${PLANT ? 1 : 0} mismatches=${mismatches}`);
    expect(mismatches, firstMismatch).toBe(0);
  });
});
