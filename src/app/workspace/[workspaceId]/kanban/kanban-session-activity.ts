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

import type { SessionInfo } from "../types";

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
