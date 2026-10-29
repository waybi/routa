import { NextRequest } from "next/server";
import * as os from "os";
import * as path from "path";
import { rm } from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { existsSync } = vi.hoisted(() => ({
  existsSync: vi.fn<(path: string) => boolean>(),
}));

const gitMocks = vi.hoisted(() => ({
  getCurrentBranch: vi.fn(),
  listBranches: vi.fn(),
  listRemoteBranches: vi.fn(),
  fetchRemote: vi.fn(),
  getBranchStatus: vi.fn(),
  checkoutBranch: vi.fn(),
  deleteBranch: vi.fn(),
  pullBranch: vi.fn(),
  getBranchInfo: vi.fn(),
  getRepoStatus: vi.fn(),
  resetLocalChanges: vi.fn(),
  isBareGitRepository: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync,
}));

vi.mock("@/core/git", async () => {
  const cooldown = await import("@/core/git/pull-cooldown");
  const asyncOf = <T extends (...args: never[]) => unknown>(fn: T) =>
    async (...args: Parameters<T>) => fn(...args);
  return {
    ...gitMocks,
    getCurrentBranchAsync: asyncOf(gitMocks.getCurrentBranch),
    listBranchesAsync: asyncOf(gitMocks.listBranches),
    listRemoteBranchesAsync: asyncOf(gitMocks.listRemoteBranches),
    fetchRemoteAsync: asyncOf(gitMocks.fetchRemote),
    getBranchStatusAsync: asyncOf(gitMocks.getBranchStatus),
    checkoutBranchAsync: asyncOf(gitMocks.checkoutBranch),
    deleteBranchAsync: asyncOf(gitMocks.deleteBranch),
    pullBranchAsync: asyncOf(gitMocks.pullBranch),
    getBranchInfoAsync: asyncOf(gitMocks.getBranchInfo),
    getRepoStatusAsync: asyncOf(gitMocks.getRepoStatus),
    resetLocalChangesAsync: asyncOf(gitMocks.resetLocalChanges),
    isBareGitRepositoryAsync: asyncOf(gitMocks.isBareGitRepository),
    pullWithCooldown: cooldown.pullWithCooldown,
    runExclusiveForRepo: (await import("@/core/git/repo-lock")).runExclusiveForRepo,
  };
});

const systemMocks = vi.hoisted(() => ({
  workspaceList: vi.fn(),
  listByWorkspace: vi.fn(),
  codebaseUpdate: vi.fn(),
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({
    workspaceStore: { list: systemMocks.workspaceList },
    codebaseStore: {
      listByWorkspace: systemMocks.listByWorkspace,
      update: systemMocks.codebaseUpdate,
    },
  }),
}));

import { resetPullCooldown } from "@/core/git/pull-cooldown";
import { DELETE, PATCH } from "../route";

describe("/api/clone/branches DELETE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    gitMocks.isBareGitRepository.mockReturnValue(false);
    gitMocks.deleteBranch.mockReturnValue({ success: true });
    gitMocks.getBranchInfo.mockReturnValue({
      current: "main",
      branches: ["main", "feature/polish"],
    });
  });

  it("deletes a local branch and returns refreshed branch info", async () => {
    const request = new NextRequest("http://localhost/api/clone/branches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: "/tmp/repos/demo",
        branch: "issue/task-1",
      }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(gitMocks.deleteBranch).toHaveBeenCalledWith("/tmp/repos/demo", "issue/task-1");
    expect(data).toEqual({
      success: true,
      deletedBranch: "issue/task-1",
      current: "main",
      branches: ["main", "feature/polish"],
    });
  });

  it("returns conflict when deleting the current branch", async () => {
    gitMocks.deleteBranch.mockReturnValue({
      success: false,
      error: "Cannot delete the current branch 'main'",
    });

    const request = new NextRequest("http://localhost/api/clone/branches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: "/tmp/repos/demo",
        branch: "main",
      }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data).toEqual({
      error: "Cannot delete the current branch 'main'",
    });
  });

  it("rejects delete requests against bare repos", async () => {
    gitMocks.isBareGitRepository.mockReturnValue(true);

    const request = new NextRequest("http://localhost/api/clone/branches", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: "/tmp/repos/demo",
        branch: "issue/task-1",
      }),
    });

    const response = await DELETE(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(gitMocks.deleteBranch).not.toHaveBeenCalled();
    expect(data).toMatchObject({
      error: expect.stringContaining("bare git repository"),
    });
  });
});

