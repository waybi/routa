// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { AgentEventType, EventBus, type AgentEvent } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus, type TaskLaneSession } from "../../models/task";
import { KanbanWorkflowOrchestrator } from "../../kanban/workflow-orchestrator";
import { InMemoryAgentStore } from "../../store/agent-store";
import { InMemoryConversationStore } from "../../store/conversation-store";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { AgentTools } from "../agent-tools";

/**
 * Card 30dbf08e (2026-10-16 10:39): Review Guard recorded APPROVED with
 * update_task and never called move_card. update_task moved the card to done
 * through review-lane convergence but emitted no COLUMN_TRANSITION and kept
 * the Review Guard as triggerSessionId, so no Done lane session started.
 */
function lane(sessionId: string, columnId: string, status: TaskLaneSession["status"], stepIndex: number): TaskLaneSession {
  return { sessionId, columnId, status, stepIndex, role: "GATE", startedAt: "2026-10-16T02:36:00.000Z" };
}

async function setup() {
  const eventBus = new EventBus();
  const taskStore = new InMemoryTaskStore();
  const boardStore = new InMemoryKanbanBoardStore();
  const tools = new AgentTools(new InMemoryAgentStore(), new InMemoryConversationStore(), taskStore, eventBus);
  tools.setKanbanBoardStore(boardStore);

  await boardStore.save(createKanbanBoard({
    id: "board-1",
    workspaceId: "ws-1",
    name: "Main",
    columns: [
      { id: "dev", name: "Dev", stage: "dev", position: 0 },
      {
        id: "review",
        name: "Review",
        stage: "review",
        position: 1,
        automation: {
          enabled: true,
          steps: [
            { id: "qa-frontend", role: "GATE", specialistId: "kanban-qa-frontend", specialistName: "QA Frontend" },
            { id: "review-guard", role: "GATE", specialistId: "kanban-review-guard", specialistName: "Review Guard" },
          ],
        },
      },
      {
        id: "done",
        name: "Done",
        stage: "done",
        position: 2,
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [
            { id: "main-pusher", role: "GATE", specialistId: "kanban-main-pusher", specialistName: "Main Pusher" },
            { id: "done-reporter", role: "GATE", specialistId: "kanban-done-reporter", specialistName: "Done Reporter" },
          ],
        },
      },
    ],
  }));

  const task = createTask({
    id: "task-approved",
    title: "Approved by update_task",
    objective: "Approved review must start the Done lane",
    workspaceId: "ws-1",
    boardId: "board-1",
    columnId: "review",
    status: TaskStatus.REVIEW_REQUIRED,
  });
  task.assignedSpecialistId = "kanban-review-guard";
  task.assignedSpecialistName = "Review Guard";
  task.triggerSessionId = "review-guard-1";
  task.sessionIds = ["qa-1", "review-guard-1"];
  task.laneSessions = [lane("qa-1", "review", "completed", 0), lane("review-guard-1", "review", "running", 1)];
  await taskStore.save(task);

  return { eventBus, taskStore, boardStore, tools, taskId: task.id };
}

async function approve(tools: AgentTools, taskId: string) {
  return tools.updateTask({
    taskId,
    updates: { verificationVerdict: "APPROVED", verificationReport: "All AC verified" },
    agentId: "review-guard-1",
  });
}

describe("AgentTools.updateTask review verdict convergence", () => {
  it("starts the Done lane when update_task moves an approved card into done", async () => {
    const { eventBus, taskStore, boardStore, tools, taskId } = await setup();
    const createSession = vi.fn().mockResolvedValue("pusher-1");
    const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession);
    orchestrator.start();

    const result = await approve(tools, taskId);
    expect(result.success).toBe(true);
    expect((await taskStore.get(taskId))?.columnId).toBe("done");

    await vi.waitFor(() => {
      expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
        cardId: taskId,
        columnId: "done",
        stepIndex: 0,
        step: expect.objectContaining({ specialistId: "kanban-main-pusher" }),
      }));
    });
    expect(orchestrator.getAutomationForCard(taskId)).toMatchObject({ columnId: "done", sessionId: "pusher-1" });
    orchestrator.stop();
  });

  it("emits one review→done transition and releases the Review Guard as trigger session", async () => {
    const { eventBus, taskStore, tools, taskId } = await setup();
    const transitions: AgentEvent[] = [];
    eventBus.on("test-listener", (event) => {
      if (event.type === AgentEventType.COLUMN_TRANSITION) transitions.push(event);
    });

    await approve(tools, taskId);

    expect(transitions).toHaveLength(1);
    expect(transitions[0].data).toMatchObject({
      cardId: taskId,
      boardId: "board-1",
      fromColumnId: "review",
      toColumnId: "done",
      fromColumnName: "Review",
      toColumnName: "Done",
    });
    const saved = await taskStore.get(taskId);
    expect(saved?.status).toBe(TaskStatus.COMPLETED);
    expect(saved?.triggerSessionId).toBeUndefined();
    expect(saved?.sessionIds).toContain("review-guard-1");
  });

  it("still emits the Review Guard's synthetic completion before the transition", async () => {
    const { eventBus, tools, taskId } = await setup();
    const events: AgentEvent[] = [];
    eventBus.on("test-listener", (event) => {
      if (event.type === AgentEventType.COLUMN_TRANSITION || event.type === AgentEventType.AGENT_COMPLETED) {
        events.push(event);
      }
    });

    await approve(tools, taskId);

    expect(events.map((event) => event.type)).toEqual([
      AgentEventType.AGENT_COMPLETED,
      AgentEventType.COLUMN_TRANSITION,
    ]);
    expect(events[0].data).toMatchObject({ sessionId: "review-guard-1", synthesizedBy: "updateTask" });
  });

  it("emits no transition when the verdict does not move the card", async () => {
    const { eventBus, taskStore, tools, taskId } = await setup();
    const saved = await taskStore.get(taskId);
    await taskStore.save({ ...saved!, columnId: "done", status: TaskStatus.COMPLETED });
    const transitions: AgentEvent[] = [];
    eventBus.on("test-listener", (event) => {
      if (event.type === AgentEventType.COLUMN_TRANSITION) transitions.push(event);
    });

    await approve(tools, taskId);

    expect(transitions).toHaveLength(0);
  });
});
