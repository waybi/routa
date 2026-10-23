import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { computeLandingFromRefs, readLandingRefs } from "@/core/git/git-landing-probe";
import { createTask } from "@/core/models/task";
import {
  __resetTaskDeliveryLandingCacheForTests,
  buildTaskDeliveryLanding,
  shouldProbeTaskDeliveryLanding,
} from "../task-delivery-landing";

// Real git, but every child_process entry point is counted, and the sync ones
// can be forbidden: the landing probe must never park the Node main thread.
const spy = vi.hoisted(() => ({
  forbidSync: false, sync: 0, async: 0, active: 0, maxActive: 0,
  /** git subcommand of every async call, in order. */
  commands: [] as string[],
  /** When it returns true for a call's argv, that git call fails with code 128. */
  failOn: null as null | ((argv: string[]) => boolean),
}));

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
    const argv = (Array.isArray(args[1]) ? args[1] : []) as string[];
    spy.commands.push(argv.find((arg) => !arg.startsWith("-")) ?? "");
    if (spy.failOn?.(argv)) {
      const done = args[args.length - 1] as (...result: unknown[]) => void;
      setImmediate(() => done(Object.assign(new Error("injected git failure"), { code: 128 }), "", ""));
      return { stdin: null };
    }
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
    Object.assign(spy, { forbidSync: false, sync: 0, async: 0, active: 0, maxActive: 0, commands: [], failOn: null });
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

// ---------------------------------------------------------------------------
// Commits that reached base under new shas (cherry-pick, rebase, patch cards).
// ---------------------------------------------------------------------------

const READ_ONLY_GIT = new Set(["cat-file", "merge-base", "cherry", "diff-tree", "diff", "log", "rev-parse", "rev-list", "ls-tree", "show", "patch-id"]);
const TASK = "issue/task-1";
const BASE = "feat/base";

function write(repo: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), content);
}

function commitAll(repo: string, message: string): string {
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "--allow-empty", "-m", message);
  return git(repo, "rev-parse", "HEAD");
}

/** Run `fn` with `branch` checked out, then go back to the task branch. */
function onBranch(repo: string, branch: string, fn: () => void): void {
  git(repo, "checkout", "-q", branch);
  fn();
  git(repo, "checkout", "-q", TASK);
}

/** root (base.txt + `files`) = main = feat/base; issue/task-1 checked out at root. */
function createReplayRepo(files: Record<string, string> = {}): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "routa-landing-replay-"));
  tempDirs.push(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "commit.gpgsign", "false");
  write(repo, "base.txt", "base");
  for (const [file, content] of Object.entries(files)) write(repo, file, content);
  commitAll(repo, "root");
  git(repo, "branch", BASE);
  git(repo, "checkout", "-q", "-b", TASK);
  return repo;
}

function snapshot(cwd: string) {
  const index = git(cwd, "rev-parse", "--path-format=absolute", "--git-path", "index");
  return {
    refs: git(cwd, "for-each-ref"),
    head: `${git(cwd, "rev-parse", "--symbolic-full-name", "HEAD")} ${git(cwd, "rev-parse", "HEAD")}`,
    index: fs.existsSync(index) ? createHash("sha256").update(fs.readFileSync(index)).digest("hex") : "none",
    status: git(cwd, "--no-optional-locks", "status", "--porcelain"),
  };
}

/**
 * buildTaskDeliveryLanding on `cwd`, asserting the probe left refs, HEAD,
 * index and work tree untouched and ran read-only git subcommands only.
 */
async function probe(cwd: string, baseBranch = BASE) {
  const before = snapshot(cwd);
  const from = spy.commands.length;
  const landing = await buildTaskDeliveryLanding(doneTask, system({
    id: "wt-1", codebaseId: "codebase-1", worktreePath: cwd, branch: TASK, baseBranch,
  }));
  expect(snapshot(cwd)).toEqual(before);
  expect(spy.commands.slice(from).filter((command) => !READ_ONLY_GIT.has(command))).toEqual([]);
  return landing;
}

