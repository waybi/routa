import { getAcpInstanceId, isExecutionLeaseActive } from "../acp/execution-backend";
import { getHttpSessionStore } from "../acp/http-session-store";
import { getAcpProcessManager } from "../acp/processer";
import type { RoutaSystem } from "../routa-system";
import { getKanbanAutomationSteps, resolveTaskStatusForBoardColumn } from "../models/kanban";
import type { Task } from "../models/task";
import { getTaskLaneSession, markTaskLaneSessionStatus, upsertTaskLaneSession } from "./task-lane-history";
import {
  endLaneRecordByOutcome,
  resolvePersistedSessionOutcome,
  type ReadSessionEndHistory,
} from "./lane-session-settlement";
import { resolveCurrentLaneAutomationState, resolveLaneResumeStep } from "./lane-automation-state";
import { resolveReviewLaneConvergenceTarget } from "./review-lane-convergence";
import { getKanbanEventBroadcaster } from "./kanban-event-broadcaster";
import { hasExceededNonDevAutomationRepeatLimit } from "./workflow-orchestrator";
import { isLaneAutomationComplete } from "./done-lane-teardown";
import { runLaneRerunOnce } from "./lane-rerun-claim";
import {
  hasTrippedRetryableEnvironmentFuse,
  isAwaitingEnvironmentFix,
  isWaitingForRateLimitRetry,
} from "./environment-failure";
import {
  enqueueKanbanTaskSession,
  processKanbanColumnTransition,
} from "./workflow-orchestrator-singleton";

export interface RestartRecoveryOptions {
  sessionStore: ReturnType<typeof getHttpSessionStore>;
  processManager: ReturnType<typeof getAcpProcessManager>;
  /** Clock for the rate-limit rerun time (tests); defaults to now. */
  now?: () => Date;
  /**
   * Persisted history of a session. With it, a stale "running" record whose
   * session already ended is recorded by its real outcome (card 6d8365ca);
   * without it, or when the history has no end, the restart rules apply.
   */
  readSessionEndHistory?: ReadSessionEndHistory;
}

function isSessionActivelyRunning(
  taskSessionId: string | undefined,
  options: RestartRecoveryOptions,
): boolean {
  if (!taskSessionId) return false;

  if (options.processManager.hasActiveSession(taskSessionId)) {
    return true;
  }

  const session = options.sessionStore.getSession(taskSessionId);
  if (!session) {
    return false;
  }

  if (session.acpStatus === "ready" || session.acpStatus === "connecting") {
    return true;
  }

  if (session.acpStatus === "error") {
    return false;
  }

  // Hydrated sessions from storage only remain resumable when the current
  // instance still owns the execution lease.
  const ownerInstanceId = session.ownerInstanceId?.trim();
  if (!ownerInstanceId) {
    return false;
  }
  if (ownerInstanceId !== getAcpInstanceId()) {
    return false;
  }

  return isExecutionLeaseActive(session.leaseExpiresAt);
}

/** The card's latest run is in this column and was ended by the inactivity watchdog. */
function isAwaitingRerunAfterLaneWatchdog(
  task: Pick<Task, "laneSessions">,
  columnId: string,
): boolean {
  const laneSessions = task.laneSessions ?? [];
  const latest = laneSessions[laneSessions.length - 1];
  return latest?.columnId === columnId
    && latest.status === "timed_out"
    && latest.recoveryReason === "watchdog_inactivity";
}

/**
 * A step of the card's current column that was still running when Routa
 * restarted did not finish, whatever conclusion the card already carries
 * (a Done card has Review's verdict; card a0b2b4fa's pusher, 2026-10-23):
 * it is recorded as interrupted, so a rerun starts at that step.
 */
function markInterruptedByRestart(task: Task, sessionId: string): void {
  markTaskLaneSessionStatus(task, sessionId, "timed_out");
  upsertTaskLaneSession(task, { sessionId, recoveryReason: "restart_interrupted" });
}

/**
 * End a stale "running" record. A session whose history shows how it ended is
 * recorded by that outcome (completed at its turn end; failed on an error,
 * cancelled turn or exit inside the turn). Otherwise: interrupted by the
 * restart in the card's column, "transitioned" in a column it already left.
 */
