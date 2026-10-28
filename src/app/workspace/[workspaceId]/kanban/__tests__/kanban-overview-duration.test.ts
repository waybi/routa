import { describe, expect, it } from "vitest";
import { computeCardDuration, medianMs } from "../kanban-overview-duration";
import type { TaskInfo } from "../../types";

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 28, 0, 0, 0);
const NOW = T0 + 10 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function run(columnId: string, startMin: number, endMin: number | null, status: LaneSession["status"] = "completed", extra: Partial<LaneSession> = {}): LaneSession {
  seq += 1;
  return {
    sessionId: `s${seq}`,
    columnId,
    status,
    startedAt: iso(T0 + startMin * MIN),
    ...(endMin === null ? {} : { completedAt: iso(T0 + endMin * MIN) }),
    ...extra,
  };
}
const card = (laneSessions?: LaneSession[]) => ({ laneSessions }) as Pick<TaskInfo, "laneSessions">;

describe("computeCardDuration (AC6)", () => {
  it("① normal card: sums sessions into prepare / build / check / finish", () => {
    const d = computeCardDuration(card([
      run("backlog", 0, 5), run("todo", 5, 15), run("dev", 15, 45), run("review", 45, 60), run("done", 60, 65),
    ]), NOW);
    expect(d.buckets).toEqual({ prepare: 15 * MIN, build: 30 * MIN, check: 15 * MIN, finish: 5 * MIN, stuck: 0 });
    expect(d.totalMs).toBe(65 * MIN);
    expect(d.reworkCount).toBe(0);
    expect(d.stuckCount).toBe(0);
  });

  it("② a timed_out session goes whole into stuck, not into its lane", () => {
    const d = computeCardDuration(card([
      run("dev", 0, 40, "timed_out", { recoveryReason: "watchdog_inactivity" }), run("dev", 40, 70), run("done", 70, 72),
    ]), NOW);
    expect(d.buckets.build).toBe(30 * MIN);
    expect(d.buckets.stuck).toBe(40 * MIN);
    expect(d.stuckMs).toBe(40 * MIN);
    expect(d.stuckCount).toBe(1);
    expect(d.totalMs).toBe(72 * MIN);
  });

  it("③ dev run three times → reworkCount 2", () => {
    const d = computeCardDuration(card([run("dev", 0, 10), run("dev", 10, 20, "failed"), run("dev", 20, 30), run("done", 30, 31)]), NOW);
    expect(d.reworkCount).toBe(2);
    expect(d.buckets.build).toBe(30 * MIN);
  });

  it("④ sessions after the first Done run are not counted", () => {
    const d = computeCardDuration(card([
      run("dev", 0, 10), run("done", 10, 12), run("done", 12, 14), run("dev", 100, 200), run("review", 200, 300),
    ]), NOW);
    expect(d.totalMs).toBe(14 * MIN);
    expect(d.buckets.build).toBe(10 * MIN);
    expect(d.buckets.check).toBe(0);
    expect(d.reworkCount).toBe(0);
  });

  it("⑤ a finished session without completedAt ends at lastActivityAt, else counts 0", () => {
    const withActivity = run("dev", 0, null, "failed", { lastActivityAt: iso(T0 + 7 * MIN) });
    const bare = run("review", 10, null, "failed");
    const d = computeCardDuration(card([withActivity, bare]), NOW);
    expect(d.buckets.build).toBe(7 * MIN);
    expect(d.buckets.check).toBe(0);
  });

  it("⑥ a running session ends at now", () => {
    const d = computeCardDuration(card([run("dev", 570, null, "running")]), NOW);
    expect(d.buckets.build).toBe(30 * MIN);
    expect(d.totalMs).toBe(30 * MIN);
  });

  it("⑦ no or broken laneSessions give zeros without throwing", () => {
    const zero = { totalMs: 0, buckets: { prepare: 0, build: 0, check: 0, finish: 0, stuck: 0 }, reworkCount: 0, stuckMs: 0, stuckCount: 0 };
    expect(computeCardDuration(card(undefined), NOW)).toEqual(zero);
    expect(computeCardDuration(card([]), NOW)).toEqual(zero);
    expect(computeCardDuration(card([{ sessionId: "x", status: "running", startedAt: "" } as LaneSession]), NOW)).toEqual(zero);
  });

  it("negative spans count 0; blocked counts as check; custom lanes count as build", () => {
    const d = computeCardDuration(card([run("blocked", 20, 10), run("blocked", 20, 30), run("qa", 30, 40)]), NOW);
    expect(d.buckets.check).toBe(10 * MIN);
    expect(d.buckets.build).toBe(10 * MIN);
  });
});

