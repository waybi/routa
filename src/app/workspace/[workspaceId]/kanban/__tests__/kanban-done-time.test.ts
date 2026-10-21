import { describe, expect, it } from "vitest";
import {
  defaultExpandedSegments,
  formatDoneEnteredAt,
  getDoneEnteredAt,
  getTrailingDoneSessions,
  segmentDoneTasks,
} from "../kanban-done-time";
import type { TaskInfo } from "../../types";

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

function session(columnId: string, startedAt: string, status: LaneSession["status"] = "completed"): LaneSession {
  return { sessionId: `${columnId}-${startedAt}`, columnId, startedAt, status };
}

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: id,
    status: "COMPLETED",
    columnId: "done",
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as TaskInfo;
}

/** Local-time epoch for the given calendar slot (tests stay timezone-agnostic). */
function local(y: number, m: number, d: number, h = 0, min = 0): number {
  return new Date(y, m - 1, d, h, min).getTime();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

describe("getDoneEnteredAt (AC1)", () => {
  it("uses the first session of the trailing done run: [dev, done@10:00, done@10:05] → 10:00", () => {
    const tenOClock = local(2026, 10, 20, 10, 0);
    const result = getDoneEnteredAt(task("a", {
      updatedAt: iso(local(2026, 10, 21, 9)),
      laneSessions: [
        session("dev", iso(local(2026, 10, 20, 9))),
        session("done", iso(tenOClock)),
        session("done", iso(local(2026, 10, 20, 10, 5))),
      ],
    }));
    expect(result).toBe(tenOClock);
  });

  it("ignores an earlier done run: [done@day1, dev, done@day3] → day 3", () => {
    const day3 = local(2026, 10, 3, 8);
    const result = getDoneEnteredAt(task("a", {
      laneSessions: [
        session("done", iso(local(2026, 10, 1, 8))),
        session("dev", iso(local(2026, 10, 2, 8))),
        session("done", iso(day3)),
      ],
    }));
    expect(result).toBe(day3);
  });

  it("falls back to updatedAt when the last session is not done: [done, dev]", () => {
    const updatedAt = local(2026, 10, 21, 12);
    const input = task("a", {
      updatedAt: iso(updatedAt),
      laneSessions: [session("done", iso(local(2026, 10, 1))), session("dev", iso(local(2026, 10, 2)))],
    });
    expect(getTrailingDoneSessions(input)).toEqual([]);
    expect(getDoneEnteredAt(input)).toBe(updatedAt);
  });

  it("falls back to updatedAt when there are no lane sessions", () => {
    const updatedAt = local(2026, 10, 21, 12);
    expect(getDoneEnteredAt(task("a", { updatedAt: iso(updatedAt) }))).toBe(updatedAt);
    expect(getDoneEnteredAt(task("b", { updatedAt: iso(updatedAt), laneSessions: [] }))).toBe(updatedAt);
  });

  it("falls back to createdAt when updatedAt is missing, and 0 when nothing parses", () => {
    const createdAt = local(2026, 9, 1, 7);
    expect(getDoneEnteredAt(task("a", { createdAt: iso(createdAt) }))).toBe(createdAt);
    expect(getDoneEnteredAt(task("b", { createdAt: "nope", updatedAt: "bad" }))).toBe(0);
  });
});

describe("segmentDoneTasks (AC3)", () => {
  // Wednesday 2026-10-21 15:00 local; Monday of that week is 10-19.
  const wednesday = new Date(2026, 9, 21, 15, 0);
  const at = (id: string, ms: number) => task(id, { updatedAt: iso(ms) });

  it("splits an ordinary weekday into today / yesterday / thisWeek / older", () => {
    const segments = segmentDoneTasks([
      at("today-start", local(2026, 10, 21, 0, 0)),
      at("today-late", local(2026, 10, 21, 14, 59)),
      at("yesterday", local(2026, 10, 20, 23, 59)),
      at("yesterday-start", local(2026, 10, 20, 0, 0)),
      at("monday", local(2026, 10, 19, 0, 0)),
      at("sunday", local(2026, 10, 18, 23, 59)),
    ], wednesday);
    expect(segments.today.map((item) => item.id)).toEqual(["today-start", "today-late"]);
    expect(segments.yesterday.map((item) => item.id)).toEqual(["yesterday", "yesterday-start"]);
    expect(segments.thisWeek.map((item) => item.id)).toEqual(["monday"]);
    expect(segments.older.map((item) => item.id)).toEqual(["sunday"]);
    expect(defaultExpandedSegments(segments)).toEqual(["today", "yesterday"]);
  });

  it("leaves thisWeek empty on Monday (yesterday = Sunday)", () => {
    const monday = new Date(2026, 9, 19, 9, 0);
    const segments = segmentDoneTasks([
      at("today", local(2026, 10, 19, 8)),
      at("sunday", local(2026, 10, 18, 12)),
      at("saturday", local(2026, 10, 17, 12)),
    ], monday);
    expect(segments.today.map((item) => item.id)).toEqual(["today"]);
    expect(segments.yesterday.map((item) => item.id)).toEqual(["sunday"]);
    expect(segments.thisWeek).toEqual([]);
    expect(segments.older.map((item) => item.id)).toEqual(["saturday"]);
  });

  it("treats Sunday as the last day of the week (Monday is 6 days back)", () => {
    const sunday = new Date(2026, 9, 25, 9, 0);
    const segments = segmentDoneTasks([
      at("monday", local(2026, 10, 19, 1)),
      at("prev-sunday", local(2026, 10, 18, 23)),
    ], sunday);
    expect(segments.thisWeek.map((item) => item.id)).toEqual(["monday"]);
    expect(segments.older.map((item) => item.id)).toEqual(["prev-sunday"]);
  });

  it("expands yesterday and thisWeek by default when today is empty", () => {
    const segments = segmentDoneTasks([
      at("yesterday", local(2026, 10, 20, 12)),
      at("monday", local(2026, 10, 19, 12)),
      at("older", local(2026, 10, 1, 12)),
    ], wednesday);
    expect(segments.today).toEqual([]);
    expect(defaultExpandedSegments(segments)).toEqual(["yesterday", "thisWeek"]);
  });
});

describe("formatDoneEnteredAt", () => {
  it("shows HH:mm for today and yesterday, M-D otherwise", () => {
    const ms = local(2026, 3, 7, 9, 5);
    expect(formatDoneEnteredAt(ms, "today")).toBe("09:05");
    expect(formatDoneEnteredAt(ms, "yesterday")).toBe("09:05");
    expect(formatDoneEnteredAt(ms, "thisWeek")).toBe("3-7");
    expect(formatDoneEnteredAt(ms, "older")).toBe("3-7");
  });
});
