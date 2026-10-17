/**
 * Folds pushed `kanban:session-activity` heartbeats into the fetched session
 * list.
 *
 * The board fetches `/api/sessions` once and refetches only on
 * `kanban:changed`. Without this merge a card keeps whatever the session
 * looked like at fetch time — typically `connecting`, so a card that had been
 * working for 20 minutes still read "starting".
 *
 * Whichever side has the newer `lastActivityAt` wins, so a slow refetch that
 * lands after a heartbeat cannot roll the card back.
 */

import type { SessionInfo, TaskInfo } from "../types";

export interface SessionActivityPatch {
  sessionId: string;
  acpStatus?: SessionInfo["acpStatus"];
  acpError?: string;
  lastActivityAt?: string;
  lastEventType?: string;
  lastToolName?: string;
  lastToolStatus?: string;
  terminalState?: SessionInfo["terminalState"];
  terminalReason?: string;
}

function toMs(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function mergeSessionActivity(
  sessions: SessionInfo[],
  pushed: Record<string, SessionActivityPatch>,
): SessionInfo[] {
  if (Object.keys(pushed).length === 0) return sessions;
  return sessions.map((session) => {
    const patch = pushed[session.sessionId];
    if (!patch) return session;
    if (toMs(patch.lastActivityAt) < toMs(session.lastActivityAt)) return session;
    return {
      ...session,
      acpStatus: patch.acpStatus ?? session.acpStatus,
      acpError: patch.acpError,
      lastActivityAt: patch.lastActivityAt ?? session.lastActivityAt,
      lastEventType: patch.lastEventType,
      lastToolName: patch.lastToolName,
      lastToolStatus: patch.lastToolStatus,
      terminalState: patch.terminalState,
      terminalReason: patch.terminalReason,
    };
  });
}

/**
 * Which session a card should read its run status from.
 *
 * Normally the card's `triggerSessionId`. But when a run dies, the board's
 * stale-session sweep (`restart-recovery.ts` sanitizeStaleCurrentLaneAutomation)
 * clears the trigger and marks the lane record failed/timed out — so the card
 * lost the session and with it the reason ("process exited …"), showing a bare
 * "failed" or even "idle". Fall back to the newest failed lane record in the
 * card's current column so the reason stays on the card face.
 */
export function resolveCardLinkedSession(
  task: Pick<TaskInfo, "triggerSessionId" | "columnId" | "laneSessions">,
  sessionMap: Map<string, SessionInfo>,
): SessionInfo | undefined {
  if (task.triggerSessionId) return sessionMap.get(task.triggerSessionId);
  const failed = (task.laneSessions ?? [])
    .filter((entry) => entry.columnId === task.columnId
      && (entry.status === "failed" || entry.status === "timed_out"))
    .sort((left, right) => toMs(right.startedAt) - toMs(left.startedAt))[0];
  return failed ? sessionMap.get(failed.sessionId) : undefined;
}

/**
 * "model / effort" for a lane run, or undefined when neither is known (the
 * caller then renders nothing). The session record is what the agent actually
 * runs; the lane record is what session/new asked for, used until the session
 * list has it.
 */
export function formatSessionModelLabel(
  session: Pick<SessionInfo, "model" | "reasoningEffort"> | undefined,
  laneSession: { model?: string; reasoningEffort?: string } | undefined,
): string | undefined {
  const model = session?.model?.trim() || laneSession?.model?.trim();
  const effort = session?.reasoningEffort?.trim() || laneSession?.reasoningEffort?.trim();
  const parts = [model, effort].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" / ") : undefined;
}
