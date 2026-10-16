// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

const DONE_STEPS = [
  { id: "main-pusher", role: "GATE" as const, specialistId: "kanban-main-pusher", specialistName: "Main Pusher" },
  { id: "done-reporter", role: "GATE" as const, specialistId: "kanban-done-reporter", specialistName: "Done Reporter" },
];

function lane(sessionId: string, columnId: string, status: TaskLaneSession["status"], stepIndex = 0): TaskLaneSession {
  return { sessionId, columnId, status, stepIndex, startedAt: "2026-10-16T02:00:00.000Z" };
}

async function setup(prefix: string, taskOverrides: Partial<Task>, options?: {
  createSession?: (params: { stepIndex: number }) => Promise<string | null>;
}) {
  const eventBus = new EventBus();
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const createSession = vi.fn(options?.createSession ?? (async () => null));

  const board = createKanbanBoard({
    id: `${prefix}-board`,
    workspaceId: "default",
    name: "Main Board",
    isDefault: true,
    columns: [
      { id: "review", name: "Review", stage: "review", position: 0 },
      {
        id: "done",
        name: "Done",
        stage: "done",
        position: 1,
        automation: { enabled: true, transitionType: "entry", steps: DONE_STEPS },
      },
    ],
  });
  await boardStore.save(board);

  const task: Task = {
    ...createTask({
      id: `${prefix}-task`,
      title: "Done lane teardown",
      objective: "Teardown exits must not count as failures",
      workspaceId: "default",
      boardId: board.id,
      columnId: "done",
      status: TaskStatus.COMPLETED,
    }),
    ...taskOverrides,
  };
  await taskStore.save(task);

  const orchestrator = new KanbanWorkflowOrchestrator(
    eventBus,
    boardStore,
    taskStore,
    createSession as never,
  );
  const recoverSpy = vi.spyOn(orchestrator as never as { recoverAutomation: () => Promise<boolean> }, "recoverAutomation");
  orchestrator.start();

  await orchestrator.processColumnTransition({
    cardId: task.id,
    cardTitle: task.title,
    boardId: board.id,
    workspaceId: "default",
    fromColumnId: "review",
    toColumnId: "done",
  });

  return { eventBus, orchestrator, taskStore, task, createSession, recoverSpy };
}

function emit(eventBus: EventBus, type: AgentEventType, sessionId: string, data: Record<string, unknown> = {}) {
  eventBus.emit({
    type,
    agentId: sessionId,
    workspaceId: "default",
    data: { sessionId, ...data },
    timestamp: new Date(),
  });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("KanbanWorkflowOrchestrator post-completion failures", () => {
  it("ignores an exit of a leftover review session on a COMPLETED card (old-column session)", async () => {
    const { eventBus, orchestrator, taskStore, task, createSession, recoverSpy } = await setup("leftover", {
      triggerSessionId: "review-guard-1",
      laneSessions: [lane("review-guard-1", "review", "running", 1)],
    });
    expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({ columnId: "done", status: "queued" });
    createSession.mockClear();

    emit(eventBus, AgentEventType.AGENT_FAILED, "review-guard-1", {
      success: false,
      error: "DeepSeek Harness process exited unexpectedly (code=0, signal=null)",
    });
    await settle();

    const saved = await taskStore.get(task.id);
    const entry = saved?.laneSessions?.find((session) => session.sessionId === "review-guard-1");
    expect(entry?.status).not.toBe("failed");
    expect(entry?.recoveryReason).toBeUndefined();
    expect(recoverSpy).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(0);
    expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({ columnId: "done", status: "queued" });
    expect(orchestrator.getAutomationForCard(task.id)?.sessionId).toBeUndefined();
  });

  it("ignores a Done session exit once every Done lane step has completed", async () => {
    const { eventBus, taskStore, task, createSession, recoverSpy } = await setup("finished", {
      triggerSessionId: "reporter-1",
      laneSessions: [
        lane("review-guard-1", "review", "completed", 1),
        lane("pusher-1", "done", "completed", 0),
        lane("reporter-1", "done", "completed", 1),
      ],
    });
    createSession.mockClear();

    emit(eventBus, AgentEventType.AGENT_FAILED, "reporter-1", {
      success: false,
      error: "DeepSeek Harness process exited unexpectedly (code=0, signal=null)",
    });
    await settle();

    const saved = await taskStore.get(task.id);
    const entry = saved?.laneSessions?.find((session) => session.sessionId === "reporter-1");
    expect(entry).toMatchObject({ status: "completed" });
    expect(entry?.recoveryReason).toBeUndefined();
    expect(recoverSpy).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(0);
  });

  it("does nothing when the automation was already cleaned up", async () => {
    const { eventBus, orchestrator, taskStore, task, createSession, recoverSpy } = await setup("cleaned", {
      laneSessions: [
        lane("pusher-1", "done", "completed", 0),
        lane("reporter-1", "done", "completed", 1),
      ],
    });
    orchestrator.stop();
    orchestrator.start();
    createSession.mockClear();

    emit(eventBus, AgentEventType.AGENT_FAILED, "pusher-1", { success: false, error: "killed" });
    await settle();

    const saved = await taskStore.get(task.id);
    expect(saved?.laneSessions?.find((session) => session.sessionId === "pusher-1")?.status).toBe("completed");
    expect(recoverSpy).not.toHaveBeenCalled();
    expect(createSession).toHaveBeenCalledTimes(0);
  });

  it("still records a real failure of the running Done lane pusher on a COMPLETED card", async () => {
    const { eventBus, orchestrator, taskStore, task } = await setup("pusher-fails", {
      laneSessions: [lane("review-guard-1", "review", "completed", 1)],
    }, {
      createSession: async () => "pusher-1",
    });
    const saved0 = await taskStore.get(task.id);
    await taskStore.save({ ...saved0!, laneSessions: [...(saved0!.laneSessions ?? []), lane("pusher-1", "done", "running", 0)] });
    expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({ sessionId: "pusher-1", status: "running" });

    emit(eventBus, AgentEventType.AGENT_FAILED, "pusher-1", { success: false, error: "git push rejected" });
    await vi.waitFor(async () => {
      const saved = await taskStore.get(task.id);
      expect(saved?.laneSessions?.find((session) => session.sessionId === "pusher-1")).toMatchObject({
        status: "failed",
        recoveryReason: "agent_failed",
      });
      expect(saved?.lastSyncError).toBe("git push rejected");
    });
    expect(orchestrator.getAutomationForCard(task.id)?.status).toBe("failed");
  });
});
