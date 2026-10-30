import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  classifyOverviewTask,
  countStatusBar,
  isDoneToday,
  isResolvedAwaitingCleanup,
  laneProgress,
  summarizeRhythm,
} from "../kanban-overview-status-rules";
import { buildWorkspaceRow, collectRecentDone, sortInProgress, sortOverviewRows } from "../kanban-overview-rules";
import { KanbanOverviewStatusBar } from "../kanban-overview-status-bar";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

const MIN = 60_000;
const HOUR = 60 * MIN;
// Local time on purpose: every rule must follow the machine's own midnight (TZ-independent test).
const NOW = new Date(2026, 9, 28, 0, 0, 30).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const none = () => [] as readonly string[];

let seq = 0;
function session(columnId: string, startedAt: number, status: LaneSession["status"] = "completed", extra: Partial<LaneSession> = {}): LaneSession {
  seq += 1;
  return { sessionId: `s${seq}`, columnId, status, startedAt: iso(startedAt), ...(status === "running" ? {} : { completedAt: iso(startedAt + 10 * MIN) }), ...extra };
}
function task(id: string, columnId: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return { id, title: `t ${id}`, status: "PENDING", columnId, boardId: "b", createdAt: iso(NOW - 30 * 24 * HOUR), updatedAt: iso(NOW - HOUR), ...overrides } as TaskInfo;
}
const done = (id: string, enteredAt: number) => task(id, "done", {
  status: "COMPLETED",
  laneSessions: [session("done", enteredAt)],
  completionReport: { excerpt: "r", commit: "abc1234", hasLeftover: false, createdAt: iso(enteredAt) },
  deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 },
});
function board(id: string, queued?: number): KanbanBoardInfo {
  return {
    id, workspaceId: "w", name: id, isDefault: id === "b1", createdAt: iso(0), updatedAt: iso(0),
    columns: [{ id: "dev", name: "Dev", position: 0, stage: "dev" }, { id: "done", name: "Done", position: 1, stage: "done" }],
    ...(queued === undefined ? {} : { queue: { queuedCount: queued, queuedCardIds: [], queuedCards: [], queuedPositions: {} } }),
  } as unknown as KanbanBoardInfo;
}

describe("status bar and classification (AC1 / AC3)", () => {
  const boards = [board("b1")];
  const wsA = [
    done("a1", NOW + 1000 - 0), done("a2", NOW - 10 * 1000), done("a3", NOW - 20 * 1000), done("a4", NOW - 25 * 1000), done("a5", NOW - 29 * 1000),
    task("run", "dev", { laneSessions: [session("dev", NOW - 5 * MIN, "running")] }),
    task("idle", "review"),
    task("todo", "todo", { laneSessions: [session("todo", NOW - 5 * MIN, "running")] }),
    task("blk", "blocked"),
  ];
  // 31 s before NOW is 23:59:59 yesterday; "b-new" 00:00:10 today; "late" 23:59:50 yesterday.
  const wsB = [done("just-before-midnight", NOW - 31 * 1000), done("b-new", NOW - 20 * 1000)];
  const yesterday = done("late", new Date(2026, 9, 27, 23, 59, 50).getTime());
  const rowA = buildWorkspaceRow({ id: "A", title: "A" }, wsA, boards, NOW, "", none);
  const rowB = buildWorkspaceRow({ id: "B", title: "B" }, [...wsB, yesterday], boards, NOW, "", none);

  it("counts today's Done across all Done cards (5 + 1), cross-midnight aware, not capped at 3 per project", () => {
    expect(isDoneToday(yesterday, NOW)).toBe(false);
    expect(rowA.recentDone.items).toHaveLength(3);
    expect(countStatusBar([rowA], NOW).doneToday).toBe(5);
    expect(countStatusBar([rowB], NOW).doneToday).toBe(1);
    expect(countStatusBar([rowA, rowB], NOW).doneToday).toBe(6);
  });

  it("classifies running / queued / attention; blocked only in attention", () => {
    const counts = countStatusBar([rowA], NOW);
    expect(counts).toMatchObject({ running: 1, queued: 2, attention: 1 });
    const ids = new Set(rowA.attentionAll.map((e) => e.task.id));
    expect(classifyOverviewTask(wsA[5], ids)).toBe("running");
    expect(classifyOverviewTask(wsA[6], ids)).toBe("queued");
    expect(classifyOverviewTask(wsA[7], ids)).toBe("queued");
    expect(classifyOverviewTask(wsA[8], ids)).toBe("attention");
    expect(sortInProgress(wsA).map((t) => t.id)).not.toContain("blk");
  });

  it("keeps the full Done list while showing only 3", () => {
    const recent = collectRecentDone(wsA, NOW, "");
    expect(recent.items).toHaveLength(3);
    expect(recent.all).toHaveLength(5);
  });
});

