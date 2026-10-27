/**
 * Workflow Orchestrator Singleton
 *
 * Provides a global instance of the KanbanWorkflowOrchestrator.
 * Initialized when the RoutaSystem is created.
 */

import {
  KanbanWorkflowOrchestrator,
  type AutomationSessionSupervisionContext,
  type CreateAutomationSessionResult,
} from "./workflow-orchestrator";
import { v4 as uuidv4 } from "uuid";
import type { RoutaSystem } from "../routa-system";
import type {
  KanbanAutomationStep,
  KanbanBoard,
  KanbanColumnAutomation,
  KanbanColumnStage,
} from "../models/kanban";
import { TaskStatus } from "../models/task";
import { GitWorktreeService } from "../git/git-worktree-service";
import {
  getDefaultWorkspaceWorktreeRoot,
  getEffectiveWorkspaceMetadata,
} from "../models/workspace";
import {
  resolveKanbanAutomationStep,
  resolveEffectiveTaskAutomation,
  type AutomationSpecialistSummary,
} from "./effective-task-automation";
import { buildKanbanWorktreeNaming } from "./worktree-naming";
import { KanbanSessionQueue } from "./kanban-session-queue";
import { getKanbanSessionConcurrencyLimit as getBoardSessionConcurrencyLimit } from "./board-session-limits";
import { getKanbanDevSessionSupervision, getKanbanLaneSessionWatchdog } from "./board-session-supervision";
import { getKanbanAutoProvider } from "./board-auto-provider";
import { upsertTaskLaneSession } from "./task-lane-history";
import {
  classifyRetryableEnvironmentFailure,
  formatEnvironmentFailureError,
  isEnvironmentFailureMessage,
} from "./environment-failure";
import { planRateLimitRetry } from "./rate-limit-retry";
import { refreshTaskLaneExperienceMemory } from "./task-lane-experience";
import { completeRunningSessionsOutsideColumn } from "./task-session-transition";
import { resolveLaneResumeStep } from "./lane-automation-state";
import { analyzeFlowForTasks } from "./flow-ledger";
import { resolveTaskWorktreeTruth } from "./task-worktree-truth";
import { runDoneWorktreeCleanup } from "./done-worktree-cleanup";
import { getHttpSessionStore } from "../acp/http-session-store";
import { getSpecialistById } from "../orchestration/specialist-prompts";
import { dispatchSessionPrompt } from "@/core/acp/session-prompt";
import type { ColumnTransitionData } from "./column-transition";
import {
  buildTaskEvidenceSummary,
  buildTaskInvestValidation,
  buildTaskStoryReadiness,
} from "./task-derived-summary";
import { ensureCompletionFallbackArtifact } from "./completion-fallback-artifact";
import { blockedColumnOf, routeAttentionToBlocked } from "./attention-to-blocked";
import {
  applyBlockedResolverGuard,
  evaluateBlockedResolverGuard,
  resolveBlockedAttentionReason,
} from "./blocked-resolver-guard";
import { KanbanTools } from "../tools/kanban-tools";
import { buildTaskDeliveryLanding } from "./task-delivery-landing";

// Use globalThis to survive HMR in Next.js dev mode
const GLOBAL_KEY = "__routa_workflow_orchestrator__";
const STARTED_KEY = "__routa_workflow_orchestrator_started__";
const QUEUE_KEY = "__routa_kanban_session_queue__";

function resolveKanbanSpecialist(
  specialistId: string,
  locale?: string,
): AutomationSpecialistSummary | undefined {
  const specialist = (locale ? getSpecialistById(specialistId, locale) : undefined)
    ?? getSpecialistById(specialistId);
  if (!specialist) return undefined;
  return {
    name: specialist.name,
    role: specialist.role,
    defaultProvider: specialist.defaultProvider,
  };
}

