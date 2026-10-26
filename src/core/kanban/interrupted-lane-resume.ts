/**
 * Automatic rerun of lane steps a Routa restart or a cancelled turn
 * interrupted (card 14de4800).
 *
 * A restart ends every agent process; the steps that were running end as
 * failed + turn_cancelled or timed_out + restart_interrupted. Before, only
 * POST revive or a manual rerun started them again, so cards waited in
 * "interrupted" until someone noticed (2026-10-26: 3 cards, 12 minutes).
 * After the startup sweep this module re-runs, at the same step index, every
 * card whose latest lane record is such an interruption. A rerun planned for
 * later (`retryAfterAt`, a cancelled turn's backoff) waits for that time.
 * A user's own cancel (`user_cancelled`), the lane watchdog, environment
 * failures and agent failures are never re-run here.
 */

import type { KanbanAutomationStep, KanbanColumn } from "../models/kanban";
import { getKanbanAutomationSteps } from "../models/kanban";
import type { Task, TaskLaneSessionRecoveryReason } from "../models/task";
import type { RoutaSystem } from "../routa-system";
import { isLaneAutomationComplete } from "./done-lane-teardown";
import { hasTrippedRetryableEnvironmentFuse } from "./environment-failure";
import { resolveLaneResumeStep } from "./lane-automation-state";
import { runLaneRerunOnce } from "./lane-rerun-claim";
import { hasExceededNonDevAutomationRepeatLimit } from "./workflow-orchestrator";
import { enqueueKanbanTaskSession } from "./workflow-orchestrator-singleton";

/** Recovery reasons of a step a restart or a non-user cancel interrupted. */
export const INTERRUPTED_LANE_REASONS: readonly TaskLaneSessionRecoveryReason[] = ["turn_cancelled", "restart_interrupted"];

export type InterruptedLaneDecision =
  | { kind: "resume"; step: KanbanAutomationStep; stepIndex: number }
  | { kind: "wait"; retryAt: Date }
  | { kind: "skip"; reason: string };

/**
 * Whether the card's interrupted lane step is re-run now, later, or not at
 * all. Only the card's very latest lane record counts, and it must belong to
 * the card's current column.
 */
export function decideInterruptedLaneResume(
  task: Pick<Task, "columnId" | "laneSessions" | "triggerSessionId">,
  columns: KanbanColumn[],
  now: Date,
): InterruptedLaneDecision {
  const columnId = task.columnId;
  const column = columns.find((entry) => entry.id === columnId);
  const automation = column?.automation;
  const transitionType = automation?.transitionType ?? "entry";
  if (!column || !columnId || !automation?.enabled || getKanbanAutomationSteps(automation).length === 0
    || (transitionType !== "entry" && transitionType !== "both")) {
    return { kind: "skip", reason: "no lane automation" };
  }
  const laneSessions = task.laneSessions ?? [];
  const latest = laneSessions.at(-1);
  // The card's session is the interrupted run itself (it ended): not a live one.
  if (task.triggerSessionId && task.triggerSessionId !== latest?.sessionId) {
    return { kind: "skip", reason: "a session is assigned" };
  }
  if (!latest || latest.columnId !== columnId) return { kind: "skip", reason: "no run in this column" };
  if (laneSessions.some((entry) => entry.columnId === columnId && entry.status === "running")) {
    return { kind: "skip", reason: "a step is running" };
  }
  if ((latest.status !== "failed" && latest.status !== "timed_out")
    || !(INTERRUPTED_LANE_REASONS as readonly string[]).includes(latest.recoveryReason ?? "")) {
    return { kind: "skip", reason: "latest run was not interrupted" };
  }
  if (hasTrippedRetryableEnvironmentFuse(task, columnId)) return { kind: "skip", reason: "fuse tripped" };
  if (hasExceededNonDevAutomationRepeatLimit(task, columnId, column.stage)) {
    return { kind: "skip", reason: "repeat limit" };
  }
  if (column.stage === "done" && isLaneAutomationComplete(task, columnId, automation)) {
    return { kind: "skip", reason: "lane complete" };
  }
  const retryAtMs = latest.retryAfterAt ? Date.parse(latest.retryAfterAt) : Number.NaN;
  if (Number.isFinite(retryAtMs) && retryAtMs > now.getTime()) {
    return { kind: "wait", retryAt: new Date(retryAtMs) };
  }
  const resumeStep = resolveLaneResumeStep(task, columns);
  return resumeStep ? { kind: "resume", ...resumeStep } : { kind: "skip", reason: "no step" };
}

export interface InterruptedLaneResumeOptions {
  now?: () => Date;
}