describe("row queue sum and ordering (AC3)", () => {
  it("sums queuedCount over boards, a missing queue counts 0", () => {
    const row = buildWorkspaceRow({ id: "W", title: "W" }, [], [board("b1", 2), board("b2", 3), board("b3")], NOW, "", none);
    expect(row.queuedCount).toBe(5);
  });

  it("puts rows with needs-you cards first and leaves the rest in the old order", () => {
    const rows = [
      { title: "x", score: 9, collapsed: false, attention: [] },
      { title: "y", score: 2, collapsed: false, attention: [{}] },
      { title: "w", score: 9, collapsed: false, attention: [] },
      { title: "z", score: 0, collapsed: true, attention: [] },
    ];
    expect(sortOverviewRows(rows).map((r) => r.title)).toEqual(["y", "w", "x", "z"]);
  });
});

describe("laneProgress (AC2)", () => {
  it("reads step, specialist, step number and running time from the current run", () => {
    const t = task("p", "dev", { laneSessions: [session("dev", NOW - 12 * MIN, "running", { specialistName: "Dev Crafter", stepIndex: 1 })] });
    expect(laneProgress(t, NOW)).toEqual({ step: 3, specialistName: "Dev Crafter", stepNumber: 2, runningMs: 12 * MIN, failed: false });
  });

  it("flags failed and timed_out current runs; old cards have no run info", () => {
    expect(laneProgress(task("f", "dev", { laneSessions: [session("dev", NOW - MIN, "failed")] }), NOW).failed).toBe(true);
    expect(laneProgress(task("o", "dev", { laneSessions: [session("dev", NOW - MIN, "timed_out")] }), NOW).failed).toBe(true);
    expect(laneProgress(task("old", "review"), NOW)).toEqual({ step: 4, specialistName: null, stepNumber: null, runningMs: null, failed: false });
    expect(laneProgress(task("b", "backlog"), NOW).step).toBe(1);
    expect(laneProgress(done("d", NOW), NOW).step).toBe(5);
  });
});

describe("summarizeRhythm (AC7)", () => {
  it("counts per day, median, rework and stuck cards", () => {
    const mk = (id: string, dayBack: number, dev: LaneSession[]) => task(id, "done", {
      status: "COMPLETED",
      laneSessions: [...dev, session("done", new Date(2026, 9, 28 - dayBack, 12).getTime())],
    });
    const at = (m: number) => NOW - 24 * HOUR - m * MIN;
    const tasks = [
      mk("a", 1, [{ ...session("dev", at(0)), completedAt: iso(at(0) + 30 * MIN) }]),
      mk("b", 1, [{ ...session("dev", at(0)), completedAt: iso(at(0) + 60 * MIN) }, { ...session("dev", at(100)), completedAt: iso(at(100) + 60 * MIN) }]),
      mk("c", 3, [{ ...session("dev", at(0), "timed_out"), completedAt: iso(at(0) + 40 * MIN) }]),
    ];
    const r = summarizeRhythm(tasks, NOW);
    expect(r.count).toBe(3);
    expect(r.perDay).toEqual([0, 0, 0, 1, 0, 2, 0]);
    expect(r.reworkCards).toBe(1);
    expect(r.stuckCards).toBe(1);
    expect(r.stuckMs).toBe(40 * MIN);
    expect(r.medianMs).not.toBeNull();
    expect(summarizeRhythm([], NOW)).toMatchObject({ count: 0, medianMs: null, stuckCards: 0 });
  });
});

