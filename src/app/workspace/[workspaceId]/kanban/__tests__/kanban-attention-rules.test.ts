import { describe, expect, it } from "vitest";
import {
  attentionDismissKey,
  boardHasMainPusher,
  collectAttentionItems,
} from "../kanban-attention-rules";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

const NOW = Date.UTC(2026, 9, 21, 12);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function session(columnId: string, startedAt: number, status: LaneSession["status"]): LaneSession {
  return { sessionId: `${columnId}-${startedAt}`, columnId, startedAt: iso(startedAt), status };
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
});
