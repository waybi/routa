/**
 * Environment failure classification for Kanban automation sessions.
 *
 * An environment failure means the session could not run because the host
 * environment is misconfigured (for example the provider is not registered),
 * not because the agent failed the task. Such failures are recorded on the lane
 * session with `recoveryReason: "environment_failure"`, are excluded from the
 * normal retry / repeat-limit counters, and are never retried automatically:
 * retrying cannot succeed until a human fixes the environment.
 *
 * Keep the patterns narrow. Treating ordinary task failures as environment
 * failures would exempt them from the circuit breaker.
 */

import type { Task, TaskLaneSession, TaskLaneSessionRecoveryReason } from "../models/task";

/** Error message fragments that identify an environment failure. */
export const ENVIRONMENT_FAILURE_PATTERNS: readonly string[] = [
  // src/core/acp/provider-registry.ts: `Unknown provider: "<id>". Not registered in ProviderRegistry.`
  "Not registered in ProviderRegistry",
  "Unknown provider:",
];

/** Prefix written into `lastSyncError` so humans can see the failure class. */
export const ENVIRONMENT_FAILURE_ERROR_PREFIX = "[environment]";

export function isEnvironmentFailureMessage(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) {
    return false;
  }
  return ENVIRONMENT_FAILURE_PATTERNS.some((pattern) => message.includes(pattern));
}

export function formatEnvironmentFailureError(message: string): string {
  return message.startsWith(ENVIRONMENT_FAILURE_ERROR_PREFIX)
    ? message
    : `${ENVIRONMENT_FAILURE_ERROR_PREFIX} ${message}`;
}

export function isEnvironmentFailureLaneSession(
  entry: Pick<TaskLaneSession, "recoveryReason"> | undefined,
): boolean {
  return entry?.recoveryReason === "environment_failure";
}

/** Count environment failures in the card's current consecutive run of `columnId`. */
export function getEnvironmentFailureCount(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
): number {
  const laneSessions = task?.laneSessions ?? [];
  let count = 0;
  for (let index = laneSessions.length - 1; index >= 0; index -= 1) {
    const entry = laneSessions[index];
    if (entry.columnId !== columnId) {
      break;
    }
    if (isEnvironmentFailureLaneSession(entry)) {
      count += 1;
    }
  }
  return count;
}

// ── Retryable environment failures (card 79804de2) ──────────────────────────
//
// A model rate limit (HTTP 429) or a Routa restart interrupting the step is
// not the card's fault either, but unlike `environment_failure` it clears by
// itself. These runs do not consume the non-Dev repeat budget or the Dev
// recovery budget. A rate-limited step is re-run automatically at
// `retryAfterAt`. A turn cancelled while Routa keeps running (turn_cancelled)
// is re-run after a short backoff, also at `retryAfterAt`; after a restart the
// startup resume re-runs turn_cancelled and restart_interrupted steps
// (interrupted-lane-resume.ts, card 14de4800). A user's own cancel is
// `user_cancelled`: not retryable, never re-run automatically, and it does
// not consume the repeat budget either (lane-cancel-origin.ts). Consecutive
// retryable failures in one lane trip a fuse.

/** Recovery reasons that are retryable environment failures. */
export const RETRYABLE_ENVIRONMENT_REASONS: readonly TaskLaneSessionRecoveryReason[] = [
  "rate_limited",
  "turn_cancelled",
  "restart_interrupted",
];

/** Consecutive retryable environment failures in one lane that stop automatic reruns. */
export const RETRYABLE_ENVIRONMENT_FAILURE_FUSE_LIMIT = 5;

/** Backoff minutes for the 1st, 2nd and 3rd-or-later rate limit without a server reset time. */
export const RATE_LIMIT_BACKOFF_MINUTES: readonly number[] = [5, 10, 20];

/** Symmetric jitter applied to the local backoff (±20%). */
export const RATE_LIMIT_BACKOFF_JITTER = 0.2;

/** Upper bound of the delay added after a server reset time (never earlier than the server time). */
export const RATE_LIMIT_SERVER_JITTER_MS = 60_000;

const RATE_LIMIT_KEYWORDS: readonly string[] = [
  "usage_limit_reached",
  "rate_limit_error",
  "trial_rate_limited",
];

