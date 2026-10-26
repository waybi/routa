// @vitest-environment node
/**
 * Card 14de4800 F3: random cross-check of the startup resume decision
 * (decideInterruptedLaneResume) against a judge written from the requirement,
 * not from the implementation:
 *
 *   resume ⇔ latest record is in the card's column ∧ status ∈ {failed, timed_out}
 *          ∧ reason ∈ {turn_cancelled, restart_interrupted}
 *          ∧ < 5 retryable failures in a row in this column (fuse)
 *          ∧ < 3 non-Dev budget runs in this column (revive's repeat limit)
 *          ∧ no step of the column running ∧ no other live session assigned
 *          ∧ retryAfterAt absent or passed ∧ (Done: last step not completed)
 *   and then it re-runs the latest record's step.
 *
 * A planted judge error (watchdog_inactivity resumable) must be caught first.
 */
import { describe, expect, it } from "vitest";

import { createKanbanBoard, type KanbanColumn } from "../../models/kanban";
import type { TaskLaneSession, TaskLaneSessionRecoveryReason } from "../../models/task";
import { decideInterruptedLaneResume } from "../interrupted-lane-resume";

const STEP_COUNT: Record<string, number> = { todo: 2, dev: 1, review: 3, done: 2 };
const COLUMNS: KanbanColumn[] = createKanbanBoard({
  id: "b",
  workspaceId: "w",
  name: "b",
  columns: [
    { id: "backlog", name: "backlog", position: 0, stage: "backlog" },
    ...(["todo", "dev", "review", "done"] as const).map((id, index) => ({
      id,
      name: id,
      position: index + 1,
      stage: id,
      automation: {
        enabled: true,
        transitionType: "entry" as const,
        steps: Array.from({ length: STEP_COUNT[id] }, (_, step) => ({ id: `${id}-${step}`, providerId: "dsh", role: "CRAFTER" as const })),
      },
    })),
  ],
}).columns;

const STATUSES: TaskLaneSession["status"][] = ["running", "completed", "failed", "timed_out", "transitioned"];
const REASONS: Array<TaskLaneSessionRecoveryReason | undefined> = [
  undefined, "watchdog_inactivity", "agent_failed", "completion_criteria_not_met", "environment_failure",
  "turn_cancelled", "user_cancelled", "restart_interrupted", "rate_limited",
];
const NOW = new Date("2026-10-26T18:00:00.000Z");

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

interface Case {
  columnId: string;
  laneSessions: TaskLaneSession[];
  triggerSessionId?: string;
}

function generate(random: () => number, index: number): Case {
  const columnId = pick(random, ["backlog", "todo", "dev", "review", "done"]);
  const laneSessions: TaskLaneSession[] = [];
  const count = Math.floor(random() * 8);
  for (let n = 0; n < count; n += 1) {
    const recordColumn = random() < 0.8 ? columnId : pick(random, ["todo", "dev", "review", "done"]);
    const steps = STEP_COUNT[recordColumn] ?? 1;
    const status = random() < 0.5 ? pick(random, ["failed", "timed_out"] as const) : pick(random, STATUSES);
    const reason = random() < 0.4 ? pick(random, ["turn_cancelled", "restart_interrupted", "rate_limited"] as const) : pick(random, REASONS);
    const retry = pick(random, ["none", "past", "future"] as const);
    laneSessions.push({
      sessionId: `c${index}-s${n}`,
      columnId: recordColumn,
      stepIndex: Math.floor(random() * steps),
      status,
      recoveryReason: reason,
      retryAfterAt: retry === "none" ? undefined : new Date(NOW.getTime() + (retry === "past" ? -60_000 : 60_000)).toISOString(),
      startedAt: NOW.toISOString(),
    });
  }
  const trigger = pick(random, ["none", "latest", "other"] as const);
  return {
    columnId,
    laneSessions,
    triggerSessionId: trigger === "none" ? undefined : trigger === "latest" ? laneSessions.at(-1)?.sessionId : `live-${index}`,
  };
}

