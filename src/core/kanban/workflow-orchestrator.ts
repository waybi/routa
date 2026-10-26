/**
 * KanbanWorkflowOrchestrator — Coordinates column automation and task progress.
 *
 * Listens for COLUMN_TRANSITION events and triggers the configured Column Agent
 * for the target column. Tracks active automations, supervises dev-lane ACP
 * sessions, and supports bounded recovery for watchdog/loop policies.
 */

import { getHttpSessionStore } from "../acp/http-session-store";
import { EventBus, AgentEventType, AgentEvent } from "../events/event-bus";
import type {
  KanbanAutomationStep,
  KanbanColumnAutomation,
  KanbanColumnStage,
  KanbanDevSessionCompletionRequirement,
  KanbanDevSessionSupervision,
  KanbanDevSessionSupervisionMode,
  KanbanLaneSessionWatchdog,
} from "../models/kanban";
import { getKanbanAutomationSteps, resolveTaskStatusForBoardColumn } from "../models/kanban";
import { TaskStatus, type Task, type TaskLaneSessionRecoveryReason } from "../models/task";
import type { KanbanBoardStore } from "../store/kanban-board-store";
import type { TaskStore } from "../store/task-store";
import type { ColumnTransitionData } from "./column-transition";
import { resolveTransitionAutomation } from "./column-transition";
import {
  getDefaultKanbanDevSessionSupervision,
  getDefaultKanbanLaneSessionWatchdog,
} from "./board-session-supervision";
import { getTaskLaneSession, markTaskLaneSessionStatus, upsertTaskLaneSession } from "./task-lane-history";
import { collectTaskSessionIds, isLaneAutomationComplete } from "./done-lane-teardown";
import { reconcileExitAfterTurnEnd, settleUnhandledLaneEnd } from "./lane-session-settlement";
import {
  classifyRetryableEnvironmentFailure,
  formatEnvironmentFailureError,
  isEnvironmentFailureLaneSession,
  isEnvironmentFailureMessage,
  isRetryableEnvironmentFailureLaneSession,
} from "./environment-failure";
import {
  collectRateLimitEvidence,
  RateLimitRetryScheduler,
  runRateLimitRetry,
} from "./rate-limit-retry";
import { isUserCancelledLaneSession, planLaneStepRetry, resolveCancelledTurnReason } from "./lane-cancel-origin";

const WATCHDOG_SCAN_INTERVAL_MS = 30_000;
const COMPLETED_AUTOMATION_CLEANUP_DELAY_MS = 30_000;

interface RecoveryNotificationParams {
  workspaceId: string;
  sessionId: string;
  cardId: string;
  cardTitle: string;
  boardId: string;
  columnId: string;
  reason: string;
  mode: KanbanDevSessionSupervisionMode;
}

export type SendKanbanSessionPrompt = (params: {
  workspaceId: string;
  sessionId: string;
  prompt: string;
}) => Promise<void>;

function getDisabledSupervisionConfig(): KanbanDevSessionSupervision {
  return {
    ...getDefaultKanbanDevSessionSupervision(),
    mode: "disabled",
  };
}

function shouldSuperviseStage(stage: KanbanColumnStage): boolean {
  return stage === "dev";
}

/** Minutes of silence that end a step: the Dev policy, or the lane watchdog elsewhere. */
function getInactivityTimeoutMinutes(automation: ActiveAutomation): number {
  return isRecoveryMode(automation.supervision.mode) || !automation.laneWatchdog
    ? automation.supervision.inactivityTimeoutMinutes
    : automation.laneWatchdog.inactivityTimeoutMinutes;
}

function isRecoveryMode(mode: KanbanDevSessionSupervisionMode): mode is "watchdog_retry" | "ralph_loop" {
  return mode === "watchdog_retry" || mode === "ralph_loop";
}

/** The turn ended with stopReason=cancelled: a failed step, re-run after a backoff unless the user cancelled it. */
function isCancelledTurn(event: AgentEvent): boolean {
  return event.type === AgentEventType.AGENT_COMPLETED && event.data?.stopReason === "cancelled";
}

/** A completion synthesized from a tool call (or a report) arrives while the agent is still inside its turn. */
function isInTurnEvent(event: AgentEvent): boolean {
  return event.type === AgentEventType.REPORT_SUBMITTED || typeof event.data?.synthesizedBy === "string";
}

function getRecoveryReason(
  event: AgentEvent,
  completionSatisfied: boolean,
  environmentFailure = false,
  rateLimited = false,
): TaskLaneSessionRecoveryReason {
  if (environmentFailure) {
    return "environment_failure";
  }
  if (rateLimited) {
    return "rate_limited";
  }
  if (isCancelledTurn(event)) {
    return resolveCancelledTurnReason(event.data?.sessionId);
  }
  if (event.type === AgentEventType.AGENT_TIMEOUT) {
    return "watchdog_inactivity";
  }
  if (event.type === AgentEventType.AGENT_FAILED) {
    return "agent_failed";
  }
  if (event.type === AgentEventType.AGENT_COMPLETED && !completionSatisfied) {
    return "completion_criteria_not_met";
  }
  return "agent_failed";
}

function buildKanbanRecoveryPrompt(params: RecoveryNotificationParams): string {
  const mode = params.mode === "watchdog_retry" ? "watchdog_retry" : "ralph_loop";
  return [
    `hi，这里有一个 Agent（acp session id = ${params.sessionId}）很久没动了，你看看怎么回事，要不要继续？`,
    `Card: ${params.cardTitle} (${params.cardId})`,
    `Board: ${params.boardId}`,
    `Column: ${params.columnId}`,
    `Mode: ${mode}`,
    `Reason: ${params.reason}`,
    "如果 session 还在，请直接处理并继续任务；否则尽快确认下一步重建策略。",
  ].join("\\n");
}

function getAutomationStepLabel(step: KanbanAutomationStep | undefined, stepIndex: number): string {
  if (!step) {
    return `Step ${stepIndex + 1}`;
  }
  return step.specialistName ?? step.specialistId ?? step.role ?? `Step ${stepIndex + 1}`;
}

const NON_DEV_AUTOMATION_REPEAT_LIMIT = 3;

export function getNonDevAutomationRunCount(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
  stage: KanbanColumnStage,
): number {
  if (!task || stage === "dev") {
    return 0;
  }

  const laneSessions = task.laneSessions ?? [];
  let runCount = 0;

  for (let index = laneSessions.length - 1; index >= 0; index -= 1) {
    const entry = laneSessions[index];
    if (entry.columnId !== columnId || entry.laneRerunRequestedAt) { // a rerun request ends the previous round
      break;
    }
    // Environment failures (including retryable ones: rate limits, restart
    // interruptions) are counted separately (see environment-failure.ts); they
    // and a user's own cancel must not consume the normal repeat budget.
    if (isEnvironmentFailureLaneSession(entry) || isRetryableEnvironmentFailureLaneSession(entry) || isUserCancelledLaneSession(entry)) {
      continue;
    }
    runCount += 1;
  }

  return runCount;
}

export function hasExceededNonDevAutomationRepeatLimit(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
  stage: KanbanColumnStage,
): boolean {
  return getNonDevAutomationRunCount(task, columnId, stage) >= NON_DEV_AUTOMATION_REPEAT_LIMIT;
}

