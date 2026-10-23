import { execFile } from "child_process";
import type { RepoLandingStatus } from "./git-utils";

/**
 * Async, non-blocking counterpart of `getRepoLandingStatus` for the
 * `GET /api/tasks` hot path.
 *
 * The sync helpers in git-utils.ts run `execFileSync`, which parks the Node
 * main thread for every git process; with ~5 commands per done card and 100+
 * done cards, one task list blocked every other request for seconds (see
 * docs/issues/2026-04-09-next-task-api-head-of-line-blocking.md). Here every
 * git call is an async `execFile`, and the refs that decide the answer are
 * resolved once, in a single `git cat-file --batch-check`, so the caller can
 * key a cache on their shas.
 */

const GIT_MAX_BUFFER = 1024 * 1024;

export interface GitCommandError extends Error {
  code?: number | string;
}

export function runGitAsync(args: string[], cwd: string, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      { cwd, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout).trimEnd());
      },
    );
    if (input !== undefined) {
      child.stdin?.on("error", () => { /* git exited early; the callback reports it */ });
      child.stdin?.end(input);
    }
  });
}

/** Refs that fully determine a landing result, resolved to object ids. */
export interface LandingRefs {
  headSha: string | null;
  /** Name of the first candidate base ref that exists (same order as git-utils). */
  baseRef?: string;
  baseSha?: string;
  /** Requested base branch, or `baseRef` without `origin/`. */
  baseBranch?: string;
  /** Sha of the local `baseBranch` ref when it differs from `baseRef`. */
  localBaseSha?: string;
}

function baseRefCandidates(baseBranch?: string | null): string[] {
  const normalized = baseBranch?.trim();
  return Array.from(new Set([
    normalized ? `origin/${normalized}` : null,
    normalized ?? null,
    "origin/main",
    "main",
    "origin/master",
    "master",
  ].filter((candidate): candidate is string => Boolean(candidate))));
}

const OBJECT_ID = /^[0-9a-f]{40,64}$/;

/**
 * Resolve HEAD and every candidate base ref with one git process.
 * Returns `null` when `repoPath` is not a usable git repository.
 */
export async function readLandingRefs(
  repoPath: string,
  baseBranch?: string | null,
): Promise<LandingRefs | null> {
  const candidates = baseRefCandidates(baseBranch);
  const names = ["HEAD", ...candidates];
  let output: string;
  try {
    output = await runGitAsync(
      ["cat-file", "--batch-check=%(objectname)"],
      repoPath,
      `${names.join("\n")}\n`,
    );
  } catch {
    return null;
  }
  const lines = output.split("\n");
  const shas = new Map<string, string>();
  names.forEach((name, index) => {
    const line = lines[index]?.trim() ?? "";
    if (OBJECT_ID.test(line)) shas.set(name, line);
  });
  const baseRef = candidates.find((candidate) => shas.has(candidate));
  const normalizedBaseBranch = baseBranch?.trim() || baseRef?.replace(/^origin\//, "");
  const localBaseSha = normalizedBaseBranch && normalizedBaseBranch !== baseRef
    ? shas.get(normalizedBaseBranch)
    : undefined;
  return {
    headSha: shas.get("HEAD") ?? null,
    baseRef,
    baseSha: baseRef ? shas.get(baseRef) : undefined,
    baseBranch: normalizedBaseBranch,
    localBaseSha,
  };
}

/** `null` when git failed for a reason other than "not an ancestor". */
async function isAncestorAsync(repoPath: string, ref: string, descendant: string): Promise<boolean | null> {
  try {
    await runGitAsync(["merge-base", "--is-ancestor", ref, descendant], repoPath);
    return true;
  } catch (error) {
    return (error as GitCommandError).code === 1 ? false : null;
  }
}

export interface LandingComputation {
  status: RepoLandingStatus;
  /** False when a git command failed unexpectedly; such results must not be cached. */
  reliable: boolean;
}

/**
 * Compute `base..HEAD` and "HEAD reachable from base" from resolved shas, so
 * the answer belongs to exactly the refs in `refs` even if they move meanwhile.
 * Semantics match `getRepoLandingStatus`: on any failure the count is 0 and
 * the landing is `false`.
 */
export async function computeLandingFromRefs(repoPath: string, refs: LandingRefs): Promise<LandingComputation> {
  const head = refs.headSha ?? "HEAD";
  const status: RepoLandingStatus = {
    baseBranch: refs.baseBranch,
    baseRef: refs.baseRef,
    commitsSinceBase: 0,
    landedOnBase: null,
  };
  if (!refs.baseRef || !refs.baseSha) {
    return { status, reliable: refs.headSha !== null };
  }
  let reliable = refs.headSha !== null;
  // Sequential on purpose: callers cap concurrent probes, which then also caps
  // concurrent git processes.
  const count = await runGitAsync(["rev-list", "--count", `${refs.baseSha}..${head}`], repoPath).catch(() => null);
  const onBase = await isAncestorAsync(repoPath, head, refs.baseSha);
  if (count === null) reliable = false;
  status.commitsSinceBase = Number.parseInt(count ?? "", 10) || 0;
  if (onBase === null) reliable = false;
  if (onBase) {
    status.landedOnBase = true;
    return { status, reliable };
  }
  if (refs.localBaseSha) {
    const onLocal = await isAncestorAsync(repoPath, head, refs.localBaseSha);
    if (onLocal === null) reliable = false;
    status.landedOnBase = onLocal === true;
    return { status, reliable };
  }
  status.landedOnBase = false;
  return { status, reliable };
}
