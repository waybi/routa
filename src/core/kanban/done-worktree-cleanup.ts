/**
 * Removes a finished card's worktree once its Done lane has run and every
 * session of the card has ended.
 *
 * The removal itself is `GitWorktreeService.removeWorktree`, which uses
 * `git worktree remove --force` and `git branch -D`. Every safety check runs
 * here first, in the same call: the copy is only deleted when its branch is
 * already on the remote default branch (same commit or same patch-id) and the
 * working tree has nothing uncommitted. Anything uncertain keeps the copy.
 *
 * Failures are logged only. This module never writes the task, a lane
 * session, `lastSyncError` or a card comment, so it cannot re-trigger the Done
 * lane or restart recovery.
 */

import { execFile } from "child_process";
import fs from "fs";
import { promisify } from "util";

import type { CodebaseStore } from "../db/pg-codebase-store";
import type { WorktreeStore } from "../db/pg-worktree-store";
import type { KanbanColumnAutomation } from "../models/kanban";
import { TaskStatus, type Task } from "../models/task";
import type { Worktree } from "../models/worktree";
import { isLaneAutomationComplete } from "./done-lane-teardown";

const execFileAsync = promisify(execFile);

export const DONE_WORKTREE_CLEANUP_ENV = "ROUTA_AUTO_CLEANUP_DONE_WORKTREE";
export const DONE_WORKTREE_CLEANUP_LOG_PREFIX = "[DoneWorktreeCleanup]";
/** TopBI ships through Gerrit, never through origin's default branch. */
export const TOPBI_BOARD_ID = "312b1f5a-f1d6-4e51-b0da-334944e64609";

const GIT_TIMEOUT_MS = 30_000;
const GIT_FETCH_TIMEOUT_MS = 60_000;

export interface DoneWorktreeCleanupContext {
  task: Task;
  /** The Done column whose automation just finished. */
  columnId: string;
  automation: KanbanColumnAutomation | undefined;
  worktreeStore: WorktreeStore;
  codebaseStore: CodebaseStore;
}

export type DoneWorktreeCleanupDecision =
  | { ok: true; worktree: Worktree }
  | { ok: false; reason: string; worktree?: Worktree };

export type DoneWorktreeCleanupResult =
  | { result: "removed"; worktreeId: string }
  | { result: "skipped"; reason: string; worktreeId?: string }
  | { result: "failed"; reason: string; worktreeId?: string };

export interface WorktreeRemover {
  removeWorktree(worktreeId: string, options?: { deleteBranch?: boolean }): Promise<void>;
}

export function isDoneWorktreeCleanupEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DONE_WORKTREE_CLEANUP_ENV] !== "0";
}

async function git(args: string[], cwd: string, timeout = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024 });
  return String(stdout);
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0]?.trim() || "unknown error";
}

/**
 * Read-only decision: may this card's worktree be removed right now?
 * Checks run cheapest first; the first unmet condition is returned.
 */
