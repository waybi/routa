import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, AgentEventType } from "../../events/event-bus";
import { InMemoryTaskStore } from "../../store/task-store";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { createKanbanBoard } from "../../models/kanban";
import type { Task } from "../../models/task";
import { KanbanEventBroadcaster, truncateLifecyclePreview } from "../kanban-event-broadcaster";
import { setupTaskLifecycleBridge } from "../task-lifecycle-bridge";
import { emitColumnTransition } from "../column-transition";

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    title: "Ship the thing",
    objective: "Ship it",
    status: "IN_PROGRESS",
    columnId: "dev",
    triggerSessionId: "session-1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Task;
}

function createHarness(options: { withBoardStore?: boolean } = {}) {
  const eventBus = new EventBus();
  const taskStore = new InMemoryTaskStore();
  const kanbanBoardStore = new InMemoryKanbanBoardStore();
  const broadcaster = new KanbanEventBroadcaster();
  const broadcast = vi.spyOn(broadcaster, "broadcast");
  const notifyTaskLifecycle = vi.spyOn(broadcaster, "notifyTaskLifecycle");
  const dispose = setupTaskLifecycleBridge({
    eventBus,
    taskStore,
    broadcaster,
    kanbanBoardStore: options.withBoardStore === false ? undefined : kanbanBoardStore,
  });
  return { eventBus, taskStore, kanbanBoardStore, broadcaster, broadcast, notifyTaskLifecycle, dispose };
}

