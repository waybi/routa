import type { TaskLaneSession } from "../models/task";
import type { KanbanAutomationStep } from "../models/kanban";
import { getTaskLaneSession } from "./task-lane-history";

/**
 * When a step's end event arrives and the card has no lane record for that
 * session (the start-time record was lost), the end handler used to upsert a
 * skeleton with no column or step. Rate-limit retry and the startup resume
 * match records by columnId/stepIndex, so such a step was never re-run
 * (retro L279). This returns the column/step fields to write with the
 * skeleton, taken from the in-memory automation. It returns {} when the
 * record already exists (its fields are never touched) or when the
 * automation holds no column.
 */
export function buildLaneSessionBackfill(
  task: Parameters<typeof getTaskLaneSession>[0],
  automation: {
    columnId?: string;
    columnName?: string;
    currentStepIndex: number;
    steps?: KanbanAutomationStep[];
  } | undefined,
  sessionId: string,
): Partial<TaskLaneSession> {
  if (!automation?.columnId || getTaskLaneSession(task, sessionId)) return {};
  const stepIndex = automation.currentStepIndex;
  const step = automation.steps?.[stepIndex];
  return {
    columnId: automation.columnId,
    ...(automation.columnName ? { columnName: automation.columnName } : {}),
    stepIndex,
    ...(step?.id ? { stepId: step.id } : {}),
    ...(step
      ? {
        stepName: step.specialistName ?? step.specialistId ?? step.role,
        role: step.role,
        specialistId: step.specialistId,
        specialistName: step.specialistName,
      }
      : {}),
  };
}
