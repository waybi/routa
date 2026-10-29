/**
 * Regression: a pre-push hook in a worktree exports GIT_DIR=<main>/.git/worktrees/<x>,
 * whose config is shared with the main checkout. Any test that ran `git init --bare` inside a tmp dir (no path arg)
 * under that env re-initialised GIT_DIR as bare and flipped the main checkout to
 * core.bare=true (2026-10-29). vitest.git-env.setup.ts scrubs GIT_* for every test file.
 *
 * Parent mode spawns a child vitest on this file with GIT_DIR pointing at a throwaway
 * "outer" repo; child mode runs `git init --bare` like the real tests do. Only mktemp repos.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { makeRepo, makeTempDir, runGit } from "./git-test-fixtures";

const CHILD_FLAG = "ROUTA_GIT_ENV_SCRUB_CHILD";
const THIS_FILE = "src/core/git/__tests__/git-env-global-scrub.test.ts";
const isChild = process.env[CHILD_FLAG] === "1";

const coreBare = (repo: string) =>
  execFileSync("git", ["config", "--file", path.join(repo, ".git", "config"), "core.bare"], { encoding: "utf8" }).trim();

describe.skipIf(isChild)("global GIT_* scrub (hook env)", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

  it("hazard probe: git init --bare under GIT_DIR flips the outer repo to bare", () => {
    const outer = makeRepo(); const bare = makeTempDir(); dirs.push(outer, bare);
    // Same form as runGit(bare, "init", "--bare"): no path arg, so git inits $GIT_DIR.
    execFileSync("git", ["init", "-q", "--bare"], { cwd: bare, env: { ...process.env, GIT_DIR: path.join(outer, ".git") } });
    expect(coreBare(outer)).toBe("true");
  });

  it("tests run with GIT_DIR exported do not touch the outer repo config", () => {
    const outer = makeRepo(); dirs.push(outer);
    const before = fs.readFileSync(path.join(outer, ".git", "config"), "utf8");
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("VITEST") || k.startsWith("GIT_")) delete env[k];
    Object.assign(env, { GIT_DIR: path.join(outer, ".git"), [CHILD_FLAG]: "1" });
    const root = process.cwd();
    execFileSync(path.join(root, "node_modules", ".bin", "vitest"), ["run", THIS_FILE], { cwd: root, env, stdio: "pipe" });
    expect(coreBare(outer)).toBe("false");
    expect(fs.readFileSync(path.join(outer, ".git", "config"), "utf8")).toBe(before);
  }, 120_000);
});

describe.runIf(isChild)("child: a test that inits a bare repo", () => {
  it("git init --bare inside a tmp dir", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "routa-git-env-child-"));
    try { runGit(bare, "init", "-q", "--bare"); } finally { fs.rmSync(bare, { recursive: true, force: true }); }
  });
});