async function createAutomationSession(
  system: RoutaSystem,
  params: {
    workspaceId: string;
    cardTitle: string;
    columnName: string;
    cardId: string;
    columnId: string;
    automation: KanbanColumnAutomation;
    step: KanbanAutomationStep;
    stepIndex: number;
    supervision?: AutomationSessionSupervisionContext;
  },
): Promise<CreateAutomationSessionResult | null> {
  const task = await system.taskStore.get(params.cardId);
  if (!task?.boardId) return null;
  const result = await enqueueKanbanTaskSession(system, {
    task,
    expectedColumnId: params.columnId,
    step: params.step,
    stepIndex: params.stepIndex,
    supervision: params.supervision,
  });
  // Pass "queued" through: a full board must not read as a failed step.
  return { sessionId: result.sessionId ?? null, queued: result.queued };
}

export async function enqueueKanbanTaskSession(
  system: RoutaSystem,
  params: {
    task: Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>;
    expectedColumnId?: string;
    ignoreExistingTrigger?: boolean;
    bypassQueue?: boolean;
    mutateTask?: (task: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>) => void;
    providerOverride?: string;
    step?: KanbanAutomationStep;
    stepIndex?: number;
    supervision?: AutomationSessionSupervisionContext;
    /**
     * Manual rerun: start at the lane step that still has to run (see
     * resolveLaneResumeStep) and hand the run to the workflow orchestrator so
     * the lane's later steps follow it.
     */
    resumeLane?: boolean;
    /**
     * The run of `step`/`stepIndex` is started outside a column transition
     * (manual rerun, POST revive): hand it to the workflow orchestrator so its
     * end is recorded and the lane's later steps follow it. A queued run is
     * adopted when the board queue starts it.
     */
    adoptLaneRun?: boolean;
  },
): Promise<{ sessionId?: string; queued: boolean; error?: string }> {
  const task = params.task;
  if (!task?.boardId) {
    return { queued: false, error: "Task is missing board context." };
  }
  if (task.triggerSessionId && !params.ignoreExistingTrigger) {
    return { sessionId: task.triggerSessionId, queued: false };
  }

  if (params.resumeLane && !params.step) {
    const resumeStep = await resolveLaneResumeForTask(system, task, params.expectedColumnId ?? task.columnId);
    if (resumeStep) {
      const { resumeLane: _resumeLane, ...startParams } = params;
      return enqueueKanbanTaskSession(system, {
        ...startParams,
        step: resumeStep.step,
        stepIndex: resumeStep.stepIndex,
        adoptLaneRun: true,
      });
    }
    // No lane step to resume (a card-level agent override, or no step found):
    // the run still belongs to the lane, so the orchestrator follows it at the
    // step it starts as (card 6d8365ca; dev session b2261ec7 was never ended).
    // If the orchestrator refuses, the run's end still settles its lane record.
    const { resumeLane: _resumeLane, ...startParams } = params;
    const columnId = params.expectedColumnId ?? task.columnId;
    const result = await enqueueKanbanTaskSession(system, startParams);
    if (columnId && (result.sessionId || result.queued)) {
      await getWorkflowOrchestrator(system).adoptLaneRun({
        cardId: task.id,
        columnId,
        stepIndex: params.stepIndex ?? 0,
        sessionId: result.sessionId,
      });
    }
    return result;
  }

  if (params.adoptLaneRun) {
    const { adoptLaneRun: _adoptLaneRun, ...startParams } = params;
    const columnId = params.expectedColumnId ?? task.columnId;
    const result = await enqueueKanbanTaskSession(system, startParams);
    if (columnId && params.step && typeof params.stepIndex === "number" && (result.sessionId || result.queued)) {
      await getWorkflowOrchestrator(system).adoptLaneRun({
        cardId: task.id,
        columnId,
        stepIndex: params.stepIndex,
        sessionId: result.sessionId,
      });
    }
    return result;
  }

  // Card 59f5b059: every resolver start passes this gate (after the
  // resume/adopt branches, so a stopped start is never adopted).
  const guardHit = await checkBlockedResolverGuard(system, task, params);
  if (guardHit) return { queued: false, error: `blocked-resolver-guard:${guardHit}` };

  if (params.bypassQueue) {
    const result = await startKanbanTaskSession(system, task.id, params);
    return {
      sessionId: result.sessionId ?? undefined,
      queued: false,
      error: result.error,
    };
  }

  const queue = getKanbanSessionQueue(system);
  return queue.enqueue({
    cardId: task.id,
    cardTitle: task.title,
    boardId: task.boardId,
    workspaceId: task.workspaceId,
    columnId: params.expectedColumnId ?? task.columnId,
    start: async () => startKanbanTaskSession(system, task.id, params),
  });
}

