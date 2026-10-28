import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask } from "@/core/models/task";
import {
  buildTaskDeliveryReadiness,
  buildTaskDeliveryTransitionErrorFromRules,
  buildTaskDeliveryTransitionError,
} from "../task-delivery-readiness";

const isGitRepository = vi.fn();
const isBareGitRepository = vi.fn();
const getRepoDeliveryStatus = vi.fn();
const hasBranchAuthoredCommitsOnHead = vi.fn();

vi.mock("@/core/git", () => ({
  isGitRepository: (...args: unknown[]) => isGitRepository(...args),
  isBareGitRepository: (...args: unknown[]) => isBareGitRepository(...args),
  getRepoDeliveryStatus: (...args: unknown[]) => getRepoDeliveryStatus(...args),
  hasBranchAuthoredCommitsOnHead: (...args: unknown[]) => hasBranchAuthoredCommitsOnHead(...args),
  isGitRepositoryAsync: async (...args: unknown[]) => isGitRepository(...args),
  isBareGitRepositoryAsync: async (...args: unknown[]) => isBareGitRepository(...args),
  getRepoDeliveryStatusAsync: async (...args: unknown[]) => getRepoDeliveryStatus(...args),
  hasBranchAuthoredCommitsOnHeadAsync: async (...args: unknown[]) => hasBranchAuthoredCommitsOnHead(...args),
}));

