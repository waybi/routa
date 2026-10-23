import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, type Task } from "@/core/models/task";

const notify = vi.fn();
const ensureDefaultBoard = vi.fn();
const reviveMissingEntryAutomations = vi.fn();
const processKanbanColumnTransition = vi.fn();
const enqueueKanbanTaskSession = vi.fn();
const getBoardSnapshot = vi.fn();

const taskStore = {
  listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
  save: vi.fn<(task: Task) => Promise<void>>(),
};

const boardStore = {
  listByWorkspace: vi.fn(),
  get: vi.fn(),
};

const workspaceStore = {
  get: vi.fn(),
};

const system = {
  taskStore,
  kanbanBoardStore: boardStore,
  workspaceStore,
};

vi.mock("@/core/routa-system", () => ({
  getRoutaSystem: () => system,
}));

vi.mock("@/core/kanban/boards", () => ({
  ensureDefaultBoard: (...args: unknown[]) => ensureDefaultBoard(...args),
}));

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/restart-recovery", () => ({
  reviveMissingEntryAutomations: (...args: unknown[]) => reviveMissingEntryAutomations(...args),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  getKanbanSessionQueue: () => ({ getBoardSnapshot }),
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
  enqueueKanbanTaskSession: (...args: unknown[]) => enqueueKanbanTaskSession(...args),
}));

import { GET } from "../route";

const board = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Default Board",
  isDefault: true,
  columns: [{
    id: "backlog",
    name: "Backlog",
    position: 0,
    stage: "backlog",
    automation: {
      enabled: true,
      transitionType: "entry",
      steps: [{ id: "backlog-refiner", role: "CRAFTER" }],
    },
  }],
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};

describe("/api/kanban/boards GET", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureDefaultBoard.mockResolvedValue(undefined);
    taskStore.save.mockResolvedValue(undefined);
    workspaceStore.get.mockResolvedValue({
      metadata: {
        "kanbanAutoProvider:board-1": "codex",
        "kanbanHistoryMemoryPolicy:board-1": JSON.stringify({
          mode: "force",
          minMatchedSessions: 4,
          minMatchedFiles: 5,
          minFeatureCandidates: 2,
          minConfidence: "high",
        }),
      },
    });
    getBoardSnapshot.mockResolvedValue({
      boardId: "board-1",
      runningCount: 0,
      runningCards: [],
      queuedCount: 0,
      queuedCardIds: [],
      queuedCards: [],
      queuedPositions: {},
    });
    boardStore.listByWorkspace.mockResolvedValue([board]);
    boardStore.get.mockResolvedValue(board);
    // An orphaned card with a stale running session: the old GET rewrote its
    // lane sessions and re-enqueued it.
    taskStore.listByWorkspace.mockResolvedValue([{
      ...createTask({
        id: "task-1",
        title: "Orphaned backlog story",
        objective: "Backlog story",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "backlog",
        status: TaskStatus.PENDING,
      }),
      triggerSessionId: "session-1",
      laneSessions: [{
        sessionId: "session-1",
        columnId: "backlog",
        status: "running",
        startedAt: "2025-01-01T00:00:00.000Z",
      }],
    }]);
  });

  it("requires workspaceId", async () => {
    const response = await GET(new NextRequest("http://localhost/api/kanban/boards"));
    expect(response.status).toBe(400);
  });

  it("returns boards without triggering revive, transitions, enqueues or task writes", async () => {
    const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.boards[0]).toMatchObject({
      id: "board-1",
      autoProviderId: "codex",
      historyMemoryPolicy: {
        mode: "force",
        minMatchedSessions: 4,
        minMatchedFiles: 5,
        minFeatureCandidates: 2,
        minConfidence: "high",
      },
    });
    expect(reviveMissingEntryAutomations).toHaveBeenCalledTimes(0);
    expect(processKanbanColumnTransition).toHaveBeenCalledTimes(0);
    expect(enqueueKanbanTaskSession).toHaveBeenCalledTimes(0);
    expect(taskStore.save).toHaveBeenCalledTimes(0);
  });

  // Card 5fdaa681 (F2, 6f4f9ed4): a card waiting for a rerun after a restart
  // interruption is still only read by GET, however often the page loads.
  it("does not rerun a restart-interrupted step when the board is read twice", async () => {
    taskStore.listByWorkspace.mockResolvedValue([{
      ...createTask({
        id: "task-interrupted",
        title: "Interrupted Done pusher",
        objective: "Interrupted Done pusher",
        workspaceId: "workspace-1",
        boardId: "board-1",
        columnId: "backlog",
        status: TaskStatus.PENDING,
      }),
      laneSessions: [{
        sessionId: "pusher-1",
        columnId: "backlog",
        stepIndex: 0,
        status: "timed_out",
        recoveryReason: "restart_interrupted",
        startedAt: "2026-10-23T20:23:00.000Z",
        completedAt: "2026-10-23T20:30:00.000Z",
      }],
    }]);

    for (let read = 0; read < 2; read += 1) {
      const response = await GET(new NextRequest("http://localhost/api/kanban/boards?workspaceId=workspace-1"));
      expect(response.status).toBe(200);
    }

    expect(reviveMissingEntryAutomations).toHaveBeenCalledTimes(0);
    expect(processKanbanColumnTransition).toHaveBeenCalledTimes(0);
    expect(enqueueKanbanTaskSession).toHaveBeenCalledTimes(0);
    expect(taskStore.save).toHaveBeenCalledTimes(0);
  });
});