/** Stops a Blocked resolver start the gate rejects; returns the gate name on a hit. */
async function checkBlockedResolverGuard(
  system: RoutaSystem,
  task: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>,
  params: { expectedColumnId?: string; step?: KanbanAutomationStep },
): Promise<string | undefined> {
  const board = task.boardId ? await system.kanbanBoardStore.get(task.boardId) : undefined;
  const columnId = params.expectedColumnId ?? task.columnId;
  if (!board || !columnId || blockedColumnOf(board) !== columnId) return undefined;
  const current = (await system.taskStore.get(task.id)) ?? task;
  // A card that already left the column cannot start there (startKanbanTaskSession refuses it).
  if (current.columnId !== columnId) return undefined;
  let specialistId = params.step?.specialistId;
  if (!specialistId) {
    const workspace = await system.workspaceStore.get(current.workspaceId);
    specialistId = resolveEffectiveTaskAutomation(current, board.columns, resolveKanbanSpecialist, {
      autoProviderId: getKanbanAutoProvider(workspace?.metadata, board.id),
    }).specialistId;
  }
  const decision = evaluateBlockedResolverGuard({ task: current, board, specialistId });
  if (decision.gate === "none") return undefined;
  await applyBlockedResolverGuard(system.taskStore, current, decision);
  // The column transition marked the lane "queued" before asking for a session: drop it.
  forgetKanbanCard(system, task.id, { columnId });
  return decision.gate;
}

async function resolveLaneResumeForTask(
  system: RoutaSystem,
  task: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>,
  columnId: string | undefined,
): Promise<{ step: KanbanAutomationStep; stepIndex: number; columnId: string } | undefined> {
  if (!task.boardId || !columnId) return undefined;
  const board = await system.kanbanBoardStore.get(task.boardId);
  if (!board) return undefined;
  const workspace = await system.workspaceStore.get(task.workspaceId);
  const laneTask = { ...task, columnId };
  const effective = resolveEffectiveTaskAutomation(laneTask, board.columns, resolveKanbanSpecialist, {
    autoProviderId: getKanbanAutoProvider(workspace?.metadata, task.boardId),
  });
  // A card-level agent override runs its own single step; keep its old rerun path.
  if (effective.source !== "lane") return undefined;
  const resumeStep = resolveLaneResumeStep(laneTask, board.columns);
  return resumeStep ? { ...resumeStep, columnId } : undefined;
}

