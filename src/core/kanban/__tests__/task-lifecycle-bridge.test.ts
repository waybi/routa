import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, AgentEventType } from "../../events/event-bus";
import { InMemoryTaskStore } from "../../store/task-store";
import type { Task } from "../../models/task";
import { KanbanEventBroadcaster, truncateLifecyclePreview } from "../kanban-event-broadcaster";
import { setupTaskLifecycleBridge } from "../task-lifecycle-bridge";

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

function createHarness() {
  const eventBus = new EventBus();
  const taskStore = new InMemoryTaskStore();
  const broadcaster = new KanbanEventBroadcaster();
  const broadcast = vi.spyOn(broadcaster, "broadcast");
  const dispose = setupTaskLifecycleBridge({ eventBus, taskStore, broadcaster });
  return { eventBus, taskStore, broadcaster, broadcast, dispose };
}

/** The bridge resolves the card asynchronously; let those microtasks settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("setupTaskLifecycleBridge", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it("emits a completed lifecycle event for the card owning the session", async () => {
    await harness.taskStore.save(createTask());

    harness.eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "session-1",
      workspaceId: "ws-1",
      data: { sessionId: "session-1" },
      timestamp: new Date(),
    });
    await flush();

    expect(harness.broadcast).toHaveBeenCalledTimes(1);
    const event = harness.broadcast.mock.calls[0][0];
    expect(event).toMatchObject({
      type: "kanban:task-lifecycle",
      workspaceId: "ws-1",
      taskId: "task-1",
      taskTitle: "Ship the thing",
      phase: "completed",
      sessionId: "session-1",
      columnId: "dev",
    });
  });

  it("maps a completed run on a review card to needs_review", async () => {
    await harness.taskStore.save(createTask({ columnId: "review" }));

    harness.eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "session-1",
      workspaceId: "ws-1",
      data: { sessionId: "session-1" },
      timestamp: new Date(),
    });
    await flush();

    expect(harness.broadcast.mock.calls[0][0]).toMatchObject({ phase: "needs_review" });
  });

  it("maps failures to the failed phase and carries the error as preview", async () => {
    await harness.taskStore.save(createTask());

    harness.eventBus.emit({
      type: AgentEventType.AGENT_FAILED,
      agentId: "session-1",
      workspaceId: "ws-1",
      data: { sessionId: "session-1", error: "provider exploded" },
      timestamp: new Date(),
    });
    await flush();

    expect(harness.broadcast.mock.calls[0][0]).toMatchObject({
      phase: "failed",
      lastMessagePreview: "provider exploded",
    });
  });

  it("resolves the card through laneSessions when it is not the trigger session", async () => {
    await harness.taskStore.save(createTask({
      triggerSessionId: undefined,
      laneSessions: [{ sessionId: "session-9", columnId: "dev" }],
    } as Partial<Task>));

    harness.eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "session-9",
      workspaceId: "ws-1",
      data: { sessionId: "session-9" },
      timestamp: new Date(),
    });
    await flush();

    expect(harness.broadcast.mock.calls[0][0]).toMatchObject({ taskId: "task-1" });
  });

  it("stays silent when no card owns the session", async () => {
    await harness.taskStore.save(createTask({ triggerSessionId: "other-session" }));

    harness.eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "unknown-session",
      workspaceId: "ws-1",
      data: { sessionId: "unknown-session" },
      timestamp: new Date(),
    });
    await flush();

    expect(harness.broadcast).not.toHaveBeenCalled();
  });

  it("ignores event types that are not a lifecycle transition", async () => {
    await harness.taskStore.save(createTask());

    harness.eventBus.emit({
      type: AgentEventType.MESSAGE_SENT,
      agentId: "session-1",
      workspaceId: "ws-1",
      data: { sessionId: "session-1" },
      timestamp: new Date(),
    });
    await flush();

    expect(harness.broadcast).not.toHaveBeenCalled();
  });

  it("stops emitting after dispose", async () => {
    await harness.taskStore.save(createTask());
    harness.dispose();

    harness.eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "session-1",
      workspaceId: "ws-1",
      data: { sessionId: "session-1" },
      timestamp: new Date(),
    });
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
