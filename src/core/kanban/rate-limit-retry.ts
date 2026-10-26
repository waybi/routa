/**
 * Delayed rerun of a rate-limited lane step (card 79804de2), or of a step
 * whose turn was cancelled by something other than the user (card 14de4800).
 *
 * Such a step is re-run at the time recorded on its lane record
 * (`retryAfterAt`), at the same step index, without touching any retry
 * budget. The timer lives in this process only: after a Routa restart the
 * startup resume (interrupted-lane-resume.ts) re-runs a cancelled step at
 * that time, and POST revive reruns either once `retryAfterAt` has passed.
 */

import type { Task } from "../models/task";
import type { SessionUpdateNotification } from "../acp/http-session-store";
import type { TaskStore } from "../store/task-store";
import type {
  ActiveAutomation,
  AutomationSessionSupervisionContext,
  CreateAutomationSession,
} from "./workflow-orchestrator";
import {
  computeRateLimitRetryAt,
  formatRateLimitedError,
  formatRetryableEnvironmentFuseError,
  getConsecutiveRetryableEnvironmentFailureCount,
  RETRYABLE_ENVIRONMENT_FAILURE_FUSE_LIMIT,
} from "./environment-failure";
import { upsertTaskLaneSession } from "./task-lane-history";

export interface RateLimitRetryEntry {
  cardId: string;
  columnId: string;
  stepIndex: number;
  retryAt: Date;
  /** The rate-limited session; the rerun only runs while it is still the lane's latest record. */
  failedSessionId: string;
  /** Dev supervision counters carried over unchanged. */
  attempt: number;
  recoveryAttempts: number;
}

export type RunRateLimitRetry = (entry: RateLimitRetryEntry) => Promise<void>;

/** setTimeout fires at once for delays above 2^31-1 ms; longer waits are chained. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** One pending rerun per card; scheduling again replaces it. */
export class RateLimitRetryScheduler {
  private pending = new Map<string, { entry: RateLimitRetryEntry; timer: ReturnType<typeof setTimeout> }>();

  constructor(private run: RunRateLimitRetry) {}

  schedule(entry: RateLimitRetryEntry): void {
    this.cancel(entry.cardId);
    this.arm(entry);
  }

  /** Schedule a rerun of the automation's current step, keeping its Dev counters. */
  scheduleRun(
    automation: Pick<ActiveAutomation, "cardId" | "columnId" | "currentStepIndex" | "attempt" | "recoveryAttempts">,
    failedSessionId: string,
    retryAt: Date,
  ): void {
    const { cardId, columnId, currentStepIndex: stepIndex, attempt, recoveryAttempts } = automation;
    this.schedule({ cardId, columnId, stepIndex, retryAt, failedSessionId, attempt, recoveryAttempts });
  }

  private arm(entry: RateLimitRetryEntry): void {
    const delay = Math.max(0, entry.retryAt.getTime() - Date.now());
    const wait = Math.min(delay, MAX_TIMER_DELAY_MS);
    const timer = setTimeout(() => {
      if (this.pending.get(entry.cardId)?.timer !== timer) return;
      if (wait < delay) {
        this.arm(entry);
        return;
      }
      this.pending.delete(entry.cardId);
      void this.run(entry).catch((error) => {
        console.warn(`[RateLimitRetry] card=${entry.cardId} rerun failed:`, error);
      });
    }, wait);
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    this.pending.set(entry.cardId, { entry, timer });
  }

  /** Drop the card's pending rerun (optionally only when it is for another column than `keepColumnId`). */
  cancel(cardId: string, keepColumnId?: string): void {
    const current = this.pending.get(cardId);
    if (!current) return;
    if (keepColumnId !== undefined && current.entry.columnId === keepColumnId) return;
    clearTimeout(current.timer);
    this.pending.delete(cardId);
  }

  /** forgetCard: drop the rerun, or only the one for `columnId` when given. */
  forget(cardId: string, columnId?: string): void {
    if (columnId === undefined || this.get(cardId)?.columnId === columnId) this.cancel(cardId);
  }

