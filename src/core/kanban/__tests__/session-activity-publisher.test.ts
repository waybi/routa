import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanEventBroadcaster } from "../kanban-event-broadcaster";
import {
  SESSION_ACTIVITY_THROTTLE_MS,
  SessionActivityPublisher,
  type SessionActivitySnapshot,
} from "../session-activity-publisher";
import { InMemoryKanbanEventStore } from "@/core/store/kanban-event-store";

function snapshot(overrides: Partial<SessionActivitySnapshot> = {}): SessionActivitySnapshot {
  return {
    workspaceId: "ws",
    sessionId: "s1",
    acpStatus: "ready",
    lastActivityAt: new Date().toISOString(),
    lastEventType: "tool_call",
    ...overrides,
  };
}

describe("SessionActivityPublisher", () => {
  let broadcaster: KanbanEventBroadcaster;
  let publish: ReturnType<typeof vi.fn<KanbanEventBroadcaster["notifySessionActivity"]>>;
  let publisher: SessionActivityPublisher;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcaster = new KanbanEventBroadcaster();
    publish = vi.spyOn(broadcaster, "notifySessionActivity") as unknown as typeof publish;
    publisher = new SessionActivityPublisher(broadcaster, { now: () => Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes the first heartbeat immediately", () => {
    publisher.observe(snapshot());
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("throttles routine heartbeats but delivers the newest one when the window closes", () => {
    publisher.observe(snapshot({ lastToolName: "a" }));
    publisher.observe(snapshot({ lastToolName: "b" }));
    publisher.observe(snapshot({ lastToolName: "c" }));
    expect(publish).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(SESSION_ACTIVITY_THROTTLE_MS);

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1][0].lastToolName).toBe("c");
  });

  it("sends urgent frames (status flips, errors, turn end) without waiting", () => {
    publisher.observe(snapshot());
    publisher.observe(snapshot({ acpStatus: "error", acpError: "boom" }), { urgent: true });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[1][0].acpStatus).toBe("error");

    // The urgent frame also cancels the pending trailing one.
    vi.advanceTimersByTime(SESSION_ACTIVITY_THROTTLE_MS * 2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("keeps sessions independent", () => {
    publisher.observe(snapshot({ sessionId: "s1" }));
    publisher.observe(snapshot({ sessionId: "s2" }));
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("drops pending state on forget", () => {
    publisher.observe(snapshot());
    publisher.observe(snapshot());
    publisher.forget("s1");
    vi.advanceTimersByTime(SESSION_ACTIVITY_THROTTLE_MS);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe("KanbanEventBroadcaster session activity", () => {
  it("does not persist heartbeats into the replay store", async () => {
    const broadcaster = new KanbanEventBroadcaster();
    const store = new InMemoryKanbanEventStore();
    broadcaster.setEventStore(store);

    broadcaster.notifySessionActivity(snapshot());
    broadcaster.notifySessionTail({ workspaceId: "ws", sessionId: "s1", tail: "hi", updateType: "agent_message" });
    await Promise.resolve();

    const rows = await store.list("ws", {});
    expect(rows.map((row) => row.type)).toEqual(["kanban:session-tail"]);
  });
});
