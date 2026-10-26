// @vitest-environment node
/**
 * Card 64f2e31c (F3): random cross-check of the attention routing against an
 * oracle written from the card's table (not from the implementation).
 * 12,000 generated card states; for each the oracle decides
 *   - stays in "Needs you" (inbox),
 *   - moves to Blocked,
 *   - goes to the owner instead (3rd round of the same reason),
 * and the implementation (collectTaskAttentionItems, decideAttentionRouting,
 * countResolutionRounds) must agree on every one. A planted oracle bug
 * (waiting counted as still in the inbox) must be caught first.
 */
import { describe, expect, it } from "vitest";
import { createTask, type Task, type TaskLaneSession } from "../../models/task";
import { collectTaskAttentionItems } from "../attention-rules";
import { decideAttentionRouting, toAttentionTask } from "../attention-to-blocked";
import { countResolutionRounds } from "../auto-resolution-record";

const NOW = Date.UTC(2026, 9, 26, 12);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const STATES = 12_000;

function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type Kind = "doneFailed" | "noReport" | "unmerged" | "interrupted";
type Category = "landed" | "superseded" | "handed_off" | "waiting" | "needs_owner" | undefined;

interface Generated {
  task: Task;
  landing?: { landedOnBase: boolean | null; commitsSinceBase: number };
  hasPusher: boolean;
  column: string;
  runs: TaskLaneSession[];
  doneAgeMs: number;
  hasReport: boolean;
  category: Category;
  resolvedAtMs: number;
  roundsByReason: Record<string, number>;
}

const record = (reason: string) => [
  "## 自动处理记录", "### 卡在哪", reason, "### 判断", "x", "### 做了什么", "x", "### 结果核对", "x", "### 没做什么、为什么", "x",
].join("\n");

function generate(random: () => number, index: number): Generated {
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const column = pick(["dev", "review", "done", "blocked"] as const);
  const runCount = Math.floor(random() * 4);
  const doneAgeMs = pick([MIN, DAY, 6 * DAY, 8 * DAY, 30 * DAY]);
  const start = NOW - doneAgeMs;
  const runs: TaskLaneSession[] = [{ sessionId: `p-${index}`, columnId: "todo", status: "completed", startedAt: new Date(start - DAY).toISOString() }];
  for (let run = 0; run < runCount; run += 1) {
    const status = pick(["completed", "failed", "timed_out", "running", "transitioned"] as const);
    const reason = pick([undefined, undefined, "environment_failure", "rate_limited"] as const);
    runs.push({
      sessionId: `s-${index}-${run}`,
      columnId: column,
      status,
      startedAt: new Date(start + run * MIN).toISOString(),
      ...(reason ? { recoveryReason: reason } : {}),
      ...(reason === "rate_limited" ? { retryAfterAt: new Date(NOW + pick([-1, 1]) * 10 * MIN).toISOString() } : {}),
    });
  }
  const hasReport = random() < 0.3;
  const category = pick([undefined, undefined, undefined, "landed", "superseded", "handed_off", "waiting", "needs_owner"] as const);
  const resolvedAtMs = pick([NOW, NOW - 2 * DAY, NOW - 7 * DAY]);
  const roundsByReason: Record<string, number> = {};
  const comments: Task["comments"] = [];
  for (const reason of ["attention:doneFailed", "attention:noReport", "attention:unmerged", "attention:interrupted"]) {
    const rounds = pick([0, 0, 1, 2, 3]);
    roundsByReason[reason] = rounds;
    for (let round = 0; round < rounds; round += 1) comments.push({ id: `${reason}-${round}`, body: record(reason), createdAt: new Date(NOW).toISOString() });
  }
  if (hasReport) comments.push({ id: "report", body: "## 完成汇报\n- ok", createdAt: new Date(NOW).toISOString() });
  const landing = column === "done" ? pick([undefined, { landedOnBase: true, commitsSinceBase: 0 }, { landedOnBase: false, commitsSinceBase: 2 }, { landedOnBase: null, commitsSinceBase: 0 }]) : undefined;
  const task: Task = {
    ...createTask({ id: `c-${index}`, title: "t", objective: "o", workspaceId: "w", boardId: "b", columnId: column }),
    laneSessions: runs,
    comments,
    updatedAt: new Date(start),
    ...(category ? { attentionResolution: { category, conclusion: "c", resolvedAt: new Date(resolvedAtMs).toISOString() } } : {}),
  };
  return { task, landing, hasPusher: random() < 0.5, column, runs, doneAgeMs, hasReport, category, resolvedAtMs, roundsByReason };
}

const RESOLVED = new Set(["landed", "superseded", "handed_off", "waiting"]);
const failedStatus = (status: string) => status === "failed" || status === "timed_out";

/**
 * Where a conclusion still holds (high-risk review, 2nd rejection): landed /
 * superseded in Blocked or Done; handed_off / waiting in Blocked; needs_owner
 * in Blocked or until a lane run starts after it.
 */