// F3: random (now, doneEnteredAt) pairs against a reference that compares local year-month-day.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("isDoneToday random cross-check (F3, seed 1028)", () => {
  it("agrees with a local year-month-day comparison on 10,000 pairs", () => {
    const rand = mulberry32(1028);
    for (let i = 0; i < 10_000; i += 1) {
      const now = new Date(2026, 0, 1).getTime() + Math.floor(rand() * 400 * 24 * HOUR);
      const entered = now + Math.floor((rand() - 0.5) * 6 * 24 * HOUR);
      const t = task("r", "done", { laneSessions: [session("done", entered)] });
      const a = new Date(now);
      const b = new Date(entered);
      const same = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      expect(isDoneToday(t, now)).toBe(same);
    }
  });
});

describe("resolved Blocked cards are not counted as queued", () => {
  const boards = [board("b1")];
  const res = (category: string) => ({ category, resolvedAt: iso(NOW - HOUR) }) as TaskInfo["attentionResolution"];
  const rowOf = (tasks: TaskInfo[]) => buildWorkspaceRow({ id: "A", title: "A" }, tasks, boards, NOW, "", none);

  it.each(["landed", "superseded", "handed_off", "waiting"])("Blocked + %s leaves queued and is counted separately", (category) => {
    const t = task("b", "blocked", { attentionResolution: res(category) });
    expect(isResolvedAwaitingCleanup(t)).toBe(true);
    const counts = countStatusBar([{ tasks: [t], attentionAll: [] }], NOW);
    expect(counts).toEqual({ running: 0, queued: 0, attention: 0, doneToday: 0, resolvedAwaitingCleanup: 1 });
    expect(classifyOverviewTask(t, new Set())).toBe("queued");
  });

  it("keeps old behaviour for needs_owner, missing resolution, other lanes and attention cards", () => {
    const needsOwner = task("n", "blocked", { attentionResolution: res("needs_owner") });
    const bare = task("bare", "blocked");
    const dev = task("dev", "dev", { attentionResolution: res("waiting") });
    const todo = task("todo", "todo");
    const backlog = task("bl", "backlog");
    expect(isResolvedAwaitingCleanup(needsOwner)).toBe(false);
    expect(isResolvedAwaitingCleanup(bare)).toBe(false);
    const counts = countStatusBar([{ tasks: [needsOwner, bare, dev, todo, backlog], attentionAll: [] }], NOW);
    expect(counts).toEqual({ running: 0, queued: 5, attention: 0, doneToday: 0, resolvedAwaitingCleanup: 0 });
    const inAttention = task("x", "blocked", { attentionResolution: res("superseded") });
    const c2 = countStatusBar([{ tasks: [inAttention], attentionAll: [{ task: inAttention }] as never }], NOW);
    expect(c2).toEqual({ running: 0, queued: 0, attention: 1, doneToday: 0, resolvedAwaitingCleanup: 0 });
  });

  it("sums over several rows and keeps the cards in the queued filter", () => {
    const a = task("a", "blocked", { attentionResolution: res("landed") });
    const rows = [rowOf([a, task("q", "todo")]), rowOf([task("b", "blocked", { attentionResolution: res("waiting") })])];
    const counts = countStatusBar(rows, NOW);
    expect(counts.queued).toBe(1);
    expect(counts.resolvedAwaitingCleanup).toBe(2);
  });

  it("renders four buttons and a hover title only on the queued one when N > 0", () => {
    const base = { running: 1, queued: 2, attention: 3, doneToday: 4 };
    const render = (n: number) => renderToStaticMarkup(createElement(KanbanOverviewStatusBar, { counts: { ...base, resolvedAwaitingCleanup: n }, active: null, onToggle: () => {} }));
    const zero = render(0);
    const three = render(3);
    expect((three.match(/<button/g) ?? []).length).toBe(4);
    expect(zero).not.toContain("title=");
    expect((three.match(/title=/g) ?? []).length).toBe(1);
    expect(three).not.toContain("{count}");
    expect(three).toMatch(/data-testid="kanban-overview-status-queued"[^>]*title="[^"]*3[^"]*"|title="[^"]*3[^"]*"[^>]*data-testid="kanban-overview-status-queued"/);
    expect(three.replace(/ title="[^"]*"/, "")).toBe(zero);
  });
});
