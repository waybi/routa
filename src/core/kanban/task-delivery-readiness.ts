import {
  getRepoDeliveryStatusAsync,
  hasBranchAuthoredCommitsOnHeadAsync,
  isBareGitRepositoryAsync,
  isGitRepositoryAsync,
  type RepoDeliveryStatus,
} from "@/core/git";
import type { KanbanDeliveryRules } from "@/core/models/kanban";
import type { Codebase } from "@/core/models/codebase";
import type { Task } from "@/core/models/task";
import type { Worktree } from "@/core/models/worktree";
import { DONE_WITHOUT_OWN_COMMITS_CATEGORIES, isAttentionResolutionInEffect } from "@/core/models/task-attention-resolution";
import { resolveTaskWorktreeTruth } from "./task-worktree-truth";

interface DeliverySystemLike {
  codebaseStore: {
    get(codebaseId: string): Promise<Codebase | undefined>;
    getDefault(workspaceId: string): Promise<Codebase | undefined>;
  };
  worktreeStore: {
    get(worktreeId: string): Promise<Worktree | undefined>;
  };
}

export interface TaskDeliveryReadiness {
  checked: boolean;
  repoPath?: string;
  branch?: string;
  baseBranch?: string;
  baseRef?: string;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
  commitsSinceBase: number;
  hasCommitsSinceBase: boolean;
  hasUncommittedChanges: boolean;
  isGitHubRepo: boolean;
  canCreatePullRequest: boolean;
  /**
   * HEAD reachable from the base branch (task branch has landed).
   * `null`/absent when the check could not run (no base ref, not a git repo, unchecked).
   */
  landedOnBase?: boolean | null;
  /**
   * The branch already landed on base (no commits left since base) and it
   * carries commits authored on the branch itself, so its work is delivered
   * rather than never started. Only evaluated when `landedOnBase === true`
   * and `hasCommitsSinceBase === false`; otherwise `false`/absent.
   */
  hasLandedOwnCommits?: boolean;
  /**
   * The Blocked resolver concluded the card's work is already on base
   * (attentionResolution landed / superseded, card 64f2e31c): it may enter
   * Done without commits of its own. Other targets ignore it.
   */
  resolvedAsDelivered?: boolean;
  reason?: string;
}

interface TaskRepoContext {
  repoPath: string;
  baseBranch?: string;
  codebase?: Codebase;
  requiresWorktree?: boolean;
}

async function resolveTaskRepoContext(
  task: Task,
  system: DeliverySystemLike,
): Promise<TaskRepoContext | null> {
  const truth = await resolveTaskWorktreeTruth(task, system);
  if (!truth) {
    return null;
  }

  return {
    repoPath: truth.repoPath,
    baseBranch: truth.baseBranch,
    codebase: truth.codebase,
    requiresWorktree: truth.source !== "task.worktreeId",
  };
}

function mapReadiness(
  context: TaskRepoContext,
  deliveryStatus: RepoDeliveryStatus,
): TaskDeliveryReadiness {
  return {
    checked: true,
    repoPath: context.repoPath,
    branch: deliveryStatus.branch,
    baseBranch: deliveryStatus.baseBranch,
    baseRef: deliveryStatus.baseRef,
    modified: deliveryStatus.status.modified,
    untracked: deliveryStatus.status.untracked,
    ahead: deliveryStatus.status.ahead,
    behind: deliveryStatus.status.behind,
    commitsSinceBase: deliveryStatus.commitsSinceBase,
    hasCommitsSinceBase: deliveryStatus.hasCommitsSinceBase,
    hasUncommittedChanges: deliveryStatus.hasUncommittedChanges,
    isGitHubRepo: deliveryStatus.isGitHubRepo,
    canCreatePullRequest: deliveryStatus.canCreatePullRequest,
    landedOnBase: deliveryStatus.landedOnBase,
    hasLandedOwnCommits: false,
  };
}

