/**
 * Random cross-check (F3) of the `interrupted` rule against an independent
 * judge written straight from the card's rule. The judge never imports the
 * implementation; a planted bug proves the cross-check can see a difference.
 */
import { describe, expect, it } from "vitest";
import { collectTaskAttentionItems, isTaskInterrupted } from "../kanban-attention-rules";
import type { TaskInfo } from "../../types";

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

const SEED = 20261023;
const CASES = 10_000;
const NOW = Date.UTC(2026, 9, 23, 12);
const COLUMNS = ["backlog", "todo", "dev", "review", "done", "blocked"] as const;
const STATUSES: LaneSession["status"][] = ["running", "completed", "failed", "timed_out", "transitioned"];

/** mulberry32: small seeded PRNG so every run sees the same cards. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCards(seed: number, count: number): TaskInfo[] {
  const rand = prng(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const cards: TaskInfo[] = [];
  for (let i = 0; i < count; i += 1) {
    const sessions: LaneSession[] = [];
    const runs = Math.floor(rand() * 6);
    for (let j = 0; j < runs; j += 1) {
      const startedAt = NOW - Math.floor(rand() * 60 * 24 * 3600_000);
      sessions.push({
        sessionId: `c${i}-s${j}`,
        columnId: pick(COLUMNS),
        status: pick(STATUSES),
        startedAt: new Date(startedAt).toISOString(),
        ...(rand() < 0.7 ? { completedAt: new Date(startedAt + 3600_000).toISOString() } : {}),
      });
    }
    let triggerSessionId: string | undefined;
    const triggerRoll = rand();
    if (triggerRoll < 0.35 && sessions.length > 0) triggerSessionId = pick(sessions).sessionId;
    else if (triggerRoll < 0.5) triggerSessionId = `c${i}-missing`;
    cards.push({
      id: `c${i}`,
      title: `c${i}`,
      status: "PENDING",
      columnId: pick(COLUMNS),
      createdAt: new Date(NOW - 90 * 24 * 3600_000).toISOString(),
      triggerSessionId,
      laneSessions: sessions,
    } as TaskInfo);
  }
  return cards;
}

/**
 * Judge written from the card text, step by step:
 * 1. not in done / blocked;
 * 2. trigger set and found → that run; trigger set and missing → not
 *    interrupted; no trigger → newest startedAt in the current column;
 * 3. failed or timed_out → interrupted.
 * `plantBug` swaps step 2's "missing → not interrupted" for "fall back to the
 * current column's newest run".
 */
function judge(card: TaskInfo, plantBug = false): string | null {
  if (card.columnId === "done" || card.columnId === "blocked") return null;
  const runs = card.laneSessions ?? [];
  const newestInColumn = () => runs
    .filter((run) => run.columnId === card.columnId)
    .reduce<LaneSession | null>((best, run) => (!best || Date.parse(run.startedAt) > Date.parse(best.startedAt) ? run : best), null);
  let current: LaneSession | null;
  if (card.triggerSessionId) {
    current = runs.find((run) => run.sessionId === card.triggerSessionId) ?? null;
    if (!current && plantBug) current = newestInColumn();
  } else {
    current = newestInColumn();
  }
  return current && (current.status === "failed" || current.status === "timed_out") ? current.sessionId : null;
}

function implementation(card: TaskInfo): string | null {
  if (!isTaskInterrupted(card)) return null;
  const item = collectTaskAttentionItems(card, { hasMainPusher: true, now: NOW }).find((entry) => entry.kind === "interrupted");
  return item?.sessionId ?? "<interrupted without item>";
}

describe("interrupted rule: seeded random cross-check", () => {
  const cards = randomCards(SEED, CASES);

  it(`agrees with the independent judge on ${CASES} random cards (seed ${SEED})`, () => {
    const mismatches = cards.filter((card) => judge(card) !== implementation(card)).map((card) => card.id);
    expect(mismatches).toEqual([]);
    // The sample must exercise both outcomes and the missing-trigger branch.
    expect(cards.filter((card) => judge(card) !== null).length).toBeGreaterThan(500);
    expect(cards.filter((card) => card.triggerSessionId?.endsWith("-missing")).length).toBeGreaterThan(500);
  });

  it("detects a planted bug (missing trigger falls back to the current column)", () => {
    const mismatches = cards.filter((card) => judge(card, true) !== implementation(card));
    expect(mismatches.length).toBeGreaterThan(0);
  });
});
