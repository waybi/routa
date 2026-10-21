/**
 * "When did this card enter Done?" and the Done-column day segments.
 *
 * `updatedAt` is a poor proxy: any edit (or a page load that touches the
 * worktree) refreshes it and reshuffles the Done lane. The lane-session log
 * records when the Done automation started, so the entry time is the first
 * session of the *trailing* run of Done sessions. Everything here is pure and
 * takes `now` as an argument so tests can pin the clock.
 */

import type { TaskInfo } from "../types";

export const DONE_LANE_ID = "done";

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

function parseTime(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The trailing run of consecutive `columnId === "done"` sessions, oldest
 * first. Empty when the last session is not a Done session (e.g. the card was
 * just dragged back into Done and automation has not started yet).
 */
export function getTrailingDoneSessions(task: Pick<TaskInfo, "laneSessions">): LaneSession[] {
  const sessions = task.laneSessions ?? [];
  let start = sessions.length;
  while (start > 0 && sessions[start - 1]?.columnId === DONE_LANE_ID) {
    start -= 1;
  }
  return sessions.slice(start);
}

/**
 * Epoch ms the card entered Done: first session of the trailing Done run,
 * else `updatedAt`, else `createdAt`, else 0.
 */
export function getDoneEnteredAt(task: Pick<TaskInfo, "laneSessions" | "updatedAt" | "createdAt">): number {
  const trailing = getTrailingDoneSessions(task);
  const fromSession = trailing.length > 0 ? parseTime(trailing[0].startedAt) : 0;
  return fromSession || parseTime(task.updatedAt) || parseTime(task.createdAt) || 0;
}

export type DoneSegmentKey = "today" | "yesterday" | "thisWeek" | "older";

export const DONE_SEGMENT_ORDER: readonly DoneSegmentKey[] = ["today", "yesterday", "thisWeek", "older"];

export interface DoneSegmentBounds {
  todayStart: number;
  yesterdayStart: number;
  weekStart: number;
}

/** Local-time boundaries. Uses calendar arithmetic so DST days stay correct. */
export function getDoneSegmentBounds(now: Date): DoneSegmentBounds {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const daysSinceMonday = (now.getDay() + 6) % 7;
  return {
    todayStart: new Date(y, m, d).getTime(),
    yesterdayStart: new Date(y, m, d - 1).getTime(),
    weekStart: new Date(y, m, d - daysSinceMonday).getTime(),
  };
}

export function getDoneSegmentOf(timestamp: number, bounds: DoneSegmentBounds): DoneSegmentKey {
  if (timestamp >= bounds.todayStart) return "today";
  if (timestamp >= bounds.yesterdayStart) return "yesterday";
  // On Monday weekStart === todayStart, so this range is empty by construction.
  if (timestamp >= bounds.weekStart) return "thisWeek";
  return "older";
}

export type DoneSegments = Record<DoneSegmentKey, TaskInfo[]>;

/** Splits (already sorted) Done cards into day segments, keeping input order. */
export function segmentDoneTasks(tasks: readonly TaskInfo[], now: Date): DoneSegments {
  const bounds = getDoneSegmentBounds(now);
  const segments: DoneSegments = { today: [], yesterday: [], thisWeek: [], older: [] };
  for (const task of tasks) {
    segments[getDoneSegmentOf(getDoneEnteredAt(task), bounds)].push(task);
  }
  return segments;
}

/** The first two non-empty segments in today → older order. */
export function defaultExpandedSegments(segments: DoneSegments): DoneSegmentKey[] {
  return DONE_SEGMENT_ORDER.filter((key) => segments[key].length > 0).slice(0, 2);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "HH:mm" for today/yesterday, "M-D" otherwise (local time). */
export function formatDoneEnteredAt(timestamp: number, segment: DoneSegmentKey): string {
  const date = new Date(timestamp);
  if (segment === "today" || segment === "yesterday") {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }
  return `${date.getMonth() + 1}-${date.getDate()}`;
}