describe("/api/clone/branches PATCH", () => {
  let cooldownFile = "";
  let fileSeq = 0;
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(cooldownFile, { force: true });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    existsSync.mockReturnValue(true);
    gitMocks.isBareGitRepository.mockReturnValue(false);
    gitMocks.checkoutBranch.mockReturnValue(true);
    gitMocks.pullBranch.mockReturnValue({ success: true });
    resetPullCooldown();
    cooldownFile = path.join(os.tmpdir(), `routa-route-test-${process.pid}-${++fileSeq}-cooldown.json`);
    vi.stubEnv("ROUTA_PULL_COOLDOWN_FILE", cooldownFile);
    gitMocks.getBranchInfo.mockReturnValue({
      current: "main",
      branches: ["main", "feature/polish"],
    });
    gitMocks.getBranchStatus.mockReturnValue({
      ahead: 0,
      behind: 0,
      hasUncommittedChanges: false,
    });
  });

  it("rejects checkout requests against bare repos", async () => {
    gitMocks.isBareGitRepository.mockReturnValue(true);

    const request = new NextRequest("http://localhost/api/clone/branches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: "/tmp/repos/demo",
        branch: "main",
      }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(gitMocks.checkoutBranch).not.toHaveBeenCalled();
    expect(data).toMatchObject({
      error: expect.stringContaining("bare git repository"),
    });
  });

  function checkoutRequest(repoPath: string, branch: string) {
    return new NextRequest("http://localhost/api/clone/branches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoPath, branch, pull: true }),
    });
  }

  it("moves every codebase registration of the checked-out repo to the new branch", async () => {
    gitMocks.getBranchInfo.mockReturnValue({ current: "master", branches: ["master", "dev"] });
    systemMocks.workspaceList.mockResolvedValue([{ id: "ws-a" }, { id: "ws-b" }]);
    systemMocks.listByWorkspace.mockImplementation(async (workspaceId: string) =>
      workspaceId === "ws-a"
        ? [
          { id: "cb-1", repoPath: "/tmp/repos/demo", branch: "feat/old" },
          { id: "cb-other", repoPath: "/tmp/repos/other", branch: "feat/old" },
        ]
        : [
          { id: "cb-2", repoPath: "/tmp/repos/demo/", branch: "feat/old" },
          { id: "cb-same", repoPath: "/tmp/repos/demo", branch: "master" },
        ],
    );

    const response = await PATCH(checkoutRequest("/tmp/repos/demo", "master"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(systemMocks.codebaseUpdate).toHaveBeenCalledTimes(2);
    expect(systemMocks.codebaseUpdate).toHaveBeenCalledWith("cb-1", { branch: "master" });
    expect(systemMocks.codebaseUpdate).toHaveBeenCalledWith("cb-2", { branch: "master" });
    expect(data).toMatchObject({ success: true, branch: "master", registrationsUpdated: 2 });
  });

  it("still reports a successful checkout when the registration sync fails", async () => {
    systemMocks.workspaceList.mockRejectedValue(new Error("db down"));

    const response = await PATCH(checkoutRequest("/tmp/repos/demo", "main"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ success: true, branch: "main", registrationsUpdated: 0 });
  });

  it("does not touch registrations when the checkout fails", async () => {
    gitMocks.checkoutBranch.mockReturnValue(false);

    const response = await PATCH(checkoutRequest("/tmp/repos/demo", "missing"));

    expect(response.status).toBe(500);
    expect(systemMocks.workspaceList).not.toHaveBeenCalled();
    expect(systemMocks.codebaseUpdate).not.toHaveBeenCalled();
  });
});
