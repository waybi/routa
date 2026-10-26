import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTask, TaskStatus } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import { closeSqliteDatabase, getSqliteDatabase } from "@/core/db/sqlite";
import { SqliteTaskStore } from "@/core/db/sqlite-task-store";
import { SqliteWorkspaceStore } from "@/core/db/sqlite-workspace-store";

const notify = vi.fn();
const removeCardJob = vi.fn();
const enqueueKanbanTaskSession = vi.fn();

// Card 64f2e31c (C3): a real SQLite file under the OS temp dir, opened with
// the production bootstrap (initializeSqliteTables).
const dir = mkdtempSync(path.join(tmpdir(), "routa-attention-resolution-"));
const db = getSqliteDatabase(path.join(dir, "routa.db"));
const taskStore = new SqliteTaskStore(db);

const system = {
  taskStore,
  kanbanBoardStore: { get: vi.fn() },
  workspaceStore: { get: vi.fn() },
  worktreeStore: { assignSession: vi.fn(), get: vi.fn() },
  codebaseStore: { findByRepoPath: vi.fn(), get: vi.fn(), getDefault: vi.fn() },
  eventBus: {},
  artifactStore: undefined,
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/task-board-context", () => ({
  ensureTaskBoardContext: vi.fn(async () => ({})),
}));

vi.mock("@/core/kanban/github-issues", () => ({
  updateGitHubIssue: vi.fn(),
}));

vi.mock("@/core/git/git-worktree-service", () => ({
  GitWorktreeService: vi.fn(class {}),
}));

vi.mock("@/core/models/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/models/workspace")>()),
  getDefaultWorkspaceWorktreeRoot: vi.fn(),
  getEffectiveWorkspaceMetadata: vi.fn(),
}));

vi.mock("@/core/kanban/column-transition", () => ({
  emitColumnTransition: vi.fn(),
}));

vi.mock("@/core/kanban/task-session-transition", () => ({
  archiveActiveTaskSession: vi.fn(),
  prepareTaskForColumnChange: vi.fn(() => false),
}));

vi.mock("@/core/kanban/task-delivery-readiness", () => ({
  buildTaskDeliveryReadiness: vi.fn(async () => ({
    checked: false,
    modified: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    commitsSinceBase: 0,
    hasCommitsSinceBase: false,
    hasUncommittedChanges: false,
    isGitHubRepo: false,
    canCreatePullRequest: false,
  })),
  buildTaskDeliveryTransitionErrorFromRules: vi.fn(() => null),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  endKanbanTaskSessions: vi.fn(async () => undefined),
  forgetKanbanCard: vi.fn(),
  enqueueKanbanTaskSession: (...args: unknown[]) => enqueueKanbanTaskSession(...args),
  getKanbanSessionQueue: () => ({ removeCardJob }),
  processKanbanColumnTransition: vi.fn(),
}));

import { GET, PATCH } from "../route";

const RESOLVED_AT = "2026-10-26T08:00:00.000Z";

describe("/api/tasks/[taskId] attentionResolution (C3, AC5)", () => {
  beforeAll(async () => {
    await new SqliteWorkspaceStore(db).save(createWorkspace({ id: "workspace-1", title: "W" }));
  });
  afterAll(() => {
    closeSqliteDatabase();
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(async () => {
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue(null);
    await taskStore.save(createTask({
      id: "task-1",
      title: "Resolved card",
      objective: "Resolved card",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "blocked",
      status: TaskStatus.BLOCKED,
    }));
  });

  const patchTask = async (body: Record<string, unknown>) => {
    const response = await PATCH(new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }), { params: Promise.resolve({ taskId: "task-1" }) });
    return { response, data: await response.json() };
  };
  const getTask = async () => (await (await GET(new NextRequest("http://localhost/api/tasks/task-1"), {
    params: Promise.resolve({ taskId: "task-1" }),
  })).json()).task;

  it.each(["landed", "superseded", "handed_off", "waiting", "needs_owner"])(
    "writes category %s and reads it back through GET and a new store instance",
    async (category) => {
      const value = { category, conclusion: "一句结论", ref: "abc1234", resolvedAt: RESOLVED_AT, sessionId: "s-1" };
      const { response } = await patchTask({ attentionResolution: value });
      expect(response.status).toBe(200);
      expect((await getTask()).attentionResolution).toEqual(value);
      expect((await new SqliteTaskStore(db).get("task-1"))?.attentionResolution).toEqual(value);
    },
  );

  it.each([
    ["an unknown category", { category: "fixed", conclusion: "x", resolvedAt: RESOLVED_AT }],
    ["a missing resolvedAt", { category: "landed", conclusion: "x" }],
    ["a missing conclusion", { category: "landed", resolvedAt: RESOLVED_AT }],
    ["a string", "landed"],
  ])("rejects %s with 400 and leaves the stored value unchanged", async (_label, value) => {
    await patchTask({ attentionResolution: { category: "waiting", conclusion: "等修复卡", resolvedAt: RESOLVED_AT } });
    const { response } = await patchTask({ attentionResolution: value });
    expect(response.status).toBe(400);
    expect((await new SqliteTaskStore(db).get("task-1"))?.attentionResolution?.category).toBe("waiting");
  });

  it("null clears the field", async () => {
    await patchTask({ attentionResolution: { category: "landed", conclusion: "ok", resolvedAt: RESOLVED_AT } });
    const { response } = await patchTask({ attentionResolution: null });
    expect(response.status).toBe(200);
    expect((await new SqliteTaskStore(db).get("task-1"))?.attentionResolution).toBeUndefined();
  });

  it("an old row without the column value reads back as undefined", async () => {
    const raw = (db as unknown as { $client: { prepare(sql: string): { run(...args: unknown[]): unknown } } }).$client;
    raw.prepare(
      "INSERT INTO tasks (id, title, objective, status, workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("old-1", "Old", "Old", "PENDING", "workspace-1", Date.now(), Date.now());
    const old = await new SqliteTaskStore(db).get("old-1");
    expect(old?.title).toBe("Old");
    expect(old?.attentionResolution).toBeUndefined();
  });
});
