/**
 * Cooldown for the automatic `git pull` that runs when a kanban board opens.
 *
 * In-process memory only: a restart clears it, so the first board open after a
 * restart always pulls. A failed pull is never recorded, so it is retried on
 * the next request. Concurrent requests for the same repo share one pull.
 * The manual pull endpoint does not use this module.
 */

import * as path from "path";

export const PULL_COOLDOWN_MS = 10 * 60 * 1000;

type PullResult = { success: boolean; error?: string };

let clock: () => number = () => Date.now();
const lastPullAt = new Map<string, number>();
const inFlight = new Map<string, Promise<PullResult>>();

/** Test hook: replace the clock used for cooldown checks. */
export function setPullCooldownClock(now: (() => number) | null): void {
  clock = now ?? (() => Date.now());
}

/** Test hook: forget all cooldown and in-flight records. */
export function resetPullCooldown(): void {
  lastPullAt.clear();
  inFlight.clear();
}

export interface CooldownPullOutcome {
  skipped: boolean;
  result?: PullResult;
}

export async function pullWithCooldown(
  repoPath: string,
  doPull: () => Promise<PullResult>,
): Promise<CooldownPullOutcome> {
  const key = path.resolve(repoPath);

  const pending = inFlight.get(key);
  if (pending) {
    return { skipped: false, result: await pending };
  }

  const last = lastPullAt.get(key);
  if (last !== undefined && clock() - last < PULL_COOLDOWN_MS) {
    return { skipped: true };
  }

  const run = doPull().then((result) => {
    if (result.success) lastPullAt.set(key, clock());
    return result;
  });
  inFlight.set(key, run);
  try {
    return { skipped: false, result: await run };
  } finally {
    inFlight.delete(key);
  }
}
