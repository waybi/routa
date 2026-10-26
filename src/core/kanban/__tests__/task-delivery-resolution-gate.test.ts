// @vitest-environment node
/**
 * Card 64f2e31c (AC6, C5, F4): the Done gate accepts a card with 0 own commits
 * when the Blocked resolver concluded landed / superseded, through both move
 * entries (PATCH columnId and MCP move_card). A new branch without a
 * conclusion, a dirty worktree and a Review target are still rejected; the
 * old "own commits already fast-forwarded" path still passes. Real git repos
 * under the OS temp dir.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createKanbanBoard, type KanbanColumn } from "@/core/models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "@/core/models/task";
import { InMemoryKanbanBoardStore } from "@/core/store/kanban-board-store";
import { InMemoryTaskStore } from "@/core/store/task-store";

const emitColumnTransition = vi.fn();
const root = mkdtempSync(path.join(tmpdir(), "routa-resolution-gate-"));
const taskStore = new InMemoryTaskStore();
const kanbanBoardStore = new InMemoryKanbanBoardStore();
let repoPath = "";
const codebaseStore = {
  get: vi.fn(async () => ({ id: "cb", workspaceId: "default", repoPath, branch: "main", isDefault: true })),
  getDefault: vi.fn(async () => undefined),
  findByRepoPath: vi.fn(async () => undefined),
};
const system = {
  taskStore,
  kanbanBoardStore,
  codebaseStore,
  worktreeStore: { get: vi.fn(async () => undefined), assignSession: vi.fn() },
  workspaceStore: { get: vi.fn(async () => undefined) },
  eventBus: {},
  artifactStore: undefined,
};

vi.mock("@/core/routa-system", () => ({ getRoutaSystem: () => system }));
vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({ getKanbanEventBroadcaster: () => ({ notify: vi.fn() }) }));
vi.mock("@/core/kanban/task-board-context", () => ({ ensureTaskBoardContext: vi.fn(async () => ({})) }));
vi.mock("@/core/kanban/github-issues", () => ({ updateGitHubIssue: vi.fn() }));
vi.mock("@/core/kanban/column-transition", () => ({ emitColumnTransition: (...args: unknown[]) => emitColumnTransition(...args) }));
vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  endKanbanTaskSessions: vi.fn(async () => undefined),
  forgetKanbanCard: vi.fn(),
  enqueueKanbanTaskSession: vi.fn(async () => ({ queued: false })),
  getKanbanSessionQueue: () => ({ removeCardJob: vi.fn() }),
  processKanbanColumnTransition: vi.fn(),
}));

import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { KanbanTools } from "@/core/tools/kanban-tools";
import { buildTaskDeliveryReadiness, buildTaskDeliveryTransitionErrorFromRules } from "../task-delivery-readiness";
import { collectTaskAttentionItems } from "../attention-rules";
import { decideAttentionRouting, toAttentionTask } from "../attention-to-blocked";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const DELIVERY = { requireCommittedChanges: true, requireCleanWorktree: true, requirePullRequestReady: true };
const COLUMNS: KanbanColumn[] = [
  { id: "review", name: "Review", stage: "review", position: 0, automation: { enabled: false, deliveryRules: { requireCommittedChanges: true, requireCleanWorktree: true } } },
  { id: "done", name: "Done", stage: "done", position: 1, automation: { enabled: false, deliveryRules: DELIVERY } },
  { id: "blocked", name: "Blocked", stage: "blocked", position: 2 },
  { id: "dev", name: "Dev", stage: "dev", position: 3 },
  // A plain lane: moving into Dev would also create a worktree, which is not under test here.
  { id: "todo", name: "Todo", stage: "todo", position: 4 },
];

let caseNo = 0;
/** A fresh origin + clone on branch issue/<n> cut from origin/main; returns the clone path. */
function freshRepo(): string {
  caseNo += 1;
  const origin = path.join(root, `origin-${caseNo}.git`);
  const seed = path.join(root, `seed-${caseNo}`);
  const work = path.join(root, `work-${caseNo}`);
  execFileSync("git", ["init", "--bare", "-b", "main", origin]);
  execFileSync("git", ["init", "-b", "main", seed]);
  git(seed, "config", "user.email", "t@example.com");
  git(seed, "config", "user.name", "t");
  writeFileSync(path.join(seed, "a.txt"), "a\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "base");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "origin", "main");
  execFileSync("git", ["clone", origin, work]);
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "t");
  git(work, "checkout", "-b", `issue/${caseNo}`, "origin/main");
  return work;
}