type Verdict = { resume: false } | { resume: true; stepIndex: number };

/** The judge: written from the requirement (see the header). */
function judge(c: Case, planted = false): Verdict {
  const no: Verdict = { resume: false };
  if (!STEP_COUNT[c.columnId]) return no;
  const latest = c.laneSessions.at(-1);
  if (!latest || latest.columnId !== c.columnId) return no;
  if (c.triggerSessionId && c.triggerSessionId !== latest.sessionId) return no;
  if (c.laneSessions.some((entry) => entry.columnId === c.columnId && entry.status === "running")) return no;
  const interrupted = ["turn_cancelled", "restart_interrupted", ...(planted ? ["watchdog_inactivity"] : [])];
  if (!["failed", "timed_out"].includes(latest.status) || !interrupted.includes(latest.recoveryReason ?? "")) return no;

  // Trailing stay in this column, newest first.
  const stay: TaskLaneSession[] = [];
  for (let index = c.laneSessions.length - 1; index >= 0 && c.laneSessions[index].columnId === c.columnId; index -= 1) {
    stay.push(c.laneSessions[index]);
  }
  let streak = 0;
  for (const entry of stay) {
    if (entry.status === "running") continue;
    const retryable = ["rate_limited", "turn_cancelled", "restart_interrupted"].includes(entry.recoveryReason ?? "")
      && ["failed", "timed_out"].includes(entry.status);
    if (!retryable) break;
    streak += 1;
  }
  if (streak >= 5) return no;
  if (c.columnId !== "dev") {
    const budgetRuns = stay.filter((entry) => {
      const exempt = entry.recoveryReason === "environment_failure"
        || entry.recoveryReason === "user_cancelled"
        || (["rate_limited", "turn_cancelled", "restart_interrupted"].includes(entry.recoveryReason ?? "")
          && ["failed", "timed_out"].includes(entry.status));
      return !exempt;
    }).length;
    if (budgetRuns >= 3) return no;
  }
  if (c.columnId === "done" && stay.some((entry) => (
    (entry.status === "completed" || entry.status === "transitioned") && entry.stepIndex === STEP_COUNT.done - 1
  ))) return no;
  if (latest.retryAfterAt && Date.parse(latest.retryAfterAt) > NOW.getTime()) return no;
  return { resume: true, stepIndex: latest.stepIndex! };
}

function actual(c: Case): Verdict {
  const decision = decideInterruptedLaneResume({ columnId: c.columnId, laneSessions: c.laneSessions, triggerSessionId: c.triggerSessionId }, COLUMNS, NOW);
  return decision.kind === "resume" ? { resume: true, stepIndex: decision.stepIndex } : { resume: false };
}

function crossCheck(planted: boolean, total = 10_000): { mismatches: number; resumes: number; first?: Case } {
  const random = rng(14_000_480);
  let mismatches = 0;
  let resumes = 0;
  let first: Case | undefined;
  for (let index = 0; index < total; index += 1) {
    const c = generate(random, index);
    const expected = judge(c, planted);
    if (expected.resume) resumes += 1;
    if (JSON.stringify(expected) !== JSON.stringify(actual(c))) {
      mismatches += 1;
      first ??= c;
    }
  }
  return { mismatches, resumes, first };
}

describe("F3: startup resume decision, 10,000 random card states", () => {
  it("the planted judge error (watchdog_inactivity resumable) is caught", () => {
    expect(crossCheck(true).mismatches).toBeGreaterThan(0);
  });

  it("0 mismatches against the requirement judge", () => {
    const result = crossCheck(false);
    console.log(`[F3] 10000 states, judge resumes ${result.resumes}, mismatches ${result.mismatches}`);
    expect(result.first).toBeUndefined();
    expect(result.mismatches).toBe(0);
    expect(result.resumes).toBeGreaterThan(200);
  });
});
