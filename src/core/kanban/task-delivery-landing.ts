import { computeLandingFromRefs, readLandingRefs, type LandingRefs } from "@/core/git/git-landing-probe";
import type { Codebase } from "@/core/models/codebase";
import type { Task } from "@/core/models/task";
import type { Worktree } from "@/core/models/worktree";

/**
 * Lightweight "has this task branch landed on its base branch?" probe.
 *
 * `GET /api/tasks` deliberately does not compute `deliveryReadiness` per card
 * (see docs/issues/2026-04-09-next-task-api-head-of-line-blocking.md); the
 * full probe runs `git status` and `git remote` for every task and took ~15 s
 * on a 21-card workspace. The board still needs one bit — whether a `done`
 * card's commits are reachable from the base branch — to tell "finished" from
 * "actually merged". This module answers that with read-only ref lookups
 * (`cat-file --batch-check`, `rev-list --count`, `merge-base --is-ancestor`),
 * only for cards that have a task worktree. Every git call is async
 * (git-landing-probe.ts), at most {@link LANDING_PROBE_CONCURRENCY} probes run
 * at once, and results are cached by HEAD + base shas, so the list stays fast
 * and never blocks the Node main thread.
 */

export interface TaskDeliveryLanding {
  /** HEAD reachable from base. `null` when it could not be determined. */
  landedOnBase: boolean | null;
  /** Commits on the task branch that are not on base (0 once landed). */
  commitsSinceBase: number;
  branch?: string;
  baseBranch?: string;
}

interface LandingSystemLike {
  codebaseStore: {
    get(codebaseId: string): Promise<Codebase | undefined>;
  };
  worktreeStore: {
    get(worktreeId: string): Promise<Worktree | undefined>;
  };
}

/**
 * Process-wide cache of landing results, keyed by worktree path + HEAD sha +
 * the resolved base ref name and sha (+ the local base branch sha when the
 * probe may fall back to it).
 *
 * The answer is a pure function of those shas, so both `true` and `false`
 * ("unmerged +N") are cached: a new commit moves HEAD, a fetch or merge moves
 * base, and either one misses the cache. Results computed while a git command
 * failed unexpectedly, or with an unborn HEAD, are not cached.
 *
 * A hit costs one `git cat-file --batch-check` instead of the full probe.
 * Kept on globalThis so Next dev hot reloads do not drop it.
 */
const LANDING_CACHE_KEY = "__routa_task_delivery_landing_cache__";
const LANDING_CACHE_MAX_ENTRIES = 1000;

function getLandingCache(): Map<string, TaskDeliveryLanding> {
  const g = globalThis as Record<string, unknown>;
  if (!g[LANDING_CACHE_KEY]) {
    g[LANDING_CACHE_KEY] = new Map<string, TaskDeliveryLanding>();
  }
  return g[LANDING_CACHE_KEY] as Map<string, TaskDeliveryLanding>;
}

function rememberLanding(key: string, landing: TaskDeliveryLanding): void {
  const cache = getLandingCache();
  cache.delete(key);
  cache.set(key, landing);
  while (cache.size > LANDING_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function landingCacheKey(worktreePath: string, refs: LandingRefs): string | null {
  if (!refs.headSha) return null;
  return [
    worktreePath,
    refs.headSha,
    refs.baseBranch ?? "",
    refs.baseRef ?? "",
    refs.baseSha ?? "",
    refs.localBaseSha ?? "",
  ].join("\0");
}

/** Test-only: clear the landing-result cache. */
export function __resetTaskDeliveryLandingCacheForTests(): void {
  getLandingCache().clear();
}

/**
 * At most this many landing probes run git at once (process-wide). Each probe
 * runs its commands one after another, so this also caps git processes.
 */
export const LANDING_PROBE_CONCURRENCY = 8;
let activeProbes = 0;
const probeQueue: Array<() => void> = [];

async function withProbeSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeProbes >= LANDING_PROBE_CONCURRENCY) {
    await new Promise<void>((resolve) => probeQueue.push(resolve));
  } else {
    activeProbes += 1;
  }
  try {
    return await run();
  } finally {
    const next = probeQueue.shift();
    if (next) next();
    else activeProbes -= 1;
  }
}

/** Columns whose cards can meaningfully be "done but not merged". */
const LANDING_COLUMNS = new Set(["done"]);

export function shouldProbeTaskDeliveryLanding(
  task: Pick<Task, "columnId" | "worktreeId">,
): boolean {
  return Boolean(task.worktreeId) && LANDING_COLUMNS.has(task.columnId ?? "");
}

export async function buildTaskDeliveryLanding(
  task: Pick<Task, "columnId" | "worktreeId">,
  system: LandingSystemLike,
): Promise<TaskDeliveryLanding | undefined> {
  if (!shouldProbeTaskDeliveryLanding(task) || !task.worktreeId) {
    return undefined;
  }
  const worktree = await system.worktreeStore.get(task.worktreeId);
  if (!worktree?.worktreePath) {
    return undefined;
  }
  const worktreePath = worktree.worktreePath;
  const baseBranch = worktree.baseBranch
    || (await system.codebaseStore.get(worktree.codebaseId))?.branch;

  return withProbeSlot(async () => {
    const refs = await readLandingRefs(worktreePath, baseBranch);
    if (!refs) return undefined;
    const cacheKey = landingCacheKey(worktreePath, refs);
    const cached = cacheKey ? getLandingCache().get(cacheKey) : undefined;
    if (cached) return { ...cached, branch: worktree.branch };

    const { status, reliable } = await computeLandingFromRefs(worktreePath, refs);
    const landing: TaskDeliveryLanding = {
      landedOnBase: status.landedOnBase,
      commitsSinceBase: status.commitsSinceBase,
      branch: worktree.branch,
      baseBranch: status.baseBranch,
    };
    if (cacheKey && reliable) rememberLanding(cacheKey, landing);
    return landing;
  });
}
