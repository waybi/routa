// @vitest-environment node
/**
 * Card 2d21984e (C5, C15, AC5, AC6, F2c): getRoutaSystem() must never publish a
 * half-initialized singleton. It used to write globalThis first and resolve the
 * orchestrator module after; a resolve error then skipped the Kanban event
 * persistence, and every later call returned that crippled singleton.
 *
 * `require` is not available under vitest, so the tests drive
 * initializeRoutaSystem(), the function getRoutaSystem() delegates to, with
 * the module shapes the bundler produces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({
    hasActiveSession: () => false,
    listSessions: () => [],
    getSession: () => undefined,
  }),
}));
const h = vi.hoisted(() => ({ boot: undefined as undefined | (() => unknown), trigger: vi.fn() }));
vi.mock("@/core/routa-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/routa-system")>();
  // Only the route under test goes through this; everything else keeps the real functions.
  return { ...actual, getRoutaSystem: () => (h.boot ? h.boot() : actual.getRoutaSystem()) };
});
vi.mock("@/core/kanban/agent-trigger", () => ({
  triggerAssignedTaskAgent: h.trigger,
  getInternalApiOrigin: () => "http://localhost",
}));
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));

import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import * as orchestratorModule from "@/core/kanban/workflow-orchestrator-singleton";
import { resetWorkflowOrchestrator } from "@/core/kanban/workflow-orchestrator-singleton";
import { initializeRoutaSystem } from "@/core/routa-system";
import { NextRequest } from "next/server";
import { GET as boardsGet } from "@/app/api/kanban/boards/route";
import { createKanbanBoard } from "@/core/models/kanban";
import { createTask, TaskStatus } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";

const g = globalThis as Record<string, unknown>;
const KEY = "__routa_system__";

function clearGlobals() {
  delete g[KEY];
  resetWorkflowOrchestrator();
}

beforeEach(clearGlobals);
afterEach(() => {
  clearGlobals();
  vi.restoreAllMocks();
});

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

async function broadcastedRows(system: ReturnType<typeof initializeRoutaSystem>, workspaceId: string) {
  getKanbanEventBroadcaster().notify({ workspaceId, entity: "task", action: "updated", resourceId: "t1", source: "user" });
  await flush();
  return system.kanbanEventStore.list(workspaceId);
}

describe("initializeRoutaSystem", () => {
  it("attaches Kanban event persistence: a broadcast event is found in the store (AC5, C15)", async () => {
    const system = initializeRoutaSystem("memory", orchestratorModule);
    expect(g[KEY]).toBe(system);

    const rows = await broadcastedRows(system, "ws-persist");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "kanban:changed", resourceId: "t1" });
  });

  // C5 / AC6: first call fails on an empty shape, leaves nothing behind; the retry is complete.
  it("throws on an empty module shape, leaves no singleton, and the retry initializes fully once", async () => {
    expect(() => initializeRoutaSystem("memory", {})).toThrow(/startWorkflowOrchestrator is not a function/);
    expect(g[KEY]).toBeUndefined();

    const system = initializeRoutaSystem("memory", orchestratorModule);
    expect(g[KEY]).toBe(system);
    const rows = await broadcastedRows(system, "ws-retry");
    expect(rows).toHaveLength(1);
  });

  it("does not create stores or bridges when the module cannot be resolved", () => {
    const broadcaster = getKanbanEventBroadcaster();
    const setStore = vi.spyOn(broadcaster, "setEventStore");
    expect(() => initializeRoutaSystem("memory", { default: {} })).toThrow();
    expect(setStore).not.toHaveBeenCalled();
  });

  // The production shape: a Promise. The system is complete at once; the orchestrator starts when it resolves.
  it("accepts the production async-module Promise and starts the orchestrator after it resolves", async () => {
    const start = vi.fn();
    const system = initializeRoutaSystem("memory", Promise.resolve({ startWorkflowOrchestrator: start }));
    expect(g[KEY]).toBe(system);
    expect((await broadcastedRows(system, "ws-async"))).toHaveLength(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(system);
  });

  it("an async module that resolves to an unusable shape logs loudly and un-publishes the system", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    initializeRoutaSystem("memory", Promise.resolve({}));
    expect(g[KEY]).toBeDefined();
    await flush();
    expect(g[KEY]).toBeUndefined();
    expect(errors.mock.calls.some((call) => String(call[0]).includes("Workflow orchestrator failed to start"))).toBe(true);
  });

  // F2c: second call returns the same instance. createSqliteSystem() uses
  // require(), which vitest lacks; the sqlite backend is covered by the
  // production-bundle probe (card evidence C7).
  it("returns the same instance on a second call (memory)", () => {
    const first = initializeRoutaSystem("memory", orchestratorModule);
    const second = initializeRoutaSystem("memory", orchestratorModule);
    expect(second).toBe(first);
    expect(first.kanbanEventStore.constructor.name).toBe("InMemoryKanbanEventStore");
  });

  // C6: the first caller of getRoutaSystem() is GET /api/kanban/boards (the orchestrator now starts
  // after the bridges). A read must not launch a lane session or write a card event.
  it("a first GET /api/kanban/boards starts no agent and changes no card", async () => {
    let created: ReturnType<typeof initializeRoutaSystem> | undefined;
    h.boot = () => (created ??= initializeRoutaSystem("memory", orchestratorModule));
    try {
      // Seed through a throwaway handle on the same store the route will use.
      const seeded = h.boot() as ReturnType<typeof initializeRoutaSystem>;
      await seeded.workspaceStore.save(createWorkspace({ id: "ws-get", title: "G" }));
      await seeded.kanbanBoardStore.save(createKanbanBoard({
        id: "board-get",
        workspaceId: "ws-get",
        name: "B",
        isDefault: true,
        columns: [{ id: "dev", name: "Dev", position: 0, stage: "dev", automation: { enabled: true, steps: [{ id: "s1", providerId: "dsh", role: "CRAFTER" }] } }],
      }));
      await seeded.taskStore.save(createTask({ id: "card-get", title: "g", objective: "g", workspaceId: "ws-get", boardId: "board-get", columnId: "dev", status: TaskStatus.IN_PROGRESS }));
      await flush();
      const lanesBefore = (await seeded.taskStore.get("card-get"))?.laneSessions?.length ?? 0;
      const userUpdates = async () => (await seeded.kanbanEventStore.list("ws-get"))
        .filter((row) => (row.payload as { source?: string; action?: string }).source === "user"
          && (row.payload as { action?: string }).action === "updated").length;
      const eventsBefore = await userUpdates();

      for (let index = 0; index < 2; index += 1) {
        const response = await boardsGet(new NextRequest("http://localhost/api/kanban/boards?workspaceId=ws-get"));
        expect(response.status).toBe(200);
      }
      await flush();

      expect(h.trigger).not.toHaveBeenCalled();
      expect((await seeded.taskStore.get("card-get"))?.laneSessions?.length ?? 0).toBe(lanesBefore);
      expect(await userUpdates()).toBe(eventsBefore);
    } finally {
      h.boot = undefined;
    }
  });
});