describe("task delivery readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isBareGitRepository.mockReturnValue(false);
  });

  it("returns unchecked when no codebase or worktree is linked", async () => {
    const task = createTask({
      id: "task-1",
      title: "No repo",
      objective: "Nothing linked yet",
      workspaceId: "workspace-1",
    });
    const system = {
      codebaseStore: {
        get: vi.fn(),
        getDefault: vi.fn().mockResolvedValue(undefined),
      },
      worktreeStore: {
        get: vi.fn(),
      },
    };

    const readiness = await buildTaskDeliveryReadiness(task, system);

    expect(readiness.checked).toBe(false);
    expect(readiness.landedOnBase).toBeNull();
    expect(readiness.reason).toContain("no linked repository");
    expect(isGitRepository).not.toHaveBeenCalled();
  });

  it("uses the task worktree as the delivery source and marks GitHub branches as PR-ready", async () => {
    const task = createTask({
      id: "task-1",
      title: "Feature branch ready",
      objective: "Ready to ship",
      workspaceId: "workspace-1",
      worktreeId: "wt-1",
      codebaseIds: ["codebase-1"],
    });
    const system = {
      codebaseStore: {
        get: vi.fn().mockResolvedValue({
          id: "codebase-1",
          repoPath: "/repo/main",
          branch: "main",
          sourceType: "github",
          sourceUrl: "https://github.com/acme/platform",
        }),
        getDefault: vi.fn(),
      },
      worktreeStore: {
        get: vi.fn().mockResolvedValue({
          id: "wt-1",
          codebaseId: "codebase-1",
          workspaceId: "workspace-1",
          worktreePath: "/repo/worktrees/task-1",
          branch: "issue/task-1",
          baseBranch: "main",
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };
    isGitRepository.mockReturnValue(true);
    getRepoDeliveryStatus.mockReturnValue({
      branch: "issue/task-1",
      baseBranch: "main",
      baseRef: "origin/main",
      status: {
        clean: true,
        ahead: 1,
        behind: 0,
        modified: 0,
        untracked: 0,
      },
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: false,
      remoteUrl: "git@github.com:acme/platform.git",
      isGitHubRepo: true,
      canCreatePullRequest: true,
      landedOnBase: false,
    });

    const readiness = await buildTaskDeliveryReadiness(task, system);

    expect(readiness.landedOnBase).toBe(false);
    expect(isGitRepository).toHaveBeenCalledWith("/repo/worktrees/task-1");
    expect(getRepoDeliveryStatus).toHaveBeenCalledWith("/repo/worktrees/task-1", {
      baseBranch: "main",
      sourceType: "github",
      sourceUrl: "https://github.com/acme/platform",
    });
    expect(readiness).toMatchObject({
      checked: true,
      repoPath: "/repo/worktrees/task-1",
      branch: "issue/task-1",
      commitsSinceBase: 1,
      canCreatePullRequest: true,
    });
  });

  it("returns unchecked when the fallback codebase path is a bare repo", async () => {
    const task = createTask({
      id: "task-2",
      title: "Bare repo fallback",
      objective: "Needs a worktree first",
      workspaceId: "workspace-1",
      codebaseIds: ["codebase-1"],
    });
    const system = {
      codebaseStore: {
        get: vi.fn().mockResolvedValue({
          id: "codebase-1",
          repoPath: "/repo/bare",
          branch: "main",
          sourceType: "github",
          sourceUrl: "https://github.com/acme/platform",
        }),
        getDefault: vi.fn(),
      },
      worktreeStore: {
        get: vi.fn(),
      },
    };
    isGitRepository.mockReturnValue(true);
    isBareGitRepository.mockReturnValue(true);

    const readiness = await buildTaskDeliveryReadiness(task, system);

    expect(readiness.checked).toBe(false);
    expect(readiness.repoPath).toBe("/repo/bare");
    expect(readiness.reason).toContain("bare git repo");
    expect(getRepoDeliveryStatus).not.toHaveBeenCalled();
  });

  it("formats blocking messages for review and done transitions", () => {
    const reviewError = buildTaskDeliveryTransitionError({
      checked: true,
      branch: "issue/task-1",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    }, "Review", "review");
    const reviewDirtyError = buildTaskDeliveryTransitionError({
      checked: true,
      branch: "issue/task-1",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 2,
      untracked: 1,
      ahead: 1,
      behind: 0,
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: true,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    }, "Review", "review");
    const doneError = buildTaskDeliveryTransitionError({
      checked: true,
      branch: "issue/task-1",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 2,
      untracked: 1,
      ahead: 1,
      behind: 0,
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: true,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    }, "Done", "done");

    expect(reviewError).toContain("no committed changes detected");
    expect(reviewDirtyError).toContain("uncommitted changes");
    expect(reviewDirtyError).toContain("before requesting review");
    expect(reviewDirtyError).toContain("stash or restore unrelated leftovers");
    expect(doneError).toContain("uncommitted changes");
  });

  it("evaluates configurable delivery rules without relying on hard-coded column ids", () => {
    const reviewLikeError = buildTaskDeliveryTransitionErrorFromRules({
      checked: true,
      branch: "issue/task-2",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    }, "QA Gate", {
      requireCommittedChanges: true,
      requireCleanWorktree: true,
    });

    const doneLikeError = buildTaskDeliveryTransitionErrorFromRules({
      checked: true,
      branch: "main",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 1,
      behind: 0,
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    }, "Release", {
      requireCommittedChanges: true,
      requireCleanWorktree: true,
      requirePullRequestReady: true,
    });

    expect(reviewLikeError).toContain("no committed changes detected");
    expect(doneLikeError).toContain("GitHub repo is not PR-ready yet");
  });

  describe("task branch already landed on base", () => {
    const landedReadiness = {
      checked: true,
      branch: "issue/d636956a",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 0,
      behind: 0,
      commitsSinceBase: 0,
      hasCommitsSinceBase: false,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: false,
      landedOnBase: true,
      hasLandedOwnCommits: true,
    };
    const doneRules = {
      requireCommittedChanges: true,
      requireCleanWorktree: true,
      requirePullRequestReady: true,
    };

    it("accepts a clean branch whose own commits already landed on base", () => {
      expect(buildTaskDeliveryTransitionErrorFromRules(landedReadiness, "Review", {
        requireCommittedChanges: true,
        requireCleanWorktree: true,
      })).toBeNull();
      expect(buildTaskDeliveryTransitionErrorFromRules(landedReadiness, "Done", doneRules)).toBeNull();
    });

    it("still rejects a landed branch that has uncommitted changes", () => {
      const error = buildTaskDeliveryTransitionErrorFromRules({
        ...landedReadiness,
        modified: 1,
        hasUncommittedChanges: true,
      }, "Done", doneRules);
      expect(error).toContain("uncommitted changes");
    });

    it("still reports no committed changes when the branch has not landed", () => {
      for (const landedOnBase of [false, null]) {
        const error = buildTaskDeliveryTransitionErrorFromRules({
          ...landedReadiness,
          landedOnBase,
          hasLandedOwnCommits: false,
        }, "Review", { requireCommittedChanges: true, requireCleanWorktree: true });
        expect(error).toContain("no committed changes detected");
      }
    });

    it("still reports no committed changes for a landed branch without any commits of its own", () => {
      const error = buildTaskDeliveryTransitionErrorFromRules({
        ...landedReadiness,
        hasLandedOwnCommits: false,
      }, "Review", { requireCommittedChanges: true, requireCleanWorktree: true });
      expect(error).toContain("no committed changes detected");
    });

    it("detects own landed commits only when the branch landed with nothing left since base", async () => {
      const task = createTask({
        id: "task-landed",
        title: "Landed",
        objective: "Already fast-forwarded",
        workspaceId: "workspace-1",
        worktreeId: "wt-landed",
        codebaseIds: ["codebase-1"],
      });
      task.deliverySnapshot = {
        capturedAt: new Date().toISOString(),
        repoPath: "/repo/worktrees/task-landed",
        baseRef: "origin/main",
        baseSha: "base-sha",
        headSha: "snapshot-head",
        commits: [],
        source: "review_transition",
      };
      const system = {
        codebaseStore: {
          get: vi.fn().mockResolvedValue({ id: "codebase-1", repoPath: "/repo/main", branch: "main" }),
          getDefault: vi.fn(),
        },
        worktreeStore: {
          get: vi.fn().mockResolvedValue({
            id: "wt-landed",
            codebaseId: "codebase-1",
            workspaceId: "workspace-1",
            worktreePath: "/repo/worktrees/task-landed",
            branch: "issue/task-landed",
            baseBranch: "main",
            status: "active",
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        },
      };
      isGitRepository.mockReturnValue(true);
      getRepoDeliveryStatus.mockReturnValue({
        branch: "issue/task-landed",
        baseBranch: "main",
        baseRef: "origin/main",
        status: { clean: true, ahead: 0, behind: 0, modified: 0, untracked: 0 },
        commitsSinceBase: 0,
        hasCommitsSinceBase: false,
        hasUncommittedChanges: false,
        remoteUrl: null,
        isGitHubRepo: false,
        canCreatePullRequest: false,
        landedOnBase: true,
      });
      hasBranchAuthoredCommitsOnHead.mockReturnValue(true);

      const readiness = await buildTaskDeliveryReadiness(task, system);

      expect(readiness.hasLandedOwnCommits).toBe(true);
      expect(hasBranchAuthoredCommitsOnHead).toHaveBeenCalledWith(
        "/repo/worktrees/task-landed",
        "issue/task-landed",
        { fallbackSha: "snapshot-head" },
      );

      hasBranchAuthoredCommitsOnHead.mockClear();
      getRepoDeliveryStatus.mockReturnValue({
        branch: "issue/task-landed",
        baseBranch: "main",
        baseRef: "origin/main",
        status: { clean: true, ahead: 0, behind: 0, modified: 0, untracked: 0 },
        commitsSinceBase: 0,
        hasCommitsSinceBase: false,
        hasUncommittedChanges: false,
        remoteUrl: null,
        isGitHubRepo: false,
        canCreatePullRequest: false,
        landedOnBase: false,
      });
      const notLanded = await buildTaskDeliveryReadiness(task, system);
      expect(notLanded.hasLandedOwnCommits).toBe(false);
      expect(hasBranchAuthoredCommitsOnHead).not.toHaveBeenCalled();
    });
  });
});
