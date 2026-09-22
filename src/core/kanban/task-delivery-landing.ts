import { getRepoLandingStatus, isGitRepository } from "@/core/git";
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

  const status = getRepoLandingStatus(worktree.worktreePath, { baseBranch });
  return {
    landedOnBase: status.landedOnBase,
    commitsSinceBase: status.commitsSinceBase,
    branch: worktree.branch,
    baseBranch: status.baseBranch,
  };
}
