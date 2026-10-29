// @vitest-environment node
/**
 * Card 2d21984e (F2e, F4): the MCP tool path in kanban-tools resolves the
 * orchestrator module through the shared resolver and still calls
 * enqueueKanbanTaskSession once when a card is created in an automated lane.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  start: vi.fn(),
  enqueue: vi.fn(async () => ({ queued: true })),
}));

vi.mock("../../kanban/workflow-orchestrator-singleton", () => ({
  startWorkflowOrchestrator: h.start,
  enqueueKanbanTaskSession: h.enqueue,
}));

import { createKanbanBoard } from "../../models/kanban";
import { createWorkspace } from "../../models/workspace";
import { createInMemorySystem } from "../../routa-system";
import { KanbanTools } from "../kanban-tools";

async function setup() {
  const system = createInMemorySystem();
  await system.workspaceStore.save(createWorkspace({ id: "ws-k", title: "K" }));
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: "board-k",
    workspaceId: "ws-k",
    name: "B",
    isDefault: true,
    columns: [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "todo", name: "Todo", position: 1, stage: "todo", automation: { enabled: true, steps: [{ id: "s1", providerId: "dsh", role: "CRAFTER" }] } },
    ],
  }));
  const tools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
  tools.setEventBus(system.eventBus);
  tools.setAutomationSystem(system);
  return tools;
}

beforeEach(() => {
  h.start.mockClear();
  h.enqueue.mockClear();
});

describe("KanbanTools.createCard in an automated lane", () => {
  it("starts the orchestrator and enqueues the card once", async () => {
    const tools = await setup();
    const result = await tools.createCard({ title: "t", workspaceId: "ws-k", boardId: "board-k", columnId: "todo" });
    expect(result.success).toBe(true);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });
});