describe("medianMs", () => {
  it("uses the middle value, and the mean of the two middle values when even", () => {
    expect(medianMs([])).toBeNull();
    expect(medianMs([5, 1, 3])).toBe(3);
    expect(medianMs([30 * MIN, 60 * MIN, 120 * MIN, 300 * MIN])).toBe(90 * MIN);
  });
});

// F3: seeded random cross-check against an independent reference written from the AC6 text.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function reference(sessions: LaneSession[], now: number) {
  let cut = sessions.length;
  const firstDone = sessions.findIndex((s) => s.columnId === "done");
  if (firstDone >= 0) {
    cut = firstDone;
    while (cut < sessions.length && sessions[cut].columnId === "done") cut += 1;
  }
  const counted = sessions.slice(0, cut);
  const bucketOf: Record<string, "prepare" | "build" | "check" | "finish"> = {
    backlog: "prepare", todo: "prepare", dev: "build", review: "check", blocked: "check", done: "finish",
  };
  const out = { prepare: 0, build: 0, check: 0, finish: 0, stuck: 0 };
  for (const s of counted) {
    const start = Date.parse(s.startedAt);
    const endRaw = s.status === "running" ? now : (s.completedAt ? Date.parse(s.completedAt) : (s.lastActivityAt ? Date.parse(s.lastActivityAt) : NaN));
    const span = Number.isFinite(endRaw) && endRaw > start ? endRaw - start : 0;
    if (s.status === "timed_out") out.stuck += span;
    else out[bucketOf[s.columnId ?? ""] ?? "build"] += span;
  }
  return { buckets: out, rework: Math.max(0, counted.filter((s) => s.columnId === "dev").length - 1) };
}

describe("computeCardDuration random cross-check (F3, seed 20261028)", () => {
  it("matches the reference on 10,000 random cards", () => {
    const rand = mulberry32(20261028);
    const lanes = ["backlog", "todo", "dev", "review", "blocked", "done"];
    const statuses: LaneSession["status"][] = ["running", "completed", "failed", "timed_out"];
    for (let i = 0; i < 10_000; i += 1) {
      const n = Math.floor(rand() * 43);
      const sessions: LaneSession[] = [];
      let cursor = 0;
      for (let k = 0; k < n; k += 1) {
        const start = cursor + Math.floor(rand() * 5);
        const dur = Math.floor(rand() * 90) - 5;
        const status = statuses[Math.floor(rand() * 4)];
        const withEnd = rand() > 0.2;
        sessions.push(run(lanes[Math.floor(rand() * lanes.length)], start, withEnd ? start + dur : null, status,
          !withEnd && rand() > 0.5 ? { lastActivityAt: iso(T0 + (start + 3) * MIN) } : {}));
        cursor = start + Math.max(dur, 0);
      }
      const got = computeCardDuration(card(sessions), NOW);
      const want = reference(sessions, NOW);
      expect(got.buckets).toEqual(want.buckets);
      expect(got.reworkCount).toBe(want.rework);
      expect(got.stuckMs).toBe(want.buckets.stuck);
      expect(got.totalMs).toBe(Object.values(want.buckets).reduce((a, b) => a + b, 0));
    }
  });
});
