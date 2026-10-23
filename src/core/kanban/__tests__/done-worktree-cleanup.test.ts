// @vitest-environment node
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryCodebaseStore } from "../../db/pg-codebase-store";
import { InMemoryWorktreeStore } from "../../db/pg-worktree-store";
import { AgentEventType, EventBus } from "../../events/event-bus";
import { GitWorktreeService } from "../../git/git-worktree-service";
import { createCodebase } from "../../models/codebase";
import { createKanbanBoard, type KanbanColumnAutomation } from "../../models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "../../models/task";
import { createWorktree } from "../../models/worktree";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import {
  DONE_WORKTREE_CLEANUP_ENV,
  runDoneWorktreeCleanup,
  TOPBI_BOARD_ID,
  type WorktreeRemover,
} from "../done-worktree-cleanup";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

const BRANCH = "issue/abcd1234";
const WORKTREE_ID = "wt-abcd1234";
const CODEBASE_ID = "cb-1";

const DONE_STEPS = [
  { id: "main-pusher", role: "GATE" as const, specialistId: "kanban-main-pusher", specialistName: "Main Pusher" },
  { id: "done-reporter", role: "GATE" as const, specialistId: "kanban-done-reporter", specialistName: "Done Reporter" },
];
const DONE_AUTOMATION: KanbanColumnAutomation = { enabled: true, transitionType: "entry", steps: DONE_STEPS };

function lane(sessionId: string, columnId: string, status: TaskLaneSession["status"], stepIndex = 0): TaskLaneSession {
  return { sessionId, columnId, status, stepIndex, startedAt: "2026-10-21T02:00:00.000Z" };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

interface Fixture {
  root: string;
  repo: string;
  wt: string;
  worktreeStore: InMemoryWorktreeStore;
  codebaseStore: InMemoryCodebaseStore;
  service: GitWorktreeService;
}

const roots: string[] = [];

/** origin (bare) ← repo (main) + worktree on BRANCH with one card commit. */
async function createFixture(): Promise<Fixture> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "done-wt-cleanup-")));
  roots.push(root);
  const origin = path.join(root, "origin.git");
  const repo = path.join(root, "repo");
  const wt = path.join(root, "wt");
  git(root, "init", "--bare", "--initial-branch=main", origin);
  git(root, "clone", "--quiet", origin, repo);
  fs.writeFileSync(path.join(repo, "README.md"), "init\n");
  fs.writeFileSync(path.join(repo, ".gitignore"), "ignored/\n");
  git(repo, "checkout", "--quiet", "-B", "main");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "init");
  git(repo, "push", "--quiet", "-u", "origin", "main");
  git(repo, "worktree", "add", "--quiet", "-b", BRANCH, wt, "main");
  fs.writeFileSync(path.join(wt, "feature.txt"), "card change\n");
  git(wt, "add", "feature.txt");
  git(wt, "commit", "--quiet", "-m", "feat: card change");

  const worktreeStore = new InMemoryWorktreeStore();
  const codebaseStore = new InMemoryCodebaseStore();
  await codebaseStore.add(createCodebase({ id: CODEBASE_ID, workspaceId: "default", repoPath: repo, branch: "main" }));
  await worktreeStore.add({
    ...createWorktree({
      id: WORKTREE_ID,
      codebaseId: CODEBASE_ID,
      workspaceId: "default",
      worktreePath: wt,
      branch: BRANCH,
      baseBranch: "main",
    }),
    status: "active",
  });
  return { root, repo, wt, worktreeStore, codebaseStore, service: new GitWorktreeService(worktreeStore, codebaseStore) };
}

/** Land the card commit on origin/main with the same hash. */
function pushBranchToMain(fx: Fixture) {
  git(fx.wt, "push", "--quiet", "origin", `${BRANCH}:main`);
}

function branchExists(fx: Fixture): boolean {
  return git(fx.repo, "branch", "--list", BRANCH).trim().length > 0;
}

async function expectKept(fx: Fixture) {
  expect(fs.existsSync(fx.wt)).toBe(true);
  expect(branchExists(fx)).toBe(true);
  expect(await fx.worktreeStore.get(WORKTREE_ID)).toBeDefined();
}

async function expectRemoved(fx: Fixture) {
  expect(fs.existsSync(fx.wt)).toBe(false);
  expect(branchExists(fx)).toBe(false);
  expect(await fx.worktreeStore.get(WORKTREE_ID)).toBeUndefined();
}