function conclusionHolds(state: Generated): boolean {
  switch (state.category) {
    case "landed":
    case "superseded":
      return state.column === "blocked" || state.column === "done";
    case "handed_off":
    case "waiting":
      return state.column === "blocked";
    case "needs_owner":
      return state.column === "blocked" || state.runs.every((run) => Date.parse(run.startedAt) <= state.resolvedAtMs);
    default:
      return false;
  }
}

/** The card's table, written independently of the implementation. */
function oracle(state: Generated, resolved: Set<string> = RESOLVED) {
  const inColumn = state.runs.filter((run) => run.columnId === state.column);
  const kinds: Array<Kind | "blocked"> = [];
  if (!(state.category && resolved.has(state.category) && conclusionHolds(state))) {
    if (state.column === "blocked") kinds.push("blocked");
    else if (state.column !== "done") {
      const newest = inColumn[inColumn.length - 1];
      if (newest && failedStatus(newest.status)) kinds.push("interrupted");
    } else if (state.doneAgeMs <= 7 * DAY) {
      const last = inColumn[inColumn.length - 1];
      if (!state.hasReport && last && failedStatus(last.status)) kinds.push("doneFailed");
      else if (!state.hasReport && inColumn.length > 0 && inColumn.every((run) => run.status !== "running")) kinds.push("noReport");
      if (state.hasPusher && state.landing?.landedOnBase === false && state.landing.commitsSinceBase > 0) kinds.push("unmerged");
    }
  }
  const inInbox = kinds.length > 0;
  let action: "none" | "block" | "escalate" = "none";
  const routed = kinds.find((kind): kind is Kind => kind !== "blocked");
  if (state.column !== "blocked" && routed) {
    let retrySpent = true;
    if (routed === "interrupted") {
      const latest = inColumn[inColumn.length - 1]!;
      if (latest.recoveryReason === "rate_limited" && Date.parse(latest.retryAfterAt ?? "") > NOW) retrySpent = false;
      else if (latest.recoveryReason === "environment_failure") retrySpent = true;
      else retrySpent = inColumn.filter((run) => failedStatus(run.status)).length >= 2;
    }
    if (retrySpent) action = state.roundsByReason[`attention:${routed}`]! >= 2 ? "escalate" : "block";
  }
  return { inInbox, action, routed };
}

function board(hasPusher: boolean) {
  return {
    columns: [
      { id: "dev", name: "Dev", stage: "dev" as const, position: 0 },
      { id: "review", name: "Review", stage: "review" as const, position: 1 },
      { id: "done", name: "Done", stage: "done" as const, position: 2, automation: { enabled: true, steps: hasPusher ? [{ id: "p", specialistId: "kanban-main-pusher" }] : [] } },
      { id: "blocked", name: "Blocked", stage: "blocked" as const, position: 3 },
    ],
  };
}

function mismatches(judge: (state: Generated) => ReturnType<typeof oracle>): string[] {
  const random = prng(0x64f2e31c);
  const found: string[] = [];
  const tally: Record<string, number> = {};
  for (let index = 0; index < STATES; index += 1) {
    const state = generate(random, index);
    const expected = judge(state);
    const key = `${expected.action}:${expected.routed ?? "-"}`;
    tally[key] = (tally[key] ?? 0) + 1;
    const items = collectTaskAttentionItems(toAttentionTask(state.task, state.landing), { hasMainPusher: state.hasPusher, now: NOW });
    const decision = decideAttentionRouting(state.task, board(state.hasPusher), { now: NOW, landing: state.landing });
    const actualRounds = expected.routed ? countResolutionRounds(state.task.comments, `attention:${expected.routed}`) : 0;
    if (items.length > 0 !== expected.inInbox) found.push(`#${index} inbox ${items.length > 0} vs ${expected.inInbox}`);
    if (decision.action !== expected.action) found.push(`#${index} action ${decision.action} vs ${expected.action}`);
    if (expected.routed && actualRounds !== state.roundsByReason[`attention:${expected.routed}`]) found.push(`#${index} rounds`);
  }
  lastTally = tally;
  return found;
}

let lastTally: Record<string, number> = {};

describe("attention routing random cross-check (F3)", () => {
  it("catches a planted oracle bug (waiting counted as still in the inbox)", () => {
    const planted = new Set(["landed", "superseded", "handed_off"]);
    const found = mismatches((state) => oracle(state, planted));
    console.info(`[F3] planted bug: ${found.length} mismatches, e.g. ${found[0]}`);
    expect(found.length).toBeGreaterThan(0);
  });

  it(`agrees with the card's table on ${STATES} generated states`, () => {
    const found = mismatches((state) => oracle(state));
    console.info(`[F3] ${STATES} states, ${found.length} mismatches; cases ${JSON.stringify(lastTally)}`);
    // Every routed kind is exercised both as a move and as an escalation.
    for (const kind of ["doneFailed", "noReport", "unmerged", "interrupted"]) {
      expect(lastTally[`block:${kind}`]).toBeGreaterThan(0);
      expect(lastTally[`escalate:${kind}`]).toBeGreaterThan(0);
    }
    expect(found).toEqual([]);
  });
});
