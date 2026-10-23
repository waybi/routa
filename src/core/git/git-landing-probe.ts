import { execFile } from "child_process";
import type { RepoLandingStatus } from "./git-utils";

/**
 * Async, non-blocking counterpart of `getRepoLandingStatus` for the
 * `GET /api/tasks` hot path.
 *
 * The sync helpers in git-utils.ts run git synchronously, which parks the
 * Node main thread for every git process; with ~5 commands per done card and 100+
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

/** How many task commits each replay layer recognized (internal, not part of the API). */
export interface LandingLayerCounts {
  patchId: number;
  content: number;
  subjectFiles: number;
}

export interface LandingComputation {
  status: RepoLandingStatus;
  /** False when a git command failed unexpectedly; such results must not be cached. */
  reliable: boolean;
  /** Which layer recognized how many commits, for the base round that decided the result. */
  matchedBy?: LandingLayerCounts;
}

interface UnlandedCount {
  /** Non-merge task commits no layer recognized; `null` when it could not be counted. */
  missing: number | null;
  reliable: boolean;
  matchedBy: LandingLayerCounts;
}

/** Max pathspecs per git invocation, to stay far below the OS argv limit. */
const PATHSPEC_BATCH = 200;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface CommitFiles {
  sha: string;
  subject: string;
  /** Sorted, de-duplicated paths the commit changed (renames split into delete + add). */
  files: string[];
}

const UNIT_SEPARATOR = "\x1f";

/** `<sha>\x1f<subject>` header token, else null. */
function parseCommitHeader(token: string): { sha: string; subject: string } | null {
  const sep = token.indexOf(UNIT_SEPARATOR);
  if (sep < 0) return null;
  const sha = token.slice(0, sep);
  const subject = token.slice(sep + 1);
  return OBJECT_ID.test(sha) && !subject.includes("\n") ? { sha, subject } : null;
}

/**
 * Parse `--format=%H%x1f%s --name-only -z` output of `diff-tree --stdin` or
 * `log`: a NUL-terminated header per commit, then its NUL-terminated paths
 * (git puts a newline between the header and the first path). `-z` keeps
 * non-ASCII and special paths verbatim.
 */
function parseCommitFiles(output: string): CommitFiles[] {
  const commits: CommitFiles[] = [];
  let current: { commit: CommitFiles; files: Set<string> } | null = null;
  let afterHeader = false;
  const flush = () => {
    if (current) current.commit.files = Array.from(current.files).sort();
  };
  for (const token of output.split("\0")) {
    const header = parseCommitHeader(token);
    if (header) {
      flush();
      current = { commit: { ...header, files: [] }, files: new Set() };
      commits.push(current.commit);
      afterHeader = true;
      continue;
    }
    const file = afterHeader && token.startsWith("\n") ? token.slice(1) : token;
    afterHeader = false;
    if (current && file) current.files.add(file);
  }
  flush();
  return commits;
}

/**
 * Subject and changed paths of `shas`, from one `diff-tree --stdin` process.
 * `--no-renames` gives task and base commits the same path-set definition
 * regardless of user config; `--always` keeps empty commits in the output.
 */
async function readCommitFiles(repoPath: string, shas: string[]): Promise<Map<string, CommitFiles>> {
  const output = await runGitAsync(
    ["diff-tree", "--stdin", "--always", "-r", "--root", "--no-renames", "--name-only", "-z", "--format=%H%x1f%s"],
    repoPath,
    `${shas.join("\n")}\n`,
  );
  const result = new Map(parseCommitFiles(output).map((commit) => [commit.sha, commit]));
  if (shas.some((sha) => !result.has(sha))) {
    throw new Error("git diff-tree did not report every requested commit");
  }
  return result;
}

/** `true` when the two commits share history; `null` when git failed. */
async function hasMergeBase(repoPath: string, a: string, b: string): Promise<boolean | null> {
  try {
    await runGitAsync(["merge-base", a, b], repoPath);
    return true;
  } catch (error) {
    return (error as GitCommandError).code === 1 ? false : null;
  }
}

const commitKey = (commit: CommitFiles) => `${commit.subject}\0${commit.files.join("\0")}`;

/**
 * Count the non-merge commits of `headSha` that did not land on `baseSha`,
 * also when they landed under a new sha (rebase, cherry-pick, a patch card
 * replaying them). Strict to loose, each layer only sees what the previous
 * one left:
 *   ① patch-id — `git cherry` (skips merge commits);
 *   ② content — every path the commit changed is identical in base and head;
 *   ③ subject + paths — a non-merge commit in headSha..baseSha (merge-base..base)
 *      with the same full subject and the exact same set of changed paths;
 *      each base commit can vouch for one task commit only.
 * Empty commits only count as landed through ①. A failing git command stops
 * the count: its layer recognizes nothing and the result is unreliable; so is
 * a head without any history in common with base.
 */
