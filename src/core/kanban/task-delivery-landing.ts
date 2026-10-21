import { getRepoLandingStatus, getRepoRefSha, isGitRepository } from "@/core/git";
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
 * "actually merged". This module answers that with three read-only ref
 * lookups (`rev-parse --verify`, `rev-list --count`, `merge-base
 * --is-ancestor`) and only for cards that have a task worktree, so it stays
 * on the list hot path.
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
 * Process-wide cache of `landedOnBase === true` results, keyed by worktree
 * path + HEAD sha + requested base branch.
 *
 * A landed commit is an immutable fact: once HEAD is reachable from base, base
 * only moves forward, so the answer cannot flip for the same HEAD. A new
 * commit changes HEAD and misses the cache. The one exception is a force-push
 * that rewinds base past HEAD; that is rare and accepted here. `false` and
 * `null` are never cached, because they can turn true at any time.
 *
 * A cache hit still costs one `git rev-parse HEAD` instead of the full probe.
 * Kept on globalThis so Next dev hot reloads do not drop it.
 */
const LANDED_CACHE_KEY = "__routa_task_delivery_landed_cache__";
const LANDED_CACHE_MAX_ENTRIES = 500;

function getLandedCache(): Map<string, TaskDeliveryLanding> {
  const g = globalThis as Record<string, unknown>;
  if (!g[LANDED_CACHE_KEY]) {
    g[LANDED_CACHE_KEY] = new Map<string, TaskDeliveryLanding>();
  }
  return g[LANDED_CACHE_KEY] as Map<string, TaskDeliveryLanding>;
}

function rememberLanded(key: string, landing: TaskDeliveryLanding): void {
  const cache = getLandedCache();
  cache.delete(key);
  cache.set(key, landing);
  while (cache.size > LANDED_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test-only: clear the landed-result cache. */
export function __resetTaskDeliveryLandingCacheForTests(): void {
  getLandedCache().clear();
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
  if (!worktree?.worktreePath || !isGitRepository(worktree.worktreePath)) {
    return undefined;
  }
  const baseBranch = worktree.baseBranch
    || (await system.codebaseStore.get(worktree.codebaseId))?.branch;

  const headSha = getRepoRefSha(worktree.worktreePath, "HEAD");
  const cacheKey = headSha ? `${worktree.worktreePath}\0${headSha}\0${baseBranch ?? ""}` : null;
  if (cacheKey) {
    const cached = getLandedCache().get(cacheKey);
    if (cached) return { ...cached, branch: worktree.branch };
  }

  const status = getRepoLandingStatus(worktree.worktreePath, { baseBranch });
  const landing: TaskDeliveryLanding = {
    landedOnBase: status.landedOnBase,
    commitsSinceBase: status.commitsSinceBase,
    branch: worktree.branch,
    baseBranch: status.baseBranch,
  };
  if (cacheKey && landing.landedOnBase === true) {
    rememberLanded(cacheKey, landing);
  }
  return landing;
}
