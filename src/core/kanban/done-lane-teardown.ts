/**
 * Helpers for winding a card down once its Done lane has finished.
 *
 * After the last Done lane step completes, the card's agent sessions have no
 * more work. Their later exit (requested by Routa or done from outside) is
 * teardown, not a step failure, and must not re-run the lane.
 */

import { getKanbanAutomationSteps, type KanbanColumnAutomation } from "../models/kanban";
import type { Task } from "../models/task";

/**
 * True when the card's latest stay in `columnId` already has a completed run
 * of the lane's last automation step. Only the trailing block of lane sessions
 * in that column counts, so a card that left and re-entered the column starts
 * over.
 */
export function isLaneAutomationComplete(
  task: Pick<Task, "laneSessions">,
  columnId: string,
  automation: KanbanColumnAutomation | undefined,
): boolean {
  const steps = getKanbanAutomationSteps(automation);
  if (steps.length === 0) {
    return false;
  }
  const lastStepIndex = steps.length - 1;
  const laneSessions = task.laneSessions ?? [];
  for (let index = laneSessions.length - 1; index >= 0; index -= 1) {
    const entry = laneSessions[index];
    if (entry.columnId !== columnId) {
      break;
    }
    if (entry.status !== "completed" && entry.status !== "transitioned") {
      continue;
    }
    const stepIndex = typeof entry.stepIndex === "number"
      ? entry.stepIndex
      : steps.length === 1 ? 0 : undefined;
    if (stepIndex === lastStepIndex) {
      return true;
    }
  }
  return false;
}

/** Every agent session id the card has used, oldest first, without duplicates. */
export function collectTaskSessionIds(
  task: Pick<Task, "laneSessions" | "sessionIds" | "triggerSessionId">,
): string[] {
  const ids = [
    ...(task.laneSessions ?? []).map((entry) => entry.sessionId),
    ...(task.sessionIds ?? []),
    task.triggerSessionId,
  ];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}
