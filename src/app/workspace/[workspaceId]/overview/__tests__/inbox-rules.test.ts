import { describe, expect, it } from "vitest";
import { attentionDismissKey } from "../../kanban/kanban-attention-rules";
import { buildWorkspaceRow } from "../../kanban/kanban-overview-rules";
import {
  buildInboxRows,
  buildWorkspaceInbox,
  completionReportHref,
  inboxColumnName,
  inboxRowHref,
  latestCompletionResult,
  summarizeWorkspace,
  taskAuthoritativeAt,
} from "../inbox-rules";
import { DAY, HOUR, NOW, card, doneCard, interruptedCard, iso, makeBoard, report, run, unmergedCard } from "./inbox-fixtures";

const WS = { id: "w1", title: "Workspace One" };
const none = () => [] as const;

function reasons(tasks: Parameters<typeof buildWorkspaceInbox>[1], withPusher = true) {
  return buildWorkspaceInbox(WS, tasks, [makeBoard("b1", withPusher)], NOW, none).active
    .map((row) => `${row.task.id}:${row.reason}:P${row.severity}`);
}

describe("inbox severity", () => {
  it("doneFailed is P1", () => {
    expect(reasons([doneCard("f", "failed")])).toEqual(["f:doneFailed:P1"]);
  });

  it("blocked with lastSyncError is P1", () => {
    expect(reasons([card("b", { columnId: "blocked", lastSyncError: "push rejected" })])).toEqual(["b:blockedError:P1"]);
  });

  it("noReport is P2", () => {
    expect(reasons([doneCard("n", "completed")])).toEqual(["n:noReport:P2"]);
  });

  it("unmerged is P3", () => {
    expect(reasons([unmergedCard("u", 3)])).toEqual(["u:unmerged:P3"]);
  });

  it("blocked without a recorded reason is P3, not a failure", () => {
    expect(reasons([card("b", { columnId: "blocked", lastSyncError: "   " })])).toEqual(["b:blockedUnknown:P3"]);
  });
});

describe("inbox set boundaries (same as the board strip)", () => {
  it("skips Done cards that entered Done more than 7 days ago", () => {
    const old = doneCard("old", "failed", {}, NOW - 9 * DAY);
    expect(reasons([old])).toEqual([]);
  });

  it("does not report unmerged on boards whose Done lane has no main pusher", () => {
    expect(reasons([unmergedCard("u", 3)], false)).toEqual([]);
  });

  it("does not report noReport while a Done-lane run is still running", () => {
    const running = card("r", { laneSessions: [run("done", NOW - HOUR, "running")] });
    expect(reasons([running])).toEqual([]);
  });

  it("keeps one row per workspace + card + kind", () => {
    const task = doneCard("dup", "failed");
    const rows = buildWorkspaceInbox(WS, [task, { ...task }], [makeBoard("b1", true)], NOW, none).active;
    expect(rows.map((row) => row.key)).toEqual(["w1|dup|doneFailed"]);
  });
});

describe("inbox ordering and event time", () => {
  it("sorts P1 → P3, then by event time, newest first", () => {
    const rows = buildWorkspaceInbox(WS, [
      unmergedCard("p3", 2),
      doneCard("p2", "completed", {}, NOW - 2 * HOUR),
      doneCard("p1-old", "failed", {}, NOW - 5 * HOUR),
      doneCard("p1-new", "timed_out", {}, NOW - HOUR),
    ], [makeBoard("b1", true)], NOW, none).active;
    expect(rows.map((row) => row.task.id)).toEqual(["p1-new", "p1-old", "p2", "p3"]);
  });

  it("uses the last Done run's completedAt, not updatedAt", () => {
    const task = doneCard("f", "failed", { updatedAt: iso(NOW - 60_000) }, NOW - 4 * HOUR);
    const [row] = buildWorkspaceInbox(WS, [task], [makeBoard("b1", true)], NOW, none).active;
    expect(row.eventAt).toBe(NOW - 4 * HOUR);
  });

  it("returns null event time for blocked cards without updatedAt", () => {
    const task = card("b", { columnId: "blocked", updatedAt: undefined as unknown as string });
    const [row] = buildWorkspaceInbox(WS, [task], [makeBoard("b1", true)], NOW, none).active;
    expect(row.eventAt).toBeNull();
  });
});