function buildNonDevAutomationRepeatLimitMessage(columnName: string, runCount: number): string {
  return `Stopped Kanban automation for "${columnName}" after ${runCount + 1} runs. `
    + `Non-dev lanes are limited to ${NON_DEV_AUTOMATION_REPEAT_LIMIT} automation runs to prevent loops.`;
}

/** Context persisted for a session attempt when supervision is enabled. */
export interface AutomationSessionSupervisionContext {
  attempt: number;
  mode: "watchdog_retry" | "ralph_loop";
  completionRequirement: KanbanDevSessionCompletionRequirement;
  objective: string;
  recoveredFromSessionId?: string;
  recoveryReason?: TaskLaneSessionRecoveryReason;
}

/** Represents an active column automation in progress */
export interface ActiveAutomation {
  cardId: string;
  cardTitle: string;
  boardId: string;
  workspaceId: string;
  columnId: string;
  columnName: string;
  stage: KanbanColumnStage;
  automation: KanbanColumnAutomation;
  steps: KanbanAutomationStep[];
  currentStepIndex: number;
  sessionId?: string;
  startedAt: Date;
  status: "queued" | "running" | "completed" | "failed";
  supervision: KanbanDevSessionSupervision;
  /**
   * Set for lanes outside Dev: a step silent this long is ended as timed_out
   * and never re-run automatically (a Done-lane pusher must not push twice).
   */
  laneWatchdog?: KanbanLaneSessionWatchdog;
  attempt: number;
  recoveryAttempts: number;
  signaledSessionIds: Set<string>;
  /** Whether to automatically try the next fallback step on failure */
  enableAutomaticFallback?: boolean;
}

/** Callback to create an agent session for a column automation */
export type CreateAutomationSession = (params: {
  workspaceId: string;
  cardId: string;
  cardTitle: string;
  columnId: string;
  columnName: string;
  automation: KanbanColumnAutomation;
  step: KanbanAutomationStep;
  stepIndex: number;
  supervision?: AutomationSessionSupervisionContext;
}) => Promise<string | CreateAutomationSessionResult | null>;

/**
 * `queued` means the board is at its session limit: the step waits in the
 * board queue and starts when a slot frees. It is not a failure.
 */
export interface CreateAutomationSessionResult {
  sessionId?: string | null;
  queued?: boolean;
}

type AutomationStepStart = "started" | "queued" | "failed";

/** A lane's own steps followed by the card's automatic fallback agents. */
function buildAutomationSteps(
  automation: KanbanColumnAutomation,
  task: Task | undefined,
): KanbanAutomationStep[] {
  const fallbackSteps = task?.enableAutomaticFallback && task.fallbackAgentChain?.length
    ? task.fallbackAgentChain.map((agent, index) => ({
      id: `fallback-${index + 1}`,
      providerId: agent.providerId,
      role: agent.role,
      specialistId: agent.specialistId,
      specialistName: agent.specialistName,
    }))
    : [];
  return [...getKanbanAutomationSteps(automation), ...fallbackSteps];
}

function readCreatedSession(
  result: string | CreateAutomationSessionResult | null | undefined,
): { sessionId?: string; queued: boolean } {
  if (typeof result === "string") {
    return { sessionId: result || undefined, queued: false };
  }
  return {
    sessionId: result?.sessionId ?? undefined,
    queued: !result?.sessionId && result?.queued === true,
  };
}

/** Ends the process behind an ACP session. Must tolerate unknown or already-exited sessions. */
export type KillAutomationSession = (sessionId: string) => Promise<void>;

async function killSessionViaProcessManager(sessionId: string): Promise<void> {
  const { getAcpProcessManager } = await import("../acp/processer");
  await getAcpProcessManager().killSession(sessionId);
}

/** Callback to clean up a card's session queue entry before auto-advancing or recovering */
export type CleanupCardSession = (cardId: string) => void;

/**
 * Removes a finished card's worktree after every session of the card has
 * ended. Must run its own safety checks and must not write the task.
 */
export type DoneWorktreeCleanup = (params: {
  task: Task;
  columnId: string;
  automation: KanbanColumnAutomation;
}) => Promise<void>;

interface PendingWorktreeCleanup {
  taskId: string;
  columnId: string;
  automation: KanbanColumnAutomation;
}

export type ResolveDevSessionSupervision = (params: {
  workspaceId: string;
  boardId: string;
  columnId: string;
  stage: KanbanColumnStage;
}) => Promise<KanbanDevSessionSupervision>;

export type ResolveLaneSessionWatchdog = (params: {
  workspaceId: string;
  boardId: string;
  columnId: string;
  stage: KanbanColumnStage;
}) => Promise<KanbanLaneSessionWatchdog>;

export type EnsureCompletionFallbackArtifact = (params: {
  task: Task;
  sessionId: string;
  workspaceId: string;
  stage: KanbanColumnStage;
  transport?: string;
}) => Promise<void>;

export class KanbanWorkflowOrchestrator {
  private handlerKey = "kanban-workflow-orchestrator";
  private activeAutomations = new Map<string, ActiveAutomation>();
  private started = false;
  private cleanupCardSession?: CleanupCardSession;
  private resolveDevSessionSupervision?: ResolveDevSessionSupervision;
  private resolveLaneSessionWatchdog?: ResolveLaneSessionWatchdog;
  private sendKanbanSessionPrompt?: SendKanbanSessionPrompt;
  private ensureCompletionFallbackArtifact?: EnsureCompletionFallbackArtifact;
  private watchdogTimer?: ReturnType<typeof setInterval>;
  /** Sessions Routa ended itself while winding down a finished card. */
  private teardownSessionIds = new Set<string>();
  /** Teardown sessions still inside their turn; ended on their next lifecycle event. */
  private deferredTeardownSessionIds = new Set<string>();
  /** Sessions whose agent process Routa already ended; each is ended once. */
  private endedSessionIds = new Set<string>();
  /**
   * Sessions ended because the user deleted their card or moved it out of
   * their column. Their later lifecycle events (the failure raised by the
   * aborted prompt) are teardown: no lane record, recovery or re-run.
   */
  private cardEndedSessionIds = new Set<string>();
  /**
   * Running sessions of a lane their card left (move_card, update_task
   * convergence), mapped to the card id. Their end only winds the step down:
   * the lane record is completed and the process ended; no next step,
   * recovery or re-run starts.
   */
  private departedLaneSessions = new Map<string, string>();
  private doneWorktreeCleanup?: DoneWorktreeCleanup;
  private afterLaneEnd?: (cardId: string) => Promise<unknown>; // card 64f2e31c: route to Blocked
  /**
   * Worktree removals waiting for a deferred teardown session to end, keyed by
   * that session id. In memory only: a restart in between keeps the copy.
   */
  private pendingWorktreeCleanup = new Map<string, PendingWorktreeCleanup>();
  /** Delayed reruns of rate-limited steps (card 79804de2). */
  private rateLimitRetries = new RateLimitRetryScheduler((entry) => runRateLimitRetry({
    taskStore: this.taskStore,
    createSession: this.createSession && (async (params) => readCreatedSession(await this.createSession!(params))),
    adoptLaneRun: async (params) => (await this.adoptLaneRun(params)) ? this.activeAutomations.get(params.cardId) : undefined,
    cleanupCardSession: this.cleanupCardSession,
    buildSupervision: (active, objective, from) => this.buildSupervisionContext(active, objective, { recoveredFromSessionId: from }),
  }, entry));

