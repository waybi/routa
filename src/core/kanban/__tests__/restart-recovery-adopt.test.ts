// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock } = vi.hoisted(() => ({
  triggerAssignedTaskAgentMock: vi.fn(),
}));

vi.mock("@/core/acp/session-prompt", () => ({
  dispatchSessionPrompt: vi.fn(),
}));

vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));

import { createInMemorySystem } from "../../routa-system";
import { getHttpSessionStore } from "../../acp/http-session-store";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus } from "../../models/task";
import { AgentEventType } from "../../events/event-bus";
import { createWorkspace } from "../../models/workspace";
import {
  enqueueKanbanTaskSession,
  getWorkflowOrchestrator,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";
import { reviveMissingEntryAutomations } from "../restart-recovery";

/**
 * POST revive starts the step after a finished one directly (not through a
 * column transition). Before 2026-10-23 that run was not handed to the
 * workflow orchestrator: when it ended its lane record stayed "running" and
 * the lane's following step never started (Done Reporter a1d9bffc on card
 * 25afcd82, Flight Review Guard a53e3e2f on card 7a25276b).
 */
describe("revive hands the next lane step to the workflow orchestrator", () => {
  const limitKey = "kanbanSessionConcurrencyLimit:board-revive";

  async function setup(limit = "5") {
    const system = createInMemorySystem();
    await system.workspaceStore.save(createWorkspace({ id: "default", title: "Default", metadata: { [limitKey]: limit } }));
    const board = createKanbanBoard({
      id: "board-revive",
      workspaceId: "default",
      name: "Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        {
          id: "todo",
          name: "Todo",
          position: 1,
          stage: "todo",
          automation: {
            enabled: true,
            transitionType: "entry",
            autoAdvanceOnSuccess: false,
            steps: [
              { id: "first", providerId: "claude", role: "ROUTA", specialistId: "todo-orchestrator" },
              { id: "second", providerId: "claude", role: "ROUTA", specialistId: "contract-setter" },
              { id: "third", providerId: "claude", role: "ROUTA", specialistId: "flight-review-guard" },
            ],
          },
        },
        { id: "dev", name: "Dev", position: 2, stage: "dev" },
      ],
    });
    await system.kanbanBoardStore.save(board);
    // State after a restart: step 1 had finished, step 2 never started.
    const card = {
      ...createTask({
        id: "card-v",
        title: "Card V",
        objective: "Three-step lane interrupted by a restart",
        workspaceId: "default",
        boardId: board.id,
        columnId: "todo",
        status: TaskStatus.PENDING,
      }),
      triggerSessionId: "card-v:0:old",
      laneSessions: [{
        sessionId: "card-v:0:old",
        columnId: "todo",
        status: "completed" as const,
        stepId: "first",
        stepIndex: 0,
        startedAt: "2026-10-23T08:00:00.000Z",
      }],
    };
    await system.taskStore.save(card);

    triggerAssignedTaskAgentMock.mockImplementation(async (params: { task: { id: string }; stepIndex?: number }) => ({
      sessionId: `${params.task.id}:${params.stepIndex ?? "x"}`,
      transport: "acp",
    }));
    const emitCompleted = (sessionId: string) => system.eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: sessionId,
      workspaceId: "default",
      data: { sessionId, success: true },
      timestamp: new Date(),
    });
    const revive = () => reviveMissingEntryAutomations(system, "default", board.id, {
      sessionStore: getHttpSessionStore(),
      processManager: { hasActiveSession: () => false } as never,
    });

    startWorkflowOrchestrator(system);
    return { system, board, card, emitCompleted, revive, orchestrator: getWorkflowOrchestrator(system) };
  }

  beforeEach(() => {
    resetWorkflowOrchestrator();
    triggerAssignedTaskAgentMock.mockReset();
  });

  afterEach(() => {
    resetWorkflowOrchestrator();
  });

  it("records the revived step as completed and starts the lane's following step", async () => {
    const { system, card, emitCompleted, revive, orchestrator } = await setup();

    await revive();
    expect((await system.taskStore.get(card.id))?.triggerSessionId).toBe("card-v:1");

    emitCompleted("card-v:1");
    await vi.waitFor(async () => {
      expect((await system.taskStore.get(card.id))?.triggerSessionId).toBe("card-v:2");
    });
    expect((await system.taskStore.get(card.id))?.laneSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "card-v:1", status: "completed", stepIndex: 1 }),
    ]));
    expect(triggerAssignedTaskAgentMock).toHaveBeenLastCalledWith(expect.objectContaining({
      stepIndex: 2,
      step: expect.objectContaining({ specialistId: "flight-review-guard" }),
    }));

    emitCompleted("card-v:2");
    await vi.waitFor(() => {
      expect(orchestrator.getAutomationForCard(card.id)?.status).toBe("completed");
    });
    const finished = await system.taskStore.get(card.id);
    expect(finished?.laneSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "card-v:2", status: "completed", stepIndex: 2 }),
    ]));
    expect(finished?.lastSyncError).toBeUndefined();
  });

  it("follows a revived step that waited in the board queue once it starts", async () => {
    const { system, board, card, emitCompleted, revive } = await setup("1");
    const blocker = createTask({
      id: "card-blocker",
      title: "Blocker",
      objective: "Holds the only board slot",
      workspaceId: "default",
      boardId: board.id,
      columnId: "backlog",
      status: TaskStatus.PENDING,
    });
    await system.taskStore.save(blocker);
    const blockerRun = await enqueueKanbanTaskSession(system, { task: blocker, expectedColumnId: "backlog" });
    expect(blockerRun.sessionId).toBeTruthy();

    await revive();
    expect(triggerAssignedTaskAgentMock).not.toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({ id: card.id }),
    }));

    emitCompleted(blockerRun.sessionId!);
    await vi.waitFor(async () => {
      expect((await system.taskStore.get(card.id))?.triggerSessionId).toBe("card-v:1");
    });

    emitCompleted("card-v:1");
    await vi.waitFor(async () => {
      expect((await system.taskStore.get(card.id))?.triggerSessionId).toBe("card-v:2");
    });
    expect((await system.taskStore.get(card.id))?.laneSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "card-v:1", status: "completed", stepIndex: 1 }),
    ]));
  });
});
