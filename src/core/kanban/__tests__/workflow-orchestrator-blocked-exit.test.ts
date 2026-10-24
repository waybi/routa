// @vitest-environment node
/**
 * Card 60f276e0 (review R2): a Done card whose pusher is still running may
 * now be moved to blocked with move_card. The Done lane must stop there: when
 * the pusher's session later ends, no Done step may start on the Blocked card
 * and the lane must not record a failure. A card still in Done keeps the old
 * behaviour.
 */
import { describe, expect, it, vi } from "vitest";

import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanTools } from "../../tools/kanban-tools";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

const DONE_STEPS = [
  { id: "done-pusher", role: "GATE" as const, specialistId: "kanban-done-pusher", specialistName: "推送员" },
  { id: "done-reporter", role: "GATE" as const, specialistId: "kanban-done-reporter", specialistName: "完成汇报员" },
];

async function setup() {
  const eventBus = new EventBus();
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  await boardStore.save(createKanbanBoard({
    id: "board-1",
    workspaceId: "default",
    name: "Main",
    isDefault: true,
    columns: [
      { id: "todo", name: "Todo", stage: "todo", position: 0 },
      { id: "review", name: "Review", stage: "review", position: 1 },
      {
        id: "done",
        name: "Done",
        stage: "done",
        position: 2,
        automation: { enabled: true, transitionType: "entry", steps: DONE_STEPS },
      },
      { id: "blocked", name: "Blocked", stage: "blocked", position: 3 },
      { id: "stuck", name: "Stuck", stage: "blocked", position: 4 },
    ],
  }));

  // Records the started step on the card, as the real session start does.
  const createSession = vi.fn(async (params: { cardId: string; stepIndex: number }) => {
    const sessionId = `${params.cardId}-step-${params.stepIndex}`;
    const task = await taskStore.get(params.cardId);
    if (task) {
      task.triggerSessionId = sessionId;
      task.laneSessions = [...(task.laneSessions ?? []), {
        sessionId,
        columnId: "done",
        stepId: DONE_STEPS[params.stepIndex].id,
        stepIndex: params.stepIndex,
        role: "GATE",
        status: "running",
        startedAt: "2026-10-24T04:00:00.000Z",
      }];
      await taskStore.save(task);
    }
    return sessionId;
  });
  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession as never, vi.fn());
  orchestrator.start();
  const tools = new KanbanTools(boardStore, taskStore);
  tools.setEventBus(eventBus);

  const startDoneLane = async (cardId: string) => {
    await taskStore.save(createTask({
      id: cardId,
      title: `Card ${cardId}`,
      objective: "Leave Done while the pusher runs",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "done",
      status: TaskStatus.COMPLETED,
    }));
    await orchestrator.processColumnTransition({
      cardId,
      cardTitle: `Card ${cardId}`,
      boardId: "board-1",
      workspaceId: "default",
      fromColumnId: "review",
      toColumnId: "done",
    });
    expect(orchestrator.getAutomationForCard(cardId)).toMatchObject({ columnId: "done", sessionId: `${cardId}-step-0` });
  };

  const endPusher = async (cardId: string, type: AgentEventType) => {
    const failed = type === AgentEventType.AGENT_FAILED;
    eventBus.emit({
      type,
      agentId: `${cardId}-step-0`,
      workspaceId: "default",
      data: { sessionId: `${cardId}-step-0`, success: !failed, ...(failed ? { error: "boom" } : {}) },
      timestamp: new Date(),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
  };

  const startsFor = (cardId: string) => createSession.mock.calls.filter(([params]) => params.cardId === cardId).length;
  const doneLane = async (cardId: string) => (await taskStore.get(cardId))?.laneSessions?.find((s) => s.sessionId === `${cardId}-step-0`);

  return { orchestrator, tools, taskStore, startDoneLane, endPusher, startsFor, doneLane };
}

describe("Done lane after move_card to a blocked lane (review R2)", () => {
  it.each(["blocked", "stuck"])("pusher completes after the card moved to %s: no reporter starts", async (target) => {
    const { orchestrator, tools, taskStore, startDoneLane, endPusher, startsFor } = await setup();
    await startDoneLane("moved");
    await startDoneLane("control");

    const result = await tools.moveCard({ cardId: "moved", targetColumnId: target });
    expect(result.success).toBe(true);

    await endPusher("moved", AgentEventType.AGENT_COMPLETED);
    await endPusher("control", AgentEventType.AGENT_COMPLETED);

    expect((await taskStore.get("moved"))?.columnId).toBe(target);
    expect(startsFor("moved")).toBe(1);
    // Control card still in Done: its reporter starts as before.
    expect(startsFor("control")).toBe(2);
    expect((await taskStore.get("control"))?.triggerSessionId).toBe("control-step-1");
    orchestrator.stop();
  });

  it("pusher fails after the card moved to blocked: no failure is recorded on the Blocked card", async () => {
    const { orchestrator, tools, taskStore, startDoneLane, endPusher, startsFor, doneLane } = await setup();
    await startDoneLane("moved");
    await startDoneLane("control");

    expect((await tools.moveCard({ cardId: "moved", targetColumnId: "blocked" })).success).toBe(true);
    await endPusher("moved", AgentEventType.AGENT_FAILED);
    await endPusher("control", AgentEventType.AGENT_FAILED);

    const moved = await taskStore.get("moved");
    expect(moved?.columnId).toBe("blocked");
    expect(moved?.lastSyncError).toBeUndefined();
    expect((await doneLane("moved"))?.status).not.toBe("failed");
    expect((await doneLane("moved"))?.recoveryReason).toBeUndefined();
    expect(startsFor("moved")).toBe(1);
    // Control card still in Done: the failure is recorded as before.
    expect((await doneLane("control"))?.status).toBe("failed");
    expect((await doneLane("control"))?.recoveryReason).toBe("agent_failed");
    expect((await taskStore.get("control"))?.lastSyncError).toBeTruthy();
    orchestrator.stop();
  });

  it("a move into the card's own column keeps the running Done automation", async () => {
    const { orchestrator, tools, startDoneLane } = await setup();
    await startDoneLane("same");

    expect((await tools.moveCard({ cardId: "same", targetColumnId: "done" })).success).toBe(true);

    expect(orchestrator.getAutomationForCard("same")).toMatchObject({ columnId: "done", sessionId: "same-step-0" });
    orchestrator.stop();
  });
});
