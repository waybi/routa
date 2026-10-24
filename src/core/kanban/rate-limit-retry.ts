/**
 * Delayed rerun of a rate-limited lane step (card 79804de2).
 *
 * A step that failed because the model was rate limited is re-run at the
 * time recorded on its lane record (`retryAfterAt`), at the same step index,
 * without touching any retry budget. The timer lives in this process only:
 * after a Routa restart, POST revive reruns the step once `retryAfterAt` has
 * passed (see restart-recovery.ts).
 */

import type { Task } from "../models/task";
import type { SessionUpdateNotification } from "../acp/http-session-store";
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
 * column is running, and the rate-limited record is still the column's
 * latest run (nobody reran or moved the card meanwhile).
 */
export function canRunRateLimitRetry(task: Pick<Task, "columnId" | "laneSessions"> | undefined, entry: RateLimitRetryEntry): boolean {
  if (!task || task.columnId !== entry.columnId) return false;
  const laneSessions = task.laneSessions ?? [];
  if (laneSessions.some((session) => session.columnId === entry.columnId && session.status === "running")) {
    return false;
  }
  const latest = [...laneSessions].reverse().find((session) => session.columnId === entry.columnId);
  return latest?.sessionId === entry.failedSessionId && latest.recoveryReason === "rate_limited";
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
