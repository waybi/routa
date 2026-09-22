/**
 * Card run status derivation.
 *
 * `acpStatus` only has three values (connecting | ready | error), and the card
 * rendered `ready` as "live". But `ready` means "the ACP process is alive",
 * not "the agent is producing output" — a finished agent waiting for its next
 * prompt looked exactly like one mid-task. Users could not tell from the board
 * whether it was time to go look at the result.
 *
 * This module folds the process status together with the lane-session record
 * (which does carry terminal state and activity timestamps) into a status the
 * board can actually act on.
 */

import type { TaskInfo } from "../types";

export type KanbanCardRunStatus =
  | "queued"
  | "starting"
  | "working"
  | "idle"
  | "completed"
  | "failed";

/**
 * How recently the lane session must have emitted something to count as
 * actively working. Chosen to comfortably exceed a slow tool round-trip while
 * still flipping to "idle" within one glance of the agent going quiet.
 */
export const CARD_WORKING_ACTIVITY_WINDOW_MS = 30_000;

type AcpStatus = "connecting" | "ready" | "error" | undefined;

export interface ResolveCardRunStatusInput {
  task: Pick<TaskInfo, "columnId" | "triggerSessionId" | "laneSessions">;
  acpStatus: AcpStatus;
  queuePosition?: number;
  /** Injected for deterministic tests. */
  now?: number;
}

function toTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The lane session record for the run currently attached to the card. */
function findCurrentLaneSession(task: ResolveCardRunStatusInput["task"]) {
  const laneSessions = task.laneSessions ?? [];
  if (task.triggerSessionId) {
    const match = laneSessions.find((entry) => entry.sessionId === task.triggerSessionId);
    if (match) return match;
  }
  // Fall back to the most recently started record.
  return [...laneSessions]
    .sort((left, right) => (toTimestamp(right.startedAt) ?? 0) - (toTimestamp(left.startedAt) ?? 0))[0];
}

export function resolveCardRunStatus({
  task,
  acpStatus,
  queuePosition,
  now = Date.now(),
}: ResolveCardRunStatusInput): KanbanCardRunStatus {
  if (queuePosition) return "queued";
  if (acpStatus === "error") return "failed";
  if (acpStatus === "connecting") return "starting";

  const laneSession = findCurrentLaneSession(task);

  // Terminal lane state wins over the process being alive: a completed run
  // whose process lingers is "completed", not "live".
  if (laneSession?.status === "failed" || laneSession?.status === "timed_out") return "failed";
  if (laneSession?.status === "completed" || laneSession?.status === "transitioned") return "completed";

  if (acpStatus !== "ready") {
    // No live process. Done/blocked columns are terminal by definition.
    if (task.columnId === "done") return "completed";
    return "idle";
  }

  // Process alive: distinguish actually-working from parked-and-waiting.
  const lastActivityAt = toTimestamp(laneSession?.lastActivityAt)
    ?? toTimestamp(laneSession?.startedAt);
  if (lastActivityAt === undefined) {
    // Alive but no activity record at all — treat as working so a fresh run is
    // not mislabelled idle before its first event lands.
    return "working";
  }
  return now - lastActivityAt <= CARD_WORKING_ACTIVITY_WINDOW_MS ? "working" : "idle";
}

/** i18n key under the `kanban` dictionary for each status. */
export function cardRunStatusLabelKey(status: KanbanCardRunStatus): string {
  switch (status) {
    case "queued":
      return "queued";
    case "starting":
      return "starting";
    case "working":
      return "working";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "idle":
    default:
      return "idle";
  }
}

export function cardRunStatusTone(status: KanbanCardRunStatus): string {
  switch (status) {
    case "queued":
      return "bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40";
    case "starting":
      return "bg-sky-100 text-sky-700 ring-1 ring-inset ring-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:ring-sky-900/40";
    case "working":
      return "bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-900/40";
    case "completed":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/10 dark:text-emerald-300 dark:ring-emerald-900/30";
    case "failed":
      return "bg-rose-100 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:ring-rose-900/40";
    case "idle":
    default:
      return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-300 dark:ring-white/5";
  }
}

/** Only an actively-working card animates; a parked one must look parked. */
export function cardRunStatusDotClass(status: KanbanCardRunStatus): string {
  switch (status) {
    case "working":
      return "animate-pulse bg-emerald-500";
    case "starting":
      return "animate-pulse bg-sky-500";
    case "failed":
      return "bg-rose-500";
    case "completed":
      return "bg-emerald-500";
    case "queued":
      return "bg-amber-500";
    case "idle":
    default:
      return "bg-slate-400";
  }
}

// ─── Merge state (done ≠ merged) ────────────────────────────────────────

export type KanbanCardMergeState = "unmerged" | "merged" | "unknown";

/**
 * Whether a done card's branch has actually landed on the base branch.
 *
 * `done` on the board only means the column automation finished; the task
 * branch may still be sitting in its worktree (e.g. Gerrit repos where the
 * PR publisher cannot open a PR). Only cards that carry commits beyond the
 * base are classified — a done card with nothing to merge is `unknown`
 * rather than `merged`, so the badge never claims a landing that never
 * happened.
 */
export function resolveCardMergeState(
  task: Pick<TaskInfo, "columnId" | "deliveryReadiness" | "deliveryLanding">,
): KanbanCardMergeState {
  if (task.columnId !== "done") return "unknown";
  // The list endpoint ships the cheap `deliveryLanding` probe; the detail
  // endpoint additionally ships full `deliveryReadiness`. Either is enough.
  const landing = task.deliveryLanding;
  if (landing) {
    if (landing.landedOnBase === true) return "merged";
    if (landing.landedOnBase === false && landing.commitsSinceBase > 0) return "unmerged";
    return "unknown";
  }
  const readiness = task.deliveryReadiness;
  if (!readiness?.checked) return "unknown";
  if (readiness.landedOnBase === true) return "merged";
  if (readiness.landedOnBase === false && readiness.hasCommitsSinceBase) return "unmerged";
  return "unknown";
}

export function cardMergeStateTone(state: Exclude<KanbanCardMergeState, "unknown">): string {
  return state === "unmerged"
    ? "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-900/40"
    : "bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400";
}
