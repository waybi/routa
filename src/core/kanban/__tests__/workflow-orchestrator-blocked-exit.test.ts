// @vitest-environment node
/**
 * Card 60f276e0 (review R2): a Done card whose pusher is still running may
 * now be moved to blocked with move_card. The Done lane must stop there: when
 * the pusher's session later ends, no Done step may start on the Blocked card
 * and the lane must not record a failure. A card still in Done keeps the old
 * behaviour.
 *
 * Review R1 (round 3): leaving the lane must not drop the end of the session
 * that was running in it. That session's end still records its lane step as
 * completed and ends its process (Review Guard after update_task convergence,
 * pusher after move_card to blocked).
 */
import { describe, expect, it, vi } from "vitest";

import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus } from "../../models/task";
import { InMemoryAgentStore } from "../../store/agent-store";
import { InMemoryConversationStore } from "../../store/conversation-store";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { AgentTools } from "../../tools/agent-tools";
import { KanbanTools } from "../../tools/kanban-tools";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

const DONE_STEPS = [
  { id: "done-pusher", role: "GATE" as const, specialistId: "kanban-done-pusher", specialistName: "推送员" },
  { id: "done-reporter", role: "GATE" as const, specialistId: "kanban-done-reporter", specialistName: "完成汇报员" },
];
const REVIEW_STEPS = [
  { id: "qa-frontend", role: "GATE" as const, specialistId: "kanban-qa-frontend", specialistName: "QA Frontend" },
  { id: "review-guard", role: "GATE" as const, specialistId: "kanban-review-guard", specialistName: "Review Guard" },
];
const STEPS: Record<string, typeof DONE_STEPS> = { done: DONE_STEPS, review: REVIEW_STEPS };

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
      {
        id: "review",
        name: "Review",
        stage: "review",
        position: 1,
        automation: { enabled: true, steps: REVIEW_STEPS },
      },
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
  const createSession = vi.fn(async (params: { cardId: string; columnId: string; stepIndex: number }) => {
    const sessionId = `${params.cardId}-${params.columnId}-${params.stepIndex}`;
    const task = await taskStore.get(params.cardId);
    if (task) {
      task.triggerSessionId = sessionId;
      task.sessionIds = [...(task.sessionIds ?? []), sessionId];
      task.laneSessions = [...(task.laneSessions ?? []), {
        sessionId,
        columnId: params.columnId,
        stepId: STEPS[params.columnId][params.stepIndex].id,
        stepIndex: params.stepIndex,
        role: "GATE",
        status: "running",
        startedAt: "2026-10-24T04:00:00.000Z",
      }];
      await taskStore.save(task);
    }
    return sessionId;
  });
  const killSession = vi.fn(async (_sessionId: string) => undefined);
  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession as never, killSession);
  orchestrator.start();
  const tools = new KanbanTools(boardStore, taskStore);
  tools.setEventBus(eventBus);
  const agentTools = new AgentTools(new InMemoryAgentStore(), new InMemoryConversationStore(), taskStore, eventBus);
  agentTools.setKanbanBoardStore(boardStore);

  const startLane = async (cardId: string, columnId: "done" | "review") => {
    await taskStore.save(createTask({
      id: cardId,
      title: `Card ${cardId}`,
      objective: "Leave the lane while its step runs",
      workspaceId: "default",
      boardId: "board-1",
      columnId,
      status: columnId === "done" ? TaskStatus.COMPLETED : TaskStatus.REVIEW_REQUIRED,
    }));
    await orchestrator.processColumnTransition({
      cardId,
      cardTitle: `Card ${cardId}`,
      boardId: "board-1",
      workspaceId: "default",
      fromColumnId: columnId === "done" ? "review" : "todo",
      toColumnId: columnId,
    });
    expect(orchestrator.getAutomationForCard(cardId)).toMatchObject({ columnId, sessionId: `${cardId}-${columnId}-0` });
  };
  const startDoneLane = (cardId: string) => startLane(cardId, "done");

  const endSession = async (sessionId: string, type: AgentEventType) => {
    const failed = type === AgentEventType.AGENT_FAILED;
    eventBus.emit({
      type,
      agentId: sessionId,
      workspaceId: "default",
      data: { sessionId, success: !failed, ...(failed ? { error: "boom" } : {}) },
      timestamp: new Date(),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
  };
  const endPusher = (cardId: string, type: AgentEventType) => endSession(`${cardId}-done-0`, type);

  const startsFor = (cardId: string) => createSession.mock.calls.filter(([params]) => params.cardId === cardId).length;
  const laneOf = async (cardId: string, sessionId: string) =>
    (await taskStore.get(cardId))?.laneSessions?.find((s) => s.sessionId === sessionId);
  const doneLane = (cardId: string) => laneOf(cardId, `${cardId}-done-0`);
  const kills = (sessionId: string) => killSession.mock.calls.filter(([id]) => id === sessionId).length;

  return {
    orchestrator, tools, agentTools, taskStore, createSession, startLane, startDoneLane,
    endSession, endPusher, startsFor, laneOf, doneLane, kills,
  };
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
    expect((await taskStore.get("control"))?.triggerSessionId).toBe("control-done-1");
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

    expect(orchestrator.getAutomationForCard("same")).toMatchObject({ columnId: "done", sessionId: "same-done-0" });
    orchestrator.stop();
  });
});

describe("the session running when its card left the lane still winds down (review R1)", () => {
  it.each([AgentEventType.AGENT_COMPLETED, AgentEventType.AGENT_FAILED])(
    "pusher ends (%s) after move_card to blocked: its process is ended once, no reporter starts",
    async (type) => {
      const { orchestrator, tools, startDoneLane, endPusher, startsFor, doneLane, kills } = await setup();
      await startDoneLane("moved");

      expect((await tools.moveCard({ cardId: "moved", targetColumnId: "blocked" })).success).toBe(true);
      expect(kills("moved-done-0")).toBe(0);
      await endPusher("moved", type);

      expect(kills("moved-done-0")).toBe(1);
      expect((await doneLane("moved"))?.status).toBe("completed");
      expect((await doneLane("moved"))?.recoveryReason).toBeUndefined();
      expect(startsFor("moved")).toBe(1);
      orchestrator.stop();
    },
  );

  it("Review Guard approves with update_task: its lane step completes and its process ends at turn end", async () => {
    const { orchestrator, agentTools, taskStore, startLane, endSession, createSession, laneOf, kills } = await setup();
    await startLane("card", "review");
    await endSession("card-review-0", AgentEventType.AGENT_COMPLETED);
    expect((await taskStore.get("card"))?.triggerSessionId).toBe("card-review-1");

    const result = await agentTools.updateTask({
      taskId: "card",
      updates: { verificationVerdict: "APPROVED", verificationReport: "All AC verified" },
      agentId: "card-review-1",
    });
    expect(result.success).toBe(true);
    await vi.waitFor(() => {
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ cardId: "card", columnId: "done", stepIndex: 0 }));
    });
    expect((await laneOf("card", "card-review-1"))?.status).toBe("completed");
    // Synthesized completion: the Review Guard is still inside its turn.
    expect(kills("card-review-1")).toBe(0);

    await endSession("card-review-1", AgentEventType.AGENT_COMPLETED);

    expect(kills("card-review-1")).toBe(1);
    expect((await laneOf("card", "card-review-1"))?.status).toBe("completed");
    expect((await taskStore.get("card"))?.columnId).toBe("done");
    expect(orchestrator.getAutomationForCard("card")).toMatchObject({ columnId: "done", sessionId: "card-done-0" });
    orchestrator.stop();
  });
});
