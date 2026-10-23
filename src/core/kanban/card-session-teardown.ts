/**
 * Which agent sessions to end when the user deletes a card or moves it out of
 * a column (复盘 L145). The processes themselves are ended by the workflow
 * orchestrator (endKanbanTaskSessions), which ends each session once and
 * treats the exit as teardown, not a step failure.
 */

import type { Task } from "../models/task";
import { markTaskLaneSessionStatus } from "./task-lane-history";

type SessionState = Pick<Task, "laneSessions" | "triggerSessionId">;

/**
 * Sessions still running in `columnId`: lane records marked running there,
 * plus the card's trigger session. Read this before the column change
 * finalizes and clears the trigger session.
 */
export function collectRunningColumnSessionIds(task: SessionState, columnId: string | undefined): string[] {
  const ids = (task.laneSessions ?? [])
    .filter((entry) => entry.status === "running" && entry.columnId === columnId)
    .map((entry) => entry.sessionId);
  if (task.triggerSessionId) ids.push(task.triggerSessionId);
  return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
}

/** Drops sessions that belong to the card's current column (a step the move just started). */
export function excludeCurrentColumnSessions(
  sessionIds: string[],
  task: SessionState & Pick<Task, "columnId">,
): string[] {
  const keep = new Set<string>();
  if (task.triggerSessionId) keep.add(task.triggerSessionId);
  for (const entry of task.laneSessions ?? []) {
    if (entry.columnId === task.columnId) keep.add(entry.sessionId);
  }
  return sessionIds.filter((id) => !keep.has(id));
}

/** Records the ended sessions as completed (a user stop, not a failure). */
export function markSessionsCompleted(task: Parameters<typeof markTaskLaneSessionStatus>[0], sessionIds: string[]): void {
  for (const sessionId of sessionIds) {
    const entry = task.laneSessions?.find((item) => item.sessionId === sessionId);
    if (entry?.status === "running") {
      markTaskLaneSessionStatus(task, sessionId, "completed");
    }
  }
}

/** Queue operations used when a card is deleted. */
export interface CardQueue {
  getBoardSnapshot(boardId: string): Promise<{ queuedCardIds: string[] }>;
  removeCardJob(cardId: string): void;
}

/**
 * Removes a deleted card's queued step so it is never started. A running
 * entry is kept: the exit of its ended session releases the board slot and
 * starts the next queued card (removing it here would free the slot without
 * draining the queue).
 */
export async function dropQueuedCardJob(queue: CardQueue, task: Pick<Task, "id" | "boardId">): Promise<boolean> {
  if (!task.boardId) return false;
  const snapshot = await queue.getBoardSnapshot(task.boardId);
  if (!snapshot.queuedCardIds.includes(task.id)) return false;
  queue.removeCardJob(task.id);
  return true;
}