  constructor(
    private eventBus: EventBus,
    private kanbanBoardStore: KanbanBoardStore,
    private taskStore: TaskStore,
    private createSession?: CreateAutomationSession,
    private killSession: KillAutomationSession = killSessionViaProcessManager,
  ) {}

  /** Start listening for column transition events */
  start(): void {
    if (this.started) {
      return;
    }
    this.eventBus.on(this.handlerKey, (event: AgentEvent) => {
      if (event.type === AgentEventType.COLUMN_TRANSITION) {
        void this.handleColumnTransition(event);
      }
      if (
        event.type === AgentEventType.AGENT_COMPLETED
        || event.type === AgentEventType.REPORT_SUBMITTED
        || event.type === AgentEventType.AGENT_FAILED
        || event.type === AgentEventType.AGENT_TIMEOUT
      ) {
        void this.handleAgentCompletion(event);
      }
    });
    this.watchdogTimer = setInterval(() => {
      void this.scanForInactiveSessions();
    }, WATCHDOG_SCAN_INTERVAL_MS);
    (this.watchdogTimer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
    this.started = true;
  }

  /** Stop listening */
  stop(): void {
    if (!this.started) {
      return;
    }
    this.eventBus.off(this.handlerKey);
    this.activeAutomations.clear();
    this.rateLimitRetries.stopAll();
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = undefined;
    }
    this.started = false;
  }

  /** Set the session creation callback */
  setCreateSession(fn: CreateAutomationSession): void {
    this.createSession = fn;
  }

  /** Set the cleanup callback for session queue entries */
  setCleanupCardSession(fn: CleanupCardSession): void {
    this.cleanupCardSession = fn;
  }

  /** Set the resolver for board-level dev session supervision config */
  setResolveDevSessionSupervision(fn: ResolveDevSessionSupervision): void {
    this.resolveDevSessionSupervision = fn;
  }

  /** Set the resolver for the board's inactivity watchdog on lanes outside Dev */
  setResolveLaneSessionWatchdog(fn: ResolveLaneSessionWatchdog): void {
    this.resolveLaneSessionWatchdog = fn;
  }

  /** Set the callback used to send a prompt message into a live ACP session */
  setSendKanbanSessionPrompt(fn: SendKanbanSessionPrompt): void {
    this.sendKanbanSessionPrompt = fn;
  }

  setEnsureCompletionFallbackArtifact(fn: EnsureCompletionFallbackArtifact): void {
    this.ensureCompletionFallbackArtifact = fn;
  }

  /** Set the callback that removes a finished card's worktree once all its sessions ended */
  setDoneWorktreeCleanup(fn: DoneWorktreeCleanup): void {
    this.doneWorktreeCleanup = fn;
  }
  setAfterLaneEnd(fn: (cardId: string) => Promise<unknown>): void { this.afterLaneEnd = fn; }

  /** Get all active automations */
  getActiveAutomations(): ActiveAutomation[] {
    return Array.from(this.activeAutomations.values());
  }

  /** Get active automation for a specific card */
  getAutomationForCard(cardId: string): ActiveAutomation | undefined {
    return this.activeAutomations.get(cardId);
  }

  async processColumnTransition(data: ColumnTransitionData): Promise<void> {
    await this.handleColumnTransitionData(data);
  }

  /**
   * End the agent processes of sessions whose card was deleted or moved by
   * the user. Each session is ended at most once, also across concurrent
   * calls and the normal end of its step: endSessionProcess records the id
   * before it awaits the kill. Their exits are teardown, not step failures.
   */
  async endTaskSessions(sessionIds: string[], label: string): Promise<void> {
    const unique = [...new Set(sessionIds.filter((id) => typeof id === "string" && id.length > 0))];
    for (const sessionId of unique) {
      this.teardownSessionIds.add(sessionId);
      this.cardEndedSessionIds.add(sessionId);
      this.deferredTeardownSessionIds.delete(sessionId);
      this.departedLaneSessions.delete(sessionId);
    }
    for (const sessionId of unique) {
      await this.endSessionProcess(sessionId, label);
    }
  }

  /**
   * Drop the card's automation so a late event cannot advance, recover or
   * re-run it. With `columnId`, only an automation of that column is dropped
   * (the card was moved away from it).
   */
  forgetCard(cardId: string, options?: { columnId?: string }): void {
    this.rateLimitRetries.forget(cardId, options?.columnId);
    const automation = this.activeAutomations.get(cardId);
    if (!automation) return;
    if (options?.columnId !== undefined && automation.columnId !== options.columnId) return;
    if (automation.sessionId) this.cardEndedSessionIds.add(automation.sessionId); // its later end is teardown
    this.activeAutomations.delete(cardId);
  }

  /** Drop the automation of the lane the card left; keep its running session for windDownDepartedSession. */
  private leaveLane(cardId: string, columnId: string): void {
    const automation = this.activeAutomations.get(cardId);
    if (!automation || automation.columnId !== columnId) return;
    if (automation.sessionId && automation.status === "running") {
      this.departedLaneSessions.set(automation.sessionId, cardId);
    }
    this.activeAutomations.delete(cardId);
  }

  /**
   * End of a session whose card left its lane: complete its still-running
   * lane record (as completeRunningSessionsOutsideColumn does) and end its
   * process, deferred while the session is still inside its turn.
   */
  private async windDownDepartedSession(sessionId: string, cardId: string, event: AgentEvent): Promise<void> {
    if (!isInTurnEvent(event)) {
      this.departedLaneSessions.delete(sessionId);
    }
    const task = await this.taskStore.get(cardId);
    if (task && getTaskLaneSession(task, sessionId)?.status === "running") {
      markTaskLaneSessionStatus(task, sessionId, "completed");
      await this.taskStore.save(task);
    }
    await this.endFinishedStepSession(sessionId, event);
  }

  private async handleColumnTransition(event: AgentEvent): Promise<void> {
    await this.handleColumnTransitionData(event.data as unknown as ColumnTransitionData);
  }