async function countUnlandedCommits(repoPath: string, baseSha: string, headSha: string): Promise<UnlandedCount> {
  const matchedBy: LandingLayerCounts = { patchId: 0, content: 0, subjectFiles: 0 };

  // ① patch-id
  let cherry: string;
  try {
    cherry = await runGitAsync(["cherry", baseSha, headSha], repoPath);
  } catch {
    const count = await runGitAsync(["rev-list", "--count", "--no-merges", `${baseSha}..${headSha}`], repoPath)
      .catch(() => null);
    const parsed = count === null ? Number.NaN : Number.parseInt(count, 10);
    return { missing: Number.isFinite(parsed) ? parsed : null, reliable: false, matchedBy };
  }
  const pending: string[] = [];
  for (const line of cherry.split("\n")) {
    const match = /^([+-]) ([0-9a-f]{40,64})$/.exec(line.trim());
    if (!match) continue;
    if (match[1] === "+") pending.push(match[2]);
    else matchedBy.patchId += 1;
  }
  if (pending.length === 0) return { missing: 0, reliable: true, matchedBy };
  // Without a merge-base there is no merge-base..base range to match against.
  if ((await hasMergeBase(repoPath, baseSha, headSha)) !== true) {
    return { missing: pending.length, reliable: false, matchedBy };
  }

  let taskCommits: Map<string, CommitFiles>;
  try {
    taskCommits = await readCommitFiles(repoPath, pending);
  } catch {
    return { missing: pending.length, reliable: false, matchedBy };
  }
  const filesOf = (sha: string) => taskCommits.get(sha)?.files ?? [];
  const unionOfFiles = (shas: string[]) => Array.from(new Set(shas.flatMap(filesOf))).sort();

  // ② content
  const differing = new Set<string>();
  try {
    for (const batch of chunk(unionOfFiles(pending), PATHSPEC_BATCH)) {
      const output = await runGitAsync(
        ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-relative", "--no-renames", "--name-only", "-z", baseSha, headSha, "--", ...batch],
        repoPath,
      );
      for (const file of output.split("\0")) if (file) differing.add(file);
    }
  } catch {
    return { missing: pending.length, reliable: false, matchedBy };
  }
  const remaining = pending.filter((sha) => {
    const files = filesOf(sha);
    if (files.length > 0 && files.every((file) => !differing.has(file))) {
      matchedBy.content += 1;
      return false;
    }
    return true;
  });

  // ③ subject + paths
  const candidates = remaining.filter((sha) => filesOf(sha).length > 0);
  if (candidates.length === 0) return { missing: remaining.length, reliable: true, matchedBy };
  const subjects = Array.from(new Set(candidates.map((sha) => taskCommits.get(sha)?.subject ?? "")));
  const baseCommits: CommitFiles[] = [];
  try {
    const seen = new Set<string>();
    // Only base commits that touch a task path and mention a task subject can
    // match, so git filters on both and the output stays small on a long base.
    for (const batch of chunk(unionOfFiles(candidates), PATHSPEC_BATCH)) {
      const output = await runGitAsync(
        [
          "--literal-pathspecs", "log", "--no-merges", "--full-history", "--no-renames", "--full-diff",
          "--name-only", "-z", "--no-show-signature", "--format=%H%x1f%s", "--fixed-strings",
          ...subjects.map((subject) => `--grep=${subject}`),
          `${headSha}..${baseSha}`, "--", ...batch,
        ],
        repoPath,
      );
      for (const commit of parseCommitFiles(output)) {
        if (seen.has(commit.sha)) continue;
        seen.add(commit.sha);
        baseCommits.push(commit);
      }
    }
  } catch {
    return { missing: remaining.length, reliable: false, matchedBy };
  }
  const unused = baseCommits.map(commitKey).reverse(); // oldest first
  const missing = remaining.filter((sha) => {
    const task = taskCommits.get(sha);
    if (!task || task.files.length === 0) return true;
    const index = unused.indexOf(commitKey(task));
    if (index < 0) return true;
    unused.splice(index, 1);
    matchedBy.subjectFiles += 1;
    return false;
  });
  return { missing: missing.length, reliable: true, matchedBy };
}

/** One base round: the ancestor shortcut, then the three replay layers. */
async function landingAgainstBase(repoPath: string, headSha: string, baseSha: string): Promise<UnlandedCount> {
  const onBase = await isAncestorAsync(repoPath, headSha, baseSha);
  if (onBase === true) {
    return { missing: 0, reliable: true, matchedBy: { patchId: 0, content: 0, subjectFiles: 0 } };
  }
  const counted = await countUnlandedCommits(repoPath, baseSha, headSha);
  return { ...counted, reliable: counted.reliable && onBase !== null };
}

/**
 * Decide "has HEAD landed on base" from resolved shas, so the answer belongs
 * to exactly the refs in `refs` even if they move meanwhile.
 *
 * HEAD reachable from base is landed. Otherwise the task commits are matched
 * against base by patch-id, content, then subject + changed paths
 * ({@link countUnlandedCommits}); `commitsSinceBase` is the number of non-merge
 * commits none of them recognized, and 0 once landed. When a local base branch
 * exists with another sha, it gets the same round and the smaller count wins.
 * On failure the result is unreliable, never "landed" because of the failure.
 */
export async function computeLandingFromRefs(repoPath: string, refs: LandingRefs): Promise<LandingComputation> {
  const status: RepoLandingStatus = {
    baseBranch: refs.baseBranch,
    baseRef: refs.baseRef,
    commitsSinceBase: 0,
    landedOnBase: null,
  };
  if (!refs.baseRef || !refs.baseSha) {
    return { status, reliable: refs.headSha !== null };
  }
  if (!refs.headSha) {
    status.landedOnBase = false;
    return { status, reliable: false };
  }
  // Sequential on purpose: callers cap concurrent probes, which then also caps
  // concurrent git processes.
  let best = await landingAgainstBase(repoPath, refs.headSha, refs.baseSha);
  let reliable = best.reliable;
  if (best.missing !== 0 && refs.localBaseSha && refs.localBaseSha !== refs.baseSha) {
    const local = await landingAgainstBase(repoPath, refs.headSha, refs.localBaseSha);
    reliable = reliable && local.reliable;
    if (local.missing !== null && (best.missing === null || local.missing < best.missing)) best = local;
  }
  status.landedOnBase = best.missing === 0;
  status.commitsSinceBase = best.missing ?? 0;
  return { status, reliable, matchedBy: best.matchedBy };
}
