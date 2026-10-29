// @vitest-environment node
/**
 * Card dd65b565 (retro L279): TaskStore.save merges lane records instead of
 * letting an older card copy overwrite them. Contract C1 (rule table) and F3
 * (10,000 seeded random pairs checked against an independently written judge).
 */
import { describe, expect, it } from "vitest";
import type { TaskLaneSession, TaskLaneSessionStatus } from "@/core/models/task";
import { mergeLaneRecords } from "../lane-session-merge";

const STATUSES: TaskLaneSessionStatus[] = ["running", "completed", "failed", "timed_out", "transitioned"];
const ENDED = STATUSES.filter((status) => status !== "running");

function rec(sessionId: string, status: TaskLaneSessionStatus, extra: Partial<TaskLaneSession> = {}): TaskLaneSession {
  return { sessionId, status, startedAt: "2026-10-29T01:00:00.000Z", ...extra };
}

describe("mergeLaneRecords rule table (C1)", () => {
  for (const ended of ENDED) {
    it(`running in stored + ${ended} in incoming → ${ended}`, () => {
      const merged = mergeLaneRecords(
        { laneSessions: [rec("a", "running", { columnId: "done" })] },
        { laneSessions: [rec("a", ended, { completedAt: "2026-10-29T02:00:00.000Z" })] },
      );
      expect(merged.laneSessions).toEqual([
        rec("a", ended, { completedAt: "2026-10-29T02:00:00.000Z", columnId: "done" }),
      ]);
    });

    it(`${ended} in stored + running in incoming → ${ended} (an older copy cannot reopen a record)`, () => {
      const merged = mergeLaneRecords(
        { laneSessions: [rec("a", ended, { completedAt: "2026-10-29T02:00:00.000Z", recoveryReason: "turn_cancelled" })] },
        { laneSessions: [rec("a", "running", { columnId: "done", stepIndex: 0 })] },
      );
      expect(merged.laneSessions).toEqual([
        rec("a", ended, {
          completedAt: "2026-10-29T02:00:00.000Z",
          recoveryReason: "turn_cancelled",
          columnId: "done",
          stepIndex: 0,
        }),
      ]);
    });
  }

  it("two ended records take incoming", () => {
    const merged = mergeLaneRecords(
      { laneSessions: [rec("a", "failed", { recoveryReason: "turn_cancelled" })] },
      { laneSessions: [rec("a", "completed")] },
    );
    expect(merged.laneSessions[0].status).toBe("completed");
  });

  it("fills columnId/stepIndex/specialistId/stepId that incoming lacks from stored", () => {
    const merged = mergeLaneRecords(
      { laneSessions: [rec("a", "running", { columnId: "done", stepIndex: 0, specialistId: "kanban-main-pusher", stepId: "p" })] },
      { laneSessions: [rec("a", "failed", { recoveryReason: "turn_cancelled" })] },
    );
    expect(merged.laneSessions).toEqual([
      rec("a", "failed", { recoveryReason: "turn_cancelled", columnId: "done", stepIndex: 0, specialistId: "kanban-main-pusher", stepId: "p" }),
    ]);
  });

  it("keeps records only stored has; incoming order first", () => {
    const merged = mergeLaneRecords(
      { laneSessions: [rec("old", "completed"), rec("done-1", "running", { columnId: "done" })] },
      { laneSessions: [rec("old", "completed"), rec("new", "running")] },
    );
    expect(merged.laneSessions.map((entry) => entry.sessionId)).toEqual(["old", "new", "done-1"]);
  });

  it("sessionIds: union, incoming order then stored extras", () => {
    expect(mergeLaneRecords({ sessionIds: ["x", "d"] }, { sessionIds: ["x", "y"] }).sessionIds).toEqual(["x", "y", "d"]);
    expect(mergeLaneRecords(undefined, { sessionIds: ["x"] }).sessionIds).toEqual(["x"]);
    expect(mergeLaneRecords({ sessionIds: ["x"] }, {}).sessionIds).toEqual(["x"]);
  });
});