  private async handleColumnTransitionData(data: ColumnTransitionData): Promise<void> {
    // The card left the column of its pending rate-limit rerun.
    this.rateLimitRetries.cancel(data.cardId, data.laneRerun ? undefined : data.toColumnId);
    // The card left the column its automation runs in: that lane is over even
    // when the new column has no automation (e.g. move_card into Blocked), so
    // a late end of its session must not start, fail or recover a step there.
    // Runs before any await; a Review lane rerun (laneRerun) leaves its own lane.
    if (data.fromColumnId !== data.toColumnId || data.laneRerun) {
      this.leaveLane(data.cardId, data.fromColumnId);
    }
    const board = await this.kanbanBoardStore.get(data.boardId);
    if (!board) return;
    const resolved = resolveTransitionAutomation(board, data);
    if (!resolved) return;
    const task = await this.taskStore.get(data.cardId);
    const laneObjective = task?.objective?.trim() || data.cardTitle;
    const targetColumn = resolved.column;
    const automation = resolved.automation;
    const steps = buildAutomationSteps(automation, task);
    if (steps.length === 0) return;

    if (hasExceededNonDevAutomationRepeatLimit(task, targetColumn.id, targetColumn.stage)) {
      if (task) {
        task.lastSyncError = buildNonDevAutomationRepeatLimitMessage(
          targetColumn.name,
          getNonDevAutomationRunCount(task, targetColumn.id, targetColumn.stage),
        );
        task.updatedAt = new Date();
        await this.taskStore.save(task);
      }
      console.warn(
        `[WorkflowOrchestrator] Stopped repeated non-dev automation for card ${data.cardId} in column ${targetColumn.id}.`,
      );
      return;
    }

    const supervision = await this.resolveLaneSupervision(data.workspaceId, data.boardId, targetColumn);

    const existingAutomation = this.activeAutomations.get(data.cardId);
    if (
      existingAutomation
      && existingAutomation.boardId === data.boardId
      && existingAutomation.columnId === targetColumn.id
      && (existingAutomation.status === "queued" || existingAutomation.status === "running")
    ) {
      return;
    }

    const automationEntry: ActiveAutomation = {
      cardId: data.cardId,
      cardTitle: data.cardTitle,
      boardId: data.boardId,
      workspaceId: data.workspaceId,
      columnId: targetColumn.id,
      columnName: targetColumn.name,
      stage: targetColumn.stage,
      automation,
      steps,
      currentStepIndex: 0,
      startedAt: new Date(),
      status: "queued",
      supervision,
      laneWatchdog: await this.resolveLaneWatchdog(data.workspaceId, data.boardId, targetColumn),
      attempt: 1,
      recoveryAttempts: 0,
      signaledSessionIds: new Set(),
      enableAutomaticFallback: task?.enableAutomaticFallback,
    };

    this.activeAutomations.set(data.cardId, automationEntry);

    // Trigger agent session if callback is available
    if (this.createSession) {
      try {
        const { sessionId } = readCreatedSession(await this.createSession({
          workspaceId: data.workspaceId,
          cardId: data.cardId,
          cardTitle: data.cardTitle,
          columnId: targetColumn.id,
          columnName: targetColumn.name,
          automation,
          step: steps[0],
          stepIndex: 0,
          supervision: this.buildSupervisionContext(automationEntry, laneObjective),
        }));
        if (sessionId) {
          automationEntry.status = "running";
          automationEntry.sessionId = sessionId;
        }
      } catch (err) {
        automationEntry.status = "failed";
        console.error("[WorkflowOrchestrator] Failed to create session:", err);
      }
    }
  }

  /**
   * Follow a lane run started outside a column transition (a manual rerun of
   * the card) at `stepIndex`, so the lane's later steps still run after it.
   * Without a session id the run is queued; its session is adopted from the
   * card's triggerSessionId when it starts. Replaces any finished automation.
   */
  async adoptLaneRun(params: {
    cardId: string;
    columnId: string;
    stepIndex: number;
    sessionId?: string;
    /** Dev counters to carry over (a rate-limit rerun); default a fresh run. */
    counters?: { attempt: number; recoveryAttempts: number };
  }): Promise<boolean> {
    const task = await this.taskStore.get(params.cardId);
    if (!task?.boardId || task.columnId !== params.columnId) return false;
    const board = await this.kanbanBoardStore.get(task.boardId);
    const column = board?.columns.find((entry) => entry.id === params.columnId);
    const automation = column?.automation;
    if (!column || !automation?.enabled) return false;
    const steps = buildAutomationSteps(automation, task);
    if (!steps[params.stepIndex]) return false;

    this.activeAutomations.set(params.cardId, {
      cardId: params.cardId,
      cardTitle: task.title,
      boardId: task.boardId,
      workspaceId: task.workspaceId,
      columnId: column.id,
      columnName: column.name,
      stage: column.stage,
      automation,
      steps,
      currentStepIndex: params.stepIndex,
      sessionId: params.sessionId,
      startedAt: new Date(),
      status: params.sessionId ? "running" : "queued",
      supervision: await this.resolveLaneSupervision(task.workspaceId, task.boardId, column),
      laneWatchdog: await this.resolveLaneWatchdog(task.workspaceId, task.boardId, column),
      attempt: params.counters?.attempt ?? 1,
      recoveryAttempts: params.counters?.recoveryAttempts ?? 0,
      signaledSessionIds: new Set(),
      enableAutomaticFallback: task.enableAutomaticFallback,
    });
    return true;
  }

  private async resolveLaneSupervision(
    workspaceId: string,
    boardId: string,
    column: { id: string; stage: KanbanColumnStage },
  ): Promise<KanbanDevSessionSupervision> {
    return shouldSuperviseStage(column.stage)
      ? (await this.resolveDevSessionSupervision?.({
        workspaceId,
        boardId,
        columnId: column.id,
        stage: column.stage,
      })) ?? getDefaultKanbanDevSessionSupervision()
      : getDisabledSupervisionConfig();
  }

  /** Dev keeps its own supervision; every other lane gets the timeout-only watchdog. */
  private async resolveLaneWatchdog(
    workspaceId: string,
    boardId: string,
    column: { id: string; stage: KanbanColumnStage },
  ): Promise<KanbanLaneSessionWatchdog | undefined> {
    if (shouldSuperviseStage(column.stage)) {
      return undefined;
    }
    let watchdog = getDefaultKanbanLaneSessionWatchdog();
    try {
      watchdog = (await this.resolveLaneSessionWatchdog?.({
        workspaceId,
        boardId,
        columnId: column.id,
        stage: column.stage,
      })) ?? watchdog;
    } catch (error) {
      console.warn("[WorkflowOrchestrator] Failed to read the lane watchdog config; using the default:", error);
    }
    return watchdog.enabled ? watchdog : undefined;
  }