function finishedTask(overrides: Partial<Task> = {}): Task {
  return {
    ...createTask({
      id: "card-847cd543",
      title: "Finished card",
      objective: "cleanup",
      workspaceId: "default",
      boardId: "main-board",
      columnId: "done",
      status: TaskStatus.COMPLETED,
    }),
    worktreeId: WORKTREE_ID,
    laneSessions: [lane("pusher-1", "done", "completed", 0), lane("reporter-1", "done", "completed", 1)],
    ...overrides,
  };
}

function runCleanup(fx: Fixture, task: Task, remover: WorktreeRemover = fx.service) {
  return runDoneWorktreeCleanup(
    { task, columnId: "done", automation: DONE_AUTOMATION, worktreeStore: fx.worktreeStore, codebaseStore: fx.codebaseStore },
    remover,
  );
}

let logLines: string[] = [];

beforeEach(() => {
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "info").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function expectSkipLog(taskId: string, reasonFragment: string) {
  const line = logLines.find((entry) => entry.startsWith("[DoneWorktreeCleanup]") && entry.includes(`card=${taskId}`));
  expect(line, logLines.join("\n")).toBeDefined();
  expect(line).toContain("result=skipped");
  expect(line).toContain(reasonFragment);
}

describe("done worktree cleanup — safety checks on a real git repo", { timeout: 30_000 }, () => {
  it("AC2: removes the copy when origin/main has the same patch under a different commit (rebase)", async () => {
    const fx = await createFixture();
    fs.writeFileSync(path.join(fx.repo, "other.txt"), "someone else\n");
    git(fx.repo, "add", "other.txt");
    git(fx.repo, "commit", "--quiet", "-m", "chore: other work");
    const cardCommit = git(fx.wt, "rev-parse", "HEAD").trim();
    git(fx.repo, "cherry-pick", cardCommit);
    git(fx.repo, "push", "--quiet", "origin", "main");
    expect(git(fx.repo, "rev-parse", "origin/main").trim()).not.toBe(cardCommit);
    expect(git(fx.repo, "branch", "-r", "--contains", cardCommit).trim()).toBe("");

    const result = await runCleanup(fx, finishedTask());

    expect(result).toEqual({ result: "removed", worktreeId: WORKTREE_ID });
    await expectRemoved(fx);
    expect(logLines.some((entry) => entry.startsWith("[DoneWorktreeCleanup] card=card-847cd543") && entry.includes("result=removed"))).toBe(true);
  });

  it("AC3: keeps the copy when a tracked file has uncommitted changes", async () => {
    const fx = await createFixture();
    pushBranchToMain(fx);
    fs.appendFileSync(path.join(fx.wt, "feature.txt"), "edit\n");
    const removeSpy = vi.spyOn(fx.service, "removeWorktree");

    expect((await runCleanup(fx, finishedTask())).result).toBe("skipped");

    expect(removeSpy).not.toHaveBeenCalled();
    await expectKept(fx);
    expectSkipLog("card-847cd543", "worktree-dirty (1 uncommitted, 0 untracked)");
  });

  it("AC3: keeps the copy when an untracked file is not ignored (ignored files do not block)", async () => {
    const fx = await createFixture();
    pushBranchToMain(fx);
    fs.mkdirSync(path.join(fx.wt, "ignored"));
    fs.writeFileSync(path.join(fx.wt, "ignored", "cache.bin"), "x");
    fs.writeFileSync(path.join(fx.wt, "notes.txt"), "draft\n");
    const removeSpy = vi.spyOn(fx.service, "removeWorktree");

    expect((await runCleanup(fx, finishedTask())).result).toBe("skipped");

    expect(removeSpy).not.toHaveBeenCalled();
    await expectKept(fx);
    expectSkipLog("card-847cd543", "worktree-dirty (0 uncommitted, 1 untracked)");
  });

  it("AC3: keeps the copy when a branch commit has no matching patch-id on origin/main", async () => {
    const fx = await createFixture();
    const removeSpy = vi.spyOn(fx.service, "removeWorktree");

    expect((await runCleanup(fx, finishedTask())).result).toBe("skipped");

    expect(removeSpy).not.toHaveBeenCalled();
    await expectKept(fx);
    expectSkipLog("card-847cd543", "not-on-origin/main (1 commit(s) without matching patch-id");
  });

  it("AC3: keeps the copy when git fetch origin fails", async () => {
    const fx = await createFixture();
    pushBranchToMain(fx);
    git(fx.repo, "remote", "set-url", "origin", path.join(fx.root, "missing-origin.git"));
    const removeSpy = vi.spyOn(fx.service, "removeWorktree");

    expect((await runCleanup(fx, finishedTask())).result).toBe("skipped");

    expect(removeSpy).not.toHaveBeenCalled();
    await expectKept(fx);
    expectSkipLog("card-847cd543", "git-fetch-failed");
  });

  it("AC3: keeps the copy of a TopBI Board card even when it is on origin/main", async () => {
    const fx = await createFixture();
    pushBranchToMain(fx);
    const removeSpy = vi.spyOn(fx.service, "removeWorktree");

    expect((await runCleanup(fx, finishedTask({ boardId: TOPBI_BOARD_ID }))).result).toBe("skipped");

    expect(removeSpy).not.toHaveBeenCalled();
    await expectKept(fx);
    expectSkipLog("card-847cd543", "topbi-board");
  });

  it("AC6: ROUTA_AUTO_CLEANUP_DONE_WORKTREE=0 keeps the copy; unset removes it by default", async () => {
    const fx = await createFixture();
    pushBranchToMain(fx);
    const removeSpy = vi.spyOn(fx.service, "removeWorktree");

    vi.stubEnv(DONE_WORKTREE_CLEANUP_ENV, "0");
    expect((await runCleanup(fx, finishedTask())).result).toBe("skipped");
    expect(removeSpy).not.toHaveBeenCalled();
    await expectKept(fx);
    expectSkipLog("card-847cd543", `disabled (${DONE_WORKTREE_CLEANUP_ENV}=0)`);

    vi.unstubAllEnvs();
    delete process.env[DONE_WORKTREE_CLEANUP_ENV];
    expect((await runCleanup(fx, finishedTask())).result).toBe("removed");
    expect(removeSpy).toHaveBeenCalledWith(WORKTREE_ID, { deleteBranch: true });
    await expectRemoved(fx);
  });
});

async function setupDoneLane(fx: Fixture, prefix: string, remover: WorktreeRemover, order: string[] = []) {
  const eventBus = new EventBus();
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const killSession = vi.fn(async (sessionId: string) => {
    order.push(`kill:${sessionId}`);
  });
  const taskId = `${prefix}-task`;
  const createSession = vi.fn(async (params: { stepIndex: number }) => {
    const sessionId = params.stepIndex === 0 ? "pusher-1" : "reporter-1";
    const current = await taskStore.get(taskId);
    await taskStore.save({
      ...current!,
      triggerSessionId: sessionId,
      sessionIds: [...(current!.sessionIds ?? []), sessionId],
      laneSessions: [...(current!.laneSessions ?? []), lane(sessionId, "done", "running", params.stepIndex)],
    });
    return sessionId;
  });

  const board = createKanbanBoard({
    id: `${prefix}-board`,
    workspaceId: "default",
    name: "Main Board",
    isDefault: true,
    columns: [
      { id: "review", name: "Review", stage: "review", position: 0 },
      { id: "done", name: "Done", stage: "done", position: 1, automation: DONE_AUTOMATION },
    ],
  });
  await boardStore.save(board);
  await taskStore.save({
    ...createTask({
      id: taskId,
      title: "Done lane cleanup",
      objective: "Remove the merged worktree after teardown",
      workspaceId: "default",
      boardId: board.id,
      columnId: "done",
      status: TaskStatus.COMPLETED,
    }),
    worktreeId: WORKTREE_ID,
    sessionIds: ["dev-1"],
    laneSessions: [lane("dev-1", "dev", "completed", 0), lane("review-1", "review", "completed", 1)],
  });

  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession as never, killSession);
  orchestrator.setDoneWorktreeCleanup(async ({ task, columnId, automation }) => {
    await runDoneWorktreeCleanup(
      { task, columnId, automation, worktreeStore: fx.worktreeStore, codebaseStore: fx.codebaseStore },
      remover,
    );
  });
  orchestrator.start();
  await orchestrator.processColumnTransition({
    cardId: taskId,
    cardTitle: "Done lane cleanup",
    boardId: board.id,
    workspaceId: "default",
    fromColumnId: "review",
    toColumnId: "done",
  });
  return { eventBus, orchestrator, taskStore, taskId, createSession, killSession };
}

