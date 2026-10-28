/**
 * Real route + real git against throwaway repos, with a fake `git` on PATH that
 * counts `git pull`. Covers the 10 minute cooldown, async (non-blocking) pull,
 * and that the manual pull endpoint is never affected by the cooldown.
 */
import { NextRequest } from "next/server";
import * as fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installFakeGit,
  makeRepo,
  makeTempDir,
  runGit,
  type FakeGit,
} from "@/core/git/__tests__/git-test-fixtures";
import { resetPullCooldown, setPullCooldownClock } from "@/core/git/pull-cooldown";

const systemMock = vi.hoisted(() => ({
  codebase: { id: "cb-1", repoPath: "" },
}));

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => ({
    workspaceStore: {
      list: async () => [{ id: "ws-1" }],
      get: async () => ({ id: "ws-1" }),
    },
    codebaseStore: {
      listByWorkspace: async () => [],
      get: async () => systemMock.codebase,
      update: async () => undefined,
    },
  }),
}));

import { GET, PATCH } from "../route";
import { POST as manualPull } from "@/app/api/workspaces/[workspaceId]/codebases/[codebaseId]/git/pull/route";

const MIN = 60 * 1000;

function patch(repoPath: string, extra: Record<string, unknown> = {}) {
  return PATCH(new NextRequest("http://localhost/api/clone/branches", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoPath, branch: "main", pull: true, ...extra }),
  }));
}

describe("PATCH /api/clone/branches pull cooldown", () => {
  let fake: FakeGit;
  let repoA: string;
  let repoB: string;
  let now: number;
  const dirs: string[] = [];

  beforeEach(() => {
    vi.stubEnv("ROUTA_DB_DRIVER", "memory");
    fake = installFakeGit();
    repoA = makeRepo();
    repoB = makeRepo();
    dirs.push(repoA, repoB);
    now = 0;
    resetPullCooldown();
    setPullCooldownClock(() => now);
  });
  afterEach(() => {
    fake.restore();
    setPullCooldownClock(null);
    resetPullCooldown();
    vi.unstubAllEnvs();
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("C1: pulls once, skips within 10 minutes, pulls again after", async () => {
    const first = await (await patch(repoA)).json();
    expect(fake.pullCount()).toBe(1);
    expect(first.pullSkipped).toBeUndefined();
    expect(first.success).toBe(true);

    now = 9 * MIN + 59_000;
    const second = await (await patch(repoA)).json();
    expect(fake.pullCount()).toBe(1);
    expect(second.pullSkipped).toBe(true);
    expect(second.pullSkipReason).toBe("cooldown");
    expect(second.branch).toBe(first.branch);

    now = 10 * MIN + 1_000;
    const third = await (await patch(repoA)).json();
    expect(fake.pullCount()).toBe(2);
    expect(third.pullSkipped).toBeUndefined();
  });

  it("C1: two simultaneous pulls for one repo run git pull once", async () => {
    process.env.FAKE_GIT_SLEEP = "0.3";
    const [a, b] = await Promise.all([patch(repoA), patch(repoA)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(fake.pullCount()).toBe(1);
  });

  it("C2: a failed pull is not cooled down; other repos are independent", async () => {
    process.env.FAKE_GIT_PULL_EXIT = "1";
    const failed = await patch(repoA);
    expect(failed.status).toBe(200); // pull failure never failed this endpoint
    expect((await failed.json()).pullSkipped).toBeUndefined();
    await patch(repoA);
    expect(fake.pullCount()).toBe(2);

    delete process.env.FAKE_GIT_PULL_EXIT;
    await patch(repoA); // succeeds, enters cooldown
    expect(fake.pullCount()).toBe(3);
    await patch(repoB);
    expect(fake.pullCount()).toBe(4); // B unaffected by A's cooldown
    await patch(repoA);
    expect(fake.pullCount()).toBe(4);
  });

  it("C3: the manual pull endpoint ignores the cooldown", async () => {
    systemMock.codebase = { id: "cb-1", repoPath: repoA };
    await patch(repoA); // auto pull, now cooling down
    expect(fake.pullCount()).toBe(1);

    const res = await manualPull(
      new Request("http://localhost/x", { method: "POST", body: JSON.stringify({}) }),
      { params: Promise.resolve({ workspaceId: "ws-1", codebaseId: "cb-1" }) },
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data).toEqual({ success: true });
    expect(fake.pullCount()).toBe(2);
  });

  it("F2: pull:false only checks out; checkout still happens during cooldown", async () => {
    runGit(repoA, "branch", "other");
    const before = runGit(repoA, "rev-parse", "HEAD");
    const res = await (await patch(repoA, { pull: false })).json();
    expect(fake.pullCount()).toBe(0);
    expect(res.pullSkipped).toBeUndefined();
    expect(runGit(repoA, "rev-parse", "HEAD")).toBe(before);

    await patch(repoA); // cooldown starts
    const sw = await (await patch(repoA, { branch: "other" })).json();
    expect(sw.pullSkipped).toBe(true);
    expect(sw.branch).toBe("other");
    expect(runGit(repoA, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("other");
  });

  it("C12: bad input keeps its status codes and writes no cooldown", async () => {
    const missing = await PATCH(new NextRequest("http://localhost/api/clone/branches", {
      method: "PATCH", body: JSON.stringify({ branch: "main", pull: true }),
    }));
    expect(missing.status).toBe(400);
    const nonexistent = await patch("/definitely/not/here");
    expect(nonexistent.status).toBe(404);
    const notGit = makeTempDir();
    dirs.push(notGit);
    await patch(notGit);
    expect(fake.pullCount()).toBe(0);
    await patch(repoA);
    expect(fake.pullCount()).toBe(1);
  });

  it("GET returns branch info for a real repo", async () => {
    const res = await GET(new NextRequest(`http://localhost/api/clone/branches?repoPath=${encodeURIComponent(repoA)}`));
    const data = await res.json();
    expect(data.current).toBe("main");
    expect(data.local).toEqual(["main"]);
  });
});