async function seedCard(extra: Partial<Task> = {}): Promise<Task> {
  const task = {
    ...createTask({
      id: `card-${caseNo}`, title: "Gate", objective: "Gate", workspaceId: "default", boardId: "board-1",
      columnId: "blocked", status: TaskStatus.BLOCKED, codebaseIds: ["cb"],
    }),
    ...extra,
  };
  await taskStore.save(task);
  return task;
}

const landed = { category: "landed" as const, conclusion: "已进主干", resolvedAt: "2026-10-26T08:00:00.000Z", ref: "abc" };
const superseded = { ...landed, category: "superseded" as const };

async function viaPatch(cardId: string, body: Record<string, unknown>) {
  const response = await PATCH(new NextRequest(`http://localhost/api/tasks/${cardId}`, {
    method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ taskId: cardId }) });
  return { status: response.status, data: await response.json() };
}

async function viaMoveCard(cardId: string, target: string) {
  const tools = new KanbanTools(kanbanBoardStore, taskStore);
  tools.setEventBus({ emit: vi.fn() } as never);
  tools.setAutomationSystem(system as never);
  return tools.moveCard({ cardId, targetColumnId: target });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await kanbanBoardStore.save(createKanbanBoard({ id: "board-1", workspaceId: "default", name: "B", columns: COLUMNS }));
  repoPath = freshRepo();
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Done gate with attentionResolution (C5)", () => {
  it.each([["landed", landed], ["superseded", superseded]])("0 commits + %s: PATCH passes and emits blocked→done", async (_label, resolution) => {
    const task = await seedCard({ attentionResolution: resolution });
    const { status } = await viaPatch(task.id, { columnId: "done" });
    expect(status).toBe(200);
    expect((await taskStore.get(task.id))?.columnId).toBe("done");
    expect(emitColumnTransition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ fromColumnId: "blocked", toColumnId: "done" }));
    // Done keeps the conclusion: the Done gate and the main pusher read it.
    expect((await taskStore.get(task.id))?.attentionResolution?.category).toBe(resolution.category);
  });

  it.each([["landed", landed], ["superseded", superseded]])("0 commits + %s: move_card passes", async (_label, resolution) => {
    const task = await seedCard({ attentionResolution: resolution });
    const result = await viaMoveCard(task.id, "done");
    expect(result.success).toBe(true);
    expect((await taskStore.get(task.id))?.columnId).toBe("done");
    expect((await taskStore.get(task.id))?.attentionResolution?.category).toBe(resolution.category);
    expect(emitColumnTransition).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toColumnId: "done" }));
  });

  it("one PATCH can write the conclusion and move", async () => {
    const task = await seedCard();
    const { status } = await viaPatch(task.id, { attentionResolution: landed, columnId: "done" });
    expect(status).toBe(200);
  });

  it("0 commits without a conclusion (new branch) is still rejected by both entries", async () => {
    const task = await seedCard();
    const patched = await viaPatch(task.id, { columnId: "done" });
    expect(patched.status).toBe(400);
    expect(patched.data.error).toMatch(/no committed changes/);
    const moved = await viaMoveCard(task.id, "done");
    expect(moved.success).toBe(false);
    expect(moved.error).toMatch(/no committed changes/);
    expect((await taskStore.get(task.id))?.columnId).toBe("blocked");
  });

  it("needs_owner / handed_off / waiting do not open the gate", async () => {
    for (const category of ["needs_owner", "handed_off", "waiting"] as const) {
      const task = await seedCard({ attentionResolution: { ...landed, category } });
      expect((await viaMoveCard(task.id, "done")).success).toBe(false);
    }
  });

  it.each([["landed", landed], ["superseded", superseded]])(
    "a stale %s conclusion (card left Blocked for Dev) no longer opens the gate, via both entries",
    async (_label, resolution) => {
      const task = await seedCard({ columnId: "dev", status: TaskStatus.IN_PROGRESS, attentionResolution: resolution });
      const patched = await viaPatch(task.id, { columnId: "done" });
      expect(patched.status).toBe(400);
      expect(patched.data.error).toMatch(/no committed changes/);
      const moved = await viaMoveCard(task.id, "done");
      expect(moved.success).toBe(false);
      expect(moved.error).toMatch(/no committed changes/);
      expect((await taskStore.get(task.id))?.columnId).toBe("dev");
    },
  );

  it("landed but a dirty worktree is still rejected", async () => {
    writeFileSync(path.join(repoPath, "dirty.txt"), "x\n");
    const task = await seedCard({ attentionResolution: landed });
    const moved = await viaMoveCard(task.id, "done");
    expect(moved.success).toBe(false);
    expect(moved.error).toMatch(/uncommitted changes/);
    expect((await viaPatch(task.id, { columnId: "done" })).status).toBe(400);
  });

  it("landed does not open the Review gate (only Done)", async () => {
    const task = await seedCard({ attentionResolution: landed });
    expect((await viaMoveCard(task.id, "review")).success).toBe(false);
    const readiness = await buildTaskDeliveryReadiness(task, system as never);
    expect(buildTaskDeliveryTransitionErrorFromRules(readiness, "Review", COLUMNS[0].automation?.deliveryRules, "review")).toMatch(/no committed changes/);
    expect(buildTaskDeliveryTransitionErrorFromRules(readiness, "Done", DELIVERY, "done")).toBeNull();
  });

  it("old path: own commits already fast-forwarded into origin/main still pass", async () => {
    writeFileSync(path.join(repoPath, "b.txt"), "b\n");
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-m", "own work");
    git(repoPath, "push", "origin", "HEAD:main");
    git(repoPath, "fetch", "origin");
    const task = await seedCard();
    const readiness = await buildTaskDeliveryReadiness(task, system as never);
    expect(readiness.landedOnBase).toBe(true);
    expect(readiness.hasLandedOwnCommits).toBe(true);
    expect((await viaMoveCard(task.id, "done")).success).toBe(true);
  });

  it("old path: unmerged own commits pass as before", async () => {
    writeFileSync(path.join(repoPath, "c.txt"), "c\n");
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-m", "own work");
    const task = await seedCard();
    expect((await viaPatch(task.id, { columnId: "done" })).status).toBe(200);
  });
});