  private async handleAgentCompletion(event: AgentEvent): Promise<void> {
    await this.finishDeferredTeardown(event);
    const endedSessionId = typeof event.data?.sessionId === "string" ? event.data.sessionId : undefined;
    if (endedSessionId && this.cardEndedSessionIds.has(endedSessionId)) {
      return settleUnhandledLaneEnd(this.taskStore, getHttpSessionStore(), event, "teardown");
    }
    const departedCardId = endedSessionId ? this.departedLaneSessions.get(endedSessionId) : undefined;
    if (endedSessionId && departedCardId) {
      await this.windDownDepartedSession(endedSessionId, departedCardId, event);
      return;
    }
    for (const [cardId, automation] of this.activeAutomations.entries()) {
      if (automation.status === "completed" || automation.status === "failed") continue;

      const eventSessionId = typeof event.data?.sessionId === "string" ? event.data.sessionId : undefined;
      if (!eventSessionId) continue;

      const task = await this.taskStore.get(cardId);
      const sessionId = automation.sessionId ?? task?.triggerSessionId;
      const adoptedTriggerSession = !automation.sessionId && Boolean(sessionId);
      if (adoptedTriggerSession) {
        automation.sessionId = sessionId;
        automation.status = "running";
      }

      // Match only by the automation's own sessionId or the card's current triggerSessionId.
      const isRelated = Boolean(sessionId && eventSessionId === sessionId);
      if (!isRelated) continue;

      if (task && this.isPostCompletionTeardownFailure(task, automation, eventSessionId, event)) {
        // The exit of a finished card's session is teardown, not a step
        // failure: do not mark it failed, record a recovery reason, or re-run.
        if (adoptedTriggerSession) {
          automation.sessionId = undefined;
          automation.status = "queued";
        }
        automation.signaledSessionIds.add(eventSessionId);
        return settleUnhandledLaneEnd(this.taskStore, getHttpSessionStore(), event, "teardown", cardId);
      }

      const sessionStore = getHttpSessionStore();
      event = reconcileExitAfterTurnEnd(event, sessionStore); // exit right after a normal turn end = that end
      const sessionActivity = sessionStore.getSessionActivity(eventSessionId);
      if (task) {
        upsertTaskLaneSession(task, {
          sessionId: eventSessionId,
          lastActivityAt: sessionActivity?.lastMeaningfulActivityAt ?? sessionActivity?.lastActivityAt,
        });
      }

      // Cancelled turns stop advancement; non-user cancellations retry after a backoff (14de4800).
      const cancelledTurn = isCancelledTurn(event);
      const successEvent =
        event.type !== AgentEventType.AGENT_FAILED
        && event.type !== AgentEventType.AGENT_TIMEOUT
        && event.data?.success !== false
        && !cancelledTurn;
      if (!successEvent) {
        // A failed or timed-out session keeps its agent process alive (and its
        // memory) unless we end it. Kill it before any fallback/recovery starts
        // a new session; only the failed session id is targeted.
        await this.killFailedSession(eventSessionId);
      }

      const completionSatisfied = await this.isCompletionSatisfied(task, automation, successEvent);
      const acpError = sessionStore.getSession(eventSessionId)?.acpError;
      const environmentFailure = !successEvent && isEnvironmentFailureMessage(
        typeof event.data?.error === "string" && event.data.error ? event.data.error : acpError,
      );
      const rateLimitEvidence = !successEvent && !environmentFailure && !cancelledTurn
        ? collectRateLimitEvidence({
          timeout: event.type === AgentEventType.AGENT_TIMEOUT,
          error: event.data?.error,
          acpError,
          history: sessionStore.getHistory(eventSessionId),
        })
        : "";
      // A rate limit clears by itself: the step is re-run later at the same
      // index, outside the recovery and fallback budgets (card 79804de2).
      const rateLimited = classifyRetryableEnvironmentFailure(rateLimitEvidence) === "rate_limited";
      // Environment failures cannot succeed on retry: no recovery, no fallback,
      // and they do not consume the supervision retry budget.
      const shouldRecover = task && !environmentFailure && !rateLimited && !cancelledTurn
        ? await this.shouldRecover(task, automation, event, completionSatisfied)
        : false;

      if (task && getTaskLaneSession(task, eventSessionId)?.status === "running") { // an ended record is final
        const nextStatus = event.type === AgentEventType.AGENT_TIMEOUT
          ? "timed_out"
          : successEvent && completionSatisfied
            ? "completed"
            : "failed";
        markTaskLaneSessionStatus(task, eventSessionId, nextStatus);
        if (!successEvent || !completionSatisfied) {
          upsertTaskLaneSession(task, {
            sessionId: eventSessionId,
            recoveryReason: getRecoveryReason(event, completionSatisfied, environmentFailure, rateLimited),
          });
        }
      }
      const rateLimitPlan = task && (rateLimited || cancelledTurn)
        ? planLaneStepRetry({ task, columnId: automation.columnId, sessionId: eventSessionId, evidence: rateLimitEvidence, rateLimited })
        : undefined;

      const nextStepIndex = automation.currentStepIndex + 1;
      const hasNextStep = successEvent
        && completionSatisfied
        && nextStepIndex < automation.steps.length;
      let failedToAdvanceWithinLane = false;

      if (task && hasNextStep) {
        const nextStepStart = await this.startNextAutomationStep(cardId, automation, task, nextStepIndex);
        if (nextStepStart !== "failed") {
          // "queued": the board is full; the step waits in the board queue and
          // this automation adopts its session once the queue starts it.
          automation.signaledSessionIds.add(eventSessionId);
          // Every step runs in its own new session; nothing reuses this one.
          await this.endFinishedStepSession(eventSessionId, event);
          return;
        }
        failedToAdvanceWithinLane = true;
      }

      // Automatic fallback: on failure, try next fallback agent step instead of retrying
      // A step the lane watchdog ended outside Dev is not handed to a fallback
      // agent either: that would re-run it (a Done pusher could push twice).
      const laneWatchdogTimeout = event.type === AgentEventType.AGENT_TIMEOUT && Boolean(automation.laneWatchdog);
      const canFallback = !successEvent
        && !environmentFailure
        && !rateLimited
        && !laneWatchdogTimeout
        && !cancelledTurn
        && automation.enableAutomaticFallback
        && nextStepIndex < automation.steps.length;
      if (task && canFallback) {
        const maxAttempts = task.maxFallbackAttempts ?? automation.steps.length;
        const fallbackAttemptCount = automation.currentStepIndex;
        if (fallbackAttemptCount < maxAttempts) {
          const fallbackStart = await this.startNextAutomationStep(cardId, automation, task, nextStepIndex);
          if (fallbackStart !== "failed") {
            automation.signaledSessionIds.add(eventSessionId);
            return;
          }
        }
      }

      if (task && shouldRecover) {
        const recoveryReason = getRecoveryReason(event, completionSatisfied);
        await this.notifyKanbanAgent({
          workspaceId: automation.workspaceId,
          sessionId: eventSessionId,
          cardId: automation.cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          columnId: automation.columnId,
          reason: `Recovery reason: ${recoveryReason}.`,
          mode: automation.supervision.mode,
        });
        const recovered = await this.recoverAutomation(cardId, automation, task, recoveryReason);
        if (recovered) {
          // Recovery runs in a new session; the abandoned one must not keep running.
          await this.endFinishedStepSession(eventSessionId, event);
          return;
        }
      }

      automation.status = !failedToAdvanceWithinLane && successEvent && completionSatisfied ? "completed" : "failed";
      automation.signaledSessionIds.add(eventSessionId);

      if (task) {
        if (!failedToAdvanceWithinLane && successEvent && completionSatisfied) {
          task.lastSyncError = undefined;
        } else if (environmentFailure) {
          task.lastSyncError = formatEnvironmentFailureError(
            this.buildFailureMessage(automation, event, completionSatisfied),
          );
        } else if (rateLimitPlan) {
          task.lastSyncError = rateLimitPlan.lastSyncError;
        } else if (!task.lastSyncError) {
          task.lastSyncError = this.buildFailureMessage(automation, event, completionSatisfied);
        }
        await this.taskStore.save(task);
      }

      if (rateLimitPlan?.retryAt) this.rateLimitRetries.scheduleRun(automation, eventSessionId, rateLimitPlan.retryAt);

      if (
        task
        && !failedToAdvanceWithinLane
        && successEvent
        && completionSatisfied
        && this.ensureCompletionFallbackArtifact
      ) {
        try {
          await this.ensureCompletionFallbackArtifact({
            task,
            sessionId: eventSessionId,
            workspaceId: automation.workspaceId,
            stage: automation.stage,
            transport: typeof event.data?.transport === "string" ? event.data.transport : undefined,
          });
        } catch (error) {
          console.warn("[WorkflowOrchestrator] Failed to create completion fallback artifact:", error);
        }
      }

      // Auto-advance if configured and successful.
      if (!failedToAdvanceWithinLane && successEvent && completionSatisfied && automation.automation.autoAdvanceOnSuccess) {
        await this.autoAdvanceCard(cardId, automation);
      }

      if (
        task
        && !failedToAdvanceWithinLane
        && successEvent
        && completionSatisfied
        && automation.stage === "done"
        && task.columnId === automation.columnId
        && task.status === TaskStatus.COMPLETED
      ) {
        await this.teardownFinishedCardSessions(task, eventSessionId, event, automation);
      }

      if (task && automation.stage === "done" && automation.status === "failed") {
        // The Done lane stopped on a failure: no step of this card is left to
        // run, so end every process the card started. The worktree is kept.
        await this.endCardSessionsAfterDoneFailure(task);
      }

      // The step is over whatever its outcome: end its process now (a retry gets a new session).
      await this.endFinishedStepSession(eventSessionId, event);
      if (task && !rateLimitPlan?.retryAt && automation.stage !== "blocked") await this.afterLaneEnd?.(cardId)?.catch((error: unknown) => console.warn("[WorkflowOrchestrator] afterLaneEnd failed", cardId, error));

      const completedAutomation = automation;
      setTimeout(() => {
        if (this.activeAutomations.get(cardId) === completedAutomation) {
          this.activeAutomations.delete(cardId);
        }
      }, COMPLETED_AUTOMATION_CLEANUP_DELAY_MS);
      return;
    }
    await settleUnhandledLaneEnd(this.taskStore, getHttpSessionStore(), event, "event"); // no automation follows it
  }

