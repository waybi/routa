// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, VerificationVerdict, type Task, type TaskLaneSession } from "@/core/models/task";
import { reviveMissingEntryAutomations } from "../restart-recovery";

const notify = vi.fn();
const processKanbanColumnTransition = vi.fn();
const enqueueKanbanTaskSession = vi.fn();

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({ notify }),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  processKanbanColumnTransition: (...args: unknown[]) => processKanbanColumnTransition(...args),
  enqueueKanbanTaskSession: (...args: unknown[]) => enqueueKanbanTaskSession(...args),
}));

const doneBoard = {
  id: "board-1",
  columns: [
    { id: "review", name: "Review", position: 0, stage: "review" },
    {
      id: "done",
      name: "Done",
      position: 1,
      stage: "done",
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
};

function lane(sessionId: string, columnId: string, status: TaskLaneSession["status"], stepIndex: number): TaskLaneSession {
  return { sessionId, columnId, status, stepIndex, startedAt: "2026-10-16T02:00:00.000Z" };
}

function doneTask(laneSessions: TaskLaneSession[], triggerSessionId?: string): Task {
  return {
    ...createTask({
      id: "task-done",
      title: "Finished card",
      objective: "Finished card",
      workspaceId: "workspace-1",
      boardId: "board-1",
      columnId: "done",
      status: TaskStatus.COMPLETED,
    }),
    verificationVerdict: VerificationVerdict.APPROVED,
    triggerSessionId,
    laneSessions,
  };
}

describe("kanban restart recovery on a finished Done lane", () => {
  const taskStore = {
    listByWorkspace: vi.fn<(_: string) => Promise<Task[]>>(),
    save: vi.fn<(task: Task) => Promise<void>>(),
  };
  const kanbanBoardStore = { get: vi.fn() };
  const system = { taskStore, kanbanBoardStore };
  const sessionStore = { getSession: vi.fn() };
  const processManager = { hasActiveSession: vi.fn<(sessionId: string) => boolean>() };
  const options = { sessionStore: sessionStore as never, processManager: processManager as never };

  beforeEach(() => {
    vi.clearAllMocks();
    taskStore.save.mockResolvedValue(undefined);
    kanbanBoardStore.get.mockResolvedValue(doneBoard);
    sessionStore.getSession.mockReturnValue(undefined);
    processManager.hasActiveSession.mockReturnValue(false);
  });

  it("does not re-run the Done lane after its processes exit once every step completed", async () => {
    taskStore.listByWorkspace.mockResolvedValue([doneTask([
      lane("review-guard-1", "review", "completed", 1),
      lane("pusher-1", "done", "completed", 0),
      lane("reporter-1", "done", "completed", 1),
    ], "reporter-1")]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", options);

    expect(processKanbanColumnTransition).not.toHaveBeenCalled();
    expect(enqueueKanbanTaskSession).not.toHaveBeenCalled();
  });

  it("still starts the Done lane when no Done step has run yet", async () => {
    taskStore.listByWorkspace.mockResolvedValue([doneTask([
      lane("review-guard-1", "review", "completed", 1),
    ])]);

    await reviveMissingEntryAutomations(system as never, "workspace-1", "board-1", options);

    expect(processKanbanColumnTransition).toHaveBeenCalledWith(system, expect.objectContaining({
      cardId: "task-done",
      toColumnId: "done",
    }));
  });
});
