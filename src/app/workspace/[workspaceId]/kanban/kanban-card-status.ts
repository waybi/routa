/**
 * Card run status derivation.
 *
 * `acpStatus` only has three values (connecting | ready | error), and `ready`
 * means "the ACP process is alive", not "the agent is producing output". This
 * module folds the process status together with the live activity heartbeat
 * (`kanban:session-activity`, last event + time) and the lane-session record
 * into a status the board can act on without opening the card:
 *
 *   working  — something happened recently (or a tool is still running)
 *   stalled  — alive, mid-turn, but silent past the stall threshold
 *   idle     — the agent finished its turn and is parked
 *   failed   — process error, runtime error, or watchdog timeout
 *
 * History: the first version used a 30 s window on the lane record's
 * `lastActivityAt`. That field is only written on lifecycle events (it is
 * null for a running dev card in routa.db), and dsh's median gap between
 * message chunks is 13.7 s, so cards flapped to "idle" mid-task — and the
 * session snapshot never left `connecting`, so most cards just said
 * "starting".
 */

import type { SessionInfo, TaskInfo } from "../types";

export type KanbanCardRunStatus =
  | "queued"
  | "starting"
  | "working"
  | "stalled"
  | "idle"
  | "completed"
  | "failed";

/**
 * Silence longer than this, mid-turn, flips the card to "may be stuck".
 * dsh paragraphs arrive ~14 s apart at the median; 3 min of nothing is well
 * outside normal thinking time but still well before the default 10 min
 * watchdog (`board-session-supervision.ts`) kills the run.
 */
export const CARD_STALL_THRESHOLD_MS = 3 * 60_000;

/**
 * A tool that is still running (a build, a test suite) legitimately stays
 * quiet longer, so it gets a longer grace before the card calls it stuck.
 */
export const CARD_TOOL_STALL_THRESHOLD_MS = 6 * 60_000;

/** Kept for callers that still import the old name. */
export const CARD_WORKING_ACTIVITY_WINDOW_MS = CARD_STALL_THRESHOLD_MS;

type AcpStatus = "connecting" | "ready" | "error" | undefined;

export type CardSessionActivity = Pick<
  SessionInfo,
  | "acpStatus"
  | "acpError"
  | "lastActivityAt"
  | "lastEventType"
  | "lastToolName"
  | "lastToolStatus"
  | "terminalState"
  | "terminalReason"
>;

export interface ResolveCardRunStatusInput {
  task: Pick<TaskInfo, "columnId" | "triggerSessionId" | "laneSessions">;
  acpStatus: AcpStatus;
  /** Live session heartbeat; wins over the lane record when present. */
  session?: CardSessionActivity;
  queuePosition?: number;
  /**
   * A rerun was just requested and its new run is not visible yet: read
   * "starting" instead of the previous run's lane record.
   */
  retryPending?: boolean;
  /** Injected for deterministic tests. */
  now?: number;
}

export interface CardActivityDetail {
  status: KanbanCardRunStatus;
  /** ms since the last observed activity, when known. */
  quietMs?: number;
  /** Tool still running, e.g. "Bash". */
  runningTool?: string;
  /** Agent finished its turn (parked, waiting for the next prompt). */
  turnDone: boolean;
  /** Why it failed, when known. */
  failureReason?: string;
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

function isToolStillRunning(session: CardSessionActivity | undefined): boolean {
  if (!session?.lastEventType) return false;
  if (session.lastEventType !== "tool_call" && session.lastEventType !== "tool_call_update") return false;
  return session.lastToolStatus !== "completed" && session.lastToolStatus !== "failed";
}

export function describeCardActivity({
  task,
  acpStatus,
  session,
  queuePosition,
  retryPending,
  now = Date.now(),
}: ResolveCardRunStatusInput): CardActivityDetail {
  const laneSession = findCurrentLaneSession(task);
  const lastActivityAt = toTimestamp(session?.lastActivityAt)
    ?? toTimestamp(laneSession?.lastActivityAt);
  const quietMs = lastActivityAt === undefined ? undefined : Math.max(0, now - lastActivityAt);
  const toolRunning = isToolStillRunning(session);
  const runningTool = toolRunning ? session?.lastToolName : undefined;
  // terminalState is sticky across prompts, so only trust it when no newer
  // event type has been recorded.
  const turnDone = session?.lastEventType === "turn_complete"
    || (session?.terminalState === "completed" && !session.lastEventType);
  const base = { quietMs, runningTool, turnDone };

  if (queuePosition) return { ...base, status: "queued" };
  if (retryPending && !session) return { ...base, status: "starting" };
  if (acpStatus === "error") {
    return { ...base, status: "failed", failureReason: session?.acpError ?? session?.terminalReason };
  }
  if (session?.terminalState === "failed" || session?.terminalState === "timed_out") {
    return { ...base, status: "failed", failureReason: session.terminalReason };
  }

  // Terminal lane state wins over the process being alive: a completed run
  // whose process lingers is "completed", not "live".
  if (laneSession?.status === "failed" || laneSession?.status === "timed_out") {
    return { ...base, status: "failed", failureReason: session?.terminalReason };
  }
  if (laneSession?.status === "completed" || laneSession?.status === "transitioned") {
    return { ...base, status: "completed" };
  }

  // A heartbeat proves the process is up even if the status snapshot still
  // says "connecting".
  const alive = acpStatus === "ready" || (acpStatus === "connecting" && lastActivityAt !== undefined);
  if (acpStatus === "connecting" && !alive) return { ...base, status: "starting" };

  if (!alive) {
    // No live process. Done/blocked columns are terminal by definition.
    if (task.columnId === "done") return { ...base, status: "completed" };
    return { ...base, status: "idle" };
  }

  if (turnDone) return { ...base, status: "idle" };

  if (quietMs === undefined) {
    // Alive but nothing observed yet — a fresh run, not a stuck one.
    return { ...base, status: "working" };
  }
  const threshold = toolRunning ? CARD_TOOL_STALL_THRESHOLD_MS : CARD_STALL_THRESHOLD_MS;
  return { ...base, status: quietMs <= threshold ? "working" : "stalled" };
}

export function resolveCardRunStatus(input: ResolveCardRunStatusInput): KanbanCardRunStatus {
  return describeCardActivity(input).status;
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
    case "stalled":
      return "stalled";
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
    case "stalled":
      return "bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-300 dark:bg-orange-900/25 dark:text-orange-300 dark:ring-orange-900/50";
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
    case "stalled":
      return "bg-orange-500";
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
// Shared with the server-side attention rules (card 64f2e31c).
export { resolveCardMergeState } from "@/core/kanban/attention-rules";

export function cardMergeStateTone(state: Exclude<KanbanCardMergeState, "unknown">): string {
  return state === "unmerged"
    ? "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-900/40"
    : "bg-slate-100 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400";
}