  /**
   * The card's Done lane just finished: end every agent session the card has
   * used. Ids are registered before any kill so the exits they cause are
   * recognised as teardown. A session whose completion was synthesized from a
   * tool call (or a report) is still inside its turn; it is ended on its next
   * lifecycle event so its final writes are not cut off.
   * The card's worktree is removed only after every session has ended,
   * including a deferred one.
   */
  private async teardownFinishedCardSessions(
    task: Task,
    eventSessionId: string,
    event: AgentEvent,
    automation: ActiveAutomation,
  ): Promise<void> {
    const deferCurrent = event.type === AgentEventType.REPORT_SUBMITTED
      || typeof event.data?.synthesizedBy === "string";
    const sessionIds = collectTaskSessionIds(task);
    for (const sessionId of sessionIds) {
      this.teardownSessionIds.add(sessionId);
    }
    let deferred = false;
    for (const sessionId of sessionIds) {
      if (deferCurrent && sessionId === eventSessionId) {
        this.deferredTeardownSessionIds.add(sessionId);
        deferred = true;
        continue;
      }
      await this.killTeardownSession(sessionId);
    }
    const pending: PendingWorktreeCleanup = {
      taskId: task.id,
      columnId: automation.columnId,
      automation: automation.automation,
    };
    if (deferred) {
      this.pendingWorktreeCleanup.set(eventSessionId, pending);
      return;
    }
    void this.runDoneWorktreeCleanup(pending);
  }

  private async finishDeferredTeardown(event: AgentEvent): Promise<void> {
    const sessionId = typeof event.data?.sessionId === "string" ? event.data.sessionId : undefined;
    if (!sessionId || !this.deferredTeardownSessionIds.has(sessionId)) {
      return;
    }
    if (event.type === AgentEventType.REPORT_SUBMITTED || typeof event.data?.synthesizedBy === "string") {
      return;
    }
    this.deferredTeardownSessionIds.delete(sessionId);
    await this.killTeardownSession(sessionId);
    const pending = this.pendingWorktreeCleanup.get(sessionId);
    if (pending) {
      this.pendingWorktreeCleanup.delete(sessionId);
      void this.runDoneWorktreeCleanup(pending);
    }
  }

  /** Never throws and never writes the task: a cleanup failure must not re-run the lane. */
  private async runDoneWorktreeCleanup(pending: PendingWorktreeCleanup): Promise<void> {
    if (!this.doneWorktreeCleanup) {
      return;
    }
    try {
      const task = await this.taskStore.get(pending.taskId);
      if (!task) {
        return;
      }
      await this.doneWorktreeCleanup({ task, columnId: pending.columnId, automation: pending.automation });
    } catch (error) {
      console.warn(`[DoneWorktreeCleanup] card=${pending.taskId} result=failed reason=`, error);
    }
  }

  private async killTeardownSession(sessionId: string): Promise<void> {
    await this.endSessionProcess(sessionId, "of a finished card");
  }

  /**
   * End a session's agent process once. Kills go through the process
   * manager, which marks the stop as intended, so the exit raises no failure
   * event and cannot re-run a step (the 3054a54f trap).
   */
  private async endSessionProcess(sessionId: string, label: string): Promise<void> {
    if (this.endedSessionIds.has(sessionId)) {
      return;
    }
    this.endedSessionIds.add(sessionId);
    try {
      await this.killSession(sessionId);
    } catch (error) {
      console.warn(`[WorkflowOrchestrator] Failed to end session ${sessionId} ${label}:`, error);
    }
  }

  /**
   * End the session of a step that just finished. A completion synthesized
   * from a tool call (or a report) arrives while the agent is still inside
   * its turn; that session is ended on its next lifecycle event so its final
   * writes are not cut off.
   */
  private async endFinishedStepSession(sessionId: string, event: AgentEvent): Promise<void> {
    if (this.endedSessionIds.has(sessionId)) {
      return;
    }
    if (isInTurnEvent(event)) {
      this.deferredTeardownSessionIds.add(sessionId);
      return;
    }
    this.deferredTeardownSessionIds.delete(sessionId);
    await this.endSessionProcess(sessionId, "after its step ended");
  }

  /** A failed Done lane ends every session of the card; failures they cause are teardown. */
  private async endCardSessionsAfterDoneFailure(task: Task): Promise<void> {
    const sessionIds = collectTaskSessionIds(task);
    for (const sessionId of sessionIds) {
      this.teardownSessionIds.add(sessionId);
    }
    for (const sessionId of sessionIds) {
      this.deferredTeardownSessionIds.delete(sessionId);
      await this.endSessionProcess(sessionId, "of a card whose Done lane failed");
    }
  }

  /**
   * A failure event on a COMPLETED card is teardown when the session was ended
   * by Routa while winding the card down, when the card's Done lane already
   * finished, or when the session belongs to an earlier column. A failure of
   * the Done lane step that is still running is a real failure and is kept.
   */
  private isPostCompletionTeardownFailure(
    task: Task,
    automation: ActiveAutomation,
    eventSessionId: string,
    event: AgentEvent,
  ): boolean {
    const failureEvent = event.type === AgentEventType.AGENT_FAILED
      || event.type === AgentEventType.AGENT_TIMEOUT
      || event.data?.success === false;
    if (!failureEvent || task.status !== TaskStatus.COMPLETED) {
      return false;
    }
    if (this.teardownSessionIds.has(eventSessionId)) {
      return true;
    }
    if (
      task.columnId === automation.columnId
      && isLaneAutomationComplete(task, automation.columnId, automation.automation)
    ) {
      return true;
    }
    const laneSession = getTaskLaneSession(task, eventSessionId);
    return Boolean(laneSession?.columnId && laneSession.columnId !== task.columnId);
  }

  private async killFailedSession(sessionId: string): Promise<void> {
    this.deferredTeardownSessionIds.delete(sessionId);
    await this.endSessionProcess(sessionId, "after it failed");
  }