async function endStaleLaneRecord(
  task: Task,
  sessionId: string,
  inCurrentColumn: boolean,
  options: RestartRecoveryOptions,
): Promise<void> {
  const outcome = await resolvePersistedSessionOutcome(sessionId, options.readSessionEndHistory);
  if (endLaneRecordByOutcome(task, sessionId, outcome, { now: options.now?.() })) return;
  if (inCurrentColumn) {
    markInterruptedByRestart(task, sessionId);
  } else {
    markTaskLaneSessionStatus(task, sessionId, "transitioned");
  }
}

/**
 * End the card's "running" lane records whose session no longer runs and drop
 * a dead triggerSessionId. Revive only looks at the current column; the
 * startup sweep (`allColumns`) also ends records left in earlier columns.
 */
async function sanitizeStaleCurrentLaneAutomation(
  system: RoutaSystem,
  task: Task,
  options: RestartRecoveryOptions,
  sweep?: { allColumns: boolean; ended: string[] },
): Promise<Task> {
  let mutated = false;
  const nextTask: Task = {
    ...task,
    laneSessions: [...(task.laneSessions ?? [])],
    laneHandoffs: [...(task.laneHandoffs ?? [])],
    sessionIds: [...(task.sessionIds ?? [])],
    comments: [...(task.comments ?? [])],
    labels: [...(task.labels ?? [])],
    dependencies: [...(task.dependencies ?? [])],
    codebaseIds: [...(task.codebaseIds ?? [])],
  };

  if (nextTask.triggerSessionId && !isSessionActivelyRunning(nextTask.triggerSessionId, options)) {
    const triggerLaneSession = getTaskLaneSession(nextTask, nextTask.triggerSessionId);
    if (triggerLaneSession && triggerLaneSession.columnId === nextTask.columnId) {
      if (triggerLaneSession.status === "running") {
        await endStaleLaneRecord(nextTask, triggerLaneSession.sessionId, true, options);
        sweep?.ended.push(triggerLaneSession.sessionId);
      }
    }
    nextTask.triggerSessionId = undefined;
    mutated = true;
  }

  for (const entry of nextTask.laneSessions ?? []) {
    const inCurrentColumn = entry.columnId === nextTask.columnId;
    if (
      (inCurrentColumn || sweep?.allColumns)
      && entry.status === "running"
      && !isSessionActivelyRunning(entry.sessionId, options)
    ) {
      await endStaleLaneRecord(nextTask, entry.sessionId, inCurrentColumn, options);
      sweep?.ended.push(entry.sessionId);
      mutated = true;
    }
  }

  if (mutated) {
    nextTask.updatedAt = new Date();
    await system.taskStore.save(nextTask);
    return nextTask;
  }

  return task;
}

/**
 * Startup sweep over every card of every workspace. A restart ends every agent
 * process, yet lane records stay "running" until someone POSTs revive for that
 * board, and revive only looks at the current column. Records whose end was
 * never recorded (steps revive started before the orchestrator adopted them,
 * e.g. Done Reporter a1d9bffc, 2026-10-23) stayed "running" forever.
 * Uses revive's own "still running" test and terminal statuses, so a later
 * revive makes the same decisions. Starts no session.
 */
export async function endStaleRunningLaneSessions(
  system: RoutaSystem,
  options: RestartRecoveryOptions,
): Promise<{ cards: number; sessions: string[] }> {
  const ended: string[] = [];
  let cards = 0;
  for (const workspace of await system.workspaceStore.list()) {
    for (const task of await system.taskStore.listByWorkspace(workspace.id)) {
      const next = await sanitizeStaleCurrentLaneAutomation(system, task, options, { allColumns: true, ended });
      if (next !== task) cards += 1;
    }
  }
  return { cards, sessions: ended };
}