async function compute(cwd: string, baseBranch = BASE) {
  const refs = await readLandingRefs(cwd, baseBranch);
  if (!refs) throw new Error("not a git repo");
  return computeLandingFromRefs(cwd, refs);
}

function expectNotAncestor(repo: string, base = BASE): void {
  const result = realChildProcess.spawnSync("git", ["merge-base", "--is-ancestor", TASK, base], { cwd: repo });
  expect(result.status).toBe(1);
}

const subcommand = (argv: string[]) => argv.find((arg) => !arg.startsWith("-")) ?? "";

/** C1-a: two task commits cherry-picked onto base (new shas, same patch-ids). */
function cherryPickedRepo(): string {
  const repo = createReplayRepo();
  write(repo, "a.txt", "a");
  const a = commitAll(repo, "task a");
  write(repo, "b.txt", "b");
  const b = commitAll(repo, "task b");
  onBranch(repo, BASE, () => {
    write(repo, "u.txt", "u");
    commitAll(repo, "unrelated");
    git(repo, "cherry-pick", a, b);
  });
  return repo;
}

/** C1-b: replayed with another patch; f ends identical, g deleted on both sides. */
function contentReplayedRepo(): string {
  const repo = createReplayRepo({ "f.txt": "x", "g.txt": "g" });
  write(repo, "f.txt", "y");
  fs.rmSync(path.join(repo, "g.txt"));
  commitAll(repo, "task replace f drop g");
  onBranch(repo, BASE, () => {
    write(repo, "f.txt", "z");
    commitAll(repo, "base f z");
    write(repo, "f.txt", "y");
    fs.rmSync(path.join(repo, "g.txt"));
    commitAll(repo, "base f y drop g");
  });
  return repo;
}

/** C1-c: same subject + paths on base, conflict-fixed and edited again later. */
function subjectReplayedRepo(): string {
  const repo = createReplayRepo({ "h.txt": "v0" });
  write(repo, "h.txt", "v1");
  commitAll(repo, "msg-3");
  onBranch(repo, BASE, () => {
    write(repo, "h.txt", "v1-conflict-fixed");
    commitAll(repo, "msg-3");
    write(repo, "h.txt", "v2");
    commitAll(repo, "later h");
  });
  return repo;
}

const LANDED = { landedOnBase: true, commitsSinceBase: 0 };
const unlanded = (n: number) => ({ landedOnBase: false, commitsSinceBase: n });