async function startKanbanTaskSession(
  system: RoutaSystem,
  taskId: string,
  params: {
    expectedColumnId?: string;
    ignoreExistingTrigger?: boolean;
    mutateTask?: (task: NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>) => void;
    providerOverride?: string;
    step?: KanbanAutomationStep;
    stepIndex?: number;
    supervision?: AutomationSessionSupervisionContext;
  },
): Promise<{ sessionId?: string | null; error?: string }> {
  const task = await system.taskStore.get(taskId);
  if (!task) return { error: "Task no longer exists." };
  if (params.expectedColumnId && task.columnId !== params.expectedColumnId) {
    return { error: `Task is no longer in column ${params.expectedColumnId}.` };
  }
  if (task.triggerSessionId && !params.ignoreExistingTrigger) {
    return { sessionId: task.triggerSessionId };
  }

  const nextTask = {
    ...task,
    updatedAt: new Date(),
  };
  params.mutateTask?.(nextTask);
  const board = await system.kanbanBoardStore.get(nextTask.boardId!);
  const workspace = await system.workspaceStore.get(nextTask.workspaceId);
  const autoProviderId = getKanbanAutoProvider(workspace?.metadata, nextTask.boardId!);

  const initialWorktreeTruth = await resolveTaskWorktreeTruth(nextTask, system);
  if (nextTask.worktreeId && initialWorktreeTruth?.source !== "task.worktreeId") {
    nextTask.worktreeId = undefined;
  }
  const preferredCodebase = initialWorktreeTruth?.codebase;
  let worktreeCwd = initialWorktreeTruth?.cwd ?? process.cwd();
  let worktreeBranch = initialWorktreeTruth?.branch;
  if (params.expectedColumnId === "dev" && preferredCodebase && !nextTask.worktreeId) {
    try {
      const worktreeService = new GitWorktreeService(
        system.worktreeStore,
        system.codebaseStore,
      );
      const { branch, label } = buildKanbanWorktreeNaming(nextTask.id);
      const worktreeRoot = workspace
        ? getEffectiveWorkspaceMetadata(workspace).worktreeRoot
        : getDefaultWorkspaceWorktreeRoot(nextTask.workspaceId);
      const worktree = await worktreeService.createWorktree(preferredCodebase.id, {
        branch,
        baseBranch: preferredCodebase.branch ?? "main",
        label,
        worktreeRoot,
      });
      nextTask.worktreeId = worktree.id;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      nextTask.status = TaskStatus.BLOCKED;
      nextTask.columnId = "blocked";
      nextTask.lastSyncError = `Worktree creation failed: ${message}`;
      await system.taskStore.save(nextTask);
      return { error: nextTask.lastSyncError };
    }
  }
  const resolvedWorktreeTruth = await resolveTaskWorktreeTruth(nextTask, system);
  worktreeCwd = resolvedWorktreeTruth?.cwd ?? worktreeCwd;
  worktreeBranch = resolvedWorktreeTruth?.branch ?? worktreeBranch;

  const effectiveAutomation = resolveEffectiveTaskAutomation(
    nextTask,
    board?.columns ?? [],
    resolveKanbanSpecialist,
    { autoProviderId },
  );
  const providerOverride = params.providerOverride?.trim() || undefined;
  const sessionStep = resolveKanbanAutomationStep(params.step, resolveKanbanSpecialist, {
    autoProviderId,
  })
    ?? effectiveAutomation.step;
  const sessionStepIndex = params.stepIndex ?? effectiveAutomation.stepIndex;
  const sessionProviderId = providerOverride
    ?? sessionStep?.providerId
    ?? effectiveAutomation.providerId;
  const taskForSessionBase = {
    ...nextTask,
    assignedProvider: sessionProviderId,
    assignedRole: sessionStep?.role ?? effectiveAutomation.role,
    assignedSpecialistId: sessionStep?.specialistId ?? effectiveAutomation.specialistId,
    assignedSpecialistName: sessionStep?.specialistName ?? effectiveAutomation.specialistName,
  };

  // Compute board-level flow guidance for the agent
  const allBoardTasks = await system.taskStore.listByWorkspace(nextTask.workspaceId);
  const boardTasks = nextTask.boardId
    ? allBoardTasks.filter((t) => t.boardId === nextTask.boardId)
    : allBoardTasks;
  const tasksWithFlow = boardTasks.filter(
    (t) => (t.laneSessions?.length ?? 0) > 0 || (t.laneHandoffs?.length ?? 0) > 0,
  );
  const flowReport = tasksWithFlow.length >= 3
    ? analyzeFlowForTasks(tasksWithFlow, {
        workspaceId: nextTask.workspaceId,
        boardId: nextTask.boardId,
      })
    : undefined;
  const taskForSession = refreshTaskLaneExperienceMemory(taskForSessionBase, { flowReport });
  const summaryContext = {
    evidenceSummary: await buildTaskEvidenceSummary(taskForSession, system),
    storyReadiness: await buildTaskStoryReadiness(taskForSession, system),
    investValidation: buildTaskInvestValidation(taskForSession),
  };

  const { getInternalApiOrigin, triggerAssignedTaskAgent } = await import("./agent-trigger");
  const triggerResult = await triggerAssignedTaskAgent({
    origin: getInternalApiOrigin(),
    workspaceId: nextTask.workspaceId,
    cwd: worktreeCwd,
    branch: worktreeBranch,
    task: taskForSession,
    step: sessionStep,
    stepIndex: sessionStepIndex,
    // Column step model/effort travel as their own params instead of being
    // folded into taskForSession, which can be persisted.
    stepModel: sessionStep?.model,
    stepReasoningEffort: sessionStep?.reasoningEffort,
    specialistLocale: sessionStep?.specialistLocale ?? effectiveAutomation.step?.specialistLocale,
    boardColumns: board?.columns ?? [],
    summaryContext,
    flowReport,
    eventBus: system.eventBus,
  });

  if (triggerResult.sessionId) {
    // Records only, no kill: this also runs when an agent moves its own card
    // (MCP move_card) and is still inside its turn; deea45bd ends that session
    // once its turn is over. A user move (PATCH /api/tasks/{id}) ends the old
    // column's processes itself via endKanbanTaskSessions.
    completeRunningSessionsOutsideColumn(nextTask, nextTask.columnId, {
      excludeSessionId: triggerResult.sessionId,
    });
    nextTask.triggerSessionId = triggerResult.sessionId;
    // Track session in history
    if (!nextTask.sessionIds) nextTask.sessionIds = [];
    if (!nextTask.sessionIds.includes(triggerResult.sessionId)) {
      nextTask.sessionIds.push(triggerResult.sessionId);
    }
    const currentColumn = board?.columns.find((column) => column.id === nextTask.columnId);
    upsertTaskLaneSession(nextTask, {
      sessionId: triggerResult.sessionId,
      worktreeId: nextTask.worktreeId,
      cwd: worktreeCwd,
      columnId: nextTask.columnId,
      columnName: currentColumn?.name,
      stepId: sessionStep?.id,
      stepIndex: sessionStepIndex,
      stepName: sessionStep?.specialistName ?? sessionStep?.specialistId ?? sessionStep?.role,
      provider: sessionProviderId,
      model: triggerResult.model,
      reasoningEffort: triggerResult.reasoningEffort,
      role: sessionStep?.role ?? effectiveAutomation.role,
      specialistId: sessionStep?.specialistId ?? effectiveAutomation.specialistId,
      specialistName: sessionStep?.specialistName ?? effectiveAutomation.specialistName,
      transport: triggerResult.transport ?? sessionStep?.transport ?? effectiveAutomation.transport,
      externalTaskId: triggerResult.externalTaskId,
      contextId: triggerResult.contextId,
      attempt: params.supervision?.attempt,
      loopMode: params.supervision?.mode,
      completionRequirement: params.supervision?.completionRequirement,
      objective: params.supervision?.objective ?? nextTask.objective,
      recoveredFromSessionId: params.supervision?.recoveredFromSessionId,
      recoveryReason: params.supervision?.recoveryReason,
      // Card 59f5b059: a Blocked run keeps its reason (lastSyncError is cleared below).
      attentionReason: blockedRunAttentionReason(board, nextTask),
      status: "running",
    });
    refreshTaskLaneExperienceMemory(nextTask, { flowReport });
    nextTask.lastSyncError = undefined;
    if (nextTask.worktreeId) {
      await system.worktreeStore.assignSession(nextTask.worktreeId, triggerResult.sessionId);
    }
  } else if (triggerResult.error && isEnvironmentFailureMessage(triggerResult.error)) {
    // The session never started because the environment is broken (for
    // example an unregistered provider). Record it as a distinct failed lane
    // run so it is counted separately and not auto-retried.
    const currentColumn = board?.columns.find((column) => column.id === nextTask.columnId);
    const failedAt = new Date().toISOString();
    upsertTaskLaneSession(nextTask, {
      sessionId: `environment-failure-${uuidv4()}`,
      columnId: nextTask.columnId,
      columnName: currentColumn?.name,
      stepId: sessionStep?.id,
      stepIndex: sessionStepIndex,
      stepName: sessionStep?.specialistName ?? sessionStep?.specialistId ?? sessionStep?.role,
      provider: sessionProviderId,
      role: sessionStep?.role ?? effectiveAutomation.role,
      attempt: params.supervision?.attempt,
      recoveredFromSessionId: params.supervision?.recoveredFromSessionId,
      recoveryReason: "environment_failure",
      status: "failed",
      startedAt: failedAt,
      completedAt: failedAt,
    });
    nextTask.lastSyncError = formatEnvironmentFailureError(triggerResult.error);
  } else if (triggerResult.error && nextTask.columnId
    && classifyRetryableEnvironmentFailure(triggerResult.error) === "rate_limited") {
    // Rate limited before the session started (card 79804de2): a retryable
    // failed run with its planned rerun time. Not counted against any budget;
    // revive reruns the step once retryAfterAt has passed.
    const currentColumn = board?.columns.find((column) => column.id === nextTask.columnId);
    const failedAt = new Date().toISOString();
    const sessionId = `rate-limited-${uuidv4()}`;
    upsertTaskLaneSession(nextTask, {
      sessionId,
      columnId: nextTask.columnId,
      columnName: currentColumn?.name,
      stepId: sessionStep?.id,
      stepIndex: sessionStepIndex,
      stepName: sessionStep?.specialistName ?? sessionStep?.specialistId ?? sessionStep?.role,
      provider: sessionProviderId,
      role: sessionStep?.role ?? effectiveAutomation.role,
      attempt: params.supervision?.attempt,
      recoveredFromSessionId: params.supervision?.recoveredFromSessionId,
      recoveryReason: "rate_limited",
      status: "failed",
      startedAt: failedAt,
      completedAt: failedAt,
    });
    nextTask.lastSyncError = planRateLimitRetry({
      task: nextTask,
      columnId: nextTask.columnId,
      sessionId,
      evidence: triggerResult.error,
    }).lastSyncError;
  } else if (triggerResult.error) {
    nextTask.lastSyncError = triggerResult.error;
  }

  await system.taskStore.save(nextTask);
  return {
    sessionId: triggerResult.sessionId ?? null,
    error: triggerResult.error,
  };
}