async function convergeRecoveredReviewTask(
  system: RoutaSystem,
  workspaceId: string,
  boardId: string,
  task: Task,
  currentColumnName: string,
  convergenceColumnId: string,
): Promise<boolean> {
  const board = await system.kanbanBoardStore.get(boardId);
  if (!board) {
    return false;
  }

  const convergenceColumn = board.columns.find((column) => column.id === convergenceColumnId);
  if (!convergenceColumn) {
    const nextTask: Task = {
      ...task,
      columnId: convergenceColumnId,
      status: resolveTaskStatusForBoardColumn(board.columns, convergenceColumnId),
      updatedAt: new Date(),
    };
    await system.taskStore.save(nextTask);
    getKanbanEventBroadcaster().notify({
      workspaceId,
      entity: "task",
      action: "moved",
      resourceId: nextTask.id,
      source: "system",
    });
    return true;
  }

  const nextTask: Task = {
    ...task,
    columnId: convergenceColumn.id,
    status: resolveTaskStatusForBoardColumn(board.columns, convergenceColumn.id),
    updatedAt: new Date(),
  };
  await system.taskStore.save(nextTask);
  getKanbanEventBroadcaster().notify({
    workspaceId,
    entity: "task",
    action: "moved",
    resourceId: nextTask.id,
    source: "system",
  });
  await processKanbanColumnTransition(system, {
    cardId: nextTask.id,
    cardTitle: nextTask.title,
    boardId,
    workspaceId,
    fromColumnId: task.columnId ?? "__revive__",
    toColumnId: convergenceColumn.id,
    fromColumnName: currentColumnName,
    toColumnName: convergenceColumn.name,
  });
  return true;
}

/**
 * The card's latest lane record is the last step of this column, completed.
 * Only the card's very last record counts: a card that left the column and
 * came back has a later record of another column, and re-enters as before.
 */
function isLatestRunCompletedLastStep(
  task: Task,
  columnId: string,
  automation: Parameters<typeof getKanbanAutomationSteps>[0],
): boolean {
  const steps = getKanbanAutomationSteps(automation);
  const latest = task.laneSessions?.at(-1);
  if (!latest || latest.columnId !== columnId || latest.status !== "completed" || steps.length === 0) return false;
  const stepIndex = typeof latest.stepIndex === "number" ? latest.stepIndex : steps.length === 1 ? 0 : undefined;
  return stepIndex === steps.length - 1;
}

