import {
  getKanbanAutomationSteps,
  type KanbanAutomationStep,
  type KanbanColumn,
} from "../models/kanban";
import type { Task, TaskLaneSession } from "../models/task";
import { getTaskLaneSession } from "./task-lane-history";

export interface CurrentLaneAutomationState {
  currentColumnId: string;
  currentColumn?: KanbanColumn;
  steps: KanbanAutomationStep[];
  currentSession?: TaskLaneSession;
  currentStepIndex?: number;
  currentStep?: KanbanAutomationStep;
  nextStep?: KanbanAutomationStep;
  hasRemainingSteps: boolean;
}

function getStepMatchScore(
  step: KanbanAutomationStep,
  task: Pick<Task, "assignedProvider" | "assignedRole" | "assignedSpecialistId" | "assignedSpecialistName">,
): number {
  let score = 0;

  if (step.specialistId && task.assignedSpecialistId) {
    if (step.specialistId !== task.assignedSpecialistId) return -1;
    score += 8;
  }
  if (step.specialistName && task.assignedSpecialistName) {
    if (step.specialistName !== task.assignedSpecialistName) return -1;
    score += 4;
  }
  if (step.role && task.assignedRole) {
    if (step.role !== task.assignedRole) return -1;
    score += 2;
  }
  if (step.providerId && task.assignedProvider) {
    if (step.providerId !== task.assignedProvider) return -1;
    score += 1;
  }

  return score;
}