/** The attention reason a run in the Blocked column is recorded with; undefined elsewhere. */
function blockedRunAttentionReason(
  board: { columns: KanbanBoard["columns"] } | undefined,
  task: Pick<NonNullable<Awaited<ReturnType<RoutaSystem["taskStore"]["get"]>>>, "columnId" | "lastSyncError" | "laneSessions">,
): string | undefined {
  const blockedColumnId = board ? blockedColumnOf(board) : undefined;
  if (!blockedColumnId || task.columnId !== blockedColumnId) return undefined;
  return resolveBlockedAttentionReason(task, blockedColumnId);
}

async function getBoardConcurrencyLimit(system: RoutaSystem, workspaceId: string, boardId: string): Promise<number> {
  const workspace = await system.workspaceStore.get(workspaceId);
  return getBoardSessionConcurrencyLimit(workspace?.metadata, boardId);
}

async function resolveDevSessionSupervision(
  system: RoutaSystem,
  workspaceId: string,
  boardId: string,
  _stage: KanbanColumnStage,
) {
  const workspace = await system.workspaceStore.get(workspaceId);
  return getKanbanDevSessionSupervision(workspace?.metadata, boardId);
}

async function sendPromptToKanbanSession(
  system: RoutaSystem,
  params: {
    workspaceId: string;
    sessionId: string;
    prompt: string;
  },
): Promise<void> {
  const sessionStore = getHttpSessionStore();
  const sessionRecord = sessionStore.getSession(params.sessionId);
  const targetAgentId = sessionRecord?.routaAgentId;

  if (targetAgentId) {
    const conversationResult = await system.tools.readAgentConversation({
      agentId: targetAgentId,
      lastN: 5,
    });

    if (conversationResult.success) {
      const messageCount = (conversationResult.data as { messages?: unknown[] } | undefined)?.messages?.length ?? 0;
      console.debug(
        `[WorkflowOrchestrator] Read ${messageCount} recent messages for agent ${targetAgentId} before recovery prompt.`,
      );
    } else {
      console.warn(
        `[WorkflowOrchestrator] Failed to read conversation for agent ${targetAgentId}: ${conversationResult.error}`,
      );
    }

    const toolResult = await system.tools.messageAgent({
      fromAgentId: targetAgentId,
      toAgentId: targetAgentId,
      message: params.prompt,
    });

    if (toolResult.success) {
      return;
    }

    console.warn(
      `[WorkflowOrchestrator] Failed to send recovery prompt via agent ${targetAgentId}: ${toolResult.error}. Falling back to session/prompt.`,
    );
  }

  await dispatchSessionPrompt({
    sessionId: params.sessionId,
    workspaceId: params.workspaceId,
    prompt: [{ type: "text", text: params.prompt }],
  });
}

