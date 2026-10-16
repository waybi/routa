import { resolveTaskStatusForBoardColumn, type KanbanColumn, type KanbanColumnStage } from "../models/kanban";
import type { Task } from "../models/task";
import type { ColumnTransitionData } from "./column-transition";
import { resolveCurrentLaneAutomationState } from "./lane-automation-state";
import { archiveActiveTaskSession } from "./task-session-transition";

type ReviewConvergenceTask = Pick<
  Task,
  | "columnId"
  | "verificationVerdict"
  | "triggerSessionId"
  | "laneSessions"
  | "laneHandoffs"
  | "assignedProvider"
  | "assignedRole"
  | "assignedSpecialistId"
  | "assignedSpecialistName"
>;

function resolveColumnIdForStage(
  boardColumns: KanbanColumn[],
  stage: KanbanColumnStage,
): string | undefined {
  const match = boardColumns.find((column) => column.stage === stage);
  return match?.id;
}

function isReviewStage(task: ReviewConvergenceTask, boardColumns: KanbanColumn[]): boolean {
  const currentColumn = boardColumns.find((column) => column.id === task.columnId);
  return currentColumn?.stage === "review" || task.columnId === "review";
}

export function resolveReviewLaneConvergenceTarget(
  task: ReviewConvergenceTask,
  boardColumns: KanbanColumn[] = [],
): string | undefined {
  if (!task.verificationVerdict || !isReviewStage(task, boardColumns)) {
    return undefined;
  }

  const laneAutomationState = resolveCurrentLaneAutomationState(task, boardColumns);
  if (laneAutomationState.hasRemainingSteps) {
    return undefined;
  }

  switch (task.verificationVerdict) {
    case "APPROVED":
      return resolveColumnIdForStage(boardColumns, "done") ?? "done";
    case "NOT_APPROVED":
      return resolveColumnIdForStage(boardColumns, "dev") ?? "dev";
    case "BLOCKED":
      return resolveColumnIdForStage(boardColumns, "blocked") ?? "blocked";
    default:
      return undefined;
  }
}

/**
 * Moves a task whose review verdict is final into the converged column and
 * releases the review session that was the trigger session (archived into
 * sessionIds), so the next lane's automation starts a fresh session.
 * Its lane entry stays running: update_task still emits the synthetic
 * completion for it, and the next lane's start marks it completed.
 * Returns the transition to emit after the task is saved, or undefined when
 * the task stays where it is.
 *
 * update_task used to change only columnId/status here. It emitted no
 * COLUMN_TRANSITION and kept the Review Guard as triggerSessionId, so a card
 * approved through update_task (without a later move_card) sat in Done with
 * no Done lane session (card 30dbf08e on 2026-10-16).
 */
export function applyReviewLaneConvergence(
  task: Task,
  boardColumns: KanbanColumn[] = [],
): ColumnTransitionData | undefined {
  const fromColumnId = task.columnId;
  const toColumnId = resolveReviewLaneConvergenceTarget(task, boardColumns);
  if (!toColumnId || toColumnId === fromColumnId) {
    return undefined;
  }

  archiveActiveTaskSession(task);
  task.triggerSessionId = undefined;
  task.columnId = toColumnId;
  task.status = resolveTaskStatusForBoardColumn(boardColumns, toColumnId);
  task.lastSyncError = undefined;

  if (!task.boardId || !fromColumnId) {
    return undefined;
  }
  return {
    cardId: task.id,
    cardTitle: task.title,
    boardId: task.boardId,
    workspaceId: task.workspaceId,
    fromColumnId,
    toColumnId,
    fromColumnName: boardColumns.find((column) => column.id === fromColumnId)?.name,
    toColumnName: boardColumns.find((column) => column.id === toColumnId)?.name,
  };
}