function findStepIndexFromTaskAssignment(
  steps: KanbanAutomationStep[],
  task: Pick<Task, "assignedProvider" | "assignedRole" | "assignedSpecialistId" | "assignedSpecialistName">,
): number | undefined {
  let bestIndex: number | undefined;
  let bestScore = -1;

  for (const [index, step] of steps.entries()) {
    const score = getStepMatchScore(step, task);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore > 0 ? bestIndex : undefined;
}

function findCurrentLaneSession(
  task: Pick<Task, "columnId" | "triggerSessionId" | "laneSessions" | "laneHandoffs">,
  currentColumnId: string,
  sessionId?: string,
): TaskLaneSession | undefined {
  const sessionCandidates = [sessionId, task.triggerSessionId].filter((value): value is string => Boolean(value));

  for (const candidate of sessionCandidates) {
    const session = getTaskLaneSession(task, candidate);
    if (session?.columnId === currentColumnId) {
      return session;
    }
  }

  return [...(task.laneSessions ?? [])]
    .reverse()
    .find((session) => (
      session.columnId === currentColumnId
      && (
        session.status === "running"
        || session.status === "transitioned"
        || session.status === "completed"
      )
    ));
}

export function resolveCurrentLaneAutomationState(
  task: Pick<
    Task,
    | "columnId"
    | "triggerSessionId"
    | "laneSessions"
    | "laneHandoffs"
    | "assignedProvider"
    | "assignedRole"
    | "assignedSpecialistId"
    | "assignedSpecialistName"
  >,
  boardColumns: KanbanColumn[] = [],
  options?: {
    currentSessionId?: string;
    /**
     * Index of the step being launched in the current column. A session that is
     * just starting is not in `laneSessions` yet, so session lookup would fall
     * back to the previous step's `triggerSessionId`; an in-range index wins.
     */
    currentStepIndex?: number;
  },
): CurrentLaneAutomationState {
  const currentColumnId = task.columnId ?? "backlog";
  const currentColumn = boardColumns.find((column) => column.id === currentColumnId);
  const steps = getKanbanAutomationSteps(currentColumn?.automation);
  const currentSession = findCurrentLaneSession(task, currentColumnId, options?.currentSessionId);
  const explicitStepIndex = options?.currentStepIndex;

  let currentStepIndex = typeof explicitStepIndex === "number"
    && Number.isInteger(explicitStepIndex)
    && explicitStepIndex >= 0
    && explicitStepIndex < steps.length
    ? explicitStepIndex
    : currentSession?.stepIndex;
  if (
    typeof currentStepIndex !== "number"
    || currentStepIndex < 0
    || currentStepIndex >= steps.length
  ) {
    currentStepIndex = findStepIndexFromTaskAssignment(steps, task);
  }
  if (
    (typeof currentStepIndex !== "number" || currentStepIndex < 0)
    && steps.length === 1
  ) {
    currentStepIndex = 0;
  }
  if ((typeof currentStepIndex !== "number" || currentStepIndex < 0) && steps.length > 1) {
    console.warn("[LaneAutomation] Could not resolve active step for multi-step lane", {
      currentColumnId,
      currentSessionId: currentSession?.sessionId,
      steps: steps.map((step) => step.id ?? step.specialistId ?? step.specialistName ?? step.role ?? "unknown"),
      assignedProvider: task.assignedProvider,
      assignedRole: task.assignedRole,
      assignedSpecialistId: task.assignedSpecialistId,
      assignedSpecialistName: task.assignedSpecialistName,
    });
  }

  const currentStep = typeof currentStepIndex === "number" ? steps[currentStepIndex] : undefined;
  const nextStep = typeof currentStepIndex === "number" ? steps[currentStepIndex + 1] : undefined;
  const hasRemainingSteps = typeof currentStepIndex === "number"
    ? currentStepIndex < steps.length - 1
    : steps.length > 1;

  return {
    currentColumnId,
    currentColumn,
    steps,
    currentSession,
    currentStepIndex,
    currentStep,
    nextStep,
    hasRemainingSteps,
  };
}

export function buildRemainingLaneStepsMessage(
  taskTitle: string,
  state: CurrentLaneAutomationState,
): string | undefined {
  if (!state.hasRemainingSteps || !state.nextStep) {
    return undefined;
  }

  const currentLabel = state.currentStep?.specialistName
    ?? state.currentStep?.specialistId
    ?? state.currentStep?.role
    ?? `step ${typeof state.currentStepIndex === "number" ? state.currentStepIndex + 1 : 1}`;
  const nextLabel = state.nextStep.specialistName
    ?? state.nextStep.specialistId
    ?? state.nextStep.role
    ?? `step ${typeof state.currentStepIndex === "number" ? state.currentStepIndex + 2 : 2}`;

  return `Cannot move "${taskTitle}" out of ${state.currentColumn?.name ?? state.currentColumnId} yet: ${currentLabel} is still active and ${nextLabel} must run next in the same lane.`;
}

function isSameAutomationStep(
  candidate: Partial<Pick<KanbanAutomationStep, "id" | "specialistId" | "specialistName">> | undefined,
  step: Partial<Pick<KanbanAutomationStep, "id" | "specialistId" | "specialistName">>,
): boolean {
  if (!candidate) return false;
  if (step.id && candidate.id) return candidate.id === step.id;
  if (step.specialistId && candidate.specialistId) return candidate.specialistId === step.specialistId;
  if (step.specialistName && candidate.specialistName) return candidate.specialistName === step.specialistName;
  return false;
}

/**
 * Index of the step being launched within `steps`. An explicit `stepIndex` is
 * trusted only when it is in range and, if `step` is known, points at that
 * step; otherwise the step is matched by id, then specialist id/name.
 * Returns `undefined` when nothing matches, so callers keep their existing
 * fallback instead of assuming the last step.
 */
export function resolveLaunchStepIndex(
  steps: KanbanAutomationStep[],
  step: Partial<Pick<KanbanAutomationStep, "id" | "specialistId" | "specialistName">> | undefined,
  stepIndex: number | undefined,
): number | undefined {
  const inRange = typeof stepIndex === "number"
    && Number.isInteger(stepIndex)
    && stepIndex >= 0
    && stepIndex < steps.length;
  if (!step) {
    return inRange ? stepIndex : undefined;
  }
  if (inRange && isSameAutomationStep(steps[stepIndex!], step)) {
    return stepIndex;
  }
  const matched = steps.findIndex((candidate) => isSameAutomationStep(candidate, step));
  return matched >= 0 ? matched : undefined;
}

/**
 * Shared "later steps still have to run" guard for moving a card out of its
 * lane (PATCH /api/tasks/{id} and the move_card tool). Resolves the current
 * step from the lane's trigger session with the same function the lane prompt
 * uses, and returns the blocking message, or `undefined` when the move may go on.
 */
export function resolveRemainingLaneStepsMoveBlock(
  task: Pick<
    Task,
    | "title"
    | "columnId"
    | "triggerSessionId"
    | "laneSessions"
    | "laneHandoffs"
    | "assignedProvider"
    | "assignedRole"
    | "assignedSpecialistId"
    | "assignedSpecialistName"
  >,
  boardColumns: KanbanColumn[],
): string | undefined {
  if (!task.triggerSessionId) {
    return undefined;
  }
  const laneAutomationState = resolveCurrentLaneAutomationState(task, boardColumns, {
    currentSessionId: task.triggerSessionId,
  });
  return buildRemainingLaneStepsMessage(task.title, laneAutomationState);
}

/**
 * Step a manual rerun of a lane starts at. The lane's latest run decides:
 * if it did not complete, rerun that step; if it completed, run the step
 * after it (that step was lost, e.g. its start failed); after the lane's last
 * step, or with no run yet, start at the first step. Undefined when the lane
 * has no enabled automation steps.
 */
export function resolveLaneResumeStep(
  task: Pick<Task, "columnId" | "laneSessions">,
  boardColumns: KanbanColumn[],
): { step: KanbanAutomationStep; stepIndex: number } | undefined {
  const columnId = task.columnId ?? "backlog";
  const automation = boardColumns.find((column) => column.id === columnId)?.automation;
  if (!automation?.enabled) return undefined;
  const steps = getKanbanAutomationSteps(automation);
  if (steps.length === 0) return undefined;

  const latestRun = [...(task.laneSessions ?? [])]
    .reverse()
    .find((session) => session.columnId === columnId && typeof session.stepIndex === "number");
  let stepIndex = 0;
  const latestIndex = latestRun?.stepIndex;
  if (typeof latestIndex === "number" && latestIndex >= 0 && latestIndex < steps.length) {
    const finished = latestRun?.status === "completed" || latestRun?.status === "transitioned";
    stepIndex = !finished
      ? latestIndex
      : latestIndex + 1 < steps.length ? latestIndex + 1 : 0;
  }
  return { step: steps[stepIndex], stepIndex };
}
