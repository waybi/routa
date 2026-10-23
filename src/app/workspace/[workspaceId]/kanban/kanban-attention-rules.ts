/**
 * "Needs your attention" rules for the current board. Pure: `now` is passed
 * in so the 7-day window is testable. `interrupted` (a non-Done, non-Blocked
 * card whose current lane run failed or timed out) has no time window.
 */

import type { KanbanBoardInfo, TaskInfo } from "../types";
import { resolveCardMergeState } from "./kanban-card-status";
import { DONE_LANE_ID, getDoneEnteredAt, getTrailingDoneSessions } from "./kanban-done-time";

export type KanbanAttentionKind = "blocked" | "doneFailed" | "noReport" | "unmerged" | "interrupted";

export interface KanbanAttentionItem {
  taskId: string;
  kind: KanbanAttentionKind;
  /** Commits ahead of base for `unmerged`; 0 for every other kind. */
  ahead: number;
  /** Failed / timed-out lane run behind an `interrupted` item; unset otherwise. */
  sessionId?: string;
}

export type TaskLaneSessionInfo = NonNullable<TaskInfo["laneSessions"]>[number];

function startedAtMs(session: TaskLaneSessionInfo): number {
  const parsed = Date.parse(session.startedAt);
  return Number.isFinite(parsed) ? parsed : 0;
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
export function findInterruptedLaneSession(
  task: Pick<TaskInfo, "columnId" | "triggerSessionId" | "laneSessions">,
): TaskLaneSessionInfo | null {
  if (!task.columnId || task.columnId === DONE_LANE_ID || task.columnId === "blocked") return null;
  const sessions = task.laneSessions ?? [];
  let current: TaskLaneSessionInfo | undefined;
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

export function isTaskInterrupted(task: Pick<TaskInfo, "columnId" | "triggerSessionId" | "laneSessions">): boolean {
  return findInterruptedLaneSession(task) !== null;
}

export const ATTENTION_DONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MAIN_PUSHER_SPECIALIST_ID = "kanban-main-pusher";

/** True when the board's Done lane runs the main-branch pusher. */
export function boardHasMainPusher(board: Pick<KanbanBoardInfo, "columns">): boolean {
  const done = board.columns.find((column) => column.id === DONE_LANE_ID);
  const automation = done?.automation;
  if (!automation) return false;
  return automation.specialistId === MAIN_PUSHER_SPECIALIST_ID
    || (automation.steps ?? []).some((step) => step.specialistId === MAIN_PUSHER_SPECIALIST_ID);
}

export function collectTaskAttentionItems(
  task: TaskInfo,
  options: { hasMainPusher: boolean; now: number },
): KanbanAttentionItem[] {
  const items: KanbanAttentionItem[] = [];
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
  tasks: readonly TaskInfo[],
  board: Pick<KanbanBoardInfo, "columns">,
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
