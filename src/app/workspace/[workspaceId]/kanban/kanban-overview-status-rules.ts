/**
 * Status rules of the all-projects overview (card f8fcc22b): which of the four
 * states a card is in, the status-bar counts, the pipeline position of a card,
 * and the 7-day rhythm of a project. Pure: `now` is always passed in.
 */

import type { TaskInfo } from "../types";
import { ATTENTION_DONE_WINDOW_MS } from "./kanban-attention-rules";
import { DONE_LANE_ID, getDoneEnteredAt } from "./kanban-done-time";
import {
  computeCardDuration,
  emptyBuckets,
  medianMs,
  DURATION_BUCKET_ORDER,
  type DurationBuckets,
} from "./kanban-overview-duration";
import type { OverviewRow } from "./kanban-overview-rules";

export type OverviewStatus = "running" | "queued" | "attention" | "done";

/** Lanes whose cards wait for a worker even when a run is recorded (planning lanes). */
const WAITING_LANES: readonly string[] = ["backlog", "todo"];

type SessionLike = NonNullable<TaskInfo["laneSessions"]>[number];

/** Epoch ms of the local midnight that starts `now`'s day. */
export function startOfLocalDay(now: number, daysBack = 0): number {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysBack).getTime();
}

/** True when the card entered Done on the local day of `now`. */
export function isDoneToday(task: Pick<TaskInfo, "columnId" | "laneSessions" | "updatedAt" | "createdAt">, now: number): boolean {
  if (task.columnId !== DONE_LANE_ID) return false;
  const entered = getDoneEnteredAt(task);
  return entered >= startOfLocalDay(now) && entered < startOfLocalDay(now, -1);
}

/** The run that is "current" for the card: its trigger session, else the newest run in its column. */
export function currentLaneSession(task: Pick<TaskInfo, "columnId" | "triggerSessionId" | "laneSessions">): SessionLike | null {
  const sessions = Array.isArray(task.laneSessions) ? task.laneSessions : [];
  if (task.triggerSessionId) {
    const triggered = sessions.find((session) => session.sessionId === task.triggerSessionId);
    if (triggered) return triggered;
  }
  let current: SessionLike | null = null;
  for (const session of sessions) {
    if (session.columnId !== task.columnId) continue;
    if (!current || Date.parse(session.startedAt) >= Date.parse(current.startedAt)) current = session;
  }
  return current;
}

/**
 * State of one card. Cards in `attentionTaskIds` (Blocked, interrupted, ...)
 * are "attention" unless they are Done. Dev/Review (and custom lanes) with a
 * running current run are "running"; everything else that is not Done waits.
 */
export function classifyOverviewTask(task: TaskInfo, attentionTaskIds: ReadonlySet<string>): OverviewStatus {
  if (task.columnId === DONE_LANE_ID) return "done";
  if (attentionTaskIds.has(task.id)) return "attention";
  if (WAITING_LANES.includes(task.columnId ?? "")) return "queued";
  return currentLaneSession(task)?.status === "running" ? "running" : "queued";
}

export interface StatusBarCounts {
  running: number;
  queued: number;
  attention: number;
  doneToday: number;
}

/**
 * Status-bar numbers over every workspace. "Done today" counts ALL Done cards
 * that entered Done on the local day of `now` (not the 3 shown per project).
 */
export function countStatusBar(
  rows: ReadonlyArray<Pick<OverviewRow, "tasks" | "attentionAll">>,
  now: number,
): StatusBarCounts {
  const counts: StatusBarCounts = { running: 0, queued: 0, attention: 0, doneToday: 0 };
  for (const row of rows) {
    const attentionIds = new Set(row.attentionAll.map((entry) => entry.task.id));
    counts.attention += attentionIds.size;
    for (const task of row.tasks) {
      if (isDoneToday(task, now)) counts.doneToday += 1;
      const status = classifyOverviewTask(task, attentionIds);
      if (status === "running") counts.running += 1;
      else if (status === "queued") counts.queued += 1;
    }
  }
  return counts;
}

/** Position on the 5-step pipeline Backlog → Todo → Dev → Review → Done. */
export const PIPELINE_STEPS: readonly string[] = ["backlog", "todo", "dev", "review", "done"];

export interface LaneProgress {
  /** 1..5 position on the pipeline. */
  step: number;
  /** Specialist (else step / role) name of the current run; null without a run. */
  specialistName: string | null;
  /** 1-based step number inside the lane (stepIndex + 1); null when unknown. */
  stepNumber: number | null;
  /** How long the current run has been running; null when it is not running. */
  runningMs: number | null;
  /** The current run failed or timed out. */
  failed: boolean;
}

export function pipelineStepOf(columnId: string | undefined): number {
  if (columnId === "blocked") return 4;
  const index = PIPELINE_STEPS.indexOf(columnId ?? "");
  return index === -1 ? 3 : index + 1;
}

export function laneProgress(task: TaskInfo, now: number): LaneProgress {
  const session = currentLaneSession(task);
  const started = session ? Date.parse(session.startedAt) : 0;
  return {
    step: pipelineStepOf(task.columnId),
    specialistName: session ? (session.specialistName || session.stepName || session.role || null) : null,
    stepNumber: session && typeof session.stepIndex === "number" ? session.stepIndex + 1 : null,
    runningMs: session?.status === "running" && started ? Math.max(0, now - started) : null,
    failed: session?.status === "failed" || session?.status === "timed_out",
  };
}

export const RHYTHM_DAYS = 7;

export interface RhythmSummary {
  count: number;
  totalMs: number;
  /** Cards finished per local day, oldest first; the last item is today. */
  perDay: number[];
  buckets: DurationBuckets;
  /** Median AI time per card (mean of the two middle values when even); null without cards. */
  medianMs: number | null;
  reworkCards: number;
  stuckCards: number;
  stuckMs: number;
}

/** Rhythm of Done cards (already limited to the 7-day window). */
export function summarizeRhythm(tasks: readonly TaskInfo[], now: number): RhythmSummary {
  const dayStarts = Array.from({ length: RHYTHM_DAYS }, (_, index) => startOfLocalDay(now, RHYTHM_DAYS - 1 - index));
  const perDay = new Array<number>(RHYTHM_DAYS).fill(0);
  const buckets = emptyBuckets();
  const totals: number[] = [];
  let reworkCards = 0;
  let stuckCards = 0;
  let stuckMs = 0;
  for (const task of tasks) {
    const entered = getDoneEnteredAt(task);
    let day = 0;
    for (let index = RHYTHM_DAYS - 1; index > 0; index -= 1) {
      if (entered >= dayStarts[index]) { day = index; break; }
    }
    perDay[day] += 1;
    const duration = computeCardDuration(task, now);
    totals.push(duration.totalMs);
    for (const key of DURATION_BUCKET_ORDER) buckets[key] += duration.buckets[key];
    if (duration.reworkCount > 0) reworkCards += 1;
    if (duration.stuckCount > 0) {
      stuckCards += 1;
      stuckMs += duration.stuckMs;
    }
  }
  return {
    count: tasks.length,
    totalMs: totals.reduce((sum, value) => sum + value, 0),
    perDay,
    buckets,
    medianMs: medianMs(totals),
    reworkCards,
    stuckCards,
    stuckMs,
  };
}

/** Done cards inside the 7-day window, newest first. */
export function withinDoneWindow(task: TaskInfo, now: number): boolean {
  return task.columnId === DONE_LANE_ID && now - getDoneEnteredAt(task) <= ATTENTION_DONE_WINDOW_MS;
}