describe("a conclusion stops holding once the card leaves Blocked (high-risk review, 2nd rejection)", () => {
  const failedRun = (id: string, minutesAgo: number): TaskLaneSession => ({
    sessionId: id, columnId: "todo", status: "failed", startedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  });
  const waiting = { category: "waiting" as const, conclusion: "等修基线卡", resolvedAt: new Date(Date.now() - 60 * 60_000).toISOString(), ref: "fix-1" };

  it.each([
    ["PATCH columnId", (id: string) => viaPatch(id, { columnId: "todo" }).then((r) => r.status === 200)],
    ["MCP move_card", (id: string) => viaMoveCard(id, "todo").then((r) => r.success)],
  ] as const)("waiting card moved out of Blocked via %s and failing twice is reported and routed again", async (_label, move) => {
    const task = await seedCard({ attentionResolution: waiting });
    expect(await move(task.id)).toBe(true);
    const moved = (await taskStore.get(task.id))!;
    expect(moved.columnId).toBe("todo");
    expect(moved.attentionResolution).toBeUndefined();
    moved.laneSessions = [failedRun("d1", 20), failedRun("d2", 5)];
    moved.triggerSessionId = "d2";
    const now = Date.now();
    expect(collectTaskAttentionItems(toAttentionTask(moved), { hasMainPusher: false, now }).map((item) => item.kind)).toEqual(["interrupted"]);
    expect(decideAttentionRouting(moved, { columns: COLUMNS }, { now }).action).toBe("block");
  });
});
