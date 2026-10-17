import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, type Task } from "@/core/models/task";

const notify = vi.fn();
const removeCardJob = vi.fn();
const enqueueKanbanTaskSession = vi.fn();

const taskStore = {
  get: vi.fn<(_: string) => Promise<Task | null>>(),
  save: vi.fn<(task: Task) => Promise<void>>(),
};

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

vi.mock("@/core/models/workspace", () => ({
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
  enqueueKanbanTaskSession: (...args: unknown[]) => enqueueKanbanTaskSession(...args),
  getKanbanSessionQueue: () => ({ removeCardJob }),
  processKanbanColumnTransition: vi.fn(),
}));

import { GET, PATCH } from "../route";

describe("/api/tasks/[taskId] card-level model and reasoning effort override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskStore.save.mockResolvedValue();
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue(null);
    taskStore.get.mockResolvedValue(createTask({
      id: "task-1",
      title: "Model override",
      objective: "Model override",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "todo",
      status: TaskStatus.PENDING,
    }));
  });

  const patchTask = async (body: Record<string, unknown>) => {
    const response = await PATCH(new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    return { response, data: await response.json() };
  };
  const existingWithOverride = () => createTask({
    id: "task-1",
    title: "Model override",
    objective: "Model override",
    workspaceId: "workspace-1",
    boardId: "board-1",
    columnId: "todo",
    status: TaskStatus.PENDING,
    assignedModel: "claude-opus-5-5",
    assignedReasoningEffort: "high",
  });

  it("writes trimmed values and reads them back on GET", async () => {
    const { response, data } = await patchTask({
      assignedModel: "  gpt-6.1-sol  ",
      assignedReasoningEffort: "medium",
    });

    expect(response.status).toBe(200);
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      assignedModel: "gpt-6.1-sol",
      assignedReasoningEffort: "medium",
    }));
    expect(data.task).toMatchObject({ assignedModel: "gpt-6.1-sol", assignedReasoningEffort: "medium" });

    taskStore.get.mockResolvedValueOnce(existingWithOverride());
    const getResponse = await GET(new NextRequest("http://localhost/api/tasks/task-1"), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    expect((await getResponse.json()).task).toMatchObject({
      assignedModel: "claude-opus-5-5",
      assignedReasoningEffort: "high",
    });
  });

  it("clears the override when null is sent", async () => {
    taskStore.get.mockResolvedValueOnce(existingWithOverride());
    const { data } = await patchTask({ assignedModel: null, assignedReasoningEffort: null });

    const saved = taskStore.save.mock.calls.at(-1)?.[0] as Task;
    expect(saved.assignedModel).toBeUndefined();
    expect(saved.assignedReasoningEffort).toBeUndefined();
    expect(data.task.assignedModel).toBeUndefined();
  });

  it("clears the override when an empty or blank string is sent", async () => {
    taskStore.get.mockResolvedValueOnce(existingWithOverride());
    await patchTask({ assignedModel: "", assignedReasoningEffort: "   " });

    const saved = taskStore.save.mock.calls.at(-1)?.[0] as Task;
    expect(saved.assignedModel).toBeUndefined();
    expect(saved.assignedReasoningEffort).toBeUndefined();
  });

  it("keeps the stored override when the keys are absent", async () => {
    taskStore.get.mockResolvedValueOnce(existingWithOverride());
    await patchTask({ assignedProvider: "dsh" });

    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({
      assignedProvider: "dsh",
      assignedModel: "claude-opus-5-5",
      assignedReasoningEffort: "high",
    }));
  });

  it("does not start a lane session when only the override changes on a dev card", async () => {
    taskStore.get.mockResolvedValueOnce(createTask({
      id: "task-1",
      title: "Dev card",
      objective: "Dev card",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
    }));
    const { response } = await patchTask({ assignedModel: "gpt-6.1-sol", assignedReasoningEffort: "low" });

    expect(response.status).toBe(200);
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });
});
