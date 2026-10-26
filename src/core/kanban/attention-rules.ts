/**
 * "Needs your attention" rules, shared by the board strip, the inbox and the
 * server-side settlement that routes cards to Blocked (card 64f2e31c). Pure:
 * `now` is passed in so the 7-day window is testable. `interrupted` (a
 * non-Done, non-Blocked card whose current lane run failed or timed out) has
 * no time window. A card the Blocked resolver concluded as landed /
 * superseded / handed off / waiting is not reported while that conclusion is
 * still in effect for the card's column (isAttentionResolutionInEffect);
 * needs_owner still is.
 *
 * Moved from src/app/workspace/[workspaceId]/kanban/kanban-attention-rules.ts
 * (which re-exports it) so server code can use the same judgement.
 */

import { isAttentionResolvedInEffect } from "../models/task-attention-resolution";

export const DONE_LANE_ID = "done";
export const ATTENTION_DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAIN_PUSHER_SPECIALIST_ID = "kanban-main-pusher";

export type KanbanAttentionKind = "blocked" | "doneFailed" | "noReport" | "unmerged" | "interrupted";

export interface KanbanAttentionItem {
  taskId: string;
  kind: KanbanAttentionKind;
  /** Commits ahead of base for `unmerged`; 0 for every other kind. */
  ahead: number;
  /** Failed / timed-out lane run behind an `interrupted` item; unset otherwise. */
  sessionId?: string;
}

/** The lane-session fields the rules read (client TaskInfo and server Task both fit). */
export interface AttentionLaneSession {
  sessionId: string;
  columnId?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  lastActivityAt?: string;
}

export interface AttentionTask<S extends AttentionLaneSession = AttentionLaneSession> {
  id: string;
  columnId?: string;
  triggerSessionId?: string;
  laneSessions?: S[];
  createdAt?: string;
  updatedAt?: string;
  completionReport?: unknown;
  completionSummary?: string;
  deliveryLanding?: { landedOnBase: boolean | null; commitsSinceBase: number };
  deliveryReadiness?: { checked: boolean; landedOnBase?: boolean | null; hasCommitsSinceBase: boolean };
  attentionResolution?: { category: string; resolvedAt?: string } | null;
}

export type KanbanCardMergeState = "merged" | "unmerged" | "unknown";