/** Explicit HTTP 429 status forms. A bare "429" (row counts, ports, ids) is not a rate limit. */
const HTTP_429_PATTERNS: readonly RegExp[] = [
  /\bHTTP(?:\/\d(?:\.\d)?)?[\s:]*429\b/i,
  /\bstatus(?:[_\s-]?code)?["']?\s*[:=]?\s*["']?429\b/i,
  /\b429\s+Too Many Requests\b/i,
];

/** Error text as seen through any number of JSON escaping layers. */
function unescapeLayers(message: string): string {
  return message.replace(/\\/g, "");
}

export function isRetryableEnvironmentReason(reason: unknown): boolean {
  return typeof reason === "string"
    && (RETRYABLE_ENVIRONMENT_REASONS as readonly string[]).includes(reason);
}

/** A run that ended (failed / timed out) with a retryable environment failure. */
export function isRetryableEnvironmentFailureLaneSession(
  entry: Pick<TaskLaneSession, "recoveryReason" | "status"> | undefined,
): boolean {
  return Boolean(entry)
    && isRetryableEnvironmentReason(entry?.recoveryReason)
    && (entry?.status === "failed" || entry?.status === "timed_out");
}

/** "rate_limited" when the error text carries an explicit rate-limit signal. */
export function classifyRetryableEnvironmentFailure(message: unknown): "rate_limited" | undefined {
  if (typeof message !== "string" || message.length === 0) {
    return undefined;
  }
  const text = unescapeLayers(message);
  if (RATE_LIMIT_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return "rate_limited";
  }
  return HTTP_429_PATTERNS.some((pattern) => pattern.test(text)) ? "rate_limited" : undefined;
}

const ISO_TIME = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?`;
const RESETS_AT_PATTERN = new RegExp(
  String.raw`resets_at["']?\s*[:=]\s*["']?(${ISO_TIME}|\d{9,13}(?:\.\d+)?)`,
  "i",
);
const RESETS_IN_SECONDS_PATTERN = /resets_in_seconds["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i;
const RETRY_AFTER_PATTERN = /retry[-_\s]?after["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i;

/** The server's rate-limit reset time, if the error text carries one. */
export function parseRateLimitResetAt(message: unknown, now: Date): Date | undefined {
  if (typeof message !== "string" || message.length === 0) {
    return undefined;
  }
  const text = unescapeLayers(message);
  const resetsAt = RESETS_AT_PATTERN.exec(text)?.[1];
  if (resetsAt) {
    const numeric = Number(resetsAt);
    const ms = Number.isFinite(numeric)
      ? (numeric >= 1e12 ? numeric : numeric * 1000)
      : Date.parse(resetsAt);
    if (Number.isFinite(ms)) {
      return new Date(ms);
    }
  }
  const seconds = RESETS_IN_SECONDS_PATTERN.exec(text)?.[1] ?? RETRY_AFTER_PATTERN.exec(text)?.[1];
  if (seconds !== undefined) {
    return new Date(now.getTime() + Number(seconds) * 1000);
  }
  return undefined;
}

/**
 * When to re-run a rate-limited step. With a server reset time: that time
 * plus 0–60 s, never earlier (the server time is a lower bound). Without one:
 * 5 / 10 / 20 minutes for the 1st / 2nd / 3rd-or-later consecutive failure,
 * ±20%. `random` returns a number in [0, 1).
 */
export function computeRateLimitRetryAt(params: {
  message: unknown;
  consecutiveCount: number;
  now: Date;
  random?: () => number;
}): Date {
  const random = params.random ?? Math.random;
  const nowMs = params.now.getTime();
  const serverTime = parseRateLimitResetAt(params.message, params.now);
  if (serverTime) {
    const base = Math.max(serverTime.getTime(), nowMs);
    return new Date(base + Math.ceil(random() * RATE_LIMIT_SERVER_JITTER_MS));
  }
  const index = Math.min(Math.max(params.consecutiveCount, 1), RATE_LIMIT_BACKOFF_MINUTES.length) - 1;
  const factor = 1 + (random() * 2 - 1) * RATE_LIMIT_BACKOFF_JITTER;
  return new Date(nowMs + Math.round(RATE_LIMIT_BACKOFF_MINUTES[index] * 60_000 * factor));
}

/**
 * Retryable environment failures at the end of the card's current run of
 * `columnId`, newest first. A running record is skipped; a success or any
 * other failure ends the streak.
 */
export function getConsecutiveRetryableEnvironmentFailureCount(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
): number {
  const laneSessions = task?.laneSessions ?? [];
  let count = 0;
  for (let index = laneSessions.length - 1; index >= 0; index -= 1) {
    const entry = laneSessions[index];
    if (entry.columnId !== columnId) {
      break;
    }
    if (entry.status === "running") {
      continue;
    }
    if (!isRetryableEnvironmentFailureLaneSession(entry)) {
      break;
    }
    count += 1;
  }
  return count;
}

export function hasTrippedRetryableEnvironmentFuse(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
): boolean {
  return getConsecutiveRetryableEnvironmentFailureCount(task, columnId) >= RETRYABLE_ENVIRONMENT_FAILURE_FUSE_LIMIT;
}

/**
 * True while the latest run in `columnId` is a rate-limited failure whose
 * planned rerun time has not come yet. Revive must not run it early. (A
 * cancelled turn's planned rerun does not hold revive back: revive is an
 * explicit rerun, and the pending timer then finds a newer run and skips.)
 */
export function isWaitingForRateLimitRetry(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
  now: Date,
): boolean {
  const laneSessions = task?.laneSessions ?? [];
  for (let index = laneSessions.length - 1; index >= 0; index -= 1) {
    const entry = laneSessions[index];
    if (entry.columnId !== columnId) {
      return false;
    }
    if (entry.recoveryReason !== "rate_limited" || !entry.retryAfterAt) {
      return false;
    }
    const retryAtMs = Date.parse(entry.retryAfterAt);
    return Number.isFinite(retryAtMs) && retryAtMs > now.getTime();
  }
  return false;
}

function formatLocalClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** lastSyncError while a rate-limited step waits for its rerun. HH:MM is local time. */
export function formatRateLimitedError(retryAt: Date): string {
  return `${ENVIRONMENT_FAILURE_ERROR_PREFIX} rate_limited：限流，预计 ${formatLocalClock(retryAt)} 重试`;
}

/** lastSyncError after the fuse stopped automatic reruns. */
export function formatRetryableEnvironmentFuseError(count: number): string {
  return `${ENVIRONMENT_FAILURE_ERROR_PREFIX} rate_limited：连续 ${count} 次可重试环境失败，已熔断，停止自动重跑`;
}

/**
 * True when the latest lane session in `columnId` ended with an environment
 * failure. Automated paths (revive) must not re-run the lane until a human
 * fixes the environment and moves the card.
 */
export function isAwaitingEnvironmentFix(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string,
): boolean {
  const laneSessions = task?.laneSessions ?? [];
  for (let index = laneSessions.length - 1; index >= 0; index -= 1) {
    const entry = laneSessions[index];
    if (entry.columnId !== columnId) {
      return false;
    }
    return isEnvironmentFailureLaneSession(entry);
  }
  return false;
}
