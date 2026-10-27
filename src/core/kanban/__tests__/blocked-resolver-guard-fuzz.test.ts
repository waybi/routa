// @vitest-environment node
/**
 * Card 59f5b059 (F3): random cross-check of the Blocked resolver gate against
 * an oracle written from the card's rules (not from the implementation):
 * session count rule, the larger of comments and sessions ≥ 2, the three
 * patch-card rules and the push-conflict evidence rule. Each generated case
 * records what it contains while it is built; the oracle only reads those
 * facts. A planted oracle bug (rate_limited placeholders counted) must be
 * caught first.
 */
import { describe, expect, it } from "vitest";
import type { KanbanColumn } from "../../models/kanban";
import type { TaskCommentEntry, TaskLaneSession } from "../../models/task";
import { shouldEscalateToOwner } from "../auto-resolution-record";
import { evaluateBlockedResolverGuard } from "../blocked-resolver-guard";

const CASES = 12_000;
const SEED = 0x59f5b059;
const REASONS = ["attention:push_conflict", "attention:doneFailed", "attention:review_failed", "attention:blocked"] as const;
const BOARD = {
  columns: [
    { id: "dev", name: "Dev", stage: "dev", position: 0 },
    { id: "done", name: "Done", stage: "done", position: 1 },
    { id: "blocked", name: "Blocked", stage: "blocked", position: 2 },
  ] as KanbanColumn[],
};

function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

interface SessionFact {
  column: "dev" | "done" | "blocked";
  resolver: boolean;
  pusher: boolean;
  placeholder?: "rate_limited" | "environment_failure";
  failed: boolean;
  reason?: string;
}

interface Case {
  task: {
    id: string; title: string; objective: string; columnId: string; lastSyncError?: string;
    laneSessions: TaskLaneSession[]; comments: TaskCommentEntry[];
  };
  specialistId: string;
  facts: {
    inBlocked: boolean;
    resolverStart: boolean;
    prefixReason?: string;
    sessions: SessionFact[];
    recordReasons: string[];
    patchByObjective: boolean;
    patchByTitleWord: boolean;
    patchByTitleStart: boolean;
    conflictCommentLinked: boolean;
  };
}

function record(reason: string): string {
  return ["## 自动处理记录", "### 卡在哪", `${reason}；原文`, "### 判断", "j", "### 做了什么", "a", "### 结果核对", "c", "### 没做什么、为什么", "n"].join("\n");
}

function generate(random: () => number, index: number): Case {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const base = Date.UTC(2026, 9, 27);
  const sessions: SessionFact[] = [];
  const laneSessions: TaskLaneSession[] = [];
  const count = Math.floor(random() * 6);
  for (let n = 0; n < count; n += 1) {
    const column = pick(["dev", "done", "blocked", "blocked"] as const);
    const resolver = column === "blocked" && random() < 0.75;
    const pusher = column === "done" && random() < 0.7;
    const placeholder = random() < 0.15 ? pick(["rate_limited", "environment_failure"] as const) : undefined;
    const failed = random() < 0.35;
    const reason = random() < 0.65 ? pick(REASONS) : undefined;
    sessions.push({ column, resolver, pusher, placeholder, failed, reason });
    const idPrefix = placeholder === "rate_limited" ? "rate-limited-" : placeholder === "environment_failure" ? "environment-failure-" : "s-";
    laneSessions.push({
      sessionId: `${idPrefix}${index}-${n}`,
      columnId: column,
      specialistId: resolver ? "kanban-blocked-resolver" : pusher ? "kanban-main-pusher" : pick(["kanban-dev-crafter", "kanban-done-reporter"]),
      ...(placeholder ? { recoveryReason: placeholder } : {}),
      ...(reason ? { attentionReason: reason } : {}),
      status: failed ? pick(["failed", "timed_out"] as const) : pick(["completed", "transitioned"] as const),
      startedAt: new Date(base + n * 60_000).toISOString(),
    });
  }
  const recordReasons = Array.from({ length: Math.floor(random() * 3) }, () => pick(REASONS));
  const comments: TaskCommentEntry[] = recordReasons.map((reason, n) => ({ id: `r${n}`, body: record(reason), createdAt: new Date(base - 60_000).toISOString() }));
  // A conflict comment: linked to the last non-Blocked session, or written before every session (never evidence).
  const lastOutside = [...laneSessions].reverse().find((session) => session.columnId !== "blocked");
  let conflictCommentLinked = false;
  if (random() < 0.3) {
    conflictCommentLinked = Boolean(lastOutside) && random() < 0.6;
    comments.push({
      id: "conflict",
      body: pick(["rebase 冲突：src/a.ts", "CONFLICT (content): merge conflict"]),
      createdAt: new Date(base - 120_000).toISOString(),
      ...(conflictCommentLinked ? { sessionId: lastOutside!.sessionId } : {}),
    });
  }
  const objectiveKind = pick(["hex", "bare", "nonhex", "plain"] as const);
  const objective = { hex: "git cherry-pick 9fa3b1c0 后推送", bare: "跑 git cherry-pick", nonhex: "git cherry-pick zz12345", plain: "实现功能" }[objectiveKind];
  const titleKind = pick(["word", "start", "middle", "plain"] as const);
  const title = { word: "原卡的补丁卡", start: "补丁：重推", middle: "修复打补丁流程", plain: "普通卡" }[titleKind];
  const prefixReason = random() < 0.5 ? pick(REASONS) : undefined;
  const lastSyncError = prefixReason ? `${prefixReason} — 原文` : pick([undefined, "随便的错误", "attention: 空"]);
  const inBlocked = random() < 0.85;
  const resolverStart = random() < 0.85;
  return {
    task: { id: `c${index}`, title, objective, columnId: inBlocked ? "blocked" : "dev", lastSyncError, laneSessions, comments },
    specialistId: resolverStart ? "kanban-blocked-resolver" : "kanban-pr-publisher",
    facts: {
      inBlocked,
      resolverStart,
      prefixReason,
      sessions,
      recordReasons,
      patchByObjective: objectiveKind === "hex",
      patchByTitleWord: titleKind === "word",
      patchByTitleStart: titleKind === "start",
      conflictCommentLinked,
    },
  };
}

