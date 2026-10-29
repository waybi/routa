/**
 * One place that decides whether a card's lane still has a live builder
 * session. Used by the manual-rerun guard (PATCH retryTrigger), the enqueue
 * safety net and the orchestrator's adoptLaneRun, so they cannot drift apart.
 */

import { getAcpInstanceId, isExecutionLeaseActive } from "../acp/execution-backend";
import { getHttpSessionStore } from "../acp/http-session-store";
import { getAcpProcessManager } from "../acp/processer";
import type { Task } from "../models/task";

export interface LiveSessionDeps {
  sessionStore: Pick<ReturnType<typeof getHttpSessionStore>, "getSession">;
  processManager: Pick<ReturnType<typeof getAcpProcessManager>, "hasActiveSession">;
}

function defaultDeps(): LiveSessionDeps {
  return { sessionStore: getHttpSessionStore(), processManager: getAcpProcessManager() };
}

/** The session process is alive, or its record says it is ready/connecting (or leased to this instance). */
export function isSessionActivelyRunning(
  sessionId: string | undefined,
  deps: LiveSessionDeps = defaultDeps(),
): boolean {
  if (!sessionId) return false;
  if (deps.processManager.hasActiveSession(sessionId)) return true;

  const session = deps.sessionStore.getSession(sessionId);
  if (!session) return false;
  if (session.acpStatus === "ready" || session.acpStatus === "connecting") return true;
  if (session.acpStatus === "error") return false;

  // Hydrated sessions from storage only remain resumable when the current
  // instance still owns the execution lease.
  const ownerInstanceId = session.ownerInstanceId?.trim();
  if (!ownerInstanceId) return false;
  if (ownerInstanceId !== getAcpInstanceId()) return false;
  return isExecutionLeaseActive(session.leaseExpiresAt);
}

/**
 * The newest session of `columnId` whose lane record is "running" AND whose
 * process is alive. A live process alone is not enough: DSH sessions stay up
 * after their step completed.
 */
export function findLiveColumnSession(
  task: Pick<Task, "laneSessions"> | undefined,
  columnId: string | undefined,
  deps: LiveSessionDeps = defaultDeps(),
): string | undefined {
  if (!task || !columnId) return undefined;
  const entries = task.laneSessions ?? [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.columnId === columnId && entry.status === "running" && isSessionActivelyRunning(entry.sessionId, deps)) {
      return entry.sessionId;
    }
  }
  return undefined;
}

/**
 * An orchestrator automation that is "running" on a live session other than
 * `newSessionId`: adopting a new run over it would leave that session
 * unsupervised, so adoptLaneRun refuses.
 */
export function isLiveRunningAutomation(
  automation: { status: string; sessionId?: string } | undefined,
  newSessionId: string | undefined,
  deps: LiveSessionDeps = defaultDeps(),
): boolean {
  return automation?.status === "running"
    && automation.sessionId !== undefined
    && automation.sessionId !== newSessionId
    && isSessionActivelyRunning(automation.sessionId, deps);
}
