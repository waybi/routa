/**
 * Card beb29624 (C7, F2/F4): POST /api/tasks/{id}/pr-run on a card with the
 * "hold" label starts no PR session and is not a 500.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, type Task } from "@/core/models/task";

const taskStore = { get: vi.fn<(_: string) => Promise<Task | null>>(), save: vi.fn() };
const codebaseStore = { get: vi.fn() };
const worktreeStore = { get: vi.fn(async () => null) };
const enqueueKanbanTaskSession = vi.fn();

vi.mock("@/core/routa-system", () => ({ getRoutaSystem: () => ({ taskStore, codebaseStore, worktreeStore }) }));
vi.mock("@/core/git", () => ({
  getRemoteUrl: () => "git@github.com:acme/platform.git",
  isGitRepository: () => true,
  isBareGitRepository: () => false,
  isGitHubUrl: (value: string | null | undefined) => Boolean(value?.includes("github.com")),
}));
vi.mock("@/core/kanban/task-delivery-readiness", () => ({ buildTaskDeliveryReadiness: vi.fn(async () => ({ checked: false })) }));
vi.mock("@/core/kanban/task-delivery-snapshot", () => ({ captureTaskDeliverySnapshot: (task: Task) => task.deliverySnapshot }));
vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  enqueueKanbanTaskSession: (...args: unknown[]) => enqueueKanbanTaskSession(...args),
}));

import { POST } from "../route";

const MESSAGE = "卡片带 hold 标签（暂不派），去掉标签后再重跑";

function card(labels: string[]): Task {
  const task = createTask({ id: "task-1", title: "PR", objective: "PR", workspaceId: "ws", boardId: "board-1", columnId: "done" });
  task.codebaseIds = ["cb-1"];
  task.labels = labels;
  return task;
}

const post = () => POST(new NextRequest("http://localhost/api/tasks/task-1/pr-run", { method: "POST", body: "{}" }), {
  params: Promise.resolve({ taskId: "task-1" }),
});

describe("C7: pr-run on a held card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codebaseStore.get.mockResolvedValue({ id: "cb-1", repoPath: "/repo", sourceType: "github", sourceUrl: "https://github.com/acme/platform" });
    enqueueKanbanTaskSession.mockResolvedValue({ sessionId: "pr-session", queued: false });
  });

  it.each([["hold"], ["HOLD"], [" Hold "]])("labels [%s]: 409 with the hold message, no session asked for", async (label) => {
    taskStore.get.mockResolvedValue(card(["req:x", label]));
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(MESSAGE);
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });

  it("held while the request ran (enqueue answers on_hold): 409, not 500", async () => {
    taskStore.get.mockResolvedValue(card([]));
    enqueueKanbanTaskSession.mockResolvedValue({ queued: false, error: "on_hold" });
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(MESSAGE);
  });

  it("F2 control: labels hold-xxx starts the PR session once", async () => {
    taskStore.get.mockResolvedValue(card(["hold-xxx"]));
    const response = await post();
    expect(response.status).toBe(200);
    expect((await response.json()).sessionId).toBe("pr-session");
    expect(enqueueKanbanTaskSession).toHaveBeenCalledTimes(1);
  });

  it("a real enqueue error is still a 500", async () => {
    taskStore.get.mockResolvedValue(card([]));
    enqueueKanbanTaskSession.mockResolvedValue({ queued: false, error: "boom" });
    expect((await post()).status).toBe(500);
  });
});
