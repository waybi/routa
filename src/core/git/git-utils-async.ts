/**
 * Async git helpers for HTTP request paths.
 *
 * Twins of the synchronous functions in git-utils.ts. They run git through
 * `execFile` so the Node event loop keeps serving other requests while git
 * works (the sync versions block it for the whole duration, e.g. ~3 s for
 * `git pull`). Return values and error handling mirror the sync versions;
 * the sync versions stay for scripts and other non-request callers.
 */

import {
  MAX_CHANGED_FILES_WITH_DETAILED_STATS,
  MAX_UNTRACKED_FILES_WITH_SYNTHETIC_STATS,
  buildSyntheticAddedDiff,
  buildSyntheticRenameDiff,
  countDiffPatchLines,
  isGitHubUrl,
  parseGitStatusPorcelain,
  parseNumstat,
  parseNumstatToMap,
  repoChangesCache,
  type BranchStatus,
  type GitFileChange,
  type RepoBranchInfo,
  type RepoChanges,
  type RepoDeliveryStatus,
  type RepoStatus,
} from "./git-utils";
import { gitExecAsync } from "@/core/utils/safe-exec";

async function git(args: string[], cwd: string): Promise<string> {
  // Keep leading whitespace: `git status --porcelain` encodes state in columns.
  return (await gitExecAsync(args, { cwd })).trimEnd();
}

async function hasGitRef(repoPath: string, ref: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--verify", ref], repoPath);
    return true;
  } catch {
    return false;
  }
}