function emit(eventBus: EventBus, type: AgentEventType, sessionId: string, data: Record<string, unknown> = {}) {
  eventBus.emit({ type, agentId: sessionId, workspaceId: "default", data: { sessionId, ...data }, timestamp: new Date() });
}

async function settle(ms = 200) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("done worktree cleanup — orchestrator wiring", { timeout: 30_000 }, () => {
  it("AC1: removes the merged copy, branch and record after the last Done step and every session ended", async () => {
    const fx = await createFixture();
    pushBranchToMain(fx);
    const order: string[] = [];
    const remover: WorktreeRemover = {
      removeWorktree: async (id, options) => {
        order.push("remove");
        await fx.service.removeWorktree(id, options);
      },
    };
    const { eventBus, orchestrator, taskStore, taskId, killSession } = await setupDoneLane(fx, "merged", remover, order);

    emit(eventBus, AgentEventType.AGENT_COMPLETED, "pusher-1", { success: true });
    await vi.waitFor(() => expect(orchestrator.getAutomationForCard(taskId)).toMatchObject({ sessionId: "reporter-1" }));
    await settle(50);
    // The pusher's step is over, so its own process is ended; the copy stays.
    expect(order).toEqual(["kill:pusher-1"]);
    await expectKept(fx);

    emit(eventBus, AgentEventType.AGENT_COMPLETED, "reporter-1", { success: true });
    await vi.waitFor(async () => expectRemoved(fx), { timeout: 10_000 });

    expect(killSession).toHaveBeenCalledTimes(4);
    expect(order.indexOf("remove")).toBe(order.length - 1);
    const saved = await taskStore.get(taskId);
    expect(saved).toMatchObject({ status: TaskStatus.COMPLETED, columnId: "done" });
  });

  it("AC4: waits for the deferred reporter session to be ended before removing the copy", async () => {
    const fx = await createFixture();
    pushBranchToMain(fx);
    const order: string[] = [];
    const remover: WorktreeRemover = {
      removeWorktree: async (id, options) => {
        order.push("remove");
        await fx.service.removeWorktree(id, options);
      },
    };
    const { eventBus, orchestrator, taskId, killSession } = await setupDoneLane(fx, "deferred", remover, order);

    emit(eventBus, AgentEventType.AGENT_COMPLETED, "pusher-1", { success: true });
    await vi.waitFor(() => expect(orchestrator.getAutomationForCard(taskId)).toMatchObject({ sessionId: "reporter-1" }));
    emit(eventBus, AgentEventType.AGENT_COMPLETED, "reporter-1", { success: true, synthesizedBy: "updateTask" });
    await vi.waitFor(() => expect(killSession).toHaveBeenCalledTimes(3));
    await settle();
    expect(killSession).not.toHaveBeenCalledWith("reporter-1");
    expect(order).not.toContain("remove");
    await expectKept(fx);

    emit(eventBus, AgentEventType.AGENT_COMPLETED, "reporter-1", { success: true });
    await vi.waitFor(async () => expectRemoved(fx), { timeout: 10_000 });

    expect(order.indexOf("kill:reporter-1")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("remove")).toBeGreaterThan(order.indexOf("kill:reporter-1"));
    expect(order.filter((entry) => entry === "remove")).toHaveLength(1);
  });

  it("AC5: a removeWorktree error leaves the card COMPLETED in done, without re-runs or comments", async () => {
    const fx = await createFixture();
    pushBranchToMain(fx);
    const remover: WorktreeRemover = {
      removeWorktree: vi.fn(async () => {
        throw new Error("disk busy");
      }),
    };
    const { eventBus, orchestrator, taskStore, taskId, createSession } = await setupDoneLane(fx, "remove-fails", remover);

    emit(eventBus, AgentEventType.AGENT_COMPLETED, "pusher-1", { success: true });
    await vi.waitFor(() => expect(orchestrator.getAutomationForCard(taskId)).toMatchObject({ sessionId: "reporter-1" }));
    const before = await taskStore.get(taskId);
    emit(eventBus, AgentEventType.AGENT_COMPLETED, "reporter-1", { success: true });
    await vi.waitFor(() => expect(remover.removeWorktree).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    await settle();

    // The teardown exits that follow must not re-run the lane either.
    for (const sessionId of ["dev-1", "review-1", "pusher-1", "reporter-1"]) {
      emit(eventBus, AgentEventType.AGENT_FAILED, sessionId, { success: false, error: "process exited" });
    }
    await settle();

    const saved = await taskStore.get(taskId);
    expect(saved).toMatchObject({ status: TaskStatus.COMPLETED, columnId: "done" });
    expect(saved?.comments).toEqual(before?.comments);
    expect(saved?.comment).toEqual(before?.comment);
    expect(saved?.lastSyncError).toBeUndefined();
    expect(saved?.laneSessions?.filter((entry) => entry.status === "failed")).toEqual([]);
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(remover.removeWorktree).toHaveBeenCalledTimes(1);
    expect(logLines.some((entry) => entry.includes("[DoneWorktreeCleanup]") && entry.includes("result=failed") && entry.includes("disk busy"))).toBe(true);
    await expectKept(fx);
  });
});