// ---------- F3: seeded random cross-check against an independent judge ----------

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OPTIONAL_KEYS = ["columnId", "stepId", "stepIndex", "specialistId", "specialistName", "recoveryReason"] as const;

function randomRecord(rand: () => number, sessionId: string): TaskLaneSession {
  const record: TaskLaneSession = {
    sessionId,
    status: STATUSES[Math.floor(rand() * STATUSES.length)],
    startedAt: `2026-10-29T0${Math.floor(rand() * 9)}:00:00.000Z`,
  };
  const target = record as unknown as Record<string, unknown>;
  for (const key of OPTIONAL_KEYS) {
    if (rand() < 0.5) target[key] = key === "stepIndex" ? Math.floor(rand() * 3) : `${key}-${Math.floor(rand() * 4)}`;
  }
  return record;
}

function randomSide(rand: () => number, pool: string[]): { sessionIds: string[]; laneSessions: TaskLaneSession[] } {
  const ids = pool.filter(() => rand() < 0.55).sort(() => rand() - 0.5);
  const laneIds = pool.filter(() => rand() < 0.55).sort(() => rand() - 0.5);
  return { sessionIds: ids, laneSessions: laneIds.map((id) => randomRecord(rand, id)) };
}

/** Judge written from the card's rule text, not from the implementation. */
function judge(
  stored: ReturnType<typeof randomSide>,
  incoming: ReturnType<typeof randomSide>,
  plantBug = false,
): ReturnType<typeof randomSide> {
  const sessionIds = incoming.sessionIds.concat(stored.sessionIds.filter((id) => !incoming.sessionIds.includes(id)));
  const out: TaskLaneSession[] = [];
  const storedMap = new Map(stored.laneSessions.map((entry) => [entry.sessionId, entry]));
  for (const inc of incoming.laneSessions) {
    const old = storedMap.get(inc.sessionId);
    if (!old) {
      out.push(inc);
      continue;
    }
    let pick = inc;
    let fill = old;
    if (inc.status === "running" && old.status !== "running") {
      pick = old;
      fill = inc;
    }
    if (plantBug && inc.status !== "running" && old.status === "running") {
      pick = old; // planted: running overwrites an ended record
      fill = inc;
    }
    const result: Record<string, unknown> = { ...fill, ...pick };
    for (const [key, value] of Object.entries(pick)) {
      if (value === undefined) result[key] = (fill as unknown as Record<string, unknown>)[key];
    }
    out.push(result as unknown as TaskLaneSession);
  }
  const incomingIds = new Set(incoming.laneSessions.map((entry) => entry.sessionId));
  for (const old of stored.laneSessions) if (!incomingIds.has(old.sessionId)) out.push(old);
  return { sessionIds, laneSessions: out };
}

function crossCheck(plantBug: boolean): { groups: number; diffs: number } {
  const rand = mulberry32(279);
  let diffs = 0;
  const groups = 10_000;
  for (let index = 0; index < groups; index += 1) {
    const pool = ["s1", "s2", "s3", "s4", "s5"].slice(0, 2 + Math.floor(rand() * 4));
    const stored = randomSide(rand, pool);
    const incoming = randomSide(rand, pool);
    const expected = judge(stored, incoming, plantBug);
    const actual = mergeLaneRecords(stored, incoming);
    try {
      expect(actual).toEqual(expected);
    } catch {
      diffs += 1;
    }
  }
  return { groups, diffs };
}

describe("mergeLaneRecords random cross-check (F3)", () => {
  it("planted judge error (running overwrites an ended record) is caught", () => {
    const { diffs } = crossCheck(true);
    console.log(`[F3] planted-bug run: groups=10000 diffs=${diffs}`);
    expect(diffs).toBeGreaterThan(0);
  });

  it("10,000 seeded groups: 0 differences", () => {
    const { groups, diffs } = crossCheck(false);
    console.log(`[F3] real run: groups=${groups} diffs=${diffs}`);
    expect(diffs).toBe(0);
  });
});
