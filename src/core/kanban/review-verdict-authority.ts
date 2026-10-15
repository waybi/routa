import { getKanbanAutomationSteps, type KanbanColumn } from "../models/kanban";
import type { Task } from "../models/task";

function isReviewStageColumn(columnId: string, boardColumns: KanbanColumn[]): boolean {
  const column = boardColumns.find((entry) => entry.id === columnId);
  return column ? column.stage === "review" : columnId === "review";
}

/**
 * Whether `sessionId` is a GATE lane session of the task's current Review-stage
 * column, i.e. the session that is allowed to record the review verdict.
 * Sessions of other lanes, non-GATE steps, unknown sessions, and stale review
 * sessions after the card left the review column are all rejected.
 */
export function canSessionWriteVerificationVerdict(
  task: Pick<Task, "columnId" | "laneSessions">,
  sessionId: string | undefined,
  boardColumns: KanbanColumn[] = [],
): boolean {
  if (!sessionId || !task.columnId) {
    return false;
  }
  const session = task.laneSessions?.find((entry) => entry.sessionId === sessionId);
  if (!session || session.columnId !== task.columnId) {
    return false;
  }
  if (!isReviewStageColumn(task.columnId, boardColumns)) {
    return false;
  }
  if (session.role) {
    return session.role === "GATE";
  }
  const column = boardColumns.find((entry) => entry.id === task.columnId);
  const steps = getKanbanAutomationSteps(column?.automation);
  const step = typeof session.stepIndex === "number"
    ? steps[session.stepIndex]
    : steps.find((entry) => (
      (session.stepId && entry.id === session.stepId)
      || (session.specialistId && entry.specialistId === session.specialistId)
    ));
  return step?.role === "GATE";
}
