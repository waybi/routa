import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gitExecAsync } from "@/core/utils/safe-exec";
import {
  getBranchInfo,
  getRepoChanges,
  getRepoDeliveryStatus,
  hasBranchAuthoredCommitsOnHead,
  invalidateRepoChangesCache,
  isBareGitRepository,
  isGitRepository,
  listBranches,
  listRemoteBranches,
  getBranchStatus,
} from "../git-utils";
import {
  getBranchInfoAsync,
  getBranchStatusAsync,
  getRepoChangesAsync,
  getRepoDeliveryStatusAsync,
  hasBranchAuthoredCommitsOnHeadAsync,
  isBareGitRepositoryAsync,
  isGitRepositoryAsync,
  listBranchesAsync,
  listRemoteBranchesAsync,
  pullBranchAsync,
} from "../git-utils-async";
import {
  commitFile,
  installFakeGit,
  makeRepo,
  makeTempDir,
  runGit,
  type FakeGit,
} from "./git-test-fixtures";

const dirs: string[] = [];
function repo(): string {
  const d = makeRepo();
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("C4: async git does not block the event loop", () => {
  let fake: FakeGit;
  beforeEach(() => { fake = installFakeGit(); process.env.FAKE_GIT_SLEEP = "1"; });
  afterEach(() => fake.restore());

  async function timerFiresWithin200ms(run: () => Promise<unknown>): Promise<number> {
    const started = Date.now();
    const timer = new Promise<number>((resolve) => setTimeout(() => resolve(Date.now() - started), 50));
    const pending = run();
    const elapsed = await timer;
    await pending;
    return elapsed;
  }

  it("gitExecAsync", async () => {
    const dir = repo();
    expect(await timerFiresWithin200ms(() => gitExecAsync(["pull", "--ff-only"], { cwd: dir }))).toBeLessThan(200);
  });

  it("pullBranchAsync", async () => {
    const dir = repo();
    expect(await timerFiresWithin200ms(() => pullBranchAsync(dir))).toBeLessThan(200);
    expect(fake.pullCount()).toBe(1);
  });
});

describe("C6/C13: async results equal the sync results and independent expectations", () => {
  it("lists every kind of change with the right status", async () => {
    const dir = repo();
    commitFile(dir, "mod.txt", "a\n");
    commitFile(dir, "gone.txt", "g\n");
    commitFile(dir, "old_name.txt", "same content that is long enough\n");
    commitFile(dir, "staged.txt", "s\n");
    fs.writeFileSync(path.join(dir, "mod.txt"), "a\nb\n"); // " M"
    fs.writeFileSync(path.join(dir, "staged.txt"), "s\nt\n");
    runGit(dir, "add", "staged.txt"); // "M "
    fs.rmSync(path.join(dir, "gone.txt")); // " D"
    runGit(dir, "mv", "old_name.txt", "new_name.txt"); // "R "
    fs.writeFileSync(path.join(dir, "fresh file.txt"), "1\n2\n"); // "??" with space in name

    invalidateRepoChangesCache(dir);
    const sync = getRepoChanges(dir);
    invalidateRepoChangesCache(dir);
    const asyncResult = await getRepoChangesAsync(dir);
    expect(asyncResult).toEqual(sync);

    const byPath = Object.fromEntries(asyncResult.files.map((f) => [f.path, f]));
    expect(byPath["mod.txt"]).toMatchObject({ status: "modified", unstaged: true, additions: 1, deletions: 0 });
    expect(byPath["staged.txt"]).toMatchObject({ status: "modified", staged: true });
    expect(byPath["gone.txt"]).toMatchObject({ status: "deleted" });
    expect(byPath["new_name.txt"]).toMatchObject({ status: "renamed", previousPath: "old_name.txt" });
    // Names with spaces come back quoted by git; both versions must agree (checked above).
    expect(asyncResult.files.find((f) => f.path.includes("fresh file"))).toMatchObject({ status: "untracked", unstaged: true });
    expect(asyncResult.branch).toBe("main");
    expect(asyncResult.status).toMatchObject({ clean: false, modified: 4, untracked: 1 });
  });

  it("handles 5000 untracked files like the sync version", async () => {
    const dir = repo();
    for (let i = 0; i < 5000; i++) fs.writeFileSync(path.join(dir, `u${i}.txt`), "x");
    invalidateRepoChangesCache(dir);
    const sync = getRepoChanges(dir);
    invalidateRepoChangesCache(dir);
    const asyncResult = await getRepoChangesAsync(dir);
    expect(asyncResult.files).toHaveLength(5000);
    expect(asyncResult.files.map((f) => f.path)).toEqual(sync.files.map((f) => f.path));
    expect(asyncResult.status.untracked).toBe(5000);
  });

  it("branch helpers match", async () => {
    const dir = repo();
    runGit(dir, "branch", "feature/x");
    expect(await listBranchesAsync(dir)).toEqual(listBranches(dir));
    expect(await getBranchInfoAsync(dir)).toEqual(getBranchInfo(dir));
    expect(await listRemoteBranchesAsync(dir)).toEqual(listRemoteBranches(dir));
    expect(await getBranchStatusAsync(dir, "main")).toEqual(getBranchStatus(dir, "main"));
    expect(await getBranchInfoAsync(dir)).toEqual({ current: "main", branches: ["feature/x", "main"] });
  });
});

describe("F2: delivery readiness inputs, async equals sync, in six repo states", () => {
  it("unmerged commits on the card branch", async () => {
    const dir = repo();
    runGit(dir, "checkout", "-q", "-b", "card/a");
    commitFile(dir, "a.txt");
    const sync = getRepoDeliveryStatus(dir);
    expect(await getRepoDeliveryStatusAsync(dir)).toEqual(sync);
    expect(sync).toMatchObject({ branch: "card/a", commitsSinceBase: 1, hasCommitsSinceBase: true, landedOnBase: false });
    expect(await hasBranchAuthoredCommitsOnHeadAsync(dir, "card/a")).toBe(hasBranchAuthoredCommitsOnHead(dir, "card/a"));
  });

  it("already fast-forwarded into main: zero commits left, own commits recognised", async () => {
    const dir = repo();
    runGit(dir, "checkout", "-q", "-b", "card/b");
    commitFile(dir, "b.txt");
    runGit(dir, "checkout", "-q", "main");
    runGit(dir, "merge", "-q", "--ff-only", "card/b");
    runGit(dir, "checkout", "-q", "card/b");
    const sync = getRepoDeliveryStatus(dir);
    expect(await getRepoDeliveryStatusAsync(dir)).toEqual(sync);
    expect(sync).toMatchObject({ commitsSinceBase: 0, hasCommitsSinceBase: false, landedOnBase: true });
    expect(hasBranchAuthoredCommitsOnHead(dir, "card/b")).toBe(true);
    expect(await hasBranchAuthoredCommitsOnHeadAsync(dir, "card/b")).toBe(true);
  });

  it("new branch with no commits of its own is refused as own work", async () => {
    const dir = repo();
    runGit(dir, "checkout", "-q", "-b", "card/c");
    expect(await getRepoDeliveryStatusAsync(dir)).toEqual(getRepoDeliveryStatus(dir));
    expect(await hasBranchAuthoredCommitsOnHeadAsync(dir, "card/c")).toBe(false);
    expect(hasBranchAuthoredCommitsOnHead(dir, "card/c")).toBe(false);
  });

  it("dirty worktree", async () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, "dirty.txt"), "x");
    const sync = getRepoDeliveryStatus(dir);
    expect(await getRepoDeliveryStatusAsync(dir)).toEqual(sync);
    expect(sync.hasUncommittedChanges).toBe(true);
  });

  it("non-git directory and bare repository", async () => {
    const plain = makeTempDir();
    dirs.push(plain);
    expect(await isGitRepositoryAsync(plain)).toBe(isGitRepository(plain));
    expect(await isGitRepositoryAsync(plain)).toBe(false);

    const bare = makeTempDir();
    dirs.push(bare);
    runGit(bare, "init", "-q", "--bare");
    expect(await isBareGitRepositoryAsync(bare)).toBe(true);
    expect(isBareGitRepository(bare)).toBe(true);
  });
});

describe("C13: async exec options", () => {
  it("uses the same cwd/encoding as the sync exec and inherits env", async () => {
    const dir = repo();
    expect((await gitExecAsync(["rev-parse", "--show-toplevel"], { cwd: dir })).trim()).toBe(fs.realpathSync(dir));
    vi.stubEnv("GIT_AUTHOR_NAME", "Env Probe");
    runGit(dir, "commit", "--allow-empty", "-q", "-m", "e");
    const out = await gitExecAsync(["log", "-1", "--format=%an"], { cwd: dir });
    expect(out.trim()).toBe("Env Probe");
    vi.unstubAllEnvs();
  });
});