  stopAll(): void {
    for (const { timer } of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
  }

  get(cardId: string): RateLimitRetryEntry | undefined {
    return this.pending.get(cardId)?.entry;
  }

  get size(): number {
    return this.pending.size;
  }
}

/**
 * The rerun still applies: the card is in the same column, no step of that
 * column is running, and the rate-limited (or cancelled) record is still the
 * column's latest run (nobody reran or moved the card meanwhile).
 */
export function canRunRateLimitRetry(task: Pick<Task, "columnId" | "laneSessions"> | undefined, entry: RateLimitRetryEntry): boolean {
  if (!task || task.columnId !== entry.columnId) return false;
  const laneSessions = task.laneSessions ?? [];
  if (laneSessions.some((session) => session.columnId === entry.columnId && session.status === "running")) {
    return false;
  }
  const latest = [...laneSessions].reverse().find((session) => session.columnId === entry.columnId);
  return latest?.sessionId === entry.failedSessionId
    && (latest.recoveryReason === "rate_limited" || latest.recoveryReason === "turn_cancelled");
}

/**
 * Text searched for rate-limit signals: the failure's own error and the
 * session's ACP error; for an inactivity timeout also the session's last
 * message (the 429 often arrives as the last update before the silence).
 */
export function collectRateLimitEvidence(params: {
  timeout: boolean;
  error?: unknown;
  acpError?: unknown;
  history?: SessionUpdateNotification[];
}): string {
  const parts: string[] = [];
  if (typeof params.error === "string" && params.error) parts.push(params.error);
  if (typeof params.acpError === "string" && params.acpError) parts.push(params.acpError);
  if (params.timeout) {
    const last = params.history?.at(-1);
    if (last) parts.push(JSON.stringify(last.update ?? last));
  }
  return parts.join("\n");
}

/**
 * Decide what happens after a rate-limited run whose lane record is already
 * marked failed with recoveryReason "rate_limited": either a rerun time
 * (written to the record as retryAfterAt) or, once the lane's streak of
 * retryable environment failures reaches the fuse limit, no rerun.
 */
export function planRateLimitRetry(params: {
  task: Task;
  columnId: string;
  sessionId: string;
  evidence: string;
  now?: Date;
  random?: () => number;
}): { retryAt?: Date; lastSyncError: string } {
  const count = getConsecutiveRetryableEnvironmentFailureCount(params.task, params.columnId);
  if (count >= RETRYABLE_ENVIRONMENT_FAILURE_FUSE_LIMIT) {
    return { lastSyncError: formatRetryableEnvironmentFuseError(count) };
  }
  const retryAt = computeRateLimitRetryAt({
    message: params.evidence,
    consecutiveCount: count,
    now: params.now ?? new Date(),
    random: params.random,
  });
  upsertTaskLaneSession(params.task, { sessionId: params.sessionId, retryAfterAt: retryAt.toISOString() });
  return { retryAt, lastSyncError: formatRateLimitedError(retryAt) };
}

/** What the rerun needs from the orchestrator. */
export interface RateLimitRetryHost {
  taskStore: Pick<TaskStore, "get" | "save">;
  /** Starts a session for a lane step; undefined when no session creator is set. */
  createSession?: (
    params: Parameters<CreateAutomationSession>[0],
  ) => Promise<{ sessionId?: string; queued: boolean }>;
  /** Registers the lane run as the card's active automation; undefined when it cannot. */
  adoptLaneRun: (params: {
    cardId: string;
    columnId: string;
    stepIndex: number;
    counters: { attempt: number; recoveryAttempts: number };
  }) => Promise<ActiveAutomation | undefined>;
  cleanupCardSession?: (cardId: string) => void;
  buildSupervision: (
    active: ActiveAutomation,
    objective: string,
    recoveredFromSessionId: string,
  ) => AutomationSessionSupervisionContext | undefined;
}

/**
 * Re-run a rate-limited step at the same index, as a new session. Nothing is
 * counted: the Dev attempt and recovery counters are carried over unchanged.
 */
export async function runRateLimitRetry(host: RateLimitRetryHost, entry: RateLimitRetryEntry): Promise<void> {
  const task = await host.taskStore.get(entry.cardId);
  if (!host.createSession || !task || !canRunRateLimitRetry(task, entry)) return;
  const { cardId, columnId, stepIndex } = entry;
  const active = await host.adoptLaneRun({ cardId, columnId, stepIndex, counters: entry });
  if (!active) return;
  if (task.triggerSessionId) {
    if (!task.sessionIds.includes(task.triggerSessionId)) task.sessionIds.push(task.triggerSessionId);
    task.triggerSessionId = undefined;
  }
  task.lastSyncError = undefined;
  task.updatedAt = new Date();
  await host.taskStore.save(task);
  host.cleanupCardSession?.(cardId);
  try {
    const { sessionId, queued } = await host.createSession({
      workspaceId: active.workspaceId,
      cardId,
      cardTitle: active.cardTitle,
      columnId,
      columnName: active.columnName,
      automation: active.automation,
      step: active.steps[stepIndex],
      stepIndex,
      // No recoveryReason: it would be written onto the new run's record.
      supervision: host.buildSupervision(active, task.objective || task.title, entry.failedSessionId),
    });
    if (sessionId) {
      active.status = "running";
      active.sessionId = sessionId;
    } else if (!queued) {
      active.status = "failed";
    }
  } catch (error) {
    active.status = "failed";
    console.error("[WorkflowOrchestrator] Rate-limit rerun failed to start:", error);
  }
}