describe("replayed commits", () => {
  beforeEach(() => {
    __resetTaskDeliveryLandingCacheForTests();
    Object.assign(spy, { forbidSync: true, sync: 0, async: 0, active: 0, maxActive: 0, commands: [], failOn: null });
  });

  afterEach(() => {
    spy.forbidSync = false;
    spy.failOn = null;
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("C1 each layer recognizes its replay", () => {
    it.each([
      ["patch-id", cherryPickedRepo, { patchId: 2, content: 0, subjectFiles: 0 }],
      ["content", contentReplayedRepo, { patchId: 0, content: 1, subjectFiles: 0 }],
      ["subject + paths", subjectReplayedRepo, { patchId: 0, content: 0, subjectFiles: 1 }],
    ] as const)("%s", async (_layer, build, matchedBy) => {
      const repo = build();
      expectNotAncestor(repo);

      expect(await probe(repo)).toMatchObject(LANDED);
      const direct = await compute(repo);
      expect(direct.reliable).toBe(true);
      expect(direct.matchedBy).toEqual(matchedBy);

      // C7 / F2: same answer from a `git worktree add` card worktree.
      git(repo, "checkout", "-q", "--detach");
      const worktreePath = `${repo}-wt`;
      tempDirs.push(worktreePath);
      git(repo, "worktree", "add", "-q", worktreePath, TASK);
      __resetTaskDeliveryLandingCacheForTests();
      expect(await probe(worktreePath)).toEqual(await probe(repo));
      expect(await probe(worktreePath)).toMatchObject(LANDED);
    });
  });

  describe("C2 no false positives", () => {
    it("a) same subject, one more path on base", async () => {
      const repo = createReplayRepo({ "h.txt": "v0", "k.txt": "k0" });
      write(repo, "h.txt", "v1");
      commitAll(repo, "msg");
      onBranch(repo, BASE, () => {
        write(repo, "h.txt", "v1x");
        write(repo, "k.txt", "k1");
        commitAll(repo, "msg");
      });
      expect(await probe(repo)).toMatchObject(unlanded(1));
    });

    it("b) same paths, other subject", async () => {
      const repo = createReplayRepo({ "h.txt": "v0" });
      write(repo, "h.txt", "v1");
      commitAll(repo, "msg");
      onBranch(repo, BASE, () => {
        write(repo, "h.txt", "v1x");
        commitAll(repo, "other");
      });
      expect(await probe(repo)).toMatchObject(unlanded(1));
    });

    it("c) a twin before the merge-base does not count", async () => {
      const repo = createReplayRepo({ "h.txt": "v0" });
      write(repo, "h.txt", "v-pre");
      commitAll(repo, "msg");
      git(repo, "branch", "-f", BASE, "HEAD");
      write(repo, "h.txt", "v1");
      commitAll(repo, "msg");
      onBranch(repo, BASE, () => {
        write(repo, "u.txt", "u");
        commitAll(repo, "unrelated");
      });
      expectNotAncestor(repo);
      expect(await probe(repo)).toMatchObject(unlanded(1));
    });

    it("d) one base commit vouches for one task commit only", async () => {
      const repo = createReplayRepo({ "h.txt": "v0" });
      write(repo, "h.txt", "v1");
      commitAll(repo, "msg");
      write(repo, "h.txt", "v2");
      commitAll(repo, "msg");
      onBranch(repo, BASE, () => {
        write(repo, "h.txt", "vb");
        commitAll(repo, "msg");
        write(repo, "h.txt", "vc");
        commitAll(repo, "later");
      });
      expect(await probe(repo)).toMatchObject(unlanded(1));
      expect((await compute(repo)).matchedBy).toEqual({ patchId: 0, content: 0, subjectFiles: 1 });
    });

    it("e) an empty commit is not landed by an empty path set", async () => {
      const repo = createReplayRepo();
      commitAll(repo, "empty task");
      onBranch(repo, BASE, () => {
        write(repo, "u.txt", "u");
        commitAll(repo, "unrelated");
      });
      const plus = git(repo, "cherry", BASE, TASK).split("\n").filter((line) => line.startsWith("+")).length;
      expect(plus).toBe(1);
      expect(await probe(repo)).toMatchObject(unlanded(plus));
    });
  });

  describe("C3 paths and volume", () => {
    function replayByContent(files: string[], replayed: string[]): string {
      const repo = createReplayRepo(Object.fromEntries(files.map((file) => [file, "0"])));
      for (const file of files) write(repo, file, "1");
      commitAll(repo, "task many");
      onBranch(repo, BASE, () => {
        for (const file of replayed) write(repo, file, "2");
        commitAll(repo, "base many 1");
        for (const file of replayed) write(repo, file, "1");
        commitAll(repo, "base many 2");
      });
      return repo;
    }

    it.each([
      ["a) Chinese path", ["a.txt", "文档/说明.md"], "文档/说明.md"],
      ["b) glob and space characters", ["star*.txt", "br[1].txt", "sp ace.txt", "br1.txt"], "br[1].txt"],
    ] as const)("%s, with a control group missing one path", async (_name, files, dropped) => {
      expect(await probe(replayByContent([...files], [...files]))).toMatchObject(LANDED);
      __resetTaskDeliveryLandingCacheForTests();
      expect(await probe(replayByContent([...files], files.filter((file) => file !== dropped)))).toMatchObject(unlanded(1));
    });

    it("c) renames compare as delete + add even with diff.renames=true", async () => {
      const original = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
      const repo = createReplayRepo({ "a.txt": original });
      git(repo, "config", "diff.renames", "true");
      git(repo, "mv", "a.txt", "b.txt");
      commitAll(repo, "rename a to b");
      onBranch(repo, BASE, () => {
        git(repo, "mv", "a.txt", "b.txt");
        write(repo, "b.txt", `${original}\nfixed`);
        commitAll(repo, "rename a to b");
        write(repo, "b.txt", `${original}\nlater`);
        commitAll(repo, "later b");
      });
      expect(await probe(repo)).toMatchObject(LANDED);
      expect((await compute(repo)).matchedBy).toEqual({ patchId: 0, content: 0, subjectFiles: 1 });
    });

    it("d) 250 paths are compared in batches", async () => {
      const files = Array.from({ length: 250 }, (_, i) => `f${String(i).padStart(3, "0")}.txt`);
      const repo = replayByContent(files, files);
      const from = spy.commands.length;
      expect(await probe(repo)).toMatchObject(LANDED);
      expect(spy.commands.slice(from).filter((command) => command === "diff").length).toBe(2);
    });

    it("e) 3,000 base commits with 200-character subjects", async () => {
      const repo = createReplayRepo({ "h.txt": "v0" });
      const subject = (i: number) => `subject ${i} `.padEnd(200, "x");
      write(repo, "h.txt", "task");
      commitAll(repo, subject(1500));
      const root = git(repo, "rev-parse", BASE);
      let stream = "";
      for (let i = 0; i < 3000; i += 1) {
        const message = subject(i);
        const content = `v${i + 1}`;
        stream += `commit refs/heads/${BASE}\ncommitter T <t@example.com> ${1700000000 + i} +0000\n`;
        stream += `data ${Buffer.byteLength(message)}\n${message}\n`;
        if (i === 0) stream += `from ${root}\n`;
        stream += `M 100644 inline h.txt\ndata ${Buffer.byteLength(content)}\n${content}\n`;
      }
      realChildProcess.execFileSync("git", ["fast-import", "--quiet"], { cwd: repo, input: stream });
      expect(git(repo, "rev-list", "--count", `${TASK}..${BASE}`)).toBe("3000");

      expect(await probe(repo)).toMatchObject(LANDED);
      const direct = await compute(repo);
      expect(direct.reliable).toBe(true);
      expect(direct.matchedBy).toEqual({ patchId: 0, content: 0, subjectFiles: 1 });
    });
  });

  describe("C4 commitsSinceBase counts unrecognized non-merge commits", () => {
    it("a) one commit per layer plus one unrecognized", async () => {
      const repo = createReplayRepo({ "a.txt": "0", "b.txt": "0", "c.txt": "0", "d.txt": "0" });
      const shas = ["a", "b", "c", "d"].map((name, i) => {
        write(repo, `${name}.txt`, "1");
        return commitAll(repo, `t${i + 1}`);
      });
      onBranch(repo, BASE, () => {
        // A new parent first: picked onto the same parent within the same
        // second, git would recreate t1 with its original sha.
        write(repo, "u.txt", "u");
        commitAll(repo, "unrelated");
        git(repo, "cherry-pick", shas[0]);
        write(repo, "b.txt", "9");
        commitAll(repo, "b-1");
        write(repo, "b.txt", "1");
        commitAll(repo, "b-2");
        write(repo, "c.txt", "7");
        commitAll(repo, "t3");
        write(repo, "c.txt", "8");
        commitAll(repo, "c-later");
      });
      expect(await probe(repo)).toMatchObject(unlanded(1));
      expect((await compute(repo)).matchedBy).toEqual({ patchId: 1, content: 1, subjectFiles: 1 });
    });

    it("b) five commits nowhere on base", async () => {
      const repo = createReplayRepo();
      for (let i = 1; i <= 5; i += 1) {
        write(repo, `w${i}.txt`, `w${i}`);
        commitAll(repo, `work ${i}`);
      }
      onBranch(repo, BASE, () => {
        write(repo, "u.txt", "u");
        commitAll(repo, "unrelated");
      });
      expect(await probe(repo)).toMatchObject(unlanded(5));
    });

    it("c) a merge commit is not counted", async () => {
      const repo = createReplayRepo();
      onBranch(repo, BASE, () => {
        write(repo, "u.txt", "u");
        commitAll(repo, "base new");
      });
      write(repo, "o.txt", "own");
      commitAll(repo, "own");
      git(repo, "merge", "-q", "--no-ff", "-m", "merge base", BASE);
      expectNotAncestor(repo);
      expect(await probe(repo)).toMatchObject(unlanded(1));
    });

    it("d) only a merge commit left off base is landed", async () => {
      const repo = createReplayRepo();
      write(repo, "a.txt", "A");
      const a = commitAll(repo, "task a");
      onBranch(repo, BASE, () => {
        write(repo, "u.txt", "u");
        commitAll(repo, "base new");
      });
      git(repo, "merge", "-q", "--no-ff", "-m", "merge base", BASE);
      onBranch(repo, BASE, () => git(repo, "cherry-pick", a));
      expectNotAncestor(repo);
      expect(await probe(repo)).toMatchObject(LANDED);
    });
  });

  describe("C5 local base fallback", () => {
    function tasksWithLocalPicks(total: number, picked: number): string {
      const repo = createReplayRepo();
      const root = git(repo, "rev-parse", BASE);
      const shas = Array.from({ length: total }, (_, i) => {
        write(repo, `t${i}.txt`, `t${i}`);
        return commitAll(repo, `task ${i}`);
      });
      onBranch(repo, BASE, () => {
        write(repo, "u.txt", "u");
        commitAll(repo, "unrelated");
        if (picked > 0) git(repo, "cherry-pick", ...shas.slice(0, picked));
      });
      git(repo, "update-ref", `refs/remotes/origin/${BASE}`, root);
      return repo;
    }

    it("a) picked onto the local base only", async () => {
      expect(await probe(tasksWithLocalPicks(1, 1))).toMatchObject(LANDED);
    });

    it("F4-b) the local round also runs layer ③", async () => {
      const repo = createReplayRepo({ "h.txt": "v0" });
      const root = git(repo, "rev-parse", BASE);
      write(repo, "h.txt", "v1");
      commitAll(repo, "msg-local");
      onBranch(repo, BASE, () => {
        write(repo, "h.txt", "v1-fixed");
        commitAll(repo, "msg-local");
        write(repo, "h.txt", "v2");
        commitAll(repo, "later h");
      });
      git(repo, "update-ref", `refs/remotes/origin/${BASE}`, root);

      expect(await probe(repo)).toMatchObject(LANDED);
      const direct = await compute(repo);
      expect(direct.reliable).toBe(true);
      expect(direct.matchedBy).toEqual({ patchId: 0, content: 0, subjectFiles: 1 });
    });

    it("b) the smaller count of origin and local wins", async () => {
      expect(await probe(tasksWithLocalPicks(3, 1))).toMatchObject(unlanded(2));
    });

    it("c) a local base equal to origin runs one round only", async () => {
      const repo = tasksWithLocalPicks(1, 0);
      git(repo, "update-ref", "-d", `refs/remotes/origin/${BASE}`);
      let from = gitCalls();
      const single = await probe(repo);
      const singleCalls = gitCalls() - from;

      git(repo, "update-ref", `refs/remotes/origin/${BASE}`, BASE);
      const refs = await readLandingRefs(repo, BASE);
      expect(refs?.localBaseSha).toBe(refs?.baseSha);
      __resetTaskDeliveryLandingCacheForTests();
      from = gitCalls();
      const same = await probe(repo);

      expect(same).toEqual(single);
      expect(same).toMatchObject(unlanded(1));
      expect(gitCalls() - from).toBe(singleCalls);
    });
  });

  describe("C6 failures and cache", () => {
    it("a) a landed replay is served from cache with one git call", async () => {
      const repo = cherryPickedRepo();
      await probe(repo);
      const before = gitCalls();
      expect(await probe(repo)).toMatchObject(LANDED);
      expect(gitCalls() - before).toBe(1);
      expect(spy.commands[spy.commands.length - 1]).toBe("cat-file");
    });

    it.each([
      ["cherry", cherryPickedRepo],
      ["diff-tree", contentReplayedRepo],
      ["diff", contentReplayedRepo],
      ["log", subjectReplayedRepo],
    ] as const)("b) %s failing is unreliable, never landed, and not cached", async (command, build) => {
      const repo = build();
      spy.failOn = (argv) => subcommand(argv) === command;

      const failed = await probe(repo);
      expect(spy.commands).toContain(command);
      expect(failed?.landedOnBase).toBe(false);
      expect((await compute(repo)).reliable).toBe(false);

      spy.failOn = null;
      const before = gitCalls();
      expect(await probe(repo)).toMatchObject(LANDED);
      expect(gitCalls() - before).toBeGreaterThan(1);
    });

    it("c) a head without common history is unreliable and not cached", async () => {
      const repo = createReplayRepo();
      git(repo, "checkout", "-q", "--orphan", "issue/orphan");
      git(repo, "rm", "-rqf", ".");
      write(repo, "o.txt", "o");
      commitAll(repo, "orphan");

      expect(await probe(repo)).toMatchObject({ landedOnBase: false });
      expect((await compute(repo)).reliable).toBe(false);
      const before = gitCalls();
      await probe(repo);
      expect(gitCalls() - before).toBeGreaterThan(1);
    });

    it("F4-b) a failing ancestor check still lands through the layers, unreliably", async () => {
      const repo = cherryPickedRepo();
      spy.failOn = (argv) => argv.includes("--is-ancestor");

      expect(await probe(repo)).toMatchObject(LANDED);
      expect((await compute(repo)).reliable).toBe(false);
      const before = gitCalls();
      await probe(repo);
      expect(gitCalls() - before).toBeGreaterThan(1);
    });
  });

  describe("F2 old shapes", () => {
    it.each(["main", "dev"])("origin/%s: unmerged, fast-forwarded, recomputed after base moves", async (branch) => {
      const repo = createReplayRepo();
      const root = git(repo, "rev-parse", "HEAD");
      git(repo, "update-ref", `refs/remotes/origin/${branch}`, root);
      write(repo, "w1.txt", "1");
      commitAll(repo, "w1");
      write(repo, "w2.txt", "2");
      const head = commitAll(repo, "w2");
      git(repo, "checkout", "-q", "--detach");
      const worktreePath = `${repo}-wt`;
      tempDirs.push(worktreePath);
      git(repo, "worktree", "add", "-q", worktreePath, TASK);

      for (const cwd of [repo, worktreePath]) {
        __resetTaskDeliveryLandingCacheForTests();
        git(repo, "update-ref", `refs/remotes/origin/${branch}`, root);
        expect(await probe(cwd, branch)).toMatchObject({ ...unlanded(2), baseBranch: branch });

        git(repo, "update-ref", `refs/remotes/origin/${branch}`, head);
        const from = spy.commands.length;
        expect(await probe(cwd, branch)).toMatchObject({ ...LANDED, baseBranch: branch });
        expect(spy.commands.slice(from)).toEqual(["cat-file", "merge-base"]);
      }
    });

    it("an unborn HEAD is reported unmerged and unreliable", async () => {
      const repo = createReplayRepo();
      git(repo, "checkout", "-q", "--orphan", "issue/unborn");
      const sys = system({ id: "wt-1", codebaseId: "codebase-1", worktreePath: repo, branch: TASK, baseBranch: BASE });

      expect(await buildTaskDeliveryLanding(doneTask, sys)).toMatchObject(unlanded(0));
      const direct = await compute(repo);
      expect(direct.reliable).toBe(false);
      expect(direct.status).toMatchObject({ landedOnBase: false, commitsSinceBase: 0 });
    });
  });
});