export async function evaluateDoneWorktreeCleanup(
  ctx: DoneWorktreeCleanupContext,
): Promise<DoneWorktreeCleanupDecision> {
  const { task } = ctx;
  if (!isDoneWorktreeCleanupEnabled()) {
    return { ok: false, reason: `disabled (${DONE_WORKTREE_CLEANUP_ENV}=0)` };
  }
  if (task.boardId === TOPBI_BOARD_ID) {
    return { ok: false, reason: "topbi-board (ships via Gerrit, not origin)" };
  }
  if (task.status !== TaskStatus.COMPLETED) {
    return { ok: false, reason: `task-not-completed (status=${task.status})` };
  }
  if (task.columnId !== ctx.columnId) {
    return { ok: false, reason: `task-not-in-done-column (column=${task.columnId ?? "none"})` };
  }
  if (!isLaneAutomationComplete(task, ctx.columnId, ctx.automation)) {
    return { ok: false, reason: "done-lane-not-complete" };
  }
  if (!task.worktreeId) {
    return { ok: false, reason: "no-worktree-id" };
  }
  const worktree = await ctx.worktreeStore.get(task.worktreeId);
  if (!worktree) {
    return { ok: false, reason: "worktree-record-missing" };
  }
  if (!worktree.worktreePath || !fs.existsSync(worktree.worktreePath)) {
    return { ok: false, reason: "worktree-directory-missing", worktree };
  }
  const cwd = worktree.worktreePath;

  let status: string;
  try {
    status = await git(["status", "--porcelain"], cwd);
  } catch (error) {
    return { ok: false, reason: `git-status-failed: ${errorText(error)}`, worktree };
  }
  if (status.trim().length > 0) {
    const lines = status.split("\n").filter((line) => line.trim().length > 0);
    const untracked = lines.filter((line) => line.startsWith("??")).length;
    return {
      ok: false,
      reason: `worktree-dirty (${lines.length - untracked} uncommitted, ${untracked} untracked)`,
      worktree,
    };
  }

  // The checked-out HEAD must be the card branch; otherwise commits on HEAD
  // would not be covered by the branch check below.
  try {
    const head = (await git(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd)).trim();
    if (head !== worktree.branch) {
      return { ok: false, reason: `head-not-on-card-branch (head=${head}, branch=${worktree.branch})`, worktree };
    }
  } catch {
    return { ok: false, reason: `head-detached (branch=${worktree.branch})`, worktree };
  }

  try {
    await git(["fetch", "origin"], cwd, GIT_FETCH_TIMEOUT_MS);
  } catch (error) {
    return { ok: false, reason: `git-fetch-failed: ${errorText(error)}`, worktree };
  }

  const codebase = await ctx.codebaseStore.get(worktree.codebaseId);
  const defaultBranch = worktree.baseBranch?.trim() || codebase?.branch?.trim() || "main";
  const upstream = `origin/${defaultBranch}`;

  // `git cherry` lists branch commits missing from upstream: "-" means an
  // equivalent patch (same patch-id) is already on upstream, "+" means not.
  let cherry: string;
  try {
    cherry = await git(["cherry", upstream, `refs/heads/${worktree.branch}`], cwd);
  } catch (error) {
    return { ok: false, reason: `git-cherry-failed (${upstream}): ${errorText(error)}`, worktree };
  }
  const missing = cherry.split("\n").filter((line) => line.startsWith("+"));
  if (missing.length > 0) {
    const sample = missing.slice(0, 3).map((line) => line.slice(2, 10)).join(",");
    return {
      ok: false,
      reason: `not-on-${upstream} (${missing.length} commit(s) without matching patch-id: ${sample})`,
      worktree,
    };
  }

  return { ok: true, worktree };
}

function log(
  level: "info" | "warn",
  task: Task,
  worktreeId: string | undefined,
  result: DoneWorktreeCleanupResult["result"],
  reason: string,
): void {
  const line = `${DONE_WORKTREE_CLEANUP_LOG_PREFIX} card=${task.id} worktree=${worktreeId ?? "none"} `
    + `result=${result} reason=${reason}`;
  if (level === "info") {
    console.info(line);
  } else {
    console.warn(line);
  }
}

/**
 * Decide and, when safe, remove the card's worktree, its branch and its
 * worktree record. Never throws; logs exactly one line per call.
 */
export async function runDoneWorktreeCleanup(
  ctx: DoneWorktreeCleanupContext,
  remover: WorktreeRemover,
): Promise<DoneWorktreeCleanupResult> {
  const worktreeId = ctx.task.worktreeId;
  try {
    const decision = await evaluateDoneWorktreeCleanup(ctx);
    if (!decision.ok) {
      log("warn", ctx.task, worktreeId, "skipped", decision.reason);
      return { result: "skipped", reason: decision.reason, worktreeId };
    }
    await remover.removeWorktree(decision.worktree.id, { deleteBranch: true });
    log("info", ctx.task, decision.worktree.id, "removed", `branch ${decision.worktree.branch} is on origin`);
    return { result: "removed", worktreeId: decision.worktree.id };
  } catch (error) {
    const reason = `remove-error: ${errorText(error)}`;
    log("warn", ctx.task, worktreeId, "failed", reason);
    return { result: "failed", reason, worktreeId };
  }
}
