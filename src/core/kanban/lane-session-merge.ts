import type { TaskLaneSession } from "../models/task";

/**
 * Append-only merge of a card's `sessionIds` / `laneSessions` on save.
 *
 * TaskStore.save writes a whole card, so a caller holding an older copy
 * (autoAdvanceCard, end handling, MCP move_card ...) used to wipe lane records
 * a concurrent step start had just written (retro L279). Both fields only ever
 * grow, so the store merges them instead of letting the last writer win:
 *  - sessionIds: union, incoming order first, then ids only the stored row has.
 *  - laneSessions: by sessionId. Stored-only records are kept. When both sides
 *    have a record, an ended one is never turned back into running (either
 *    side); two ended records take incoming. Fields missing on the winner
 *    (columnId, stepIndex, specialistId, stepId, ...) are filled from the
 *    other side.
 * Every other card field stays last-writer-wins.
 */

export function mergeSessionIds(stored: string[] | undefined, incoming: string[] | undefined): string[] {
  const merged = [...(incoming ?? [])];
  const seen = new Set(merged);
  for (const id of stored ?? []) {
    if (!seen.has(id)) {
      seen.add(id);
      merged.push(id);
    }
  }
  return merged;
}

function mergeLaneSession(stored: TaskLaneSession, incoming: TaskLaneSession): TaskLaneSession {
  const storedEnded = stored.status !== "running";
  const incomingEnded = incoming.status !== "running";
  const [winner, other] = incomingEnded || !storedEnded ? [incoming, stored] : [stored, incoming];
  const merged: TaskLaneSession = { ...winner };
  for (const [key, value] of Object.entries(other)) {
    if (value === undefined) continue;
    const record = merged as unknown as Record<string, unknown>;
    if (record[key] === undefined) record[key] = value;
  }
  return merged;
}

export function mergeLaneSessions(
  stored: TaskLaneSession[] | undefined,
  incoming: TaskLaneSession[] | undefined,
): TaskLaneSession[] {
  const storedById = new Map((stored ?? []).map((entry) => [entry.sessionId, entry]));
  const incomingIds = new Set<string>();
  const merged: TaskLaneSession[] = [];
  for (const entry of incoming ?? []) {
    incomingIds.add(entry.sessionId);
    const counterpart = storedById.get(entry.sessionId);
    merged.push(counterpart ? mergeLaneSession(counterpart, entry) : entry);
  }
  for (const entry of stored ?? []) {
    if (!incomingIds.has(entry.sessionId)) merged.push(entry);
  }
  return merged;
}

export function mergeLaneRecords(
  stored: { sessionIds?: string[]; laneSessions?: TaskLaneSession[] } | undefined,
  incoming: { sessionIds?: string[]; laneSessions?: TaskLaneSession[] },
): { sessionIds: string[]; laneSessions: TaskLaneSession[] } {
  return {
    sessionIds: mergeSessionIds(stored?.sessionIds, incoming.sessionIds),
    laneSessions: mergeLaneSessions(stored?.laneSessions, incoming.laneSessions),
  };
}
