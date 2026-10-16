// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import {
  getEnvironmentFailureCount,
  isEnvironmentFailureMessage,
} from "../environment-failure";
import { upsertTaskLaneSession } from "../task-lane-history";
import {
  getNonDevAutomationRunCount,
  hasExceededNonDevAutomationRepeatLimit,
  KanbanWorkflowOrchestrator,
} from "../workflow-orchestrator";

const PROVIDER_NOT_REGISTERED = 'Unknown provider: "local-7357". Not registered in ProviderRegistry.';

describe("workflow orchestrator loop guard", () => {
  it("counts consecutive prior runs for non-dev lanes", () => {
    const task = createTask({
      id: "task-loop-count",
      title: "Loop count",
      objective: "Count repeated non-dev automation runs",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "todo",
    });

    task.laneSessions = [
      {
        sessionId: "todo-1",
        columnId: "todo",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "dev-1",
        columnId: "dev",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "todo-2",
        columnId: "todo",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "todo-3",
        columnId: "todo",
        status: "transitioned",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(getNonDevAutomationRunCount(task, "todo", "todo")).toBe(2);
  });

  it("resets the non-dev repeat count after the card leaves and re-enters the lane", () => {
    const task = createTask({
      id: "task-review-reentry",
      title: "Review reentry",
      objective: "Allow a fresh review run after returning from dev",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });

    task.laneSessions = [
      {
        sessionId: "review-1",
        columnId: "review",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "review-2",
        columnId: "review",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "dev-1",
        columnId: "dev",
        status: "transitioned",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "review-3",
        columnId: "review",
        status: "timed_out",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(getNonDevAutomationRunCount(task, "review", "review")).toBe(1);
    expect(hasExceededNonDevAutomationRepeatLimit(task, "review", "review")).toBe(false);
  });

  it("blocks the fourth run for the same non-dev lane", () => {
    const task = createTask({
      id: "task-loop-block",
      title: "Loop guard",
      objective: "Stop repeated non-dev automation loops",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });

    task.laneSessions = [
      {
        sessionId: "review-1",
        columnId: "review",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "review-2",
        columnId: "review",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "review-3",
        columnId: "review",
        status: "transitioned",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(hasExceededNonDevAutomationRepeatLimit(task, "review", "review")).toBe(true);
  });

  it("does not apply the repeat limit to dev lane recovery runs", () => {
    const task = createTask({
      id: "task-dev-recovery",
      title: "Dev recovery",
      objective: "Dev retries should stay available",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "dev",
    });

    task.laneSessions = [
      {
        sessionId: "dev-1",
        columnId: "dev",
        status: "failed",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "dev-2",
        columnId: "dev",
        status: "timed_out",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "dev-3",
        columnId: "dev",
        status: "running",
        startedAt: new Date().toISOString(),
      },
      {
        sessionId: "dev-4",
        columnId: "dev",
        status: "completed",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(getNonDevAutomationRunCount(task, "dev", "dev")).toBe(0);
    expect(hasExceededNonDevAutomationRepeatLimit(task, "dev", "dev")).toBe(false);
  });

  it("classifies only provider-registry errors as environment failures", () => {
    expect(isEnvironmentFailureMessage(PROVIDER_NOT_REGISTERED)).toBe(true);
    expect(isEnvironmentFailureMessage("boom")).toBe(false);
    expect(isEnvironmentFailureMessage("Failed to create ACP session.")).toBe(false);
    expect(isEnvironmentFailureMessage(undefined)).toBe(false);
  });

  it("does not count environment failures toward the non-dev repeat limit", () => {
    const task = createTask({
      id: "task-env-count",
      title: "Environment count",
      objective: "Environment failures are counted separately",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "review",
    });

    task.laneSessions = [
      { sessionId: "review-1", columnId: "review", status: "failed", startedAt: new Date().toISOString() },
      { sessionId: "review-2", columnId: "review", status: "failed", startedAt: new Date().toISOString() },
      {
        sessionId: "review-env",
        columnId: "review",
        status: "failed",
        recoveryReason: "environment_failure",
        startedAt: new Date().toISOString(),
      },
    ];

    expect(getNonDevAutomationRunCount(task, "review", "review")).toBe(2);
    expect(getEnvironmentFailureCount(task, "review")).toBe(1);
    expect(hasExceededNonDevAutomationRepeatLimit(task, "review", "review")).toBe(false);
  });

  it("records an environment failure without consuming a dev retry and does not retry the lane", async () => {
    const eventBus = new EventBus();
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    const createSession = vi.fn().mockImplementation(async ({ cardId, supervision }) => {
      const sessionId = `session-env-${supervision?.attempt ?? 1}`;
      const trackedTask = await taskStore.get(cardId);
      if (trackedTask) {
        upsertTaskLaneSession(trackedTask, { sessionId, columnId: "dev", columnName: "Dev", status: "running" });
        trackedTask.triggerSessionId = sessionId;
        await taskStore.save(trackedTask);
      }
      getHttpSessionStore().upsertSession({
        sessionId,
        workspaceId: "default",
        provider: "local-7357",
        cwd: "/tmp",
        createdAt: new Date().toISOString(),
      });
      return sessionId;
    });

    const board = createKanbanBoard({
      id: "board-env-failure",
      workspaceId: "default",
      name: "Main Board",
      isDefault: true,
      columns: [
        { id: "todo", name: "Todo", stage: "todo", position: 0 },
        {
          id: "dev",
          name: "Dev",
          stage: "dev",
          position: 1,
          automation: { enabled: true, providerId: "local-7357", role: "DEVELOPER", transitionType: "entry" },
        },
      ],
    });
    await boardStore.save(board);
    const task = createTask({
      id: "task-env-failure",
      title: "Provider not registered",
      objective: "Environment failure must not burn retries",
      workspaceId: "default",
      boardId: board.id,
      columnId: "dev",
    });
    await taskStore.save(task);

    const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession);
    orchestrator.setResolveDevSessionSupervision(async () => ({
      mode: "watchdog_retry",
      inactivityTimeoutMinutes: 1,
      maxRecoveryAttempts: 2,
      completionRequirement: "turn_complete",
    }));
    orchestrator.start();

    eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "test",
      workspaceId: "default",
      data: {
        cardId: task.id,
        cardTitle: task.title,
        boardId: board.id,
        workspaceId: "default",
        fromColumnId: "todo",
        toColumnId: "dev",
      },
      timestamp: new Date(),
    });
    await vi.waitFor(() => {
      expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({ sessionId: "session-env-1" });
    });

    eventBus.emit({
      type: AgentEventType.AGENT_FAILED,
      agentId: "session-env-1",
      workspaceId: "default",
      data: { sessionId: "session-env-1", success: false, error: PROVIDER_NOT_REGISTERED },
      timestamp: new Date(),
    });

    await vi.waitFor(async () => {
      expect(orchestrator.getAutomationForCard(task.id)?.status).toBe("failed");
    });

    const updatedTask = await taskStore.get(task.id);
    expect(updatedTask?.laneSessions).toEqual([
      expect.objectContaining({
        sessionId: "session-env-1",
        status: "failed",
        recoveryReason: "environment_failure",
      }),
    ]);
    expect(updatedTask?.lastSyncError).toBe(`[environment] ${PROVIDER_NOT_REGISTERED}`);
    // Ordinary retry budget untouched, environment failure counted once.
    expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({ recoveryAttempts: 0, attempt: 1 });
    expect(getEnvironmentFailureCount(updatedTask, "dev")).toBe(1);
    // No automatic retry in the same lane.
    expect(createSession).toHaveBeenCalledTimes(1);

    orchestrator.stop();
  });
});
