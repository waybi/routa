/**
 * Who cancelled a lane step's turn, and what happens next (card 14de4800).
 *
 * A turn that ends with stopReason=cancelled is either a user's own cancel
 * (the `session/cancel` JSON-RPC call of the Next.js ACP route) or something
 * else: Routa restarting or killing the agent. The user's cancel is recorded
 * as `user_cancelled` and never re-run automatically; any other cancel stays
 * `turn_cancelled` and is re-run at the same step after a short backoff,
 * through the same delayed-rerun scheduler as a rate limit (`retryAfterAt`).
 */

import type { Task, TaskLaneSession, TaskLaneSessionRecoveryReason } from "../models/task";
import {
  ENVIRONMENT_FAILURE_ERROR_PREFIX,
  getConsecutiveRetryableEnvironmentFailureCount,
  RATE_LIMIT_BACKOFF_JITTER,
  RETRYABLE_ENVIRONMENT_FAILURE_FUSE_LIMIT,
} from "./environment-failure";
import { planRateLimitRetry } from "./rate-limit-retry";
import { getTaskLaneSession, upsertTaskLaneSession } from "./task-lane-history";

/** How long a user-cancel mark waits for the cancelled turn's end event. */
export const USER_CANCEL_MARK_TTL_MS = 10 * 60_000;

/** Backoff minutes before re-running the 1st, 2nd and 3rd-or-later cancelled turn in a row (±20%). */
export const CANCELLED_TURN_RETRY_MINUTES: readonly number[] = [1, 2, 5];

/** Recovery reasons whose rerun waits for `retryAfterAt` (rate limit, cancelled turn). */
export const RETRY_AFTER_REASONS: readonly TaskLaneSessionRecoveryReason[] = ["rate_limited", "turn_cancelled"];

const MARKS_KEY = "__routa_user_cancelled_sessions__";

/** Shared by every module copy in the process (Next.js bundles routes and instrumentation apart). */
function userCancelMarks(): Map<string, number> {
  const g = globalThis as Record<string, unknown>;
  let marks = g[MARKS_KEY] as Map<string, number> | undefined;
  if (!marks) {
    marks = new Map();
    g[MARKS_KEY] = marks;
  }
  return marks;
}

/** The user asked to cancel this session's turn (session/cancel). */
export function markUserCancelledSession(sessionId: string, now = Date.now()): void {
  if (!sessionId) return;
  const marks = userCancelMarks();
  for (const [id, at] of marks) {
    if (now - at > USER_CANCEL_MARK_TTL_MS) marks.delete(id);
  }
  marks.set(sessionId, now);
}

export function isUserCancelledSession(sessionId: unknown, now = Date.now()): boolean {
  if (typeof sessionId !== "string") return false;
  const at = userCancelMarks().get(sessionId);
  return at !== undefined && now - at <= USER_CANCEL_MARK_TTL_MS;
}

/** Tests only. */
export function clearUserCancelMarks(): void {
  userCancelMarks().clear();
}

/** Recovery reason of a turn that ended with stopReason=cancelled. */
export function resolveCancelledTurnReason(sessionId: unknown): "user_cancelled" | "turn_cancelled" {
  return isUserCancelledSession(sessionId) ? "user_cancelled" : "turn_cancelled";
}

export function isRetryAfterReason(reason: unknown): boolean {
  return typeof reason === "string" && (RETRY_AFTER_REASONS as readonly string[]).includes(reason);
}

/** A run that does not use the non-Dev repeat budget: the user cancelled it. */
export function isUserCancelledLaneSession(entry: Pick<TaskLaneSession, "recoveryReason"> | undefined): boolean {
  return entry?.recoveryReason === "user_cancelled";
}

/** When to re-run a cancelled turn: 1 / 2 / 5 minutes for the 1st / 2nd / 3rd-or-later in a row, ±20%. */
export function computeCancelledTurnRetryAt(params: { consecutiveCount: number; now: Date; random?: () => number }): Date {
  const random = params.random ?? Math.random;
  const index = Math.min(Math.max(params.consecutiveCount, 1), CANCELLED_TURN_RETRY_MINUTES.length) - 1;
  const factor = 1 + (random() * 2 - 1) * RATE_LIMIT_BACKOFF_JITTER;
  return new Date(params.now.getTime() + Math.round(CANCELLED_TURN_RETRY_MINUTES[index] * 60_000 * factor));
}

function formatLocalClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Plan the rerun of a step whose record is failed + turn_cancelled: write
 * retryAfterAt onto the record, unless the lane's retryable failures in a row
 * reached the fuse limit. Undefined for any other record (user_cancelled).
 */
export function planCancelledTurnRetry(params: {
  task: Task;
  columnId: string;
  sessionId: string;
  now?: Date;
  random?: () => number;
}): { retryAt?: Date; lastSyncError: string } | undefined {
  const record = getTaskLaneSession(params.task, params.sessionId);
  if (record?.recoveryReason !== "turn_cancelled" || record.status !== "failed") return undefined;
  const count = getConsecutiveRetryableEnvironmentFailureCount(params.task, params.columnId);
  if (count >= RETRYABLE_ENVIRONMENT_FAILURE_FUSE_LIMIT) {
    return {
      lastSyncError: `${ENVIRONMENT_FAILURE_ERROR_PREFIX} turn_cancelled：连续 ${count} 次可重试环境失败，已熔断，停止自动重跑`,
    };
  }
  const retryAt = computeCancelledTurnRetryAt({ consecutiveCount: count, now: params.now ?? new Date(), random: params.random });
  upsertTaskLaneSession(params.task, { sessionId: params.sessionId, retryAfterAt: retryAt.toISOString() });
  return {
    retryAt,
    lastSyncError: `${ENVIRONMENT_FAILURE_ERROR_PREFIX} turn_cancelled：步骤被中断，预计 ${formatLocalClock(retryAt)} 自动重跑`,
  };
}

/** The orchestrator's delayed-rerun plan after a rate limit or a cancelled turn. */
export function planLaneStepRetry(params: {
  task: Task;
  columnId: string;
  sessionId: string;
  evidence: string;
  rateLimited: boolean;
}): { retryAt?: Date; lastSyncError: string } | undefined {
  return params.rateLimited ? planRateLimitRetry(params) : planCancelledTurnRetry(params);
}
