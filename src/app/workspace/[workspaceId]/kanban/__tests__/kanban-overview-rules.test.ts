import { describe, expect, it } from "vitest";
import {
  buildWorkspaceRow,
  collectRecentDone,
  collectWorkspaceAttention,
  formatDoneShort,
  groupTasksByBoard,
  overviewTaskHref,
  shortSha,
  sortInProgress,
  sortOverviewRows,
} from "../kanban-overview-rules";
import { ATTENTION_DONE_WINDOW_MS } from "../kanban-attention-rules";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

const NOW = Date.UTC(2026, 9, 21, 12);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const none = () => [] as readonly string[];

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function doneSession(startedAt: number, status: LaneSession["status"] = "completed"): LaneSession {
  return { sessionId: `done-${startedAt}`, columnId: "done", startedAt: iso(startedAt), status };
}

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: `title ${id}`,
    status: "PENDING",
    columnId: "dev",
    createdAt: iso(NOW - 30 * DAY),
    updatedAt: iso(NOW - HOUR),
    ...overrides,
  } as TaskInfo;
}

function doneTask(id: string, enteredAt: number, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return task(id, {
    columnId: "done",
    status: "COMPLETED",
    laneSessions: [doneSession(enteredAt)],
    completionReport: { excerpt: `report ${id}`, commit: `${id}abcdef0123`, hasLeftover: false, createdAt: iso(enteredAt) },
    ...overrides,
  });
}

function makeBoard(id: string, withPusher: boolean, isDefault = false): KanbanBoardInfo {
  return {
    id,
    workspaceId: "ws",
    name: id,
    isDefault,
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      {
        id: "done",
        name: "Done",
        position: 1,
        stage: "done",
        automation: withPusher ? { enabled: true, steps: [{ id: "p", specialistId: "kanban-main-pusher" }] } : { enabled: true, steps: [] },
      },
    ],
    createdAt: iso(0),
    updatedAt: iso(0),
  };
}

const unmerged = { landedOnBase: false, commitsSinceBase: 2 } as TaskInfo["deliveryLanding"];

describe("sortInProgress (AC3 ①)", () => {
  it("orders by lane, newest first within a lane, unknown lanes last, Done excluded", () => {
    const tasks = [
      task("rev", { columnId: "review" }),
      task("x", { columnId: "custom" }),
      task("dev-old", { columnId: "dev", updatedAt: iso(NOW - 5 * HOUR) }),
      task("dev-new", { columnId: "dev", updatedAt: iso(NOW - HOUR) }),
      task("blk", { columnId: "blocked" }),
      task("bk", { columnId: "backlog" }),
      task("td", { columnId: "todo" }),
      doneTask("d", NOW - HOUR),
    ];
    expect(sortInProgress(tasks).map((t) => t.id)).toEqual(["bk", "td", "dev-new", "dev-old", "rev", "blk", "x"]);
  });
});