export function getKanbanSessionQueue(system: RoutaSystem): KanbanSessionQueue {
  const g = globalThis as Record<string, unknown>;
  let queue = g[QUEUE_KEY] as KanbanSessionQueue | undefined;

  if (queue && !queue.isCompatible(system.eventBus, system.taskStore)) {
    queue.stop();
    delete g[QUEUE_KEY];
    queue = undefined;
  }

  if (!queue) {
    queue = new KanbanSessionQueue(
      system.eventBus,
      system.taskStore,
      (workspaceId, boardId) => getBoardConcurrencyLimit(system, workspaceId, boardId),
    );
    g[QUEUE_KEY] = queue;
  }

  return queue;
}

/**
 * Get or create the global KanbanWorkflowOrchestrator instance.
 */
export function getWorkflowOrchestrator(system: RoutaSystem): KanbanWorkflowOrchestrator {
  const g = globalThis as Record<string, unknown>;
  let orchestrator = g[GLOBAL_KEY] as KanbanWorkflowOrchestrator | undefined;

  const isCompatible = orchestrator
    && typeof (orchestrator as KanbanWorkflowOrchestrator & { processColumnTransition?: unknown }).processColumnTransition === "function";

  if (orchestrator && !isCompatible) {
    orchestrator.stop();
    delete g[GLOBAL_KEY];
    delete g[STARTED_KEY];
    orchestrator = undefined;
  }

  if (!orchestrator) {
    orchestrator = new KanbanWorkflowOrchestrator(
      system.eventBus,
      system.kanbanBoardStore,
      system.taskStore,
    );
    g[GLOBAL_KEY] = orchestrator;
  }

  return orchestrator;
}