export async function isRefAncestorAsync(repoPath: string, ref: string, descendant: string): Promise<boolean> {
  try {
    await git(["merge-base", "--is-ancestor", ref, descendant], repoPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveBaseRef(repoPath: string, baseBranch?: string | null): Promise<string | undefined> {
  const normalizedBaseBranch = baseBranch?.trim();
  const candidates = Array.from(new Set([
    normalizedBaseBranch ? `origin/${normalizedBaseBranch}` : null,
    normalizedBaseBranch ?? null,
    "origin/main",
    "main",
    "origin/master",
    "master",
  ].filter((candidate): candidate is string => Boolean(candidate))));

  for (const candidate of candidates) {
    if (await hasGitRef(repoPath, candidate)) return candidate;
  }
  return undefined;
}

export async function isGitRepositoryAsync(dir: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--git-dir"], dir);
    return true;
  } catch {
    return false;
  }
}

export async function isBareGitRepositoryAsync(dir: string): Promise<boolean> {
  try {
    return (await git(["rev-parse", "--is-bare-repository"], dir)) === "true";
  } catch {
    return false;
  }
}

async function supportsGitWorktreeOperations(repoPath: string): Promise<boolean> {
  return (await isGitRepositoryAsync(repoPath)) && !(await isBareGitRepositoryAsync(repoPath));
}

export async function getCurrentBranchAsync(repoPath: string): Promise<string | null> {
  try {
    return (await git(["rev-parse", "--abbrev-ref", "HEAD"], repoPath)) || null;
  } catch {
    return null;
  }
}

export async function getShortHeadAsync(repoPath: string): Promise<string | null> {
  try {
    return (await git(["rev-parse", "--short", "HEAD"], repoPath)) || null;
  } catch {
    return null;
  }
}

export async function listBranchesAsync(repoPath: string): Promise<string[]> {
  try {
    const output = await git(["branch", "--format=%(refname:short)"], repoPath);
    return output.split("\n").map((b) => b.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function listRemoteBranchesAsync(repoPath: string): Promise<string[]> {
  try {
    const output = await git(["branch", "-r", "--format=%(refname:short)"], repoPath);
    return output
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean)
      .filter((b) => !b.includes("HEAD"))
      .map((b) => b.replace(/^origin\//, ""));
  } catch {
    return [];
  }
}

export async function getBranchInfoAsync(repoPath: string): Promise<RepoBranchInfo> {
  const [current, branches] = await Promise.all([
    getCurrentBranchAsync(repoPath),
    listBranchesAsync(repoPath),
  ]);
  return { current: current ?? "unknown", branches };
}

export async function checkoutBranchAsync(repoPath: string, branch: string): Promise<boolean> {
  if (!(await supportsGitWorktreeOperations(repoPath))) return false;
  try {
    await git(["checkout", branch], repoPath);
    return true;
  } catch {
    try {
      await git(["checkout", "-b", branch], repoPath);
      return true;
    } catch {
      return false;
    }
  }
}

export async function deleteBranchAsync(
  repoPath: string,
  branch: string,
): Promise<{ success: boolean; error?: string }> {
  const currentBranch = await getCurrentBranchAsync(repoPath);
  if (currentBranch === branch) {
    return { success: false, error: `Cannot delete the current branch '${branch}'` };
  }
  const localBranches = await listBranchesAsync(repoPath);
  if (!localBranches.includes(branch)) {
    return { success: false, error: `Branch '${branch}' not found` };
  }
  try {
    await git(["branch", "-D", branch], repoPath);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : `Failed to delete branch '${branch}'`,
    };
  }
}

export async function getRepoStatusAsync(repoPath: string): Promise<RepoStatus> {
  const status: RepoStatus = { clean: true, ahead: 0, behind: 0, modified: 0, untracked: 0 };

  if (await supportsGitWorktreeOperations(repoPath)) {
    try {
      const output = await git(["status", "--porcelain", "-uall"], repoPath);
      const lines = output.split("\n").filter(Boolean);
      status.modified = lines.filter((l) => !l.startsWith("??")).length;
      status.untracked = lines.filter((l) => l.startsWith("??")).length;
      status.clean = lines.length === 0;
    } catch {
      // ignore
    }
  }

  try {
    const aheadBehind = await git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], repoPath);
    const [ahead, behind] = aheadBehind.split(/\s+/).map(Number);
    status.ahead = ahead || 0;
    status.behind = behind || 0;
  } catch {
    // no upstream
  }

  return status;
}

export async function getBranchStatusAsync(repoPath: string, branch: string): Promise<BranchStatus> {
  const result: BranchStatus = { ahead: 0, behind: 0, hasUncommittedChanges: false };

  try {
    const aheadBehind = await git(
      ["rev-list", "--left-right", "--count", `${branch}...origin/${branch}`],
      repoPath,
    );
    const [ahead, behind] = aheadBehind.split(/\s+/).map(Number);
    result.ahead = ahead || 0;
    result.behind = behind || 0;
  } catch {
    // no upstream or branch doesn't exist on remote - expected
  }

  if (await supportsGitWorktreeOperations(repoPath)) {
    try {
      const status = await git(["status", "--porcelain", "-uall"], repoPath);
      result.hasUncommittedChanges = status.trim().length > 0;
    } catch {
      // ignore
    }
  }

  return result;
}

export async function fetchRemoteAsync(repoPath: string): Promise<boolean> {
  try {
    await git(["fetch", "--all", "--prune"], repoPath);
    return true;
  } catch {
    return false;
  }
}

export async function pullBranchAsync(repoPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    await git(["pull", "--ff-only"], repoPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Pull failed" };
  }
}

export async function resetLocalChangesAsync(repoPath: string): Promise<{ success: boolean; error?: string }> {
  if (!(await supportsGitWorktreeOperations(repoPath))) {
    return { success: false, error: "Repository path points to a bare git repo. Reset requires a worktree." };
  }
  try {
    await git(["reset", "--hard", "HEAD"], repoPath);
    await git(["clean", "-fd"], repoPath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Reset failed" };
  }
}

export async function getRemoteUrlAsync(repoPath: string): Promise<string | null> {
  try {
    return (await git(["remote", "get-url", "origin"], repoPath)) || null;
  } catch {
    return null;
  }
}

// ─── Changes (file list + line stats) ───────────────────────────────────

const NUMSTAT_BASE = ["--no-pager", "diff", "--no-ext-diff", "--find-renames", "--find-copies"];

async function batchGetRepoFileStats(
  repoPath: string,
): Promise<Map<string, { additions: number; deletions: number }>> {
  const commands = [
    [...NUMSTAT_BASE, "--numstat"],
    [...NUMSTAT_BASE, "--cached", "--numstat"],
    [...NUMSTAT_BASE, "HEAD", "--numstat"],
  ];
  const combined = new Map<string, { additions: number; deletions: number }>();
  for (const command of commands) {
    try {
      const output = await git(command, repoPath);
      if (output.trim()) {
        for (const [filePath, stat] of parseNumstatToMap(output).entries()) {
          if (!combined.has(filePath)) combined.set(filePath, stat);
        }
      }
    } catch {
      // try next command
    }
  }
  return combined;
}

async function getFirstNonEmptyGitDiff(repoPath: string, commands: string[][]): Promise<string> {
  for (const command of commands) {
    try {
      const patch = await git(command, repoPath);
      if (patch.trim()) return patch;
    } catch {
      // try next variant
    }
  }
  return "";
}

async function getRepoFileLineStats(
  repoPath: string,
  file: GitFileChange,
): Promise<{ additions: number; deletions: number }> {
  const numstat = await getFirstNonEmptyGitDiff(repoPath, [
    [...NUMSTAT_BASE, "--numstat", "--", file.path],
    [...NUMSTAT_BASE, "--cached", "--numstat", "--", file.path],
    [...NUMSTAT_BASE, "HEAD", "--numstat", "--", file.path],
  ]);
  const parsed = parseNumstat(numstat);
  if (parsed) return parsed;

  if (file.status === "untracked" || file.status === "added") {
    return countDiffPatchLines(buildSyntheticAddedDiff(repoPath, file));
  }
  if (file.status === "renamed" && file.previousPath) {
    return countDiffPatchLines(buildSyntheticRenameDiff(file));
  }
  return { additions: 0, deletions: 0 };
}

export async function getRepoChangesAsync(repoPath: string): Promise<RepoChanges> {
  const cacheKey = `${repoPath}:${Math.floor(Date.now() / 5000)}`;
  const cached = repoChangesCache.get(cacheKey);
  if (cached) return cached;

  const branch = (await getCurrentBranchAsync(repoPath)) ?? "unknown";
  const status = await getRepoStatusAsync(repoPath);

  if (!(await supportsGitWorktreeOperations(repoPath))) {
    return { branch, status, files: [] };
  }

  try {
    const output = await git(["status", "--porcelain", "-uall"], repoPath);
    const parsedFiles = parseGitStatusPorcelain(output);
    const batchStats = await batchGetRepoFileStats(repoPath);

    let syntheticUntrackedStatsCount = 0;
    let totalStatsCalculated = 0;
    const files: GitFileChange[] = [];

    for (const file of parsedFiles) {
      if (totalStatsCalculated >= MAX_CHANGED_FILES_WITH_DETAILED_STATS) {
        files.push(file);
        continue;
      }
      const batchStat = batchStats.get(file.path);
      if (batchStat) {
        totalStatsCalculated++;
        files.push({ ...file, ...batchStat });
        continue;
      }
      if (file.status === "untracked") {
        syntheticUntrackedStatsCount += 1;
        if (syntheticUntrackedStatsCount > MAX_UNTRACKED_FILES_WITH_SYNTHETIC_STATS) {
          files.push(file);
          continue;
        }
      }
      try {
        totalStatsCalculated++;
        files.push({ ...file, ...(await getRepoFileLineStats(repoPath, file)) });
      } catch {
        files.push(file);
      }
    }

    const result: RepoChanges = { branch, status, files };
    repoChangesCache.set(cacheKey, result);
    return result;
  } catch {
    return { branch, status, files: [] };
  }
}

// ─── Delivery status ────────────────────────────────────────────────────

async function resolveLandedOnBase(
  repoPath: string,
  baseRef: string | undefined,
  baseBranch: string | undefined,
): Promise<boolean | null> {
  if (!baseRef) return null;
  if (await isRefAncestorAsync(repoPath, "HEAD", baseRef)) return true;
  if (baseBranch && baseRef !== baseBranch && (await hasGitRef(repoPath, baseBranch))) {
    return isRefAncestorAsync(repoPath, "HEAD", baseBranch);
  }
  return false;
}

export async function hasBranchAuthoredCommitsOnHeadAsync(
  repoPath: string,
  branch: string | undefined,
  options?: { fallbackSha?: string | null },
): Promise<boolean> {
  const normalizedBranch = branch?.trim();
  if (normalizedBranch && normalizedBranch !== "unknown" && normalizedBranch !== "HEAD") {
    try {
      const reflog = await git(
        ["reflog", "show", "--format=%H %gs", `refs/heads/${normalizedBranch}`],
        repoPath,
      );
      for (const line of reflog.split("\n")) {
        const separator = line.indexOf(" ");
        if (separator <= 0) continue;
        const sha = line.slice(0, separator);
        const subject = line.slice(separator + 1);
        if (/^commit( \([^)]*\))?:/.test(subject) && (await isRefAncestorAsync(repoPath, sha, "HEAD"))) {
          return true;
        }
      }
    } catch {
      // Reflog unavailable; fall through to the recorded fallback sha.
    }
  }

  const fallbackSha = options?.fallbackSha?.trim();
  return Boolean(fallbackSha) && (await isRefAncestorAsync(repoPath, fallbackSha!, "HEAD"));
}

export async function getRepoDeliveryStatusAsync(
  repoPath: string,
  options?: {
    baseBranch?: string | null;
    sourceType?: "local" | "github";
    sourceUrl?: string | null;
  },
): Promise<RepoDeliveryStatus> {
  const branch = (await getCurrentBranchAsync(repoPath)) ?? "unknown";
  const status = await getRepoStatusAsync(repoPath);
  const remoteUrl = await getRemoteUrlAsync(repoPath);
  const baseRef = await resolveBaseRef(repoPath, options?.baseBranch);
  const normalizedBaseBranch = options?.baseBranch?.trim() || baseRef?.replace(/^origin\//, "");
  let commitsSinceBase = status.ahead;

  if (baseRef) {
    try {
      commitsSinceBase = Number.parseInt(
        await git(["rev-list", "--count", `${baseRef}..HEAD`], repoPath),
        10,
      ) || 0;
    } catch {
      commitsSinceBase = status.ahead;
    }
  }

  const hasUncommittedChanges = !status.clean || status.modified > 0 || status.untracked > 0;
  const isGitHubRepo = options?.sourceType === "github"
    || Boolean(options?.sourceUrl && isGitHubUrl(options.sourceUrl))
    || Boolean(remoteUrl && isGitHubUrl(remoteUrl));
  const hasCommitsSinceBase = commitsSinceBase > 0;
  const canCreatePullRequest = isGitHubRepo
    && hasCommitsSinceBase
    && !hasUncommittedChanges
    && Boolean(branch)
    && Boolean(normalizedBaseBranch)
    && branch !== normalizedBaseBranch;

  const landedOnBase = await resolveLandedOnBase(repoPath, baseRef, normalizedBaseBranch);

  return {
    branch,
    baseBranch: normalizedBaseBranch,
    baseRef,
    status,
    commitsSinceBase,
    hasCommitsSinceBase,
    hasUncommittedChanges,
    remoteUrl,
    isGitHubRepo,
    canCreatePullRequest,
    landedOnBase,
  };
}