  private async scanForInactiveSessions(): Promise<void> {
    const sessionStore = getHttpSessionStore();
    const now = Date.now();

    for (const automation of this.activeAutomations.values()) {
      const recovery = isRecoveryMode(automation.supervision.mode);
      // Dev lanes use their supervision policy (with recovery); other lanes
      // only get the timeout-only lane watchdog.
      if (!recovery && !automation.laneWatchdog) continue;
      try {
        await this.adoptQueuedStepSession(automation);
      } catch (error) {
        // One unreadable card must not stop the scan for the others.
        console.warn(`[WorkflowOrchestrator] Watchdog could not read card ${automation.cardId}:`, error);
        continue;
      }
      if (automation.status !== "running" || !automation.sessionId) continue;

      const sessionId = automation.sessionId;
      if (automation.signaledSessionIds.has(sessionId)) continue;

      const sessionRecord = sessionStore.getSession(sessionId);
      if (recovery && sessionRecord?.acpStatus === "error") {
        automation.signaledSessionIds.add(sessionId);
        void this.notifyKanbanAgent({
          workspaceId: automation.workspaceId,
          sessionId,
          cardId: automation.cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          columnId: automation.columnId,
          reason: sessionRecord.acpError ?? "ACP session entered error state.",
          mode: automation.supervision.mode,
        });
        this.eventBus.emit({
          type: AgentEventType.AGENT_FAILED,
          agentId: sessionId,
          workspaceId: automation.workspaceId,
          data: {
            sessionId,
            success: false,
            error: sessionRecord.acpError ?? "ACP session entered error state.",
            watchdog: true,
          },
          timestamp: new Date(),
        });
        continue;
      }

      const activity = sessionStore.getSessionActivity(sessionId);
      const lastActivityAt = activity?.lastMeaningfulActivityAt
        ?? activity?.lastActivityAt
        ?? sessionRecord?.createdAt
        ?? automation.startedAt.toISOString();
      const lastActivityMs = Date.parse(lastActivityAt);
      if (!Number.isFinite(lastActivityMs)) continue;

      const timeoutMinutes = getInactivityTimeoutMinutes(automation);
      const idleMs = now - lastActivityMs;
      if (idleMs < timeoutMinutes * 60_000) continue;

      const reason = `No ACP activity for ${timeoutMinutes} minutes.`;
      sessionStore.markSessionTimedOut(sessionId, reason);
      automation.signaledSessionIds.add(sessionId);
      if (recovery) {
        // Outside Dev nothing is retried, so the silent agent is not asked to continue.
        void this.notifyKanbanAgent({
          workspaceId: automation.workspaceId,
          sessionId,
          cardId: automation.cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          columnId: automation.columnId,
          reason,
          mode: automation.supervision.mode,
        });
      }
      // handleAgentCompletion records the step as timed_out, ends its process
      // and the board queue frees its slot on this event.
      this.eventBus.emit({
        type: AgentEventType.AGENT_TIMEOUT,
        agentId: sessionId,
        workspaceId: automation.workspaceId,
        data: {
          sessionId,
          success: false,
          error: reason,
          inactivityMs: idleMs,
          lastActivityAt,
          watchdog: true,
        },
        timestamp: new Date(),
      });
    }
  }

  /**
   * A step that waited in the board queue has no session id here until it
   * ends; the queue records the session it started as the card's trigger
   * session. Adopt it so the watchdog can see a step that never ends.
   */
  private async adoptQueuedStepSession(automation: ActiveAutomation): Promise<void> {
    if (automation.status !== "queued" || automation.sessionId) return;
    const task = await this.taskStore.get(automation.cardId);
    const sessionId = task?.triggerSessionId;
    if (!task || !sessionId || task.columnId !== automation.columnId) return;
    const laneSession = getTaskLaneSession(task, sessionId);
    if (
      !laneSession
      || laneSession.columnId !== automation.columnId
      || laneSession.status !== "running"
      || (typeof laneSession.stepIndex === "number" && laneSession.stepIndex !== automation.currentStepIndex)
    ) {
      return;
    }
    automation.sessionId = sessionId;
    automation.status = "running";
    const startedAtMs = Date.parse(laneSession.startedAt ?? "");
    automation.startedAt = Number.isFinite(startedAtMs) ? new Date(startedAtMs) : new Date();
  }

  private async isCompletionSatisfied(
    task: Task | undefined,
    automation: ActiveAutomation,
    successEvent: boolean,
  ): Promise<boolean> {
    if (!successEvent) {
      return false;
    }
    if (automation.supervision.mode !== "ralph_loop") {
      return true;
    }

    switch (automation.supervision.completionRequirement) {
      case "completion_summary":
        return Boolean(task?.completionSummary?.trim());
      case "verification_report":
        return Boolean(task?.verificationReport?.trim());
      case "turn_complete":
      default:
        return true;
    }
  }

  private async shouldRecover(
    task: Task,
    automation: ActiveAutomation,
    event: AgentEvent,
    completionSatisfied: boolean,
  ): Promise<boolean> {
    if (!isRecoveryMode(automation.supervision.mode)) {
      return false;
    }
    if (task.columnId !== automation.columnId) {
      return false;
    }
    if (automation.recoveryAttempts >= automation.supervision.maxRecoveryAttempts) {
      return false;
    }

    if (event.type === AgentEventType.AGENT_TIMEOUT || event.type === AgentEventType.AGENT_FAILED) {
      return true;
    }
    if (automation.supervision.mode === "ralph_loop" && event.type === AgentEventType.AGENT_COMPLETED) {
      return !completionSatisfied;
    }
    return false;
  }

  private async startNextAutomationStep(
    cardId: string,
    automation: ActiveAutomation,
    task: Task,
    nextStepIndex: number,
  ): Promise<AutomationStepStart> {
    if (!this.createSession) {
      return "failed";
    }

    const nextStep = automation.steps[nextStepIndex];
    if (!nextStep) {
      return "failed";
    }

    const previousSessionId = automation.sessionId;
    if (previousSessionId) {
      if (!task.sessionIds.includes(previousSessionId)) {
        task.sessionIds.push(previousSessionId);
      }
      if (task.triggerSessionId === previousSessionId) {
        task.triggerSessionId = undefined;
      }
    }

    task.lastSyncError = undefined;
    task.updatedAt = new Date();
    await this.taskStore.save(task);

    this.cleanupCardSession?.(cardId);

    automation.currentStepIndex = nextStepIndex;
    automation.attempt = 1;
    automation.recoveryAttempts = 0;
    automation.status = "queued";
    automation.startedAt = new Date();
    automation.sessionId = undefined;
    automation.signaledSessionIds.clear();

    try {
      const { sessionId, queued } = readCreatedSession(await this.createSession({
        workspaceId: automation.workspaceId,
        cardId,
        cardTitle: automation.cardTitle,
        columnId: automation.columnId,
        columnName: automation.columnName,
        automation: automation.automation,
        step: nextStep,
        stepIndex: nextStepIndex,
        supervision: this.buildSupervisionContext(automation, task.objective || automation.cardTitle),
      }));

      if (queued) {
        automation.status = "queued";
        return "queued";
      }
      if (!sessionId) {
        automation.status = "failed";
        return "failed";
      }

      automation.status = "running";
      automation.sessionId = sessionId;
      return "started";
    } catch (error) {
      automation.status = "failed";
      task.lastSyncError = error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date();
      await this.taskStore.save(task);
      return "failed";
    }
  }