export async function buildTaskDeliveryReadiness(
  task: Task,
  system: DeliverySystemLike,
): Promise<TaskDeliveryReadiness> {
  const context = await resolveTaskRepoContext(task, system);
  if (!context) {
    return {
      checked: false,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: false,
      canCreatePullRequest: false,
      landedOnBase: null,
      hasLandedOwnCommits: false,
      reason: "Task has no linked repository or worktree.",
    };
  }

  if (!(await isGitRepositoryAsync(context.repoPath))) {
    return {
      checked: false,
      repoPath: context.repoPath,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: false,
      canCreatePullRequest: false,
      landedOnBase: null,
      hasLandedOwnCommits: false,
      reason: "Linked repository is missing or is not a git repository.",
    };
  }

  if (context.requiresWorktree && (await isBareGitRepositoryAsync(context.repoPath))) {
    return {
      checked: false,
      repoPath: context.repoPath,
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: false,
      canCreatePullRequest: false,
      landedOnBase: null,
      hasLandedOwnCommits: false,
      reason: "Linked repository is a bare git repo. Attach a task worktree before checking delivery readiness.",
    };
  }

  const readiness = mapReadiness(
    context,
    await getRepoDeliveryStatusAsync(context.repoPath, {
      baseBranch: context.baseBranch,
      sourceType: context.codebase?.sourceType,
      sourceUrl: context.codebase?.sourceUrl,
    }),
  );

  // Stale conclusions (the card left Blocked / Done since) do not count.
  readiness.resolvedAsDelivered = DONE_WITHOUT_OWN_COMMITS_CATEGORIES.has(task.attentionResolution?.category ?? "")
    && isAttentionResolutionInEffect(task.attentionResolution, task);

  if (readiness.landedOnBase === true && !readiness.hasCommitsSinceBase) {
    readiness.hasLandedOwnCommits = await hasBranchAuthoredCommitsOnHeadAsync(
      context.repoPath,
      readiness.branch,
      { fallbackSha: task.deliverySnapshot?.headSha },
    );
  }

  return readiness;
}

function formatBaseReference(readiness: TaskDeliveryReadiness): string {
  return readiness.baseRef ?? readiness.baseBranch ?? "the base branch";
}

export function hasDeliveryRules(
  rules: KanbanDeliveryRules | undefined,
): rules is KanbanDeliveryRules {
  return Boolean(
    rules
    && (rules.requireCommittedChanges
      || rules.requireCleanWorktree
      || rules.requirePullRequestReady),
  );
}

export function buildTaskDeliveryTransitionErrorFromRules(
  readiness: TaskDeliveryReadiness,
  targetColumnName: string,
  rules: KanbanDeliveryRules | undefined,
  targetStage?: string,
): string | null {
  if (!hasDeliveryRules(rules)) {
    return null;
  }

  if (!readiness.checked) {
    if (!readiness.reason || readiness.reason === "Task has no linked repository or worktree.") {
      return null;
    }

    return `Cannot move task to "${targetColumnName}": ${readiness.reason}`;
  }

  // A branch that already fast-forwarded into base has zero commits left
  // since base, yet its own work is delivered; accept it as committed.
  // Only the Done stage accepts the resolver's landed / superseded conclusion.
  const landedOwnCommits = (readiness.landedOnBase === true && readiness.hasLandedOwnCommits === true)
    || (targetStage === "done" && readiness.resolvedAsDelivered === true);

  if (rules.requireCommittedChanges && !readiness.hasCommitsSinceBase && !landedOwnCommits) {
    return `Cannot move task to "${targetColumnName}": no committed changes detected on branch "${readiness.branch ?? "unknown"}" relative to "${formatBaseReference(readiness)}". Commit your implementation before requesting review.`;
  }

  if (rules.requireCleanWorktree && readiness.hasUncommittedChanges) {
    const transitionAction = rules.requirePullRequestReady
      ? "marking the task done"
      : "requesting review";
    return `Cannot move task to "${targetColumnName}": branch "${readiness.branch ?? "unknown"}" still has uncommitted changes (${readiness.modified} modified, ${readiness.untracked} untracked). Commit the current card's work, then stash or restore unrelated leftovers before ${transitionAction}.`;
  }

  if (
    rules.requirePullRequestReady
    && readiness.isGitHubRepo
    && !readiness.canCreatePullRequest
    && !landedOwnCommits
  ) {
    const baseBranch = readiness.baseBranch ?? "the base branch";
    return `Cannot move task to "${targetColumnName}": GitHub repo is not PR-ready yet. Use a feature branch instead of "${baseBranch}" so this task can open a pull request cleanly.`;
  }

  return null;
}

export function buildTaskDeliveryTransitionError(
  readiness: TaskDeliveryReadiness,
  targetColumnName: string,
  targetColumnId: string,
): string | null {
  const rules: KanbanDeliveryRules | undefined = targetColumnId === "review"
    ? {
        requireCommittedChanges: true,
        requireCleanWorktree: true,
      }
    : targetColumnId === "done"
    ? {
        requireCommittedChanges: true,
        requireCleanWorktree: true,
        requirePullRequestReady: true,
      }
    : undefined;

  return buildTaskDeliveryTransitionErrorFromRules(readiness, targetColumnName, rules, targetColumnId);
}