/**
 * Start the workflow orchestrator singleton. Idempotent across HMR restarts.
 */
export function startWorkflowOrchestrator(system: RoutaSystem): void {
  const g = globalThis as Record<string, unknown>;
  const orchestrator = getWorkflowOrchestrator(system);
  const queue = getKanbanSessionQueue(system);
  orchestrator.setCreateSession((params) => createAutomationSession(system, params));
  orchestrator.setCleanupCardSession((cardId) => queue.removeCardJob(cardId));
  orchestrator.setResolveDevSessionSupervision(({ workspaceId, boardId, stage }) =>
    resolveDevSessionSupervision(system, workspaceId, boardId, stage)
  );
  orchestrator.setResolveLaneSessionWatchdog(async ({ workspaceId, boardId }) => {
    const workspace = await system.workspaceStore.get(workspaceId);
    return getKanbanLaneSessionWatchdog(workspace?.metadata, boardId);
  });
  orchestrator.setSendKanbanSessionPrompt((params) => sendPromptToKanbanSession(system, {
    workspaceId: params.workspaceId,
    sessionId: params.sessionId,
    prompt: params.prompt,
  }));
  orchestrator.setEnsureCompletionFallbackArtifact(async (params) => {
    await ensureCompletionFallbackArtifact({
      task: params.task,
      sessionId: params.sessionId,
      workspaceId: params.workspaceId,
      stage: params.stage,
      transport: params.transport === "a2a" ? "a2a" : "acp",
      artifactStore: system.artifactStore,
    });
  });
  orchestrator.setDoneWorktreeCleanup(async ({ task, columnId, automation }) => {
    await runDoneWorktreeCleanup(
      {
        task,
        columnId,
        automation,
        worktreeStore: system.worktreeStore,
        codebaseStore: system.codebaseStore,
      },
      new GitWorktreeService(system.worktreeStore, system.codebaseStore),
    );
  });
  // Card 64f2e31c: after a lane ends, route attention cards to Blocked through move_card.
  // Static imports: a lazy import here could run after a test environment was torn down.
  orchestrator.setAfterLaneEnd(async (cardId) => {
    const tools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
    tools.setEventBus(system.eventBus);
    tools.setAutomationSystem(system);
    if (system.artifactStore) tools.setArtifactStore(system.artifactStore);
    return routeAttentionToBlocked({
      taskStore: system.taskStore,
      kanbanBoardStore: system.kanbanBoardStore,
      moveCard: (params) => tools.moveCard(params),
      probeLanding: (task) => buildTaskDeliveryLanding(task, system),
    }, cardId);
  });
  orchestrator.start();
  queue.start();
  g[STARTED_KEY] = true;
}

