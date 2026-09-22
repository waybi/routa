import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask } from "@/core/models/task";
import { buildTaskDeliveryLanding, shouldProbeTaskDeliveryLanding } from "../task-delivery-landing";

const isGitRepository = vi.fn();
const getRepoLandingStatus = vi.fn();

vi.mock("@/core/git", () => ({
  isGitRepository: (...args: unknown[]) => isGitRepository(...args),
  getRepoLandingStatus: (...args: unknown[]) => getRepoLandingStatus(...args),
}));

function system(worktree?: Record<string, unknown>, codebase?: Record<string, unknown>) {
  return {
    codebaseStore: { get: vi.fn().mockResolvedValue(codebase) },
    worktreeStore: { get: vi.fn().mockResolvedValue(worktree) },
  };
}

const worktree = {
  id: "wt-1",
  codebaseId: "codebase-1",
  worktreePath: "/repo/worktrees/task-1",
  branch: "issue/task-1",
  baseBranch: "feat/base",
};

describe("task delivery landing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isGitRepository.mockReturnValue(true);
    getRepoLandingStatus.mockReturnValue({
      baseBranch: "feat/base",
      baseRef: "feat/base",
      commitsSinceBase: 2,
      landedOnBase: false,
    });
  });

  it("only probes done cards that have a worktree", () => {
    expect(shouldProbeTaskDeliveryLanding({ columnId: "done", worktreeId: "wt-1" })).toBe(true);
    expect(shouldProbeTaskDeliveryLanding({ columnId: "review", worktreeId: "wt-1" })).toBe(false);
    expect(shouldProbeTaskDeliveryLanding({ columnId: "done", worktreeId: undefined })).toBe(false);
  });

  it("skips the git probe entirely for non-done cards", async () => {
    const task = createTask({ id: "t", title: "t", objective: "o", workspaceId: "w", worktreeId: "wt-1", columnId: "dev" });
    const sys = system(worktree);

    expect(await buildTaskDeliveryLanding(task, sys)).toBeUndefined();
    expect(sys.worktreeStore.get).not.toHaveBeenCalled();
    expect(getRepoLandingStatus).not.toHaveBeenCalled();
  });

  it("reports an unmerged done card from the worktree's base branch", async () => {
    const task = createTask({ id: "t", title: "t", objective: "o", workspaceId: "w", worktreeId: "wt-1", columnId: "done" });
    const sys = system(worktree);

    const landing = await buildTaskDeliveryLanding(task, sys);

    expect(getRepoLandingStatus).toHaveBeenCalledWith("/repo/worktrees/task-1", { baseBranch: "feat/base" });
    expect(landing).toEqual({
      landedOnBase: false,
      commitsSinceBase: 2,
      branch: "issue/task-1",
      baseBranch: "feat/base",
    });
    // Base came from the worktree; no need to load the codebase.
    expect(sys.codebaseStore.get).not.toHaveBeenCalled();
  });

  it("falls back to the codebase branch when the worktree has no base", async () => {
    const task = createTask({ id: "t", title: "t", objective: "o", workspaceId: "w", worktreeId: "wt-1", columnId: "done" });
    const sys = system({ ...worktree, baseBranch: undefined }, { id: "codebase-1", branch: "main" });
    getRepoLandingStatus.mockReturnValue({ baseBranch: "main", baseRef: "origin/main", commitsSinceBase: 0, landedOnBase: true });

    const landing = await buildTaskDeliveryLanding(task, sys);

    expect(getRepoLandingStatus).toHaveBeenCalledWith("/repo/worktrees/task-1", { baseBranch: "main" });
    expect(landing?.landedOnBase).toBe(true);
  });

  it("returns undefined when the worktree is gone or not a git repo", async () => {
    const task = createTask({ id: "t", title: "t", objective: "o", workspaceId: "w", worktreeId: "wt-1", columnId: "done" });

    expect(await buildTaskDeliveryLanding(task, system(undefined))).toBeUndefined();
    isGitRepository.mockReturnValue(false);
    expect(await buildTaskDeliveryLanding(task, system(worktree))).toBeUndefined();
    expect(getRepoLandingStatus).not.toHaveBeenCalled();
  });
});