/** The bridge resolves the card asynchronously; let those microtasks settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

type Harness = ReturnType<typeof createHarness>;

function emitAgent(harness: Harness, type: AgentEventType, data: Record<string, unknown> = {}): void {
  harness.eventBus.emit({
    type,
    agentId: "session-1",
    workspaceId: "ws-1",
    data: { sessionId: "session-1", ...data },
    timestamp: new Date(),
  });
}

function emitMove(harness: Harness, fromColumnId: string, toColumnId: string, boardId = "board-1"): void {
  emitColumnTransition(harness.eventBus, {
    cardId: "task-1",
    cardTitle: "Ship the thing",
    boardId,
    workspaceId: "ws-1",
    fromColumnId,
    toColumnId,
  });
}

describe("setupTaskLifecycleBridge", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it.each(["dev", "review"])(
    "AC1: stays silent for repeated AGENT_COMPLETED while the card sits in %s",
    async (columnId) => {
      await harness.taskStore.save(createTask({ columnId }));

      for (let i = 0; i < 3; i += 1) emitAgent(harness, AgentEventType.AGENT_COMPLETED);
      emitAgent(harness, AgentEventType.AGENT_CREATED);
      await flush();

      expect(harness.notifyTaskLifecycle).not.toHaveBeenCalled();
      expect(harness.broadcast).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["dev", "done", "completed"],
    ["review", "done", "completed"],
    ["dev", "blocked", "blocked"],
    ["review", "dev", "rejected"],
    ["review", "todo", "rejected"],
    ["review", "backlog", "rejected"],
  ])("AC2: a move %s → %s notifies %s exactly once", async (from, to, phase) => {
    await harness.taskStore.save(createTask());

    emitMove(harness, from, to);
    await flush();

    expect(harness.notifyTaskLifecycle).toHaveBeenCalledTimes(1);
    expect(harness.broadcast.mock.calls[0][0]).toMatchObject({
      type: "kanban:task-lifecycle",
      workspaceId: "ws-1",
      taskId: "task-1",
      taskTitle: "Ship the thing",
      phase,
      columnId: to,
      boardId: "board-1",
    });
  });

  it.each([
    ["backlog", "todo"],
    ["todo", "dev"],
    ["dev", "review"],
    ["blocked", "dev"],
    ["done", "review"],
  ])("AC2: a move %s → %s does not notify", async (from, to) => {
    await harness.taskStore.save(createTask());

    emitMove(harness, from, to);
    await flush();

    expect(harness.notifyTaskLifecycle).not.toHaveBeenCalled();
  });

  it("AC2: the same move emitted twice (several entry points / replay) notifies once", async () => {
    await harness.taskStore.save(createTask());

    emitMove(harness, "review", "done");
    emitMove(harness, "review", "done");
    await flush();
    emitMove(harness, "review", "done");
    await flush();

    expect(harness.notifyTaskLifecycle).toHaveBeenCalledTimes(1);
  });

  it("AC2: entering Done again after leaving it notifies again", async () => {
    await harness.taskStore.save(createTask());

    emitMove(harness, "review", "done");
    await flush();
    emitMove(harness, "done", "dev");
    await flush();
    emitMove(harness, "review", "done");
    await flush();

    expect(harness.notifyTaskLifecycle).toHaveBeenCalledTimes(2);
  });

  it.each([AgentEventType.AGENT_FAILED, AgentEventType.AGENT_TIMEOUT, AgentEventType.AGENT_ERROR])(
    "AC2: %s notifies failed exactly once and carries the error as preview",
    async (type) => {
      await harness.taskStore.save(createTask({ boardId: "board-1" } as Partial<Task>));

      emitAgent(harness, type, { error: "provider exploded" });
      emitAgent(harness, type, { error: "provider exploded" });
      await flush();

      expect(harness.notifyTaskLifecycle).toHaveBeenCalledTimes(1);
      expect(harness.broadcast.mock.calls[0][0]).toMatchObject({
        phase: "failed",
        taskId: "task-1",
        sessionId: "session-1",
        columnId: "dev",
        boardId: "board-1",
        lastMessagePreview: "provider exploded",
      });
    },
  );

  it("judges by column stage, so a custom Done column id still counts as completed", async () => {
    await harness.taskStore.save(createTask());
    await harness.kanbanBoardStore.save(createKanbanBoard({
      id: "board-custom",
      workspaceId: "ws-1",
      name: "Custom",
      columns: [
        { id: "build", name: "Build", position: 0, stage: "dev" },
        { id: "check", name: "Check", position: 1, stage: "review" },
        { id: "ship", name: "Ship", position: 2, stage: "done" },
      ],
    }));

    emitMove(harness, "check", "ship", "board-custom");
    await flush();
    emitMove(harness, "ship", "check", "board-custom");
    await flush();
    emitMove(harness, "check", "build", "board-custom");
    await flush();

    expect(harness.notifyTaskLifecycle).toHaveBeenCalledTimes(2);
    expect(harness.broadcast.mock.calls[0][0]).toMatchObject({ phase: "completed", columnId: "ship" });
    expect(harness.broadcast.mock.calls[1][0]).toMatchObject({ phase: "rejected", columnId: "build" });
  });

  it("falls back to column ids as stages when no board store is wired", async () => {
    const bare = createHarness({ withBoardStore: false });
    await bare.taskStore.save(createTask());

    emitMove(bare, "review", "done");
    await flush();

    expect(bare.broadcast.mock.calls[0][0]).toMatchObject({ phase: "completed" });
    bare.dispose();
  });

  it("resolves the card through laneSessions when a failure is not from the trigger session", async () => {
    await harness.taskStore.save(createTask({
      triggerSessionId: undefined,
      laneSessions: [{ sessionId: "session-9", columnId: "dev" }],
    } as Partial<Task>));

    harness.eventBus.emit({
      type: AgentEventType.AGENT_FAILED,
      agentId: "session-9",
      workspaceId: "ws-1",
      data: { sessionId: "session-9" },
      timestamp: new Date(),
    });
    await flush();

    expect(harness.broadcast.mock.calls[0][0]).toMatchObject({ taskId: "task-1", phase: "failed" });
  });

  it("stays silent when no card owns the failing session", async () => {
    await harness.taskStore.save(createTask({ triggerSessionId: "other-session" }));

    harness.eventBus.emit({
      type: AgentEventType.AGENT_FAILED,
      agentId: "unknown-session",
      workspaceId: "ws-1",
      data: { sessionId: "unknown-session" },
      timestamp: new Date(),
    });
    await flush();

    expect(harness.broadcast).not.toHaveBeenCalled();
  });

  it("ignores a transition without cardId or toColumnId", async () => {
    harness.eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "kanban-system",
      workspaceId: "ws-1",
      data: { boardId: "board-1", fromColumnId: "review" },
      timestamp: new Date(),
    });
    await flush();

    expect(harness.broadcast).not.toHaveBeenCalled();
  });

  it("ignores event types that are not a lifecycle transition", async () => {
    await harness.taskStore.save(createTask());

    emitAgent(harness, AgentEventType.MESSAGE_SENT);
    await flush();

    expect(harness.broadcast).not.toHaveBeenCalled();
  });

  it("stops emitting after dispose", async () => {
    await harness.taskStore.save(createTask());
    harness.dispose();

    emitMove(harness, "review", "done");
    emitAgent(harness, AgentEventType.AGENT_FAILED);
    await flush();

    expect(harness.broadcast).not.toHaveBeenCalled();
  });
});

describe("truncateLifecyclePreview", () => {
  it("collapses whitespace and keeps short text intact", () => {
    expect(truncateLifecyclePreview("  all   green  ")).toBe("all green");
  });

  it("truncates long text to the preview budget", () => {
    const preview = truncateLifecyclePreview("x".repeat(400));
    expect(preview).toHaveLength(120);
    expect(preview?.endsWith("…")).toBe(true);
  });

  it("returns undefined for empty input", () => {
    expect(truncateLifecyclePreview("   ")).toBeUndefined();
    expect(truncateLifecyclePreview(undefined)).toBeUndefined();
  });
});
