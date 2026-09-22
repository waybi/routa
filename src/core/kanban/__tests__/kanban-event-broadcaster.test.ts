import { describe, expect, it, vi } from "vitest";
import { KanbanEventBroadcaster } from "../kanban-event-broadcaster";
import { InMemoryKanbanEventStore } from "@/core/store/kanban-event-store";

function parseFrame(chunk: string): { id: string | null; data: Record<string, unknown> } {
  const lines = chunk.split("\n").filter(Boolean);
  const idLine = lines.find((line) => line.startsWith("id: "));
  const dataLine = lines.find((line) => line.startsWith("data: "));
  return {
    id: idLine ? idLine.slice(4) : null,
    data: JSON.parse((dataLine ?? "data: {}").slice(6)),
  };
}

function createController() {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  const controller = {
    enqueue(value: Uint8Array) {
      chunks.push(decoder.decode(value));
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { controller, chunks };
}

describe("KanbanEventBroadcaster", () => {
  it("broadcasts only to subscribers in the matching workspace", () => {
    const broadcaster = new KanbanEventBroadcaster();
    const workspaceA = createController();
    const workspaceB = createController();

    broadcaster.attach("workspace-a", workspaceA.controller);
    broadcaster.attach("workspace-b", workspaceB.controller);

    broadcaster.notify({
      workspaceId: "workspace-a",
      entity: "task",
      action: "moved",
      resourceId: "task-1",
      source: "agent",
    });

    expect(workspaceA.chunks.some((chunk) => chunk.includes("\"workspaceId\":\"workspace-a\""))).toBe(true);
    expect(workspaceA.chunks.some((chunk) => chunk.includes("\"action\":\"moved\""))).toBe(true);
    expect(workspaceB.chunks.some((chunk) => chunk.includes("\"action\":\"moved\""))).toBe(false);
  });

  // ── Characterization: locks current wire shape before persistence lands ──

  it("emits a `connected` frame on attach carrying the connection id and workspace", () => {
    const broadcaster = new KanbanEventBroadcaster();
    const { controller, chunks } = createController();

    const connId = broadcaster.attach("workspace-a", controller);

    expect(chunks).toHaveLength(1);
    const frame = parseFrame(chunks[0]).data;
    expect(frame).toMatchObject({ type: "connected", connectionId: connId, workspaceId: "workspace-a" });
    expect(typeof frame.timestamp).toBe("string");
  });

  it("writes an `id:` line before `data:` on every broadcast frame", () => {
    // The id is what EventSource sends back as Last-Event-ID on reconnect.
    // The `connected` frame carries none: it is not a replayable event.
    const broadcaster = new KanbanEventBroadcaster();
    const { controller, chunks } = createController();
    broadcaster.attach("workspace-a", controller);

    broadcaster.notify({ workspaceId: "workspace-a", entity: "task", action: "updated", source: "agent" });

    expect(parseFrame(chunks[0]).id).toBeNull();
    const frame = parseFrame(chunks[1]);
    expect(frame.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(frame.data.type).toBe("kanban:changed");
    expect(chunks[1].endsWith("\n\n")).toBe(true);
  });

  it("persists every broadcast frame with the same id it sent, and skips `connected`", async () => {
    const store = new InMemoryKanbanEventStore();
    const broadcaster = new KanbanEventBroadcaster();
    broadcaster.setEventStore(store);
    const { controller, chunks } = createController();
    broadcaster.attach("workspace-a", controller);

    broadcaster.notify({ workspaceId: "workspace-a", entity: "task", action: "moved", resourceId: "t1", source: "user" });
    broadcaster.notifySessionTail({ workspaceId: "workspace-a", sessionId: "s1", tail: "hi", updateType: "agent_message" });
    await Promise.resolve();

    const rows = await store.list("workspace-a");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.type)).toEqual(["kanban:changed", "kanban:session-tail"]);
    expect(rows[0].id).toBe(parseFrame(chunks[1]).id);
    expect(rows[1].id).toBe(parseFrame(chunks[2]).id);
    expect(rows[0].resourceId).toBe("t1");
    expect(rows[1].resourceId).toBe("s1");
    expect(rows[0].payload).toEqual(parseFrame(chunks[1]).data);
  });

  it("persists to the store even when no subscriber is attached", async () => {
    // Events that happen while the tab is closed are exactly the ones a
    // reload needs to see.
    const store = new InMemoryKanbanEventStore();
    const broadcaster = new KanbanEventBroadcaster();
    broadcaster.setEventStore(store);

    broadcaster.notifyTaskLifecycle({ workspaceId: "workspace-a", taskId: "t1", taskTitle: "T", phase: "completed", source: "agent" });
    await Promise.resolve();

    expect(await store.list("workspace-a")).toHaveLength(1);
  });

  it("keeps broadcasting when the store rejects", async () => {
    const broadcaster = new KanbanEventBroadcaster();
    broadcaster.setEventStore({
      append: async () => { throw new Error("disk full"); },
      list: async () => [],
      pruneOlderThan: async () => 0,
    });
    const { controller, chunks } = createController();
    broadcaster.attach("workspace-a", controller);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    broadcaster.notify({ workspaceId: "workspace-a", entity: "task", action: "updated", source: "agent" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chunks).toHaveLength(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("replays stored frames after a cursor, each with its stored id", async () => {
    const store = new InMemoryKanbanEventStore();
    const broadcaster = new KanbanEventBroadcaster();
    broadcaster.setEventStore(store);

    // Three events happen while nobody is connected.
    broadcaster.notify({ workspaceId: "workspace-a", entity: "task", action: "created", resourceId: "t1", source: "user" });
    broadcaster.notify({ workspaceId: "workspace-a", entity: "task", action: "moved", resourceId: "t1", source: "agent" });
    broadcaster.notify({ workspaceId: "workspace-a", entity: "task", action: "updated", resourceId: "t1", source: "agent" });
    await Promise.resolve();
    const stored = await store.list("workspace-a");

    // Client reconnects presenting the first id.
    const { controller, chunks } = createController();
    broadcaster.attach("workspace-a", controller);
    const replayed = await broadcaster.replay(controller, "workspace-a", { afterId: stored[0].id });

    expect(replayed).toBe(2);
    const frames = chunks.slice(1).map(parseFrame);
    expect(frames.map((frame) => frame.id)).toEqual([stored[1].id, stored[2].id]);
    expect(frames.map((frame) => (frame.data as { action: string }).action)).toEqual(["moved", "updated"]);
  });

  it("replay is a no-op without a store", async () => {
    const broadcaster = new KanbanEventBroadcaster();
    const { controller, chunks } = createController();
    broadcaster.attach("workspace-a", controller);
    expect(await broadcaster.replay(controller, "workspace-a", { afterId: "x" })).toBe(0);
    expect(chunks).toHaveLength(1);
  });

  it("stamps every frame type with the same top-level fields", () => {
    const broadcaster = new KanbanEventBroadcaster();
    const { controller, chunks } = createController();
    broadcaster.attach("workspace-a", controller);

    broadcaster.notify({ workspaceId: "workspace-a", entity: "task", action: "moved", resourceId: "t1", source: "user" });
    broadcaster.notifyFitness({ workspaceId: "workspace-a", source: "system", status: "running" });
    broadcaster.notifyTaskLifecycle({ workspaceId: "workspace-a", taskId: "t1", taskTitle: "T", phase: "completed", source: "agent" });
    broadcaster.notifySessionTail({ workspaceId: "workspace-a", sessionId: "s1", tail: "hi", updateType: "agent_message" });

    const frames = chunks.slice(1).map((chunk) => parseFrame(chunk).data);
    expect(frames.map((frame) => frame.type)).toEqual([
      "kanban:changed",
      "fitness:changed",
      "kanban:task-lifecycle",
      "kanban:session-tail",
    ]);
    for (const frame of frames) {
      expect(frame.workspaceId).toBe("workspace-a");
      expect(typeof frame.timestamp).toBe("string");
    }
  });

  it("drops a subscriber whose controller throws and keeps serving the rest", () => {
    const broadcaster = new KanbanEventBroadcaster();
    const healthy = createController();
    const broken = {
      enqueue() {
        throw new Error("closed");
      },
    } as unknown as ReadableStreamDefaultController<Uint8Array>;

    broadcaster.attach("workspace-a", healthy.controller);
    // attach() writes the connected frame; a broken controller throws there,
    // so attach it via a fresh broadcaster to isolate the broadcast path.
    const isolated = new KanbanEventBroadcaster();
    isolated.attach("workspace-a", healthy.controller);
    (isolated as unknown as { controllers: Map<string, unknown> }).controllers.set("bad", {
      controller: broken,
      workspaceId: "workspace-a",
    });
    expect(isolated.connectionCount).toBe(2);

    isolated.notify({ workspaceId: "workspace-a", entity: "task", action: "updated", source: "agent" });

    expect(isolated.connectionCount).toBe(1);
    expect(healthy.chunks.some((chunk) => chunk.includes("kanban:changed"))).toBe(true);
  });
});
