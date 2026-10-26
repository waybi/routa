// @vitest-environment node
/**
 * Worktrees created by GitWorktreeService must run the repo's git hooks.
 *
 * Routa's core.hooksPath is the relative `.husky/_` (husky-generated, gitignored),
 * so a plain `git worktree add` leaves the worktree without hooks and git skips
 * pre-commit/pre-push silently. All fixtures live in mkdtemp repos.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InMemoryCodebaseStore } from "../../db/pg-codebase-store";
import { InMemoryWorktreeStore } from "../../db/pg-worktree-store";
import { createCodebase } from "../../models/codebase";
import { GitWorktreeService } from "../git-worktree-service";

const routaSystem = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/core/routa-system", () => ({ getRoutaSystem: () => routaSystem.current }));

import { NextRequest } from "next/server";
import { POST as createWorktreeRoute } from "@/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/worktrees/route";

const CODEBASE_ID = "cb-hooks";
const WRAPPER = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n';
const H_SCRIPT = '#!/usr/bin/env sh\nn=$(basename "$0")\ns=$(dirname "$(dirname "$0")")/$n\n[ ! -f "$s" ] && exit 0\nsh -e "$s" "$@"\n';

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const roots: string[] = [];

type HooksMode = "relative" | "unset" | "absolute" | "relative-not-installed";

interface Fixture {
  root: string;
  repo: string;
  service: GitWorktreeService;
  worktreeStore: InMemoryWorktreeStore;
}

/** Main repo with a tracked `.husky/pre-push` and (optionally) the husky-generated `.husky/_`. */
async function createFixture(mode: HooksMode): Promise<Fixture> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wt-hooks-")));
  roots.push(root);
  const repo = path.join(root, "repo");
  fs.mkdirSync(path.join(repo, ".husky"), { recursive: true });
  git(repo, "init", "--quiet", "--initial-branch=main");
  fs.writeFileSync(path.join(repo, "README.md"), "init\n");
  fs.writeFileSync(path.join(repo, ".husky", "pre-push"), "echo blocked by pre-push\nexit 1\n", { mode: 0o755 });
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "init");
  git(repo, "branch", "existing");

  if (mode !== "unset" && mode !== "relative-not-installed") {
    const generated = path.join(repo, ".husky", "_");
    fs.mkdirSync(generated);
    fs.writeFileSync(path.join(generated, ".gitignore"), "*");
    fs.writeFileSync(path.join(generated, "h"), H_SCRIPT, { mode: 0o755 });
    for (const hook of ["pre-push", "pre-commit"]) {
      fs.writeFileSync(path.join(generated, hook), WRAPPER, { mode: 0o755 });
    }
  }
  if (mode === "relative" || mode === "relative-not-installed") git(repo, "config", "core.hooksPath", ".husky/_");
  if (mode === "absolute") git(repo, "config", "core.hooksPath", path.join(repo, ".husky", "_"));

  const worktreeStore = new InMemoryWorktreeStore();
  const codebaseStore = new InMemoryCodebaseStore();
  await codebaseStore.add(createCodebase({ id: CODEBASE_ID, workspaceId: "default", repoPath: repo, branch: "main" }));
  routaSystem.current = { worktreeStore, codebaseStore };
  return { root, repo, service: new GitWorktreeService(worktreeStore, codebaseStore), worktreeStore };
}

function hooksDir(wt: string): string {
  return path.resolve(wt, git(wt, "rev-parse", "--git-path", "hooks").trim());
}

function snapshotDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    out[name] = `${fs.statSync(full).mode}:${fs.readFileSync(full).toString("base64")}`;
  }
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
    expect(fs.existsSync(root)).toBe(false);
  }
});

// Both `git worktree add` paths: new branch (-b) and an already existing branch.
const BRANCH_PATHS = [
  { name: "new branch (worktree add -b)", branch: "issue/new-card" },
  { name: "existing branch (worktree add <branch>)", branch: "existing" },
];

