// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus, type TaskLaneSession } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanTools } from "../kanban-tools";

function lane(sessionId: string, columnId: string, status: TaskLaneSession["status"]): TaskLaneSession {
  return { sessionId, columnId, status, stepIndex: 0, startedAt: "2026-10-16T02:39:00.000Z" };
}

async function setup(triggerSessionId: string, laneSessions: TaskLaneSession[]) {
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const tools = new KanbanTools(boardStore, taskStore);
  await boardStore.save(createKanbanBoard({
    id: "board-1",
    workspaceId: "default",
    name: "Main",
    columns: [
      { id: "review", name: "Review", stage: "review", position: 0 },
      { id: "done", name: "Done", stage: "done", position: 1 },
    ],
  }));
  await taskStore.save({
    ...createTask({
      id: "task-1",
      title: "Already in done",
      objective: "move_card to the current column",
      workspaceId: "default",
      boardId: "board-1",
      columnId: "done",
      status: TaskStatus.COMPLETED,
    }),
    triggerSessionId,
    sessionIds: [triggerSessionId],
    laneSessions,
  });
  return { tools, taskStore };
}

describe("KanbanTools.moveCard into the card's current column", () => {
  it("keeps the running Done lane session when a Review Guard repeats move_card(done)", async () => {
    const { tools, taskStore } = await setup("pusher-1", [
      lane("review-guard-1", "review", "completed"),
      lane("pusher-1", "done", "running"),
    ]);

    const result = await tools.moveCard({ cardId: "task-1", targetColumnId: "done" });

    expect(result.success).toBe(true);
    const saved = await taskStore.get("task-1");
    expect(saved?.triggerSessionId).toBe("pusher-1");
    expect(saved?.laneSessions?.find((entry) => entry.sessionId === "pusher-1")?.status).toBe("running");
  });

  it("still releases a trigger session left over from an earlier column", async () => {
    const { tools, taskStore } = await setup("review-guard-1", [
      lane("review-guard-1", "review", "running"),
    ]);

    const result = await tools.moveCard({ cardId: "task-1", targetColumnId: "done" });

    expect(result.success).toBe(true);
    const saved = await taskStore.get("task-1");
    expect(saved?.triggerSessionId).toBeUndefined();
    expect(saved?.laneSessions?.[0]?.status).toBe("completed");
  });
});