export async function processKanbanColumnTransition(
  system: RoutaSystem,
  data: ColumnTransitionData,
): Promise<void> {
  startWorkflowOrchestrator(system);
  const orchestrator = getWorkflowOrchestrator(system);
  await orchestrator.processColumnTransition(data);
}

/**
 * End the agent processes of a deleted or user-moved card's sessions through
 * the orchestrator, which ends each session once and treats the exit as
 * teardown. Routes must use this instead of the process manager directly.
 */
export async function endKanbanTaskSessions(
  system: RoutaSystem,
  sessionIds: string[],
  label: string,
): Promise<void> {
  if (sessionIds.length === 0) return;
  await getWorkflowOrchestrator(system).endTaskSessions(sessionIds, label);
}

/** Drop a card's automation (optionally only one of `columnId`) so late events cannot advance it. */
export function forgetKanbanCard(system: RoutaSystem, cardId: string, options?: { columnId?: string }): void {
  getWorkflowOrchestrator(system).forgetCard(cardId, options);
}

/**
 * Reset the orchestrator (for testing).
 */
export function resetWorkflowOrchestrator(): void {
  const g = globalThis as Record<string, unknown>;
  
  const orchestrator = g[GLOBAL_KEY] as KanbanWorkflowOrchestrator | undefined;
  if (orchestrator) {
    orchestrator.stop();
  }

  const queue = g[QUEUE_KEY] as KanbanSessionQueue | undefined;
  if (queue) {
    queue.stop();
  }
  
  delete g[GLOBAL_KEY];
  delete g[QUEUE_KEY];
  delete g[STARTED_KEY];
}