  private async recoverAutomation(
    cardId: string,
    automation: ActiveAutomation,
    task: Task,
    reason: TaskLaneSessionRecoveryReason,
  ): Promise<boolean> {
    if (!this.createSession || !isRecoveryMode(automation.supervision.mode)) {
      return false;
    }

    const previousSessionId = automation.sessionId;
    automation.recoveryAttempts += 1;
    automation.attempt += 1;
    automation.status = "queued";
    automation.startedAt = new Date();
    automation.sessionId = undefined;

    if (previousSessionId) {
      automation.signaledSessionIds.delete(previousSessionId);
      if (!task.sessionIds.includes(previousSessionId)) {
        task.sessionIds.push(previousSessionId);
      }
      if (task.triggerSessionId === previousSessionId) {
        task.triggerSessionId = undefined;
      }
    }

    task.lastSyncError = this.buildRecoveryMessage(automation, reason);
    task.updatedAt = new Date();
    await this.taskStore.save(task);

    this.cleanupCardSession?.(cardId);

    try {
      const currentStep = automation.steps[automation.currentStepIndex];
      const { sessionId, queued } = readCreatedSession(await this.createSession({
        workspaceId: automation.workspaceId,
        cardId,
        cardTitle: automation.cardTitle,
        columnId: automation.columnId,
        columnName: automation.columnName,
        automation: automation.automation,
        step: currentStep,
        stepIndex: automation.currentStepIndex,
        supervision: this.buildSupervisionContext(automation, task.objective || automation.cardTitle, {
          recoveredFromSessionId: previousSessionId,
          recoveryReason: reason,
        }),
      }));

      if (queued) {
        automation.status = "queued";
        return true;
      }
      if (!sessionId) {
        automation.status = "failed";
        return false;
      }

      automation.status = "running";
      automation.sessionId = sessionId;
      return true;
    } catch (error) {
      automation.status = "failed";
      task.lastSyncError = error instanceof Error ? error.message : String(error);
      task.updatedAt = new Date();
      await this.taskStore.save(task);
      return false;
    }
  }

  private buildSupervisionContext(
    automation: ActiveAutomation,
    objective: string,
    recovery?: {
      recoveredFromSessionId?: string;
      recoveryReason?: TaskLaneSessionRecoveryReason;
    },
  ): AutomationSessionSupervisionContext | undefined {
    if (!isRecoveryMode(automation.supervision.mode)) {
      return undefined;
    }
    return {
      attempt: automation.attempt,
      mode: automation.supervision.mode,
      completionRequirement: automation.supervision.completionRequirement,
      objective,
      recoveredFromSessionId: recovery?.recoveredFromSessionId,
      recoveryReason: recovery?.recoveryReason,
    };
  }

  private buildRecoveryMessage(
    automation: ActiveAutomation,
    reason: TaskLaneSessionRecoveryReason,
  ): string {
    const stepLabel = getAutomationStepLabel(automation.steps[automation.currentStepIndex], automation.currentStepIndex);
    const reasonLabel = reason === "watchdog_inactivity"
      ? "inactive too long"
      : reason === "completion_criteria_not_met"
        ? "stopped before completion criteria were met"
        : "failed";
    return `${stepLabel} recovered after session ${reasonLabel}. Attempt ${automation.attempt}/${automation.supervision.maxRecoveryAttempts + 1}.`;
  }

  private buildFailureMessage(
    automation: ActiveAutomation,
    event: AgentEvent,
    completionSatisfied: boolean,
  ): string {
    const stepLabel = getAutomationStepLabel(automation.steps[automation.currentStepIndex], automation.currentStepIndex);
    if (event.type === AgentEventType.AGENT_TIMEOUT) {
      return `${stepLabel} timed out after ${getInactivityTimeoutMinutes(automation)} minutes without activity.`;
    }
    if (event.type === AgentEventType.AGENT_FAILED) {
      const error = typeof event.data?.error === "string" ? event.data.error : "ACP session failed.";
      return error;
    }
    if (isCancelledTurn(event)) {
      return `${stepLabel} was cancelled before it finished; rerun the card to run it again.`;
    }
    if (event.type === AgentEventType.AGENT_COMPLETED && !completionSatisfied) {
      return `${stepLabel} completed but did not satisfy ${automation.supervision.completionRequirement}.`;
    }
    return "ACP session did not complete successfully.";
  }

  private async notifyKanbanAgent(params: RecoveryNotificationParams): Promise<void> {
    if (!this.sendKanbanSessionPrompt) {
      return;
    }
    if (this.endedSessionIds.has(params.sessionId)) {
      // Prompting a session whose process Routa ended re-spawns an agent for
      // it that no lane tracks.
      console.warn(
        `[WorkflowOrchestrator] ACP session ${params.sessionId} was already ended; skipping recovery prompt.`,
      );
      return;
    }
    const sessionStore = getHttpSessionStore();
    const sessionRecord = sessionStore.getSession(params.sessionId);
    if (!sessionRecord) {
      console.warn(
        `[WorkflowOrchestrator] ACP session ${params.sessionId} not found in local session store; skipping recovery prompt.`,
      );
      return;
    }
    if (sessionRecord.acpStatus === "error") {
      console.warn(
        `[WorkflowOrchestrator] ACP session ${params.sessionId} is already in error state; skipping recovery prompt.`,
      );
      return;
    }

    try {
      await this.sendKanbanSessionPrompt({
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        prompt: buildKanbanRecoveryPrompt(params),
      });
    } catch (error) {
      console.error(
        `[WorkflowOrchestrator] Failed to notify agent session ${params.sessionId}:`,
        error,
      );
    }
  }

  private async autoAdvanceCard(
    cardId: string,
    automation: ActiveAutomation,
  ): Promise<void> {
    try {
      const board = await this.kanbanBoardStore.get(automation.boardId);
      if (!board) return;

      // Check if the card was already moved by the specialist (via move_card tool).
      const task = await this.taskStore.get(cardId);
      if (!task) return;

      if (task.columnId !== automation.columnId) {
        return;
      }

      const currentColumn = board.columns.find((column) => column.id === automation.columnId);
      if (!currentColumn) return;

      // Done is a terminal stage — never auto-advance past it.
      if (currentColumn.stage === "done") return;

      const sortedColumns = board.columns
        .slice()
        .sort((left, right) => left.position - right.position);
      const currentIndex = sortedColumns.findIndex((column) => column.id === currentColumn.id);
      const nextColumn = sortedColumns[currentIndex + 1];
      if (!nextColumn) return;

      // Never auto-advance into the blocked lane — it is a recovery lane,
      // not a normal workflow destination.
      if (nextColumn.stage === "blocked") return;

      task.columnId = nextColumn.id;
      task.status = resolveTaskStatusForBoardColumn(board.columns, nextColumn.id);
      if (task.triggerSessionId) {
        if (!task.sessionIds) task.sessionIds = [];
        if (!task.sessionIds.includes(task.triggerSessionId)) {
          task.sessionIds.push(task.triggerSessionId);
        }
      }
      task.triggerSessionId = undefined;
      task.updatedAt = new Date();
      await this.taskStore.save(task);

      this.cleanupCardSession?.(cardId);

      this.eventBus.emit({
        type: AgentEventType.COLUMN_TRANSITION,
        agentId: "kanban-workflow-orchestrator",
        workspaceId: automation.workspaceId,
        data: {
          cardId,
          cardTitle: automation.cardTitle,
          boardId: automation.boardId,
          workspaceId: automation.workspaceId,
          fromColumnId: automation.columnId,
          toColumnId: nextColumn.id,
          fromColumnName: currentColumn.name,
          toColumnName: nextColumn.name,
        },
        timestamp: new Date(),
      });
    } catch (err) {
      console.error("[WorkflowOrchestrator] Auto-advance failed:", err);
    }
  }
}
