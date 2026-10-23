import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask } from "@/core/models/task";
import {
  __resetTaskDeliveryLandingCacheForTests,
  buildTaskDeliveryLanding,
  shouldProbeTaskDeliveryLanding,
} from "../task-delivery-landing";

// Real git, but every child_process entry point is counted, and the sync ones
// can be forbidden: the landing probe must never park the Node main thread.
const spy = vi.hoisted(() => ({ forbidSync: false, sync: 0, async: 0, active: 0, maxActive: 0 }));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const guardSync = <F extends (...args: never[]) => unknown>(fn: F) => ((...args: Parameters<F>) => {
    spy.sync += 1;
    if (spy.forbidSync) throw new Error("synchronous child_process call on the landing probe path");
    return fn(...args);
  }) as F;
  const execFile = ((...args: unknown[]) => {
    spy.async += 1;
    spy.active += 1;
    spy.maxActive = Math.max(spy.maxActive, spy.active);
    const callback = args[args.length - 1] as (...result: unknown[]) => void;
    args[args.length - 1] = (...result: unknown[]) => {
      spy.active -= 1;
      callback(...result);
    };
    return (actual.execFile as (...a: unknown[]) => unknown)(...args);
  }) as typeof actual.execFile;
  const mocked = {
    ...actual,
    execFile,
    execFileSync: guardSync(actual.execFileSync),
    execSync: guardSync(actual.execSync),
    spawnSync: guardSync(actual.spawnSync),
  };
  return { ...mocked, default: mocked };
});

const realChildProcess = await vi.importActual<typeof import("child_process")>("child_process");

function git(cwd: string, ...args: string[]): string {
  return realChildProcess.execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(repo: string, file: string): void {
  fs.writeFileSync(path.join(repo, file), file);
  git(repo, "add", file);
  git(repo, "commit", "-q", "-m", file);
}

const tempDirs: string[] = [];

/** main ← feat/base ← issue/task-1 (+1 commit, checked out). */
function createRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "routa-landing-"));
  tempDirs.push(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  commit(repo, "base.txt");
  git(repo, "branch", "feat/base");
  git(repo, "checkout", "-q", "-b", "issue/task-1");
  commit(repo, "work-1.txt");
  return repo;
}

function system(worktree?: Record<string, unknown>, codebase?: Record<string, unknown>) {
  return {
    codebaseStore: { get: vi.fn().mockResolvedValue(codebase) },
    worktreeStore: { get: vi.fn().mockResolvedValue(worktree) },
  };
}

const doneTask = createTask({ id: "t", title: "t", objective: "o", workspaceId: "w", worktreeId: "wt-1", columnId: "done" });

function gitCalls(): number {
  return spy.sync + spy.async;
}

describe("task delivery landing", () => {
  let repo: string;
  let worktree: Record<string, unknown>;

  beforeEach(() => {
    __resetTaskDeliveryLandingCacheForTests();
    Object.assign(spy, { forbidSync: false, sync: 0, async: 0, active: 0, maxActive: 0 });
    repo = createRepo();
    worktree = { id: "wt-1", codebaseId: "codebase-1", worktreePath: repo, branch: "issue/task-1", baseBranch: "feat/base" };
    spy.forbidSync = true;
  });

  afterEach(() => {
    spy.forbidSync = false;
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
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
    expect(gitCalls()).toBe(0);
  });

  it("reports an unmerged done card with async git only", async () => {
    const sys = system(worktree);

    const landing = await buildTaskDeliveryLanding(doneTask, sys);

    expect(landing).toEqual({ landedOnBase: false, commitsSinceBase: 1, branch: "issue/task-1", baseBranch: "feat/base" });
    expect(spy.sync).toBe(0);
    expect(spy.async).toBeGreaterThan(0);
    // Base came from the worktree; no need to load the codebase.
    expect(sys.codebaseStore.get).not.toHaveBeenCalled();
  });

  it("falls back to the codebase branch when the worktree has no base", async () => {
    git(repo, "branch", "-f", "main", "issue/task-1");
    const sys = system({ ...worktree, baseBranch: undefined }, { id: "codebase-1", branch: "main" });

    const landing = await buildTaskDeliveryLanding(doneTask, sys);

    expect(landing).toMatchObject({ landedOnBase: true, commitsSinceBase: 0, baseBranch: "main" });
    expect(spy.sync).toBe(0);
  });

  it("returns undefined when the worktree is gone or not a git repo", async () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-landing-plain-"));
    tempDirs.push(plainDir);

    expect(await buildTaskDeliveryLanding(doneTask, system(undefined))).toBeUndefined();
    expect(await buildTaskDeliveryLanding(doneTask, system({ ...worktree, worktreePath: plainDir }))).toBeUndefined();
    expect(await buildTaskDeliveryLanding(doneTask, system({ ...worktree, worktreePath: path.join(plainDir, "missing") }))).toBeUndefined();
  });

  describe("landing cache", () => {
    it("serves a repeated unmerged result from cache with a single git call", async () => {
      const first = await buildTaskDeliveryLanding(doneTask, system(worktree));
      const before = gitCalls();

      const second = await buildTaskDeliveryLanding(doneTask, system(worktree));

      expect(second).toEqual(first);
      expect(second?.landedOnBase).toBe(false);
      expect(gitCalls() - before).toBeLessThanOrEqual(1);
    });

    it("serves a repeated landed result from cache too", async () => {
      git(repo, "branch", "-f", "feat/base", "issue/task-1");
      await buildTaskDeliveryLanding(doneTask, system(worktree));
      const before = gitCalls();

      const second = await buildTaskDeliveryLanding(doneTask, system(worktree));

      expect(second).toMatchObject({ landedOnBase: true, commitsSinceBase: 0 });
      expect(gitCalls() - before).toBeLessThanOrEqual(1);
    });

    it("recomputes after HEAD moves", async () => {
      expect((await buildTaskDeliveryLanding(doneTask, system(worktree)))?.commitsSinceBase).toBe(1);
      commit(repo, "work-2.txt");

      expect(await buildTaskDeliveryLanding(doneTask, system(worktree))).toMatchObject({ landedOnBase: false, commitsSinceBase: 2 });
    });

    it("recomputes after the base branch moves, never returning a stale unmerged result", async () => {
      expect((await buildTaskDeliveryLanding(doneTask, system(worktree)))?.landedOnBase).toBe(false);
      git(repo, "branch", "-f", "feat/base", "issue/task-1");

      expect(await buildTaskDeliveryLanding(doneTask, system(worktree))).toMatchObject({ landedOnBase: true, commitsSinceBase: 0 });
    });

    it("recomputes when origin/<base> appears or moves", async () => {
      git(repo, "update-ref", "refs/remotes/origin/feat/base", "main");
      expect(await buildTaskDeliveryLanding(doneTask, system(worktree))).toMatchObject({ landedOnBase: false, commitsSinceBase: 1 });
      git(repo, "update-ref", "refs/remotes/origin/feat/base", "issue/task-1");

      expect(await buildTaskDeliveryLanding(doneTask, system(worktree))).toMatchObject({ landedOnBase: true, commitsSinceBase: 0 });
    });
  });

  it("runs at most 8 probes at once, but more than one", async () => {
    const probes = Array.from({ length: 20 }, () => buildTaskDeliveryLanding(doneTask, system(worktree)));

    const results = await Promise.all(probes);

    expect(results.every((landing) => landing?.commitsSinceBase === 1)).toBe(true);
    expect(spy.sync).toBe(0);
    expect(spy.maxActive).toBeGreaterThan(1);
    expect(spy.maxActive).toBeLessThanOrEqual(8);
  });
});
