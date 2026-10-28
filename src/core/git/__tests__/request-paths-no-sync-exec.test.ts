/**
 * C5/F4: request paths must not call execFileSync (safeExecSync / gitExecSync),
 * which blocks the Node event loop for the whole git run.
 */
import { NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execSpy = vi.hoisted(() => ({ calls: 0 }));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  const mocked = {
    ...actual,
    execFileSync: ((...args: Parameters<typeof actual.execFileSync>) => {
      execSpy.calls += 1;
      return actual.execFileSync(...args);
    }) as typeof actual.execFileSync,
  };
  return { ...mocked, default: mocked };
});

const store = vi.hoisted(() => ({ repoPath: "" }));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({
    workspaceStore: { list: async () => [{ id: "ws-1" }] },
    codebaseStore: {
      listByWorkspace: async () => [{ id: "cb-1", workspaceId: "ws-1", repoPath: store.repoPath, branch: "main", label: "demo" }],
      update: async () => undefined,
    },
  }),
}));

import { GET as getBranches, PATCH as patchBranches } from "@/app/api/clone/branches/route";
import { GET as getChanges } from "@/app/api/workspaces/[workspaceId]/codebases/changes/route";
import { buildTaskDeliveryReadiness } from "@/core/kanban/task-delivery-readiness";
import { commitFile, makeRepo, runGit } from "./git-test-fixtures";
import { resetPullCooldown } from "../pull-cooldown";
import { getCurrentBranch } from "../git-utils";

describe("request paths never use synchronous git exec", () => {
  let repo: string;
  beforeEach(() => {
    vi.stubEnv("ROUTA_DB_DRIVER", "memory");
    repo = makeRepo();
    store.repoPath = repo;
    resetPullCooldown();
    execSpy.calls = 0;
  });
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("sanity: the spy sees synchronous git helpers", () => {
    getCurrentBranch(repo);
    expect(execSpy.calls).toBeGreaterThan(0);
  });

  it("GET /api/clone/branches", async () => {
    const res = await getBranches(new NextRequest(`http://localhost/api/clone/branches?repoPath=${encodeURIComponent(repo)}`));
    expect(res.status).toBe(200);
    expect(execSpy.calls).toBe(0);
  });

  it("PATCH /api/clone/branches (checkout + pull, then cooled-down repeat)", async () => {
    // No remote: the pull itself fails, which is fine; only the exec style matters.
    for (let i = 0; i < 2; i++) {
      const res = await patchBranches(new NextRequest("http://localhost/api/clone/branches", {
        method: "PATCH", body: JSON.stringify({ repoPath: repo, branch: "main", pull: true }),
      }));
      expect(res.status).toBe(200);
    }
    expect(execSpy.calls).toBe(0);
  });

  it("GET codebases/changes", async () => {
    fs.writeFileSync(path.join(repo, "dirty.txt"), "x");
    execSpy.calls = 0;
    const res = await getChanges(new Request("http://localhost/x"), { params: Promise.resolve({ workspaceId: "ws-1" }) });
    const data = await res.json();
    expect(data.repos[0].files).toHaveLength(1);
    expect(execSpy.calls).toBe(0);
  });

  it("buildTaskDeliveryReadiness (used by tasks/[taskId] at 94/535/579)", async () => {
    runGit(repo, "checkout", "-q", "-b", "card/x");
    commitFile(repo, "x.txt");
    const system = {
      codebaseStore: {
        get: async () => ({ id: "cb-1", repoPath: repo, branch: "card/x", sourceType: "local" }),
        getDefault: async () => ({ id: "cb-1", repoPath: repo, branch: "main", sourceType: "local" }),
      },
      worktreeStore: {
        get: async () => ({ id: "wt-1", codebaseId: "cb-1", worktreePath: repo, branch: "card/x", baseBranch: "main" }),
      },
    };
    execSpy.calls = 0; // test setup above used the same (spied) execFileSync
    const readiness = await buildTaskDeliveryReadiness(
      { id: "t1", workspaceId: "ws-1", codebaseIds: ["cb-1"], worktreeId: "wt-1", title: "t" } as never,
      system as never,
    );
    expect(readiness.checked).toBe(true);
    expect(readiness.hasCommitsSinceBase).toBe(true);
    expect(readiness.hasUncommittedChanges).toBe(false);
    expect(execSpy.calls).toBe(0);
  });

  it("static check: the four request-path files do not import the sync git helpers", () => {
    const root = path.resolve(__dirname, "../../../..");
    const files = [
      "src/app/api/clone/branches/route.ts",
      "src/app/api/workspaces/[workspaceId]/codebases/changes/route.ts",
      "src/core/kanban/task-delivery-readiness.ts",
    ];
    const syncNames = /\b(pullBranch|getRepoChanges|getRepoDeliveryStatus|hasBranchAuthoredCommitsOnHead|isGitRepository|isBareGitRepository|getCurrentBranch|listBranches|checkoutBranch|gitExecSync|safeExecSync|execFileSync)\b(?!Async)/;
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect(src.match(syncNames), f).toBeNull();
    }
  });
});
