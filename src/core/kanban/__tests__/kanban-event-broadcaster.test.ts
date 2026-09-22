import { describe, expect, it } from "vitest";
import { KanbanEventBroadcaster } from "../kanban-event-broadcaster";

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
    const frame = JSON.parse(chunks[0].replace(/^data: /, "").trim());
    expect(frame).toMatchObject({ type: "connected", connectionId: connId, workspaceId: "workspace-a" });
    expect(typeof frame.timestamp).toBe("string");
  });

  it("writes one `data:` line per frame and no `id:` line today", () => {
    // Replay via Last-Event-ID needs an `id:` line; asserting its absence
    // here means the persistence change must consciously add it.
    const broadcaster = new KanbanEventBroadcaster();
    const { controller, chunks } = createController();
    broadcaster.attach("workspace-a", controller);

    broadcaster.notify({ workspaceId: "workspace-a", entity: "task", action: "updated", source: "agent" });

    const frame = chunks[1];
    expect(frame.startsWith("data: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
    expect(frame).not.toContain("\nid: ");
    expect(frame.split("\n").filter(Boolean)).toHaveLength(1);
  });

  it("stamps every frame type with the same top-level fields", () => {
    const broadcaster = new KanbanEventBroadcaster();
    const { controller, chunks } = createController();
    broadcaster.attach("workspace-a", controller);

    broadcaster.notify({ workspaceId: "workspace-a", entity: "task", action: "moved", resourceId: "t1", source: "user" });
    broadcaster.notifyFitness({ workspaceId: "workspace-a", source: "system", status: "running" });
    broadcaster.notifyTaskLifecycle({ workspaceId: "workspace-a", taskId: "t1", taskTitle: "T", phase: "completed", source: "agent" });
    broadcaster.notifySessionTail({ workspaceId: "workspace-a", sessionId: "s1", tail: "hi", updateType: "agent_message" });

    const frames = chunks.slice(1).map((chunk) => JSON.parse(chunk.replace(/^data: /, "").trim()));
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