export async function reviveMissingEntryAutomations(
  system: RoutaSystem,
  workspaceId: string,
  boardId: string,
  options: RestartRecoveryOptions,
): Promise<void> {
  const board = await system.kanbanBoardStore.get(boardId);
  if (!board) return;

  const tasks = await system.taskStore.listByWorkspace(workspaceId);
  for (const originalTask of tasks) {
    if (originalTask.boardId !== boardId || !originalTask.columnId) {
      continue;
    }

    const task = await sanitizeStaleCurrentLaneAutomation(system, originalTask, options);
    if (task.triggerSessionId) continue;

    const currentColumnId = task.columnId;
    if (!currentColumnId) continue;
    const column = board.columns.find((entry) => entry.id === currentColumnId);
    if (!column) continue;

    const convergenceColumnId = resolveReviewLaneConvergenceTarget(task, board.columns);
    if (convergenceColumnId && convergenceColumnId !== currentColumnId) {
      const converged = await convergeRecoveredReviewTask(
        system,
        workspaceId,
        boardId,
        task,
        column.name,
        convergenceColumnId,
      );
      if (converged) {
        continue;
      }
    }

    const automation = column.automation;
    const transitionType = automation?.transitionType ?? "entry";
    const hasLaneSessionForCurrentColumn = (task.laneSessions ?? []).some((entry) => (
      entry.columnId === currentColumnId
      && entry.status === "running"
      && isSessionActivelyRunning(entry.sessionId, options)
    ));
    if (
      !automation?.enabled
      || (transitionType !== "entry" && transitionType !== "both")
      || getKanbanAutomationSteps(automation).length === 0
      || hasLaneSessionForCurrentColumn
    ) {
      continue;
    }

    // A finished Done lane has nothing left to run. Its agent processes exit
    // after the card completes; treating that as "missing automation" re-ran
    // the pusher and reporter on finished cards (card 809c5012, defect 2).
    if (column.stage === "done" && isLaneAutomationComplete(task, currentColumnId, automation)) {
      continue;
    }

    // Respect the circuit breaker: if this card already exceeded the non-dev
    // automation repeat limit for the current column, do not revive it.
    // Without this guard every page refresh re-triggers the same doomed
    // automation, burning sessions and potentially pushing cards into wrong
    // lanes via side effects.
    if (hasExceededNonDevAutomationRepeatLimit(task, currentColumnId, column.stage)) {
      continue;
    }

    // The last run in this lane failed because of the environment (for
    // example an unregistered provider). Re-running cannot succeed until a
    // human fixes it, so revive leaves the card alone.
    if (isAwaitingEnvironmentFix(task, currentColumnId)) {
      continue;
    }

    // A rate-limited step waits for its planned rerun time (retryAfterAt);
    // after that it is rerun below like any failed step. A lane whose
    // retryable environment failures tripped the fuse is left alone
    // (card 79804de2).
    if (
      hasTrippedRetryableEnvironmentFuse(task, currentColumnId)
      || isWaitingForRateLimitRetry(task, currentColumnId, options.now?.() ?? new Date())
    ) {
      continue;
    }

    // The lane's last step really completed (also when the sweep above just
    // read it from the session history): nothing is left to run. Before, a
    // Dev crafter or Review Guard that ended its turn was re-run from the
    // lane's first step (card 6d8365ca, review R2/R2b).
    if (isLatestRunCompletedLastStep(task, currentColumnId, automation)) {
      continue;
    }

    // The lane watchdog ended a silent step outside Dev. Those steps are not
    // re-run automatically (a Done-lane pusher could push twice); the card
    // waits for a manual rerun.
    if (column.stage !== "dev" && isAwaitingRerunAfterLaneWatchdog(task, currentColumnId)) {
      continue;
    }

    // The lane's latest run was interrupted or failed (Routa restart,
    // cancelled turn): rerun that step, not the next one and not the lane's
    // first one (card 5fdaa681). Step 0 re-enters the column below.
    const latestRun = [...(task.laneSessions ?? [])]
      .reverse()
      .find((entry) => entry.columnId === currentColumnId && typeof entry.stepIndex === "number");
    const latestRunEnded = latestRun?.status === "failed" || latestRun?.status === "timed_out";
    const resumeStep = latestRunEnded ? resolveLaneResumeStep(task, board.columns) : undefined;
    // Every start below claims the card's lane first: a concurrent startup
    // resume or retryTrigger already starting it makes revive skip the card.
    if (resumeStep && resumeStep.stepIndex > 0) {
      await runLaneRerunOnce(system.taskStore, task, currentColumnId, (fresh) => enqueueKanbanTaskSession(system, {
        task: fresh,
        expectedColumnId: currentColumnId,
        ignoreExistingTrigger: true,
        step: resumeStep.step,
        stepIndex: resumeStep.stepIndex,
        adoptLaneRun: true,
      }));
      continue;
    }

    const laneState = resolveCurrentLaneAutomationState(task, board.columns);
    if (
      !latestRunEnded
      && laneState.currentSession
      && laneState.currentSession.columnId === currentColumnId
      && (laneState.currentSession.status === "transitioned" || laneState.currentSession.status === "completed")
      && laneState.nextStep
      && typeof laneState.currentStepIndex === "number"
    ) {
      // Started outside a column transition, so the orchestrator must adopt
      // it: otherwise its end is never recorded (lane stays "running") and the
      // lane's following step never starts (Done Reporter a1d9bffc, 2026-10-23).
      const nextStep = laneState.nextStep;
      const nextStepIndex = laneState.currentStepIndex + 1;
      await runLaneRerunOnce(system.taskStore, task, currentColumnId, (fresh) => enqueueKanbanTaskSession(system, {
        task: fresh,
        expectedColumnId: currentColumnId,
        ignoreExistingTrigger: true,
        step: nextStep,
        stepIndex: nextStepIndex,
        adoptLaneRun: true,
      }));
      continue;
    }

    await runLaneRerunOnce(system.taskStore, task, currentColumnId, () => processKanbanColumnTransition(system, {
      cardId: task.id,
      cardTitle: task.title,
      boardId,
      workspaceId,
      fromColumnId: "__revive__",
      toColumnId: currentColumnId,
      fromColumnName: "Revive",
      toColumnName: column.name,
    }));
  }
}
