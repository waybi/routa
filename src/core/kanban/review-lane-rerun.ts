/**
 * Review lane rerun — a Review step (the High-Risk Reviewer) that cannot
 * confirm the Review Guard finished this round calls move_card into the
 * card's own Review column. That move used to be a no-op: a same-column move
 * emits no column transition, and the lane's three finished steps already
 * filled the non-dev repeat limit. Now it reruns the lane from step 1: the
 * calling session's lane record is marked as the end of the previous round
 * (getNonDevAutomationRunCount stops counting there), the old verdict is
 * cleared so it cannot converge the card, and a transition event with
 * `laneRerun` starts step 0 again. A lane reruns at most
 * REVIEW_LANE_RERUN_LIMIT times before the card has to leave Review.
 */
import { getKanbanAutomationSteps, type KanbanColumn } from "../models/kanban";
import type { Task } from "../models/task";
import { getTaskLaneSession } from "./task-lane-history";

export const REVIEW_LANE_RERUN_LIMIT = 2;

type RerunTask = Pick<Task, "columnId" | "triggerSessionId" | "laneSessions" | "laneHandoffs">;

/** A move_card into the card's own Review column whose lane has automation steps. */
export function isReviewLaneRerunMove(
  fromColumnId: string,
  targetColumn: Pick<KanbanColumn, "id" | "stage" | "automation">,
): boolean {
  return fromColumnId === targetColumn.id
    && targetColumn.stage === "review"
    && targetColumn.automation?.enabled === true
    && getKanbanAutomationSteps(targetColumn.automation).length > 0;
}

/** Reruns already requested in the card's current (trailing) run of this column. */
export function countLaneRerunRequests(task: RerunTask, columnId: string): number {
  const laneSessions = task.laneSessions ?? [];
  let count = 0;
  for (let index = laneSessions.length - 1; index >= 0; index -= 1) {
    const entry = laneSessions[index];
    if (entry.columnId !== columnId) break;
    if (entry.laneRerunRequestedAt) count += 1;
  }
  return count;
}

/**
 * Mark the session that asks for the rerun (the card's trigger session, or
 * else the column's latest lane record) as the end of the previous round.
 */
export function markLaneRerunRequest(task: RerunTask, columnId: string, now = new Date()): void {
  const trigger = getTaskLaneSession(task, task.triggerSessionId);
  const entry = trigger?.columnId === columnId
    ? trigger
    : [...(task.laneSessions ?? [])].reverse().find((session) => session.columnId === columnId);
  if (entry) entry.laneRerunRequestedAt = now.toISOString();
}

export function buildReviewLaneRerunLimitMessage(columnName: string, rerunCount: number): string {
  return `Cannot rerun "${columnName}": the lane already reran ${rerunCount} times this round `
    + `(limit ${REVIEW_LANE_RERUN_LIMIT}). Write a failure report and move the card to "blocked" instead.`;
}