describe("dismissed rows", () => {
  it("moves rows whose board key was dismissed into the dismissed group", () => {
    const task = doneCard("f", "failed");
    const key = attentionDismissKey({ taskId: "f", kind: "doneFailed", ahead: 0 });
    const rows = buildWorkspaceInbox(WS, [task], [makeBoard("b1", true)], NOW, (boardId) => (boardId === "b1" ? [key] : []));
    expect(rows.active).toEqual([]);
    expect(rows.dismissed.map((row) => row.dismissKey)).toEqual([key]);
  });

  it("resurfaces unmerged when the ahead count changes", () => {
    const rows = buildWorkspaceInbox(WS, [unmergedCard("u", 3)], [makeBoard("b1", true)], NOW, () => ["u|unmerged|2"]);
    expect(rows.active.map((row) => row.dismissKey)).toEqual(["u|unmerged|3"]);
  });
});

describe("home summary", () => {
  const boards = [makeBoard("b1", true)];

  it("counts in-progress cards with the all-projects rule (column is not Done)", () => {
    const tasks = [card("a", { columnId: "dev" }), card("b", { columnId: "review" }), card("c", { columnId: "blocked" }), card("d")];
    expect(summarizeWorkspace(WS, tasks, boards, NOW, none).inProgress).toBe(3);
  });

  it("needs-you count equals buildWorkspaceRow(...).attention.length for the same dismissals", () => {
    const tasks = [
      doneCard("f", "failed"),
      doneCard("n", "completed"),
      unmergedCard("u", 2),
      card("b", { columnId: "blocked" }),
      doneCard("ok", "completed", { completionSummary: "done" }),
    ];
    const dismissed = (boardId: string) => (boardId === "b1" ? ["n|noReport|0"] : []);
    const summary = summarizeWorkspace(WS, tasks, boards, NOW, dismissed);
    const row = buildWorkspaceRow(WS, tasks, boards, NOW, "", dismissed);
    expect(summary.needsYou).toBe(row.attention.length);
    expect(summary.needsYou).toBe(3);
  });

  it("does not treat a card with a fresh updatedAt but old runs as the latest activity", () => {
    const touched = doneCard("touched", "completed", { updatedAt: iso(NOW - 60_000), completionReport: report }, NOW - 5 * DAY);
    const real = card("real", { columnId: "dev", laneSessions: [run("dev", NOW - 2 * HOUR, "running", { lastActivityAt: iso(NOW - HOUR) })] });
    const summary = summarizeWorkspace(WS, [touched, real], boards, NOW, none);
    expect(summary.recent?.task.id).toBe("real");
    expect(summary.recent?.at).toBe(NOW - HOUR);
  });

  it("returns no recent activity when the workspace has no cards", () => {
    expect(summarizeWorkspace(WS, [], boards, NOW, none).recent).toBeNull();
  });

  it("falls back to updatedAt only when no run or createdAt exists", () => {
    const bare = { id: "x", title: "x", status: "PENDING", updatedAt: iso(NOW - HOUR) } as unknown as Parameters<typeof taskAuthoritativeAt>[0];
    expect(taskAuthoritativeAt(bare)).toBe(NOW - HOUR);
  });
});

describe("cross-workspace rows and links", () => {
  it("merges workspaces and keeps each row's own workspace", () => {
    const rows = buildInboxRows(
      [WS, { id: "w2", title: "Two" }],
      {
        w1: { tasks: [doneCard("a", "completed")], boards: [makeBoard("b1", true)] },
        w2: { tasks: [doneCard("b", "failed", { boardId: "b2" })], boards: [makeBoard("b2", true)] },
      },
      NOW,
      none,
    );
    expect(rows.active.map((row) => `${row.workspaceId}:${row.task.id}`)).toEqual(["w2:b", "w1:a"]);
  });

  it("opens failed / unreported cards on the completion tab", () => {
    const [failed] = buildWorkspaceInbox(WS, [doneCard("f", "failed")], [makeBoard("b1", true)], NOW, none).active;
    expect(inboxRowHref(failed)).toBe("/workspace/w1/kanban?boardId=b1&taskId=f&detailTab=completion");
    const [blocked] = buildWorkspaceInbox(WS, [card("b", { columnId: "blocked" })], [makeBoard("b1", true)], NOW, none).active;
    expect(inboxRowHref(blocked)).toBe("/workspace/w1/kanban?boardId=b1&taskId=b");
  });

  it("picks the newest completion report across workspaces", () => {
    const result = latestCompletionResult([WS, { id: "w2", title: "Two" }], {
      w1: { tasks: [doneCard("old", "completed", { completionReport: { ...report, createdAt: iso(NOW - DAY) } })], boards: [makeBoard("b1", true)] },
      w2: { tasks: [doneCard("new", "completed", { boardId: "b2", completionSummary: "summary only" })], boards: [makeBoard("b2", true)] },
    });
    expect(result?.task.id).toBe("new");
    expect(result?.summary).toBe("summary only");
    expect(completionReportHref(result!)).toContain("detailTab=completion");
  });

  it("returns null when no Done card has a report", () => {
    expect(latestCompletionResult([WS], { w1: { tasks: [doneCard("n", "completed")], boards: [makeBoard("b1", true)] } })).toBeNull();
  });
});

