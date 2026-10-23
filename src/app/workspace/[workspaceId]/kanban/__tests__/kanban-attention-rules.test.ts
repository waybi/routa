import { describe, expect, it } from "vitest";
import {
  attentionDismissKey,
  boardHasMainPusher,
  collectAttentionItems,
  collectTaskAttentionItems,
  findInterruptedLaneSession,
  isTaskInterrupted,
} from "../kanban-attention-rules";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

const NOW = Date.UTC(2026, 9, 21, 12);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function session(columnId: string, startedAt: number, status: LaneSession["status"], extra: Partial<LaneSession> = {}): LaneSession {
  return { sessionId: `${columnId}-${startedAt}`, columnId, startedAt: iso(startedAt), status, ...extra };
}

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: id,
    status: "COMPLETED",
    columnId: "done",
    createdAt: iso(NOW - 30 * DAY),
    updatedAt: iso(NOW - HOUR),
    ...overrides,
  } as TaskInfo;
}

const report = { excerpt: "ok", commit: "abc", hasLeftover: false, createdAt: iso(NOW - HOUR) };

function board(doneAutomation?: KanbanBoardInfo["columns"][number]["automation"]): Pick<KanbanBoardInfo, "columns"> {
  return {
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "done", name: "Done", position: 1, stage: "done", automation: doneAutomation },
      { id: "blocked", name: "Blocked", position: 2, stage: "blocked" },
    ],
  };
}

const pusherBoard = board({ enabled: true, steps: [{ id: "s1", specialistId: "kanban-done-reporter" }, { id: "s2", specialistId: "kanban-main-pusher" }] });
const plainBoard = board({ enabled: true, steps: [{ id: "s1", specialistId: "kanban-done-reporter" }] });

function kinds(tasks: TaskInfo[], b = plainBoard) {
  return collectAttentionItems(tasks, b, NOW).map((item) => `${item.taskId}:${item.kind}:${item.ahead}`);
}

describe("blocked rule", () => {
  it("reports blocked cards regardless of age", () => {
    expect(kinds([task("b", { columnId: "blocked", updatedAt: iso(NOW - 60 * DAY) })])).toEqual(["b:blocked:0"]);
  });

  it("does not report cards in other lanes", () => {
    expect(kinds([task("d", { columnId: "dev" })])).toEqual([]);
  });

  it("a blocked card with a failed run still yields only blocked", () => {
    const failed = session("dev", NOW - HOUR, "failed");
    expect(kinds([task("b", { columnId: "blocked", triggerSessionId: failed.sessionId, laneSessions: [failed] })])).toEqual(["b:blocked:0"]);
  });
});

describe("doneFailed rule", () => {
  it("reports a failed or timed_out trailing done session with no report", () => {
    expect(kinds([
      task("f", { laneSessions: [session("done", NOW - 2 * HOUR, "failed")] }),
      task("t", { laneSessions: [session("done", NOW - 3 * HOUR, "completed"), session("done", NOW - 2 * HOUR, "timed_out")] }),
    ])).toEqual(["f:doneFailed:0", "t:doneFailed:0"]);
  });

  it("does not report when a report exists, or outside 7 days", () => {
    expect(kinds([
      task("r", { completionReport: report, laneSessions: [session("done", NOW - 2 * HOUR, "failed")] }),
      task("old", { laneSessions: [session("done", NOW - 8 * DAY, "failed")] }),
    ])).toEqual([]);
  });
});

describe("noReport rule", () => {
  it("reports finished done sessions with no report and takes a back seat to doneFailed", () => {
    expect(kinds([
      task("n", { laneSessions: [session("done", NOW - 2 * HOUR, "completed"), session("done", NOW - HOUR, "transitioned")] }),
      task("f", { laneSessions: [session("done", NOW - 2 * HOUR, "failed")] }),
    ])).toEqual(["n:noReport:0", "f:doneFailed:0"]);
  });

  it("does not report cards with no done session, a running session, a report, or older than 7 days", () => {
    expect(kinds([
      task("none", { laneSessions: [session("dev", NOW - 2 * HOUR, "completed")] }),
      task("empty"),
      task("running", { laneSessions: [session("done", NOW - 2 * HOUR, "completed"), session("done", NOW - HOUR, "running")] }),
      task("reported", { completionReport: report, laneSessions: [session("done", NOW - HOUR, "completed")] }),
      task("old", { laneSessions: [session("done", NOW - 7 * DAY - HOUR, "completed")] }),
    ])).toEqual([]);
  });
});

