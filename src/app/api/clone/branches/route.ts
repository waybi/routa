/**
 * Branch Management API Route - /api/clone/branches
 *
 * GET /api/clone/branches?repoPath=...
 *   Returns: { current, local, remote, status }
 *
 * POST /api/clone/branches - Fetch remote branches then return all
 *   Body: { repoPath: string }
 *   Returns: { current, local, remote, status }
 *
 * PATCH /api/clone/branches - Checkout a branch or reset local changes
 *   Body: { repoPath: string, branch: string }
 *   Returns: { success, branch, branches }
 *
 * DELETE /api/clone/branches - Delete a local branch
 *   Body: { repoPath: string, branch: string }
 *   Returns: { success, deletedBranch, current, branches }
 */

import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getRoutaSystem } from "@/core/routa-system";
import {
  getCurrentBranchAsync,
  listBranchesAsync,
  listRemoteBranchesAsync,
  fetchRemoteAsync,
  getBranchStatusAsync,
  checkoutBranchAsync,
  deleteBranchAsync,
  pullBranchAsync,
  runExclusiveForRepo,
  getBranchInfoAsync,
  getRepoStatusAsync,
  resetLocalChangesAsync,
  isBareGitRepositoryAsync,
} from "@/core/git";

export async function GET(request: NextRequest) {
  const repoPath = request.nextUrl.searchParams.get("repoPath");
  if (!repoPath || !fs.existsSync(repoPath)) {
    return NextResponse.json(
      { error: "Missing or invalid repoPath" },
      { status: 400 }
    );
  }

  const current = await getCurrentBranchAsync(repoPath) ?? "unknown";
  const local = await listBranchesAsync(repoPath);
  const remote = await listRemoteBranchesAsync(repoPath);
  const status = await getBranchStatusAsync(repoPath, current);

  return NextResponse.json({ current, local, remote, status });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { repoPath } = body as { repoPath?: string };

  if (!repoPath || !fs.existsSync(repoPath)) {
    return NextResponse.json(
      { error: "Missing or invalid repoPath" },
      { status: 400 }
    );
  }

  // Fetch remote, then return all branches
  await fetchRemoteAsync(repoPath);

  const current = await getCurrentBranchAsync(repoPath) ?? "unknown";
  const local = await listBranchesAsync(repoPath);
  const remote = await listRemoteBranchesAsync(repoPath);
  const status = await getBranchStatusAsync(repoPath, current);

  return NextResponse.json({ current, local, remote, status });
}

type PatchBody = {
  repoPath?: string;
  branch?: string;
  pull?: boolean;
  action?: "checkout" | "reset";
};

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as PatchBody;
  // Async git calls no longer serialize the whole process, so requests that
  // change one working tree take turns instead of racing on .git/index.lock.
  if (typeof body.repoPath === "string" && body.repoPath) {
    return runExclusiveForRepo(body.repoPath, () => handlePatch(body));
  }
  return handlePatch(body);
}

async function handlePatch(body: PatchBody) {
  const { repoPath, branch, pull: doPull, action } = body;

  if (!repoPath) {
    return NextResponse.json(
      { error: "Missing repoPath" },
      { status: 400 }
    );
  }
  if (!fs.existsSync(repoPath)) {
    return NextResponse.json(
      { error: "Repository not found" },
      { status: 404 }
    );
  }
  if (await isBareGitRepositoryAsync(repoPath)) {
    return NextResponse.json(
      {
        error: "This repository is a bare git repository (no working directory)",
        suggestion: "Bare repos can't be checked out or synced. Use them as worktree sources instead, or clone a regular working copy."
      },
      { status: 400 }
    );
  }

  if (action === "reset") {
    const result = await resetLocalChangesAsync(repoPath);
    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to reset local changes" },
        { status: 500 }
      );
    }

    const branchInfo = await getBranchInfoAsync(repoPath);
    const status = await getBranchStatusAsync(repoPath, branchInfo.current);
    const repoStatus = await getRepoStatusAsync(repoPath);

    return NextResponse.json({
      success: true,
      action: "reset",
      branch: branchInfo.current,
      branches: branchInfo.branches,
      status,
      repoStatus,
    });
  }

  if (!branch) {
    return NextResponse.json(
      { error: "Missing branch" },
      { status: 400 }
    );
  }

  const success = await checkoutBranchAsync(repoPath, branch);
  if (!success) {
    return NextResponse.json(
      { error: `Failed to checkout branch '${branch}'` },
      { status: 500 }
    );
  }

  // Optionally pull after checkout
  if (doPull) {
    await pullBranchAsync(repoPath);
  }

  const branchInfo = await getBranchInfoAsync(repoPath);
  const status = await getBranchStatusAsync(repoPath, branchInfo.current);
  const registrationsUpdated = await syncCodebaseRegistrationsToBranch(repoPath, branchInfo.current);

  return NextResponse.json({
    success: true,
    branch: branchInfo.current,
    branches: branchInfo.branches,
    status,
    registrationsUpdated,
  });
}

/**
 * Keep codebase registrations in step with a checkout made from the UI.
 *
 * The kanban page re-checks-out every registered codebase to its registered
 * branch on load, so a checkout that does not update the registration is
 * reverted the next time a board is opened. Any codebase (in any workspace)
 * whose repoPath is this checkout follows the new branch.
 */
async function syncCodebaseRegistrationsToBranch(repoPath: string, branch: string): Promise<number> {
  if (!branch) return 0;
  try {
    const target = path.resolve(repoPath);
    const system = getRoutaSystem();
    const workspaces = await system.workspaceStore.list();
    let updated = 0;
    for (const workspace of workspaces) {
      const codebases = await system.codebaseStore.listByWorkspace(workspace.id);
      for (const codebase of codebases) {
        if (!codebase.repoPath || path.resolve(codebase.repoPath) !== target) continue;
        if (codebase.branch === branch) continue;
        await system.codebaseStore.update(codebase.id, { branch });
        updated += 1;
      }
    }
    return updated;
  } catch {
    // The checkout itself succeeded; a registration sync failure must not turn it into an error.
    return 0;
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { repoPath, branch } = body as {
    repoPath?: string;
    branch?: string;
  };

  if (!repoPath) {
    return NextResponse.json(
      { error: "Missing repoPath" },
      { status: 400 }
    );
  }
  if (!fs.existsSync(repoPath)) {
    return NextResponse.json(
      { error: "Repository not found" },
      { status: 404 }
    );
  }
  if (!branch) {
    return NextResponse.json(
      { error: "Missing branch" },
      { status: 400 }
    );
  }
  if (await isBareGitRepositoryAsync(repoPath)) {
    return NextResponse.json(
      {
        error: "This repository is a bare git repository (no working directory)",
        suggestion: "Bare repos can't be used for branch operations. Use a worktree or regular working copy instead."
      },
      { status: 400 }
    );
  }

  const result = await deleteBranchAsync(repoPath, branch);
  if (!result.success) {
    const status = result.error?.includes("current branch")
      ? 409
      : result.error?.includes("not found")
        ? 404
        : 500;
    return NextResponse.json(
      { error: result.error ?? `Failed to delete branch '${branch}'` },
      { status }
    );
  }

  const branchInfo = await getBranchInfoAsync(repoPath);

  return NextResponse.json({
    success: true,
    deletedBranch: branch,
    current: branchInfo.current,
    branches: branchInfo.branches,
  });
}
