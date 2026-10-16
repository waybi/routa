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

import type { Task, TaskLaneSession } from "../models/task";

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