export interface InterruptedLaneResumeResult {
  /** `cardId:columnId:step` of every rerun started or queued. */
  resumed: string[];
  /** Cards whose rerun waits for its planned time. */
  waiting: Array<{ cardId: string; retryAt: Date }>;
}

const TIMERS_KEY = "__routa_interrupted_lane_resume_timers__";

function timers(): Map<string, ReturnType<typeof setTimeout>> {
  const g = globalThis as Record<string, unknown>;
  let map = g[TIMERS_KEY] as Map<string, ReturnType<typeof setTimeout>> | undefined;
  if (!map) {
    map = new Map();
    g[TIMERS_KEY] = map;
  }
  return map;
}

/** Drop every pending delayed resume (tests, shutdown). */
export function stopInterruptedLaneResumeTimers(): void {
  for (const timer of timers().values()) clearTimeout(timer);
  timers().clear();
}

export function hasPendingInterruptedLaneResume(cardId: string): boolean {
  return timers().has(cardId);
}

/** Re-check and re-run one card's interrupted step at `retryAt` (in this process only). */
function scheduleResume(system: RoutaSystem, cardId: string, retryAt: Date, options: InterruptedLaneResumeOptions): void {
  const map = timers();
  const existing = map.get(cardId);
  if (existing) clearTimeout(existing);
  const delay = Math.max(0, retryAt.getTime() - (options.now?.() ?? new Date()).getTime());
  const timer = setTimeout(() => {
    if (map.get(cardId) !== timer) return;
    map.delete(cardId);
    void resumeInterruptedLaneStep(system, cardId, options).catch((error) => {
      console.warn(`[RestartRecovery] Delayed resume of card ${cardId} failed:`, error);
    });
  }, Math.min(delay, 2_147_483_647));
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  map.set(cardId, timer);
}

async function resumeTask(
  system: RoutaSystem,
  task: Task,
  columns: KanbanColumn[],
  options: InterruptedLaneResumeOptions,
  result: InterruptedLaneResumeResult,
): Promise<void> {
  const now = options.now?.() ?? new Date();
  const decision = decideInterruptedLaneResume(task, columns, now);
  if (decision.kind === "wait") {
    scheduleResume(system, task.id, decision.retryAt, options);
    result.waiting.push({ cardId: task.id, retryAt: decision.retryAt });
    return;
  }
  if (decision.kind !== "resume" || !task.columnId) return;
  const columnId = task.columnId;
  const started = await runLaneRerunOnce(system.taskStore, task, columnId, async (fresh) => {
    const current = decideInterruptedLaneResume(fresh, columns, options.now?.() ?? new Date());
    if (current.kind !== "resume") return undefined;
    // Started outside a column transition: the orchestrator adopts the run so
    // its end is recorded and the lane's next step follows (routa:274).
    return enqueueKanbanTaskSession(system, {
      task: fresh,
      expectedColumnId: columnId,
      ignoreExistingTrigger: true,
      step: current.step,
      stepIndex: current.stepIndex,
      adoptLaneRun: true,
    });
  });
  if (started && (started.sessionId || started.queued)) {
    result.resumed.push(`${task.id}:${columnId}:${decision.step.specialistId ?? decision.step.id ?? decision.stepIndex}`);
  }
}

/** Re-run one card's interrupted step now if it still qualifies. */
export async function resumeInterruptedLaneStep(
  system: RoutaSystem,
  cardId: string,
  options: InterruptedLaneResumeOptions = {},
): Promise<InterruptedLaneResumeResult> {
  const result: InterruptedLaneResumeResult = { resumed: [], waiting: [] };
  const task = await system.taskStore.get(cardId);
  const board = task?.boardId ? await system.kanbanBoardStore.get(task.boardId) : undefined;
  if (task && board) await resumeTask(system, task, board.columns, options, result);
  return result;
}

/** Every card of every workspace whose latest lane record is an interruption. */
export async function resumeInterruptedLaneSteps(
  system: RoutaSystem,
  options: InterruptedLaneResumeOptions = {},
): Promise<InterruptedLaneResumeResult> {
  const result: InterruptedLaneResumeResult = { resumed: [], waiting: [] };
  const boards = new Map<string, KanbanColumn[] | undefined>();
  for (const workspace of await system.workspaceStore.list()) {
    for (const task of await system.taskStore.listByWorkspace(workspace.id)) {
      if (!task.boardId || !task.columnId) continue;
      if (!boards.has(task.boardId)) boards.set(task.boardId, (await system.kanbanBoardStore.get(task.boardId))?.columns);
      const columns = boards.get(task.boardId);
      if (!columns) continue;
      try {
        await resumeTask(system, task, columns, options, result);
      } catch (error) {
        console.warn(`[RestartRecovery] Resume of card ${task.id} failed:`, error);
      }
    }
  }
  return result;
}