describe("unmerged rule", () => {
  const unmerged = (id: string, ahead: number, extra: Partial<TaskInfo> = {}) => task(id, {
    completionReport: report,
    deliveryLanding: { landedOnBase: false, commitsSinceBase: ahead },
    ...extra,
  });

  it("reports +N on a board whose Done lane runs the main pusher", () => {
    expect(kinds([unmerged("u", 3)], pusherBoard)).toEqual(["u:unmerged:3"]);
    expect(kinds([unmerged("u", 2)], board({ enabled: true, specialistId: "kanban-main-pusher" }))).toEqual(["u:unmerged:2"]);
  });

  it("does not report on boards without the pusher, when landed, with 0 ahead, or outside 7 days", () => {
    expect(kinds([unmerged("u", 3)], plainBoard)).toEqual([]);
    expect(kinds([
      task("landed", { completionReport: report, deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 } }),
      unmerged("zero", 0),
      unmerged("old", 2, { updatedAt: iso(NOW - 9 * DAY) }),
    ], pusherBoard)).toEqual([]);
  });
});

describe("boardHasMainPusher and dismiss key", () => {
  it("detects the pusher in steps or the legacy specialistId", () => {
    expect(boardHasMainPusher(pusherBoard)).toBe(true);
    expect(boardHasMainPusher(plainBoard)).toBe(false);
    expect(boardHasMainPusher(board())).toBe(false);
  });

  it("keys on card + kind + ahead (0 for non-unmerged kinds)", () => {
    expect(attentionDismissKey({ taskId: "a", kind: "unmerged", ahead: 3 })).toBe("a|unmerged|3");
    expect(attentionDismissKey({ taskId: "a", kind: "blocked", ahead: 9 })).toBe("a|blocked|0");
  });

  it("keeps the four old kinds' keys byte-for-byte (keys computed on the pre-change code)", () => {
    expect(attentionDismissKey({ taskId: "a", kind: "doneFailed", ahead: 0 })).toBe("a|doneFailed|0");
    expect(attentionDismissKey({ taskId: "a", kind: "noReport", ahead: 4 })).toBe("a|noReport|0");
    expect(attentionDismissKey({ taskId: "a", kind: "unmerged", ahead: 0 })).toBe("a|unmerged|0");
    // An old-kind item that somehow carries a sessionId must not change its key.
    expect(attentionDismissKey({ taskId: "a", kind: "blocked", ahead: 0, sessionId: "s9" })).toBe("a|blocked|0");
    expect(attentionDismissKey({ taskId: "a", kind: "unmerged", ahead: 2, sessionId: "s9" })).toBe("a|unmerged|2");
  });

  it("keys interrupted on the failed run, so a new failure resurfaces", () => {
    const s1 = attentionDismissKey({ taskId: "card", kind: "interrupted", ahead: 0, sessionId: "s1" });
    const s2 = attentionDismissKey({ taskId: "card", kind: "interrupted", ahead: 0, sessionId: "s2" });
    expect(s1).toBe("card|interrupted|s1");
    expect(s2).toBe("card|interrupted|s2");
    expect(s1).not.toBe(s2);
  });
});

