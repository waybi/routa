/**
 * AI time of one card, derived from its lane-session log (never stored).
 *
 * Rules (card f8fcc22b, AC6):
 * - Counted: every lane session from the first one up to the END of the first
 *   run of consecutive Done sessions ("first completion report"). Sessions
 *   after that point (a later re-run) are ignored. A card that never reached
 *   Done counts all its sessions.
 * - One session = completedAt − startedAt. A running session ends at `now`.
 *   A non-running session without completedAt ends at lastActivityAt; with
 *   neither it counts 0. Negative spans count 0. Queue and waiting time never
 *   count because only session spans are summed.
 * - "Stuck" = a session whose status is `timed_out` (the worker already
 *   decided it; recoveryReason says why). Its whole span goes to the `stuck`
 *   bucket and NOT to its lane. No minute threshold lives here.
 * - Rework = dev-lane sessions − 1 (minimum 0), within the counted sessions.
 * - Buckets: prepare = backlog+todo, build = dev, check = review+blocked,
 *   finish = done; a session in any other (custom) lane counts as build so
 *   that the five buckets always add up to the total.
 */

import type { TaskInfo } from "../types";
import { DONE_LANE_ID } from "./kanban-done-time";

export type DurationBucketKey = "prepare" | "build" | "check" | "finish" | "stuck";

export const DURATION_BUCKET_ORDER: readonly DurationBucketKey[] = ["prepare", "build", "check", "finish", "stuck"];

export type DurationBuckets = Record<DurationBucketKey, number>;

export interface CardDuration {
  totalMs: number;
  buckets: DurationBuckets;
  /** dev-lane sessions − 1, minimum 0. */
  reworkCount: number;
  /** Sum of the timed_out sessions (same as buckets.stuck). */
  stuckMs: number;
  /** Number of timed_out sessions. */
  stuckCount: number;
}

type SessionLike = NonNullable<TaskInfo["laneSessions"]>[number];

function parseTime(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function emptyBuckets(): DurationBuckets {
  return { prepare: 0, build: 0, check: 0, finish: 0, stuck: 0 };
}

function laneBucket(columnId: string | undefined): Exclude<DurationBucketKey, "stuck"> {
  switch (columnId) {
    case "backlog":
    case "todo":
      return "prepare";
    case "review":
    case "blocked":
      return "check";
    case DONE_LANE_ID:
      return "finish";
    default:
      return "build";
  }
}

/** Index (inclusive) of the last session that still counts. */
function countedEnd(sessions: readonly SessionLike[]): number {
  const firstDone = sessions.findIndex((session) => session.columnId === DONE_LANE_ID);
  if (firstDone === -1) return sessions.length - 1;
  let end = firstDone;
  while (end + 1 < sessions.length && sessions[end + 1].columnId === DONE_LANE_ID) end += 1;
  return end;
}

function sessionSpanMs(session: SessionLike, now: number): number {
  const start = parseTime(session.startedAt);
  if (!start) return 0;
  const end = session.status === "running"
    ? now
    : parseTime(session.completedAt) || parseTime(session.lastActivityAt);
  return end > start ? end - start : 0;
}

export function computeCardDuration(task: Pick<TaskInfo, "laneSessions">, now: number): CardDuration {
  const sessions = Array.isArray(task.laneSessions) ? task.laneSessions : [];
  const buckets = emptyBuckets();
  let devSessions = 0;
  let stuckCount = 0;
  const end = countedEnd(sessions);
  for (let index = 0; index <= end; index += 1) {
    const session = sessions[index];
    if (!session) continue;
    if (session.columnId === "dev") devSessions += 1;
    const span = sessionSpanMs(session, now);
    if (session.status === "timed_out") {
      buckets.stuck += span;
      stuckCount += 1;
    } else {
      buckets[laneBucket(session.columnId)] += span;
    }
  }
  const totalMs = DURATION_BUCKET_ORDER.reduce((sum, key) => sum + buckets[key], 0);
  return { totalMs, buckets, reworkCount: Math.max(0, devSessions - 1), stuckMs: buckets.stuck, stuckCount };
}

/** Median of the values; an even count gives the mean of the two middle values; null when empty. */
export function medianMs(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** "45 分" / "1.5 时" style is a display matter; this gives hours with one decimal. */
export function msToHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}