describe("GitWorktreeService worktree hooks", () => {
  it.each(BRANCH_PATHS)("$name: the worktree's hooks dir exists with executable hooks copied byte-for-byte", async ({ branch }) => {
    const fx = await createFixture("relative");
    const wt = await fx.service.createWorktree(CODEBASE_ID, { branch, worktreeRoot: path.join(fx.root, "wts") });

    expect(wt.status).toBe("active");
    const dir = hooksDir(wt.worktreePath);
    expect(dir).toBe(path.join(wt.worktreePath, ".husky", "_"));
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
    for (const name of ["pre-push", "pre-commit", "h", ".gitignore"]) {
      const copied = path.join(dir, name);
      const original = path.join(fx.repo, ".husky", "_", name);
      expect(fs.lstatSync(copied).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(copied).equals(fs.readFileSync(original))).toBe(true);
      expect(fs.statSync(copied).mode).toBe(fs.statSync(original).mode);
    }
    for (const name of ["pre-push", "h"]) {
      expect(fs.statSync(path.join(dir, name)).mode & 0o111).not.toBe(0);
    }
    // The generated dir stays ignored, so the worktree is clean.
    expect(git(wt.worktreePath, "status", "--porcelain").trim()).toBe("");
  });

  it.each(BRANCH_PATHS)("$name: git push from the worktree runs pre-push and is rejected", async ({ branch }) => {
    const fx = await createFixture("relative");
    const origin = path.join(fx.root, "origin.git");
    git(fx.root, "init", "--quiet", "--bare", origin);
    git(fx.repo, "remote", "add", "origin", origin);
    const wt = await fx.service.createWorktree(CODEBASE_ID, { branch, worktreeRoot: path.join(fx.root, "wts") });
    fs.writeFileSync(path.join(wt.worktreePath, "card.txt"), "card\n");
    git(wt.worktreePath, "add", "card.txt");
    git(wt.worktreePath, "commit", "--quiet", "-m", "card");

    let pushError = "";
    try {
      git(wt.worktreePath, "push", "origin", branch);
    } catch (err) {
      pushError = String((err as { stdout?: string }).stdout ?? "") + String((err as { stderr?: string }).stderr ?? "");
    }
    expect(pushError).toContain("blocked by pre-push");
    expect(git(origin, "rev-list", "--all", "--count").trim()).toBe("0");
  });

  it.each(["unset", "absolute"] as const)("hooksPath %s: worktree is created unchanged and config untouched", async (mode) => {
    const fx = await createFixture(mode);
    const configBefore = fs.readFileSync(path.join(fx.repo, ".git", "config"));
    const wt = await fx.service.createWorktree(CODEBASE_ID, { branch: "issue/x", worktreeRoot: path.join(fx.root, "wts") });

    expect(wt.status).toBe("active");
    expect((await fx.worktreeStore.get(wt.id))?.status).toBe("active");
    expect(fs.existsSync(path.join(wt.worktreePath, ".husky", "_"))).toBe(false);
    expect(fs.readFileSync(path.join(fx.repo, ".git", "config")).equals(configBefore)).toBe(true);
  });

  it("relative hooksPath not installed in the main checkout: created active, reason logged", async () => {
    const fx = await createFixture("relative-not-installed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wt = await fx.service.createWorktree(CODEBASE_ID, { branch: "issue/x", worktreeRoot: path.join(fx.root, "wts") });

    expect(wt.status).toBe("active");
    expect(fs.existsSync(path.join(wt.worktreePath, ".husky", "_"))).toBe(false);
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/hooks not prepared.*\.husky\/_.*missing/);
  });

  it("copy failure (unreadable generated dir): created active, reason logged", async () => {
    const fx = await createFixture("relative");
    const generated = path.join(fx.repo, ".husky", "_");
    fs.chmodSync(generated, 0o000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const wt = await fx.service.createWorktree(CODEBASE_ID, { branch: "issue/x", worktreeRoot: path.join(fx.root, "wts") });
      expect(wt.status).toBe("active");
      expect((await fx.worktreeStore.get(wt.id))?.status).toBe("active");
      expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/hooks not prepared/);
    } finally {
      fs.chmodSync(generated, 0o755);
    }
  });

  it("worktree already has the hooks dir from the branch: not overwritten, no error", async () => {
    const fx = await createFixture("relative");
    git(fx.repo, "checkout", "--quiet", "existing");
    // Commit a branch-owned `.husky/_/marker` (force-added past the `*` ignore).
    fs.writeFileSync(path.join(fx.repo, ".husky", "_", "marker"), "branch\n");
    git(fx.repo, "add", "-f", ".husky/_/marker");
    git(fx.repo, "commit", "--quiet", "-m", "branch hooks");
    git(fx.repo, "checkout", "--quiet", "main");
    expect(fs.existsSync(path.join(fx.repo, ".husky", "_", "marker"))).toBe(false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const wt = await fx.service.createWorktree(CODEBASE_ID, { branch: "existing", worktreeRoot: path.join(fx.root, "wts") });
    expect(wt.status).toBe("active");
    expect(fs.readdirSync(path.join(wt.worktreePath, ".husky", "_"))).toEqual(["marker"]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("main checkout config and hooks are untouched by create + remove", async () => {
    const fx = await createFixture("relative");
    const configPath = path.join(fx.repo, ".git", "config");
    const configBefore = fs.readFileSync(configPath);
    const hooksBefore = snapshotDir(path.join(fx.repo, ".husky", "_"));

    const wt = await fx.service.createWorktree(CODEBASE_ID, { branch: "issue/x", worktreeRoot: path.join(fx.root, "wts") });
    expect(fs.readFileSync(configPath).equals(configBefore)).toBe(true);
    expect(git(fx.repo, "config", "--get", "core.hooksPath").trim()).toBe(".husky/_");
    expect(fs.existsSync(path.join(fx.repo, ".git", "worktrees", path.basename(wt.worktreePath), "config.worktree"))).toBe(false);

    await fx.service.removeWorktree(wt.id, { deleteBranch: true });
    expect(fs.existsSync(wt.worktreePath)).toBe(false);
    expect(fs.readFileSync(configPath).equals(configBefore)).toBe(true);
    expect(snapshotDir(path.join(fx.repo, ".husky", "_"))).toEqual(hooksBefore);
  });

  it("API entry POST /api/workspaces/{}/codebases/{}/worktrees creates a worktree with hooks", async () => {
    const fx = await createFixture("relative");
    // The route uses the default worktree root (~/.routa/worktrees); keep it inside the fixture.
    vi.spyOn(os, "homedir").mockReturnValue(path.join(fx.root, "home"));
    const request = new NextRequest("http://localhost/api/workspaces/default/codebases/cb-hooks/worktrees", {
      method: "POST",
      body: JSON.stringify({ branch: "issue/api" }),
      headers: { "content-type": "application/json" },
    });
    const response = await createWorktreeRoute(request, { params: Promise.resolve({ workspaceId: "default", codebaseId: CODEBASE_ID }) });

    expect(response.status).toBe(201);
    const { worktree } = (await response.json()) as { worktree: { worktreePath: string; status: string } };
    expect(worktree.status).toBe("active");
    expect(worktree.worktreePath.startsWith(fx.root)).toBe(true);
    const hook = path.join(hooksDir(worktree.worktreePath), "pre-push");
    expect(fs.statSync(hook).mode & 0o111).not.toBe(0);
  });
});