describe("interrupted rule", () => {
  const OLD = NOW - 30 * DAY;
  const failedRun = (columnId: string, startedAt: number, status: LaneSession["status"] = "failed") => session(columnId, startedAt, status);
  const triggered = (id: string, columnId: string, run: LaneSession, extra: LaneSession[] = []) => task(id, {
    columnId,
    triggerSessionId: run.sessionId,
    laneSessions: [...extra, run],
  });

  it.each([
    ["dev trigger run failed", triggered("c1", "dev", failedRun("dev", NOW - HOUR)), "dev-" + (NOW - HOUR)],
    ["review trigger run timed out", triggered("c2", "review", failedRun("review", NOW - HOUR, "timed_out")), "review-" + (NOW - HOUR)],
    ["backlog trigger run failed", triggered("c3", "backlog", failedRun("backlog", NOW - HOUR)), "backlog-" + (NOW - HOUR)],
    ["todo trigger run failed", triggered("c4", "todo", failedRun("todo", NOW - HOUR)), "todo-" + (NOW - HOUR)],
    ["failed 30 days ago (no 7-day window)", task("c5", {
      columnId: "dev",
      laneSessions: [session("dev", OLD - HOUR, "failed", { completedAt: iso(OLD) })],
    }), "dev-" + (OLD - HOUR)],
    ["no trigger: newest of 3 current-lane runs failed", task("c6", {
      columnId: "dev",
      laneSessions: [session("dev", NOW - 3 * HOUR, "completed"), session("dev", NOW - HOUR, "failed"), session("dev", NOW - 2 * HOUR, "completed")],
    }), "dev-" + (NOW - HOUR)],
  ])("reports %s", (_name, card, sessionId) => {
    expect(findInterruptedLaneSession(card)?.sessionId).toBe(sessionId);
    expect(isTaskInterrupted(card)).toBe(true);
    expect(collectTaskAttentionItems(card, { hasMainPusher: true, now: NOW })).toEqual([
      { taskId: card.id, kind: "interrupted", ahead: 0, sessionId },
    ]);
  });

  it.each([
    ["trigger session not in laneSessions (retry just started)", task("n1", {
      columnId: "dev",
      triggerSessionId: "fresh-retry",
      laneSessions: [session("dev", NOW - 2 * HOUR, "failed")],
    })],
    ["no trigger: old lane failed, current lane newest completed", task("n2", {
      columnId: "review",
      laneSessions: [session("dev", NOW - 3 * HOUR, "failed"), session("review", NOW - HOUR, "completed")],
    })],
    ["no trigger: newest current-lane run completed, older one failed", task("n3", {
      columnId: "dev",
      laneSessions: [session("dev", NOW - 3 * HOUR, "failed"), session("dev", NOW - HOUR, "completed"), session("dev", NOW - 2 * HOUR, "failed")],
    })],
    ["no trigger: only another lane's failed run", task("n4", {
      columnId: "review",
      laneSessions: [session("dev", NOW - HOUR, "failed")],
    })],
    ["current run still running", triggered("n5", "dev", failedRun("dev", NOW - HOUR, "running"))],
    ["current run transitioned", triggered("n6", "dev", failedRun("dev", NOW - HOUR, "transitioned"))],
    ["done lane with a failed run", task("n7", { columnId: "done", completionReport: report, laneSessions: [session("done", NOW - HOUR, "failed")] })],
    ["blocked lane with a failed run", triggered("n8", "blocked", failedRun("dev", NOW - HOUR))],
    ["no lane runs at all", task("n9", { columnId: "dev" })],
  ])("does not report %s", (_name, card) => {
    expect(findInterruptedLaneSession(card)).toBeNull();
    expect(isTaskInterrupted(card)).toBe(false);
    expect(collectTaskAttentionItems(card, { hasMainPusher: true, now: NOW }).some((item) => item.kind === "interrupted")).toBe(false);
  });

  it("a done card with a failed trailing run stays doneFailed, never interrupted", () => {
    expect(kinds([task("d", { laneSessions: [session("done", NOW - HOUR, "failed")] })])).toEqual(["d:doneFailed:0"]);
  });
});

describe("old kinds keep their exact output (F2)", () => {
  it("non-Done lanes with completed or running runs report nothing", () => {
    expect(kinds([
      task("bl", { columnId: "backlog", laneSessions: [session("backlog", NOW - HOUR, "completed")] }),
      task("to", { columnId: "todo", laneSessions: [session("todo", NOW - HOUR, "completed")] }),
      task("dv", { columnId: "dev", laneSessions: [session("dev", NOW - HOUR, "completed")] }),
      task("rv", { columnId: "review", laneSessions: [session("review", NOW - HOUR, "completed")] }),
      task("run", { columnId: "dev", laneSessions: [session("dev", NOW - HOUR, "running")] }),
    ], pusherBoard)).toEqual([]);
  });

  it("mixed board output is identical with and without a board autoProviderId", () => {
    const tasks = [
      task("b", { columnId: "blocked" }),
      task("f", { laneSessions: [session("done", NOW - 2 * HOUR, "failed")] }),
      task("n", { laneSessions: [session("done", NOW - 2 * HOUR, "completed")] }),
      task("u", { completionReport: report, deliveryLanding: { landedOnBase: false, commitsSinceBase: 2 } }),
      task("old", { laneSessions: [session("done", NOW - 8 * DAY, "completed")] }),
    ];
    const expected = ["b:blocked:0", "f:doneFailed:0", "n:noReport:0", "u:unmerged:2"];
    expect(kinds(tasks, pusherBoard)).toEqual(expected);
    expect(kinds(tasks, { ...pusherBoard, autoProviderId: "dsh" } as Pick<KanbanBoardInfo, "columns">)).toEqual(expected);
  });
});