describe("groupTasksByBoard", () => {
  it("puts cards without or with an unknown boardId on the default board", () => {
    const boards = [makeBoard("b1", true), makeBoard("b2", false, true)];
    const groups = groupTasksByBoard([task("a", { boardId: "b1" }), task("b"), task("c", { boardId: "gone" })], boards);
    expect(groups.get("b1")?.map((t) => t.id)).toEqual(["a"]);
    expect(groups.get("b2")?.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("falls back to the first board when there is no default", () => {
    const groups = groupTasksByBoard([task("a")], [makeBoard("first", true), makeBoard("second", true)]);
    expect(groups.get("first")?.map((t) => t.id)).toEqual(["a"]);
  });
});

describe("collectWorkspaceAttention (AC3 ②)", () => {
  it("evaluates per board: unmerged only on the board with a main pusher", () => {
    const boards = [makeBoard("pusher", true, true), makeBoard("plain", false)];
    const tasks = [
      doneTask("u1", NOW - HOUR, { boardId: "pusher", deliveryLanding: unmerged }),
      doneTask("u2", NOW - HOUR, { boardId: "plain", deliveryLanding: unmerged }),
      task("blk", { columnId: "blocked", boardId: "plain" }),
    ];
    const entries = collectWorkspaceAttention(tasks, boards, NOW, none);
    expect(entries.map((e) => [e.task.id, e.item.kind, e.boardId])).toEqual([
      ["u1", "unmerged", "pusher"],
      ["blk", "blocked", "plain"],
    ]);
  });

  it("drops items dismissed on that board", () => {
    const boards = [makeBoard("b1", true, true)];
    const tasks = [task("blk", { columnId: "blocked" }), doneTask("u", NOW - HOUR, { deliveryLanding: unmerged })];
    const dismissed = (boardId: string) => (boardId === "b1" ? ["blk|blocked|0"] : []);
    expect(collectWorkspaceAttention(tasks, boards, NOW, dismissed).map((e) => e.item.kind)).toEqual(["unmerged"]);
  });
});

describe("collectRecentDone (AC3 ③ / AC6)", () => {
  it("keeps the 7-day window inclusive at the edge and exclusive 1 ms past it", () => {
    const tasks = [
      doneTask("edge", NOW - ATTENTION_DONE_WINDOW_MS),
      doneTask("past", NOW - ATTENTION_DONE_WINDOW_MS - 1),
    ];
    expect(collectRecentDone(tasks, NOW, "").items.map((t) => t.id)).toEqual(["edge"]);
  });

  it("returns total plus the newest 3", () => {
    const tasks = [1, 2, 3, 4, 5].map((n) => doneTask(`d${n}`, NOW - n * HOUR));
    const result = collectRecentDone(tasks, NOW, "");
    expect(result.total).toBe(5);
    expect(result.items.map((t) => t.id)).toEqual(["d1", "d2", "d3"]);
  });

  it("with a query drops the window and cap: a 30-day-old card matching only by commit", () => {
    const old = doneTask("old", NOW - 30 * DAY, {
      title: "unrelated",
      completionReport: { excerpt: "nothing", commit: "feedbee1234567", hasLeftover: false, createdAt: iso(NOW - 30 * DAY) },
    });
    const tasks = [old, ...[1, 2, 3, 4].map((n) => doneTask(`d${n}`, NOW - n * HOUR, { completionReport: { excerpt: "x", commit: `feedbee${n}`, hasLeftover: false, createdAt: iso(NOW) } }))];
    const result = collectRecentDone(tasks, NOW, "feedbee");
    expect(result.total).toBe(5);
    expect(result.items.map((t) => t.id)).toEqual(["d1", "d2", "d3", "d4", "old"]);
  });
});

describe("buildWorkspaceRow / sortOverviewRows (AC3 / AC4)", () => {
  const boards = [makeBoard("b1", false, true)];

  it("builds blocks, badge, score and collapse", () => {
    const row = buildWorkspaceRow({ id: "w", title: "W" }, [
      task("a"),
      task("blk", { columnId: "blocked" }),
      doneTask("d", NOW - HOUR),
      doneTask("old", NOW - 20 * DAY),
    ], boards, NOW, "", none);
    expect(row.totalCount).toBe(4);
    expect(row.inProgress.map((t) => t.id)).toEqual(["a", "blk"]);
    expect(row.attention.map((e) => e.item.kind)).toEqual(["blocked"]);
    expect(row.recentDone.total).toBe(1);
    expect(row.score).toBe(2 * 3 + 1 * 2 + 1);
    expect(row.collapsed).toBe(false);
    expect(row.showsNoUnmergedBadge).toBe(true);
    expect(buildWorkspaceRow({ id: "w", title: "W" }, [], [makeBoard("b", true, true)], NOW, "", none).showsNoUnmergedBadge).toBe(false);
  });

  it("collapses a row with three empty blocks", () => {
    const row = buildWorkspaceRow({ id: "w", title: "W" }, [doneTask("old", NOW - 20 * DAY)], boards, NOW, "", none);
    expect(row.collapsed).toBe(true);
    expect(row.totalCount).toBe(1);
  });

  it("filters blocks by query and collapses rows without hits", () => {
    const tasks = [task("a", { title: "alpha" }), task("b", { title: "beta" })];
    const hit = buildWorkspaceRow({ id: "w", title: "W" }, tasks, boards, NOW, "alp", none);
    expect(hit.inProgress.map((t) => t.id)).toEqual(["a"]);
    expect(buildWorkspaceRow({ id: "w", title: "W" }, tasks, boards, NOW, "zzz", none).collapsed).toBe(true);
  });

  it("sorts expanded rows by score desc, ties by title, collapsed rows last", () => {
    const rows = [
      { title: "Zed", score: 0, collapsed: true },
      { title: "Beta", score: 5, collapsed: false },
      { title: "Alpha", score: 5, collapsed: false },
      { title: "Gamma", score: 9, collapsed: false },
      { title: "Able", score: 0, collapsed: true },
    ];
    expect(sortOverviewRows(rows).map((r) => r.title)).toEqual(["Gamma", "Alpha", "Beta", "Able", "Zed"]);
  });
});

describe("formatting helpers", () => {
  it("formats local M-D HH:mm and 7-char commits", () => {
    const ts = new Date(2026, 9, 5, 7, 3).getTime();
    expect(formatDoneShort(ts)).toBe("10-5 07:03");
    expect(shortSha("0123456789")).toBe("0123456");
    expect(shortSha(null)).toBeNull();
  });

  it("builds the card href without view", () => {
    expect(overviewTaskHref({ id: "t1", boardId: "b1" }, "ws 1", null)).toBe("/workspace/ws%201/kanban?boardId=b1&taskId=t1");
    expect(overviewTaskHref({ id: "t1" }, "ws", "fallback")).toBe("/workspace/ws/kanban?boardId=fallback&taskId=t1");
  });
});
