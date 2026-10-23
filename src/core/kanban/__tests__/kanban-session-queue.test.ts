import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, AgentEventType } from "../../events/event-bus";
import { createTask, TaskStatus } from "../../models/task";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanSessionQueue } from "../kanban-session-queue";

describe("KanbanSessionQueue", () => {
  let eventBus: EventBus;
  let taskStore: InMemoryTaskStore;

  beforeEach(() => {
    eventBus = new EventBus();
    taskStore = new InMemoryTaskStore();
  });

  it("queues extra cards when the board concurrency limit is reached", async () => {
    await taskStore.save(createTask({
      id: "task-1",
      title: "First task",
      objective: "First task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));
    await taskStore.save(createTask({
      id: "task-2",
      title: "Second task",
      objective: "Second task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));

    const startFirst = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const startSecond = vi.fn().mockResolvedValue({ sessionId: "session-2" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    const first = await queue.enqueue({
      cardId: "task-1",
      cardTitle: "First task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startFirst,
    });
    const second = await queue.enqueue({
      cardId: "task-2",
      cardTitle: "Second task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startSecond,
    });

    expect(first).toEqual({ sessionId: "session-1", queued: false });
    expect(second).toEqual({ queued: true });
    expect(startFirst).toHaveBeenCalledTimes(1);
    expect(startSecond).not.toHaveBeenCalled();
    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 1,
      runningCards: [{ cardId: "task-1", cardTitle: "First task" }],
      queuedCount: 1,
      queuedCardIds: ["task-2"],
      queuedCards: [{ cardId: "task-2", cardTitle: "Second task" }],
      queuedPositions: { "task-2": 1 },
    });

    eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "agent-1",
      workspaceId: "default",
      data: { sessionId: "session-1", success: true },
      timestamp: new Date(),
    });
    await vi.waitFor(() => {
      expect(startSecond).toHaveBeenCalledTimes(1);
    });

    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 1,
      runningCards: [{ cardId: "task-2", cardTitle: "Second task" }],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    queue.stop();
  });

  it("drops stale queued cards that have moved away before a slot opens", async () => {
    await taskStore.save(createTask({
      id: "task-1",
      title: "First task",
      objective: "First task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));
    await taskStore.save(createTask({
      id: "task-2",
      title: "Second task",
      objective: "Second task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));

    const startFirst = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const startSecond = vi.fn().mockResolvedValue({ sessionId: "session-2" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    await queue.enqueue({
      cardId: "task-1",
      cardTitle: "First task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startFirst,
    });
    await queue.enqueue({
      cardId: "task-2",
      cardTitle: "Second task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startSecond,
    });

    const movedTask = await taskStore.get("task-2");
    if (!movedTask) {
      throw new Error("Expected task-2");
    }
    movedTask.columnId = "done";
    await taskStore.save(movedTask);

    eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "agent-1",
      workspaceId: "default",
      data: { sessionId: "session-1", success: true },
      timestamp: new Date(),
    });
    await vi.waitFor(async () => {
      await expect(queue.getBoardSnapshot("board-1")).resolves.toMatchObject({ queuedCount: 0 });
    });

    expect(startSecond).not.toHaveBeenCalled();
    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 0,
      runningCards: [],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    queue.stop();
  });

  it("drops queued cards that already gained a trigger session before snapshotting", async () => {
    await taskStore.save(createTask({
      id: "task-1",
      title: "First task",
      objective: "First task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
      triggerSessionId: "session-1",
    }));
    await taskStore.save(createTask({
      id: "task-2",
      title: "Second task",
      objective: "Second task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));

    const startFirst = vi.fn().mockResolvedValue({ sessionId: "session-existing" });
    const startSecond = vi.fn().mockResolvedValue({ sessionId: "session-2" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    await queue.enqueue({
      cardId: "task-1",
      cardTitle: "First task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startFirst,
    });
    await queue.enqueue({
      cardId: "task-2",
      cardTitle: "Second task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startSecond,
    });

    const queuedTask = await taskStore.get("task-2");
    if (!queuedTask) {
      throw new Error("Expected task-2");
    }
    queuedTask.triggerSessionId = "session-2";
    await taskStore.save(queuedTask);

    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 1,
      runningCards: [{ cardId: "task-1", cardTitle: "First task" }],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    queue.stop();
  });

  it("drops stale running cards that no longer exist before counting board capacity", async () => {
    await taskStore.save(createTask({
      id: "task-2",
      title: "Second task",
      objective: "Second task",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));

    const startGhost = vi.fn().mockResolvedValue({ sessionId: "session-ghost" });
    const startSecond = vi.fn().mockResolvedValue({ sessionId: "session-2" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    await queue.enqueue({
      cardId: "task-ghost",
      cardTitle: "Ghost task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startGhost,
    });

    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 0,
      runningCards: [],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    const second = await queue.enqueue({
      cardId: "task-2",
      cardTitle: "Second task",
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start: startSecond,
    });

    expect(second).toEqual({ sessionId: "session-2", queued: false });
    expect(startSecond).toHaveBeenCalledTimes(1);
    await expect(queue.getBoardSnapshot("board-1")).resolves.toEqual({
      boardId: "board-1",
      runningCount: 1,
      runningCards: [{ cardId: "task-2", cardTitle: "Second task" }],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });

    queue.stop();
  });

  async function saveBacklogTask(id: string): Promise<void> {
    await taskStore.save(createTask({
      id,
      title: id,
      objective: id,
      workspaceId: "default",
      boardId: "board-1",
      columnId: "backlog",
      status: TaskStatus.PENDING,
    }));
  }

  function job(cardId: string, start: () => Promise<{ sessionId?: string | null; error?: string }>) {
    return {
      cardId,
      cardTitle: cardId,
      boardId: "board-1",
      workspaceId: "default",
      columnId: "backlog",
      start,
    };
  }

  function emitCompleted(sessionId: string): void {
    eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: sessionId,
      workspaceId: "default",
      data: { sessionId, success: true },
      timestamp: new Date(),
    });
  }

  /** Private-state probe: every queued job must sit in its board's queue array. */
  function findQueuedOrphans(queue: KanbanSessionQueue): string[] {
    const internals = queue as unknown as {
      jobsByCardId: Map<string, { cardId: string; boardId: string; status: string }>;
      queuedByBoard: Map<string, Array<{ cardId: string }>>;
    };
    return Array.from(internals.jobsByCardId.values())
      .filter((entry) => entry.status === "queued")
      .filter((entry) => !(internals.queuedByBoard.get(entry.boardId) ?? []).some((queued) => queued.cardId === entry.cardId))
      .map((entry) => entry.cardId);
  }

  it("keeps a card that was queued while drain was still starting another card", async () => {
    await saveBacklogTask("task-a");
    await saveBacklogTask("task-b");
    await saveBacklogTask("task-c");

    let resolveB: (value: { sessionId: string }) => void = () => {};
    const startA = vi.fn().mockResolvedValue({ sessionId: "session-a" });
    const startB = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveB = resolve; }));
    const startC = vi.fn().mockResolvedValue({ sessionId: "session-c" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    await queue.enqueue(job("task-a", startA));
    await expect(queue.enqueue(job("task-b", startB))).resolves.toEqual({ queued: true });

    emitCompleted("session-a");
    await vi.waitFor(() => expect(startB).toHaveBeenCalledTimes(1));

    // Drain is now awaiting B's start(); C arrives and has to wait.
    await expect(queue.enqueue(job("task-c", startC))).resolves.toEqual({ queued: true });

    resolveB({ sessionId: "session-b" });
    await vi.waitFor(async () => {
      const snapshot = await queue.getBoardSnapshot("board-1");
      expect(snapshot.runningCards).toEqual([{ cardId: "task-b", cardTitle: "task-b" }]);
    });
    const afterDrain = await queue.getBoardSnapshot("board-1");
    expect(afterDrain.queuedCardIds).toEqual(["task-c"]);
    expect(findQueuedOrphans(queue)).toEqual([]);

    emitCompleted("session-b");
    await vi.waitFor(() => expect(startC).toHaveBeenCalledTimes(1));

    queue.stop();
  });

  it("does not let a queued orphan block the card from being enqueued again", async () => {
    await saveBacklogTask("task-1");
    const startOrphan = vi.fn().mockResolvedValue({ sessionId: "session-orphan" });
    const startAgain = vi.fn().mockResolvedValue({ sessionId: "session-again" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => 1);
    queue.start();

    // Reproduce the state the old drain left behind: queued in jobsByCardId, absent from every board queue.
    const internals = queue as unknown as { jobsByCardId: Map<string, unknown> };
    internals.jobsByCardId.set("task-1", {
      ...job("task-1", startOrphan),
      status: "queued",
      enqueuedAt: new Date(),
    });
    expect(findQueuedOrphans(queue)).toEqual(["task-1"]);

    const result = await queue.enqueue(job("task-1", startAgain));

    expect(result).toEqual({ sessionId: "session-again", queued: false });
    expect(startAgain).toHaveBeenCalledTimes(1);
    expect(startOrphan).not.toHaveBeenCalled();
    expect(findQueuedOrphans(queue)).toEqual([]);

    queue.stop();
  });

  it("starts earlier queued cards before a newcomer when a slot is free", async () => {
    await saveBacklogTask("task-a");
    await saveBacklogTask("task-b");
    await saveBacklogTask("task-c");
    await saveBacklogTask("task-d");

    let limit = 1;
    const startA = vi.fn().mockResolvedValue({ sessionId: "session-a" });
    const startB = vi.fn().mockResolvedValue({ sessionId: "session-b" });
    const startC = vi.fn().mockResolvedValue({ sessionId: "session-c" });
    const startD = vi.fn().mockResolvedValue({ sessionId: "session-d" });
    const queue = new KanbanSessionQueue(eventBus, taskStore, async () => limit);
    queue.start();

    await queue.enqueue(job("task-a", startA));
    await queue.enqueue(job("task-b", startB));
    await queue.enqueue(job("task-c", startC));

    // A slot opens without a lifecycle event (for example the limit was raised).
    limit = 2;
    const resultD = await queue.enqueue(job("task-d", startD));

    expect(startB).toHaveBeenCalledTimes(1);
    expect(startD).not.toHaveBeenCalled();
    expect(resultD).toEqual({ queued: true });
    const snapshot = await queue.getBoardSnapshot("board-1");
    expect(snapshot.queuedCardIds).toEqual(["task-c", "task-d"]);

    queue.stop();
  });
});