type Expected = { gate: "none" | "rounds" | "patch-chain"; escalate: boolean; reason?: string };

function oracle(facts: Case["facts"], countPlaceholders = false): Expected {
  if (!facts.inBlocked || !facts.resolverStart) return { gate: "none", escalate: false };
  const reason = facts.prefixReason
    ?? [...facts.sessions].reverse().find((session) => session.column === "blocked" && session.reason)?.reason
    ?? "attention:blocked";
  const sessionRounds = facts.sessions.filter((session) =>
    session.column === "blocked" && session.resolver
    && (countPlaceholders || !session.placeholder)
    && (session.reason ?? "attention:blocked") === reason).length;
  const commentRounds = facts.recordReasons.filter((entry) => entry === reason).length;
  const escalate = Math.max(sessionRounds, commentRounds) >= 2;
  const patch = facts.patchByObjective || facts.patchByTitleWord || facts.patchByTitleStart;
  const lastOutside = [...facts.sessions].reverse().find((session) => session.column !== "blocked");
  const conflict = Boolean(lastOutside && lastOutside.column === "done" && lastOutside.pusher
    && (lastOutside.failed || facts.conflictCommentLinked));
  if (patch && conflict) return { gate: "patch-chain", escalate, reason };
  return { gate: escalate ? "rounds" : "none", escalate, reason };
}

let lastTally: Record<string, number> = {};

function mismatches(countPlaceholders: boolean): string[] {
  const random = prng(SEED);
  const found: string[] = [];
  const tally: Record<string, number> = {};
  for (let index = 0; index < CASES; index += 1) {
    const generated = generate(random, index);
    const expected = oracle(generated.facts, countPlaceholders);
    tally[expected.gate] = (tally[expected.gate] ?? 0) + 1;
    const actual = evaluateBlockedResolverGuard({ task: generated.task, board: BOARD, specialistId: generated.specialistId });
    if (actual.gate !== expected.gate) found.push(`#${index} gate ${actual.gate} vs ${expected.gate}`);
    if (actual.gate !== "none" && actual.reason !== expected.reason) found.push(`#${index} reason ${actual.reason} vs ${expected.reason}`);
    if (expected.reason) {
      const sessionRounds = generated.facts.sessions.filter((session) => session.column === "blocked" && session.resolver
        && (countPlaceholders || !session.placeholder) && (session.reason ?? "attention:blocked") === expected.reason).length;
      if (shouldEscalateToOwner(generated.task.comments, expected.reason, sessionRounds) !== expected.escalate) {
        found.push(`#${index} shouldEscalateToOwner`);
      }
    }
  }
  lastTally = tally;
  return found;
}

describe("Blocked resolver gate random cross-check (F3)", () => {
  it("catches a planted oracle bug (rate_limited / environment_failure placeholders counted)", () => {
    const found = mismatches(true);
    console.info(`[F3] seed ${SEED.toString(16)}, planted bug: ${found.length} mismatches, e.g. ${found[0]}`);
    expect(found.length).toBeGreaterThan(0);
  });

  it(`agrees with the card's rules on ${CASES} generated cases`, () => {
    const found = mismatches(false);
    console.info(`[F3] seed ${SEED.toString(16)}, ${CASES} cases, ${found.length} mismatches; gates ${JSON.stringify(lastTally)}`);
    expect(lastTally.none).toBeGreaterThan(0);
    expect(lastTally.rounds).toBeGreaterThan(0);
    expect(lastTally["patch-chain"]).toBeGreaterThan(0);
    expect(found).toEqual([]);
  });
});