describe("interrupted rows", () => {
  const boards = [makeBoard("b1", true)];

  it("is P1, counted with clear failures, sorted with the other P1 rows", () => {
    const rows = buildWorkspaceInbox(WS, [
      unmergedCard("p3", 2),
      interruptedCard("i", "dev", "timed_out"),
      doneCard("p1", "failed", {}, NOW - 5 * HOUR),
    ], boards, NOW, none).active;
    expect(rows.map((row) => `${row.task.id}:${row.reason}:P${row.severity}`)).toEqual(["i:interrupted:P1", "p1:doneFailed:P1", "p3:unmerged:P3"]);
  });

  it("event time falls back completedAt → lastActivityAt → startedAt", () => {
    const at = (overrides: Parameters<typeof interruptedCard>[4]) => buildWorkspaceInbox(WS, [interruptedCard("i", "dev", "failed", {}, overrides)], boards, NOW, none).active[0].eventAt;
    expect(at({ completedAt: iso(NOW - HOUR), lastActivityAt: iso(NOW - 2 * HOUR), startedAt: iso(NOW - 3 * HOUR) })).toBe(NOW - HOUR);
    expect(at({ completedAt: undefined, lastActivityAt: iso(NOW - 2 * HOUR), startedAt: iso(NOW - 3 * HOUR) })).toBe(NOW - 2 * HOUR);
    expect(at({ completedAt: undefined, lastActivityAt: undefined, startedAt: iso(NOW - 3 * HOUR) })).toBe(NOW - 3 * HOUR);
  });

  it("carries the failed run and the lane name; the dismiss key holds the run id", () => {
    const [row] = buildWorkspaceInbox(WS, [interruptedCard("i", "dev")], boards, NOW, none).active;
    expect(row.interruptedRun?.sessionId).toBe("i-run");
    expect(row.columnName).toBe("Dev");
    expect(row.dismissKey).toBe("i|interrupted|i-run");
  });

  it("hidden for one failed run, shown again after a new failed run", () => {
    const hidden = () => ["i|interrupted|i-run"];
    expect(buildWorkspaceInbox(WS, [interruptedCard("i", "dev")], boards, NOW, hidden).dismissed).toHaveLength(1);
    const again = buildWorkspaceInbox(WS, [interruptedCard("i", "dev", "failed", {}, { sessionId: "i-run-2" })], boards, NOW, hidden);
    expect(again.active.map((row) => row.dismissKey)).toEqual(["i|interrupted|i-run-2"]);
  });

  it("lane name falls back board column → run columnName → column id", () => {
    expect(inboxColumnName({ columnId: "dev" }, boards[0], { columnName: "Run lane" })).toBe("Dev");
    expect(inboxColumnName({ columnId: "review" }, boards[0], { columnName: "Run lane" })).toBe("Run lane");
    expect(inboxColumnName({ columnId: "review" }, undefined, null)).toBe("review");
  });

  it("links to the card (no completion tab)", () => {
    const [row] = buildWorkspaceInbox(WS, [interruptedCard("i", "dev")], boards, NOW, none).active;
    expect(inboxRowHref(row)).toBe("/workspace/w1/kanban?boardId=b1&taskId=i");
  });

  it("the home banner count grows by one and still equals the all-projects overview", () => {
    const base = [doneCard("f", "failed"), card("b", { columnId: "blocked" })];
    const before = summarizeWorkspace(WS, base, boards, NOW, none).needsYou;
    const withInterrupted = [...base, interruptedCard("i", "review", "timed_out")];
    const after = summarizeWorkspace(WS, withInterrupted, boards, NOW, none);
    expect(after.needsYou).toBe(before + 1);
    expect(after.needsYou).toBe(buildWorkspaceRow(WS, withInterrupted, boards, NOW, "", none).attention.length);
  });
});
