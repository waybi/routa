/**
 * Card a00fb67b (L400; C4, F4): POST /api/tasks/{id}/pr-run starts the
 * kanban-pr-publisher role, so only "hold:kanban-pr-publisher" (or the
 * whole-card hold) stops it; hold:kanban-main-pusher does not.
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

function card(labels: string[]): Task {
  const task = createTask({ id: "task-1", title: "PR", objective: "PR", workspaceId: "ws", boardId: "board-1", columnId: "done" });
  task.codebaseIds = ["cb-1"];
  task.labels = labels;
  return task;
}

const post = () => POST(new NextRequest("http://localhost/api/tasks/task-1/pr-run", { method: "POST", body: "{}" }), {
  params: Promise.resolve({ taskId: "task-1" }),
});

describe("F4 / C4: pr-run with role hold labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    codebaseStore.get.mockResolvedValue({ id: "cb-1", repoPath: "/repo", sourceType: "github", sourceUrl: "https://github.com/acme/platform" });
    enqueueKanbanTaskSession.mockResolvedValue({ sessionId: "pr-session", queued: false });
  });

  it.each([["hold:kanban-pr-publisher"], [" HOLD:Kanban-PR-Publisher "]])("labels [%s]: 409 naming the role, no session asked for", async (label) => {
    taskStore.get.mockResolvedValue(card(["req:x", label]));
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("hold:kanban-pr-publisher");
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });

  it("hold:kanban-main-pusher does not stop the PR publisher", async () => {
    taskStore.get.mockResolvedValue(card(["hold:kanban-main-pusher"]));
    const response = await post();
    expect(response.status).toBe(200);
    expect(enqueueKanbanTaskSession).toHaveBeenCalledTimes(1);
    expect(enqueueKanbanTaskSession.mock.calls[0]?.[1]?.step?.specialistId).toBe("kanban-pr-publisher");
  });

  it("role hold added while the request ran (enqueue answers on_hold): 409 naming the role, not 500", async () => {
    taskStore.get.mockResolvedValueOnce(card([])).mockResolvedValue(card(["hold:kanban-pr-publisher"]));
    enqueueKanbanTaskSession.mockResolvedValue({ queued: false, error: "on_hold" });
    const response = await post();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("hold:kanban-pr-publisher");
  });
});
