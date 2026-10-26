/**
 * One rerun at a time per card lane (card 14de4800).
 *
 * Three paths re-run an interrupted lane step: the startup resume (and its
 * delayed retries), POST revive, and PATCH retryTrigger. When they run at the
 * same time each one read the card before the others started a session, so
 * the card got two agents in the same column. A path claims the card's lane
 * (key cardId + columnId) synchronously before it starts anything; a second
 * path finds the claim taken and gives up. After a claim is released the next
 * path re-reads the card and gives up when a session started meanwhile.
 */

import type { Task } from "../models/task";
import type { TaskStore } from "../store/task-store";

const CLAIMS_KEY = "__routa_lane_rerun_claims__";

function claims(): Set<string> {
  const g = globalThis as Record<string, unknown>;
  let set = g[CLAIMS_KEY] as Set<string> | undefined;
  if (!set) {
    set = new Set();
    g[CLAIMS_KEY] = set;
  }
  return set;
}

function claimKey(cardId: string, columnId: string | undefined): string {
  return `${cardId}:${columnId ?? ""}`;
}

/** Claim the card's lane for one rerun; undefined while another rerun holds it. Call the result to release. */
export function claimLaneRerun(cardId: string, columnId: string | undefined): (() => void) | undefined {
  const key = claimKey(cardId, columnId);
  const set = claims();
  if (set.has(key)) return undefined;
  set.add(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    set.delete(key);
  };
}

export function isLaneRerunClaimed(cardId: string, columnId: string | undefined): boolean {
  return claims().has(claimKey(cardId, columnId));
}

/** Tests only. */
export function clearLaneRerunClaims(): void {
  claims().clear();
}

/** A session of `columnId` started after `snapshot` was read. */
export function hasLaneRunStartedSince(snapshot: Pick<Task, "triggerSessionId" | "laneSessions">, fresh: Pick<Task, "triggerSessionId" | "laneSessions">, columnId: string): boolean {
  if (fresh.triggerSessionId && fresh.triggerSessionId !== snapshot.triggerSessionId) return true;
  const runningBefore = new Set((snapshot.laneSessions ?? [])
    .filter((entry) => entry.columnId === columnId && entry.status === "running")
    .map((entry) => entry.sessionId));
  return (fresh.laneSessions ?? []).some((entry) => (
    entry.columnId === columnId && entry.status === "running" && !runningBefore.has(entry.sessionId)
  ));
}

/**
 * Run `start` under the card lane's claim, on the card as stored now. Gives
 * up (undefined) when another rerun holds the claim, the card left
 * `columnId`, or a session of that column started after `snapshot` was read.
 */
export async function runLaneRerunOnce<T>(
  taskStore: Pick<TaskStore, "get">,
  snapshot: Task,
  columnId: string,
  start: (fresh: Task) => Promise<T>,
): Promise<T | undefined> {
  const release = claimLaneRerun(snapshot.id, columnId);
  if (!release) return undefined;
  try {
    // A store without single reads (test doubles of the list-only revive pass) keeps the snapshot.
    const fresh = typeof taskStore.get === "function" ? await taskStore.get(snapshot.id) : snapshot;
    if (!fresh || fresh.columnId !== columnId || hasLaneRunStartedSince(snapshot, fresh, columnId)) return undefined;
    return await start(fresh);
  } finally {
    release();
  }
}
