import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, VerificationVerdict, type Task } from "@/core/models/task";
import type { TaskDeliveryReadiness } from "@/core/kanban/task-delivery-readiness";

const notify = vi.fn();
const removeCardJob = vi.fn();
const enqueueKanbanTaskSession = vi.fn();
const processKanbanColumnTransition = vi.fn();
const archiveActiveTaskSession = vi.fn<(task: Task) => void>();
const prepareTaskForColumnChange = vi.fn<(fromColumnId?: string, task?: Task) => boolean>(() => false);
const buildTaskDeliveryReadiness = vi.fn<
  (task: Task, currentSystem: typeof system) => Promise<TaskDeliveryReadiness>
>();
const buildTaskDeliveryTransitionErrorFromRules = vi.fn<
  (readiness: TaskDeliveryReadiness, targetColumnName: string, deliveryRules: Record<string, unknown> | undefined) => string | null
>(() => null);

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
  archiveActiveTaskSession: (task: Task) => archiveActiveTaskSession(task),
  prepareTaskForColumnChange: (fromColumnId?: string, task?: Task) =>
    prepareTaskForColumnChange(fromColumnId, task),
}));

vi.mock("@/core/kanban/task-delivery-readiness", () => ({
  buildTaskDeliveryReadiness: (task: Task, currentSystem: typeof system) =>
    buildTaskDeliveryReadiness(task, currentSystem),
  buildTaskDeliveryTransitionErrorFromRules: (
    readiness: TaskDeliveryReadiness,
    targetColumnName: string,
    deliveryRules: Record<string, unknown> | undefined,
  ) => buildTaskDeliveryTransitionErrorFromRules(readiness, targetColumnName, deliveryRules),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  endKanbanTaskSessions: vi.fn(async () => undefined),
  forgetKanbanCard: vi.fn(),
  enqueueKanbanTaskSession: (currentSystem: typeof system, params: { task: Task }) =>
    enqueueKanbanTaskSession(currentSystem, params),
  getKanbanSessionQueue: () => ({ removeCardJob }),
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
}));

import { PATCH } from "../route";

describe("/api/tasks/[taskId] verdict convergence gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskStore.save.mockResolvedValue();
    taskStore.get.mockResolvedValue(createTask({
      id: "task-1",
      title: "Finalize review verdict",
      objective: "Leave review only when done checks pass",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "review",
      status: TaskStatus.REVIEW_REQUIRED,
    }));
    system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
      id: "board-1",
      columns: [
        {
          id: "review",
          name: "Review",
          position: 0,
          stage: "review",
          automation: {
            enabled: true,
            steps: [
              {
                id: "review-guard",
                role: "GATE",
                specialistId: "kanban-review-guard",
                specialistName: "Review Guard",
              },
            ],
          },
        },
        {
          id: "done",
          name: "Done",
          position: 1,
          stage: "done",
          automation: {
            deliveryRules: {
              requirePullRequestReady: true,
            },
          },
        },
      ],
    });
    buildTaskDeliveryReadiness.mockResolvedValue({
      checked: true,
      branch: "main",
      baseBranch: "main",
      baseRef: "origin/main",
      modified: 0,
      untracked: 0,
      ahead: 1,
      behind: 0,
      commitsSinceBase: 1,
      hasCommitsSinceBase: true,
      hasUncommittedChanges: false,
      isGitHubRepo: true,
      canCreatePullRequest: false,
    });
    buildTaskDeliveryTransitionErrorFromRules.mockReturnValue(
      'Cannot move task to "Done": GitHub repo is not PR-ready yet. Use a feature branch instead of "main" so this task can open a pull request cleanly.',
    );
  });

  it("re-validates the converged lane before saving", async () => {
    const response = await PATCH(new NextRequest("http://localhost/api/tasks/task-1", {
      method: "PATCH",
      body: JSON.stringify({
        columnId: "review",
        verificationVerdict: VerificationVerdict.APPROVED,
      }),
      headers: { "Content-Type": "application/json" },
    }), {
      params: Promise.resolve({ taskId: "task-1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Cannot move task to "Done"');
    expect(data.deliveryReadiness).toMatchObject({
      checked: true,
      branch: "main",
      canCreatePullRequest: false,
    });
    expect(taskStore.save).not.toHaveBeenCalled();
  });

  describe("remaining review lane steps guard", () => {
    beforeEach(() => {
      buildTaskDeliveryReadiness.mockResolvedValue({
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
        reason: "Task has no linked repository or worktree.",
      });
      buildTaskDeliveryTransitionErrorFromRules.mockReturnValue(null);
    });

    const reviewBoard = {
      id: "board-1",
      columns: [
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
        {
          id: "review",
          name: "Review",
          position: 2,
          stage: "review",
          automation: {
            enabled: true,
            steps: [
              { id: "qa-frontend", role: "GATE", specialistId: "kanban-qa-frontend", specialistName: "QA Frontend" },
              { id: "review-guard", role: "GATE", specialistId: "kanban-review-guard", specialistName: "Review Guard" },
            ],
          },
        },
        { id: "done", name: "Done", position: 3, stage: "done" },
      ],
    };

    function buildReviewTask(triggerSessionId: string): Task {
      const task = createTask({
        id: "task-1",
        title: "Two-step review",
        objective: "QA Frontend then Review Guard",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "review",
        status: TaskStatus.REVIEW_REQUIRED,
        triggerSessionId,
        assignedProvider: "codex",
        assignedRole: "GATE",
        assignedSpecialistId: "kanban-review-guard",
        assignedSpecialistName: "Review Guard",
      });
      task.laneSessions = [
        {
          sessionId: "session-qa",
          columnId: "review",
          stepId: "qa-frontend",
          stepIndex: 0,
          role: "GATE",
          specialistId: "kanban-qa-frontend",
          status: "completed",
          startedAt: "2026-10-15T00:00:00.000Z",
        },
        {
          sessionId: "session-guard",
          columnId: "review",
          stepId: "review-guard",
          stepIndex: 1,
          role: "GATE",
          specialistId: "kanban-review-guard",
          status: "running",
          startedAt: "2026-10-15T00:10:00.000Z",
        },
      ];
      return task;
    }

    async function patchToDone() {
      const request = new NextRequest("http://localhost/api/tasks/task-1", {
        method: "PATCH",
        body: JSON.stringify({ columnId: "done" }),
        headers: { "Content-Type": "application/json" },
      });
      const response = await PATCH(request, { params: Promise.resolve({ taskId: "task-1" }) });
      return { response, data: await response.json() };
    }

    it("lets the last review step's session move the card", async () => {
      taskStore.get.mockResolvedValue(buildReviewTask("session-guard"));
      system.kanbanBoardStore.get = vi.fn().mockResolvedValue(reviewBoard);

      const { response, data } = await patchToDone();

      expect(String(data.error ?? "")).not.toContain("must run next in the same lane");
      expect(response.status).toBe(200);
    });

    it("still blocks the move while the earlier review step's session is the trigger", async () => {
      taskStore.get.mockResolvedValue(buildReviewTask("session-qa"));
      system.kanbanBoardStore.get = vi.fn().mockResolvedValue(reviewBoard);

      const { response, data } = await patchToDone();

      expect(response.status).toBe(400);
      expect(data.error).toContain("QA Frontend is still active and Review Guard must run next in the same lane");
      expect(taskStore.save).not.toHaveBeenCalled();
    });
  });
});