function parseTime(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The trailing run of consecutive `columnId === "done"` sessions, oldest
 * first. Empty when the last session is not a Done session.
 */
export function getTrailingDoneSessions<S extends AttentionLaneSession>(task: { laneSessions?: S[] }): S[] {
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
export function getDoneEnteredAt(task: Pick<AttentionTask, "laneSessions" | "updatedAt" | "createdAt">): number {
  const trailing = getTrailingDoneSessions(task);
  const fromSession = trailing.length > 0 ? parseTime(trailing[0].startedAt) : 0;
  return fromSession || parseTime(task.updatedAt) || parseTime(task.createdAt) || 0;
}

/** Done card merge state from the cheap landing probe or the full readiness. */
export function resolveCardMergeState(
  task: Pick<AttentionTask, "columnId" | "deliveryReadiness" | "deliveryLanding">,
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

function startedAtMs(session: AttentionLaneSession): number {
  return parseTime(session.startedAt);
}

/**
 * The failed / timed-out "current lane run" of an interrupted card, else null.
 * - Done and Blocked cards are never interrupted (they have their own kinds).
 * - With a triggerSessionId: that run, matched by id. If laneSessions has no
 *   such run (a retry or the watchdog just started it), the card is NOT
 *   interrupted, so a rerun is never started twice.
 * - Without one: the newest run (by startedAt) recorded in the card's
 *   current column.
 */
export function findInterruptedLaneSession<S extends AttentionLaneSession>(
  task: { columnId?: string; triggerSessionId?: string; laneSessions?: S[] },
): S | null {
  if (!task.columnId || task.columnId === DONE_LANE_ID || task.columnId === "blocked") return null;
  const sessions = task.laneSessions ?? [];
  let current: S | undefined;
  if (task.triggerSessionId) {
    current = sessions.find((session) => session.sessionId === task.triggerSessionId);
  } else {
    for (const session of sessions) {
      if (session.columnId !== task.columnId) continue;
      if (!current || startedAtMs(session) > startedAtMs(current)) current = session;
    }
  }
  return current && (current.status === "failed" || current.status === "timed_out") ? current : null;
}

export function isTaskInterrupted(task: { columnId?: string; triggerSessionId?: string; laneSessions?: AttentionLaneSession[] }): boolean {
  return findInterruptedLaneSession(task) !== null;
}

interface BoardColumnLike {
  id: string;
  automation?: { specialistId?: string; steps?: Array<{ specialistId?: string }> } | null;
}

/** True when the board's Done lane runs the main-branch pusher. */
export function boardHasMainPusher(board: { columns: readonly BoardColumnLike[] }): boolean {
  const done = board.columns.find((column) => column.id === DONE_LANE_ID);
  const automation = done?.automation;
  if (!automation) return false;
  return automation.specialistId === MAIN_PUSHER_SPECIALIST_ID
    || (automation.steps ?? []).some((step) => step.specialistId === MAIN_PUSHER_SPECIALIST_ID);
}

export function collectTaskAttentionItems(
  task: AttentionTask,
  options: { hasMainPusher: boolean; now: number },
): KanbanAttentionItem[] {
  const items: KanbanAttentionItem[] = [];
  if (isAttentionResolvedInEffect(task.attentionResolution, task)) return items;
  if (task.columnId === "blocked") {
    items.push({ taskId: task.id, kind: "blocked", ahead: 0 });
    return items;
  }
  const interrupted = findInterruptedLaneSession(task);
  if (interrupted) {
    items.push({ taskId: task.id, kind: "interrupted", ahead: 0, sessionId: interrupted.sessionId });
    return items;
  }
  if (task.columnId !== DONE_LANE_ID) return items;
  if (options.now - getDoneEnteredAt(task) > ATTENTION_DONE_WINDOW_MS) return items;

  const trailing = getTrailingDoneSessions(task);
  const hasReport = Boolean(task.completionReport) || Boolean(task.completionSummary?.trim());
  const last = trailing[trailing.length - 1];
  const doneFailed = !hasReport && Boolean(last) && (last.status === "failed" || last.status === "timed_out");
  if (doneFailed) {
    items.push({ taskId: task.id, kind: "doneFailed", ahead: 0 });
  } else if (!hasReport && trailing.length > 0 && trailing.every((session) => session.status !== "running")) {
    items.push({ taskId: task.id, kind: "noReport", ahead: 0 });
  }

  if (options.hasMainPusher && resolveCardMergeState(task) === "unmerged") {
    items.push({ taskId: task.id, kind: "unmerged", ahead: task.deliveryLanding?.commitsSinceBase ?? 0 });
  }
  return items;
}

/** All attention items for the board's tasks, in task order. */
export function collectAttentionItems(
  tasks: readonly AttentionTask[],
  board: { columns: readonly BoardColumnLike[] },
  now: number,
): KanbanAttentionItem[] {
  const hasMainPusher = boardHasMainPusher(board);
  return tasks.flatMap((task) => collectTaskAttentionItems(task, { hasMainPusher, now }));
}

/**
 * Dismissal key: card id + kind + commits ahead (so +2 → +3 resurfaces).
 * `interrupted` keys on the failed run instead, so a rerun that fails again
 * resurfaces. The other four kinds keep their exact old keys.
 */
export function attentionDismissKey(item: KanbanAttentionItem): string {
  if (item.kind === "interrupted") return `${item.taskId}|interrupted|${item.sessionId ?? ""}`;
  return `${item.taskId}|${item.kind}|${item.kind === "unmerged" ? item.ahead : 0}`;
}
