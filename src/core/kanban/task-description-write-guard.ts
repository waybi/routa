import type { Task } from "../models/task";
import type { KanbanColumn, KanbanColumnStage } from "../models/kanban";
import {
  buildTaskContractReadiness,
  buildTaskContractUpdateErrorFromRules,
  resolveCurrentOrNextContractGate,
  type TaskContractReadiness,
} from "./task-contract-readiness";

/**
 * Shared write guard for the task story description.
 *
 * `update_card.description`, `update_task.objective`, and the HTTP PATCH
 * `body.objective` all persist to the same column (`tasks.objective`).
 * Every write path MUST enforce the same rules, otherwise one alias becomes
 * a silent bypass around the guarded one (see
 * docs/issues/2026-09-21-update-task-objective-clobbers-gated-description.md).
 */
export const DESCRIPTION_FROZEN_STAGES: ReadonlySet<KanbanColumnStage> = new Set([
  "dev",
  "review",
  "blocked",
  "done",
]);

export function normalizeColumnStage(columnId?: string): KanbanColumnStage | undefined {
  switch ((columnId ?? "backlog").toLowerCase()) {
    case "backlog":
    case "todo":
    case "dev":
    case "review":
    case "blocked":
    case "done":
      return (columnId ?? "backlog").toLowerCase() as KanbanColumnStage;
    default:
      return undefined;
  }
}

export function resolveTaskColumnStage(
  task: Pick<Task, "columnId" | "boardId">,
  boardColumns?: Array<Pick<KanbanColumn, "id" | "stage">> | null,
): KanbanColumnStage | undefined {
  const columnId = task.columnId ?? "backlog";
  if (task.boardId && boardColumns) {
    return (
      boardColumns.find((column) => column.id === columnId)?.stage ??
      normalizeColumnStage(columnId)
    );
  }
  return normalizeColumnStage(columnId);
}

export interface TaskDescriptionWriteGuardResult {
  error: string | null;
  frozen: boolean;
  contractGate: {
    columnName: string;
    readiness: TaskContractReadiness;
  } | null;
}

/**
 * Evaluate whether a story-description write (any alias of `tasks.objective`)
 * is allowed for this task right now.
 *
 * Rules (identical to the historical `update_card.description` behavior):
 * 1. The description is frozen from dev onward (dev/review/blocked/done).
 * 2. When the current or next column enforces canonical-contract rules, the
 *    new value must still satisfy them — a gated YAML story cannot be
 *    replaced by content that would fail the same gate.
 */
export function evaluateTaskDescriptionWriteGuard(params: {
  task: Pick<Task, "columnId" | "boardId">;
  newObjective: string;
  boardColumns?: Array<Pick<KanbanColumn, "id" | "name" | "stage" | "automation">> | null;
}): TaskDescriptionWriteGuardResult {
  const { task, newObjective, boardColumns } = params;

  const stage = resolveTaskColumnStage(task, boardColumns);
  if (stage && DESCRIPTION_FROZEN_STAGES.has(stage)) {
    return {
      error:
        `Cannot update card description in ${stage}. ` +
        "The story description is frozen from dev onward; update the comment field instead.",
      frozen: true,
      contractGate: null,
    };
  }

  if (task.boardId && boardColumns) {
    const contractGate = resolveCurrentOrNextContractGate(boardColumns, task.columnId);
    if (contractGate) {
      const readiness = buildTaskContractReadiness({ objective: newObjective }, contractGate.rules);
      const error = buildTaskContractUpdateErrorFromRules(
        readiness,
        contractGate.columnName,
        contractGate.rules,
      );
      if (error) {
        return {
          error,
          frozen: false,
          contractGate: { columnName: contractGate.columnName, readiness },
        };
      }
    }
  }

  return { error: null, frozen: false, contractGate: null };
}
