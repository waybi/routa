// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  dispatchSessionPromptMock,
  triggerAssignedTaskAgentMock,
  getInternalApiOriginMock,
  createGitWorktreeMock,
} = vi.hoisted(() => ({
  dispatchSessionPromptMock: vi.fn(),
  triggerAssignedTaskAgentMock: vi.fn(),
  getInternalApiOriginMock: vi.fn(() => "http://localhost"),
  createGitWorktreeMock: vi.fn(),
}));

vi.mock("@/core/acp/session-prompt", () => ({
  dispatchSessionPrompt: dispatchSessionPromptMock,
}));

vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: getInternalApiOriginMock,
}));

vi.mock("../../git/git-worktree-service", () => ({
  GitWorktreeService: vi.fn(class {
    createWorktree = createGitWorktreeMock;
  }),
}));

import { createInMemorySystem } from "../../routa-system";
import { getHttpSessionStore } from "../../acp/http-session-store";
import { createCodebase } from "../../models/codebase";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus } from "../../models/task";
import { AgentEventType } from "../../events/event-bus";
import { createWorkspace } from "../../models/workspace";
import {
  enqueueKanbanTaskSession,
  getKanbanSessionQueue,
  getWorkflowOrchestrator,
  processKanbanColumnTransition,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";
import { getEnvironmentFailureCount } from "../environment-failure";
import { getNonDevAutomationRunCount } from "../workflow-orchestrator";

describe("workflow orchestrator singleton prompt path", () => {
  beforeEach(() => {
    resetWorkflowOrchestrator();
    triggerAssignedTaskAgentMock.mockReset();
    getInternalApiOriginMock.mockReset();
    getInternalApiOriginMock.mockReturnValue("http://localhost");
    createGitWorktreeMock.mockReset();
  });

  afterEach(() => {
    resetWorkflowOrchestrator();
    dispatchSessionPromptMock.mockReset();
  });

  it("sends recovery prompt via agent tools when routa agent session exists", async () => {
    const system = createInMemorySystem();
    const createAgentResult = await system.tools.createAgent({
      name: "watchdog-test-agent",
      role: "ROUTA",
      workspaceId: "default",
    });
    expect(createAgentResult.success).toBe(true);
    const sessionAgentId = (createAgentResult.data as { agentId: string }).agentId;
    const sessionId = "session-watchdog-tool-path";

    const sessionStore = getHttpSessionStore();
    sessionStore.upsertSession({
      sessionId,
      workspaceId: "default",
      cwd: "/tmp",
      routaAgentId: sessionAgentId,
      createdAt: new Date().toISOString(),
    });

    const readConversation = vi
      .spyOn(system.tools, "readAgentConversation")
      .mockResolvedValue({ success: true, data: { messages: [] } });
    const messageAgent = vi
      .spyOn(system.tools, "messageAgent")
      .mockResolvedValue({ success: true, data: { delivered: true } });

    startWorkflowOrchestrator(system);
    const orchestrator = getWorkflowOrchestrator(system);
    await (orchestrator as unknown as {
      notifyKanbanAgent: (params: {
        workspaceId: string;
        sessionId: string;
        cardId: string;
        cardTitle: string;
        boardId: string;
        columnId: string;
        reason: string;
        mode: "watchdog_retry";
      }) => Promise<void>;
    }).notifyKanbanAgent({
      workspaceId: "default",
      sessionId,
      cardId: "card-1",
      cardTitle: "Test card",
      boardId: "board-1",
      columnId: "dev",
      reason: "No activity for too long.",
      mode: "watchdog_retry",
    });

    expect(readConversation).toHaveBeenCalledWith({
      agentId: sessionAgentId,
      lastN: 5,
    });
    expect(messageAgent).toHaveBeenCalledWith({
      fromAgentId: sessionAgentId,
      toAgentId: sessionAgentId,
      message: expect.stringContaining(`acp session id = ${sessionId}`),
    });
    expect(dispatchSessionPromptMock).not.toHaveBeenCalled();
  });

  it("falls back to session/prompt when agent message fails", async () => {
    const system = createInMemorySystem();
    const createAgentResult = await system.tools.createAgent({
      name: "watchdog-fallback-agent",
      role: "ROUTA",
      workspaceId: "default",
    });
    const sessionAgentId = (createAgentResult.data as { agentId: string }).agentId;
    const sessionId = "session-watchdog-fallback-path";

    const sessionStore = getHttpSessionStore();
    sessionStore.upsertSession({
      sessionId,
      workspaceId: "default",
      cwd: "/tmp",
      routaAgentId: sessionAgentId,
      createdAt: new Date().toISOString(),
    });

    vi.spyOn(system.tools, "readAgentConversation").mockResolvedValue({ success: true, data: { messages: [] } });
    vi.spyOn(system.tools, "messageAgent").mockResolvedValue({ success: false, error: "temporary failure" });
    dispatchSessionPromptMock.mockResolvedValue(undefined);

    startWorkflowOrchestrator(system);
    const orchestrator = getWorkflowOrchestrator(system);
    await (orchestrator as unknown as {
      notifyKanbanAgent: (params: {
        workspaceId: string;
        sessionId: string;
        cardId: string;
        cardTitle: string;
        boardId: string;
        columnId: string;
        reason: string;
        mode: "watchdog_retry";
      }) => Promise<void>;
    }).notifyKanbanAgent({
      workspaceId: "default",
      sessionId,
      cardId: "card-1",
      cardTitle: "Test card",
      boardId: "board-1",
      columnId: "dev",
      reason: "No activity for too long.",
      mode: "watchdog_retry",
    });

    expect(dispatchSessionPromptMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      workspaceId: "default",
      prompt: [expect.objectContaining({ type: "text" })],
    }));
  });

  it("recreates a missing dev worktree before starting a new task session", async () => {
    const system = createInMemorySystem();
    const board = createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "dev", name: "Dev", position: 1, stage: "dev" },
      ],
    });
    await system.kanbanBoardStore.save(board);
    await system.codebaseStore.add(createCodebase({
      id: "repo-1",
      workspaceId: "default",
      repoPath: "/tmp/repos/main",
      branch: "main",
      isDefault: true,
    }));

    const task = createTask({
      id: "task-1",
      title: "Retry stale worktree",
      objective: "Recreate missing worktree before dev rerun",
      workspaceId: "default",
      boardId: board.id,
      columnId: "dev",
      status: TaskStatus.IN_PROGRESS,
      worktreeId: "wt-stale",
    });
    await system.taskStore.save(task);

    createGitWorktreeMock.mockResolvedValue({
      id: "wt-fresh",
      codebaseId: "repo-1",
      workspaceId: "default",
      worktreePath: "/tmp/worktrees/task-1",
      branch: "issue/task-1",
      baseBranch: "main",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    triggerAssignedTaskAgentMock.mockResolvedValue({
      sessionId: "session-dev-1",
      transport: "acp",
    });

    const result = await enqueueKanbanTaskSession(system, {
      task,
      expectedColumnId: "dev",
      ignoreExistingTrigger: true,
      bypassQueue: true,
    });

    expect(result).toEqual({ sessionId: "session-dev-1", queued: false, error: undefined });
    expect(createGitWorktreeMock).toHaveBeenCalledWith("repo-1", expect.objectContaining({
      branch: "issue/task-1",
      baseBranch: "main",
    }));
    const updatedTask = await system.taskStore.get("task-1");
    expect(updatedTask).toMatchObject({
      worktreeId: "wt-fresh",
      triggerSessionId: "session-dev-1",
    });
  });

  it("marks the previous lane run completed when a new lane session starts", async () => {
    const system = createInMemorySystem();
    const board = createKanbanBoard({
      id: "board-2",
      workspaceId: "default",
      name: "Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "todo", name: "Todo", position: 1, stage: "todo" },
      ],
    });
    await system.kanbanBoardStore.save(board);

    const task = createTask({
      id: "task-2",
      title: "Advance into todo",
      objective: "Stop the backlog run once todo begins",
      workspaceId: "default",
      boardId: board.id,
      columnId: "todo",
      status: TaskStatus.PENDING,
    });
    task.laneSessions = [{
      sessionId: "session-backlog-1",
      columnId: "backlog",
      columnName: "Backlog",
      provider: "claude",
      role: "ROUTA",
      specialistName: "Backlog Refiner",
      status: "running",
      startedAt: "2026-03-18T00:00:00.000Z",
    }];
    await system.taskStore.save(task);

    triggerAssignedTaskAgentMock.mockResolvedValue({
      sessionId: "session-todo-1",
      transport: "acp",
    });

    const result = await enqueueKanbanTaskSession(system, {
      task,
      expectedColumnId: "todo",
      ignoreExistingTrigger: true,
      bypassQueue: true,
    });

    expect(result).toEqual({ sessionId: "session-todo-1", queued: false, error: undefined });
    const updatedTask = await system.taskStore.get("task-2");
    expect(updatedTask?.triggerSessionId).toBe("session-todo-1");
    expect(updatedTask?.laneSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: "session-backlog-1",
        columnId: "backlog",
        status: "completed",
        completedAt: expect.any(String),
      }),
      expect.objectContaining({
        sessionId: "session-todo-1",
        columnId: "todo",
        status: "running",
      }),
    ]));
  });

  it("records a session that fails to start because of the environment as environment_failure", async () => {
    const system = createInMemorySystem();
    const board = createKanbanBoard({
      id: "board-env",
      workspaceId: "default",
      name: "Board",
      isDefault: true,
      columns: [
        { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
        { id: "todo", name: "Todo", position: 1, stage: "todo" },
      ],
    });
    await system.kanbanBoardStore.save(board);

    const task = createTask({
      id: "task-env",
      title: "Provider missing",
      objective: "Session cannot start",
      workspaceId: "default",
      boardId: board.id,
      columnId: "todo",
      status: TaskStatus.PENDING,
    });
    await system.taskStore.save(task);

    const error = 'Unknown provider: "local-7357". Not registered in ProviderRegistry.';
    triggerAssignedTaskAgentMock.mockResolvedValue({ error });

    const result = await enqueueKanbanTaskSession(system, {
      task,
      expectedColumnId: "todo",
      ignoreExistingTrigger: true,
      bypassQueue: true,
    });

    expect(result).toMatchObject({ queued: false, error });
    expect(result.sessionId ?? null).toBeNull();
    const updatedTask = await system.taskStore.get("task-env");
    expect(updatedTask?.lastSyncError).toBe(`[environment] ${error}`);
    expect(updatedTask?.laneSessions).toEqual([
      expect.objectContaining({
        columnId: "todo",
        status: "failed",
        recoveryReason: "environment_failure",
      }),
    ]);
    expect(getEnvironmentFailureCount(updatedTask, "todo")).toBe(1);
    expect(getNonDevAutomationRunCount(updatedTask, "todo", "todo")).toBe(0);
  });

  it("keeps ordinary start failures out of the environment failure class", async () => {
    const system = createInMemorySystem();
    const board = createKanbanBoard({
      id: "board-plain",
      workspaceId: "default",
      name: "Board",
      isDefault: true,
      columns: [{ id: "todo", name: "Todo", position: 0, stage: "todo" }],
    });
    await system.kanbanBoardStore.save(board);
    const task = createTask({
      id: "task-plain",
      title: "Plain failure",
      objective: "Session cannot start",
      workspaceId: "default",
      boardId: board.id,
      columnId: "todo",
      status: TaskStatus.PENDING,
    });
    await system.taskStore.save(task);
    triggerAssignedTaskAgentMock.mockResolvedValue({ error: "Failed to create ACP session." });

    await enqueueKanbanTaskSession(system, {
      task,
      expectedColumnId: "todo",
      ignoreExistingTrigger: true,
      bypassQueue: true,
    });

    const updatedTask = await system.taskStore.get("task-plain");
    expect(updatedTask?.lastSyncError).toBe("Failed to create ACP session.");
    expect(updatedTask?.laneSessions ?? []).toHaveLength(0);
  });

  it("keeps a lane's next step queued (not failed) while the board is full, then runs it and advances", async () => {
    const system = createInMemorySystem();
    const limitKey = "kanbanSessionConcurrencyLimit:board-queue";
    await system.workspaceStore.save(createWorkspace({ id: "default", title: "Default", metadata: { [limitKey]: "2" } }));
    const board = createKanbanBoard({
      id: "board-queue",
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
            autoAdvanceOnSuccess: true,
            steps: [
              { id: "orchestrate", providerId: "claude", role: "ROUTA", specialistId: "todo-orchestrator" },
              { id: "contract", providerId: "claude", role: "ROUTA", specialistId: "contract-setter" },
            ],
          },
        },
        { id: "dev", name: "Dev", position: 2, stage: "dev" },
      ],
    });
    await system.kanbanBoardStore.save(board);
    const blocker = createTask({
      id: "card-blocker",
      title: "Blocker",
      objective: "Holds a board slot",
      workspaceId: "default",
      boardId: board.id,
      columnId: "backlog",
      status: TaskStatus.PENDING,
    });
    const card = createTask({
      id: "card-x",
      title: "Card X",
      objective: "Two-step todo lane",
      workspaceId: "default",
      boardId: board.id,
      columnId: "todo",
      status: TaskStatus.PENDING,
    });
    await system.taskStore.save(blocker);
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

    startWorkflowOrchestrator(system);
    const blockerRun = await enqueueKanbanTaskSession(system, { task: blocker, expectedColumnId: "backlog" });
    expect(blockerRun.sessionId).toBeTruthy();
    await processKanbanColumnTransition(system, {
      cardId: card.id,
      cardTitle: card.title,
      boardId: board.id,
      workspaceId: "default",
      fromColumnId: "backlog",
      toColumnId: "todo",
    });
    expect((await system.taskStore.get(card.id))?.triggerSessionId).toBe("card-x:0");

    // The board fills up before step 1 of card X finishes.
    await system.workspaceStore.updateMetadata("default", { [limitKey]: "1" });
    emitCompleted("card-x:0");

    const orchestrator = getWorkflowOrchestrator(system);
    const queue = getKanbanSessionQueue(system);
    await vi.waitFor(async () => {
      expect((await queue.getBoardSnapshot(board.id)).queuedCardIds).toEqual([card.id]);
    });
    expect(orchestrator.getAutomationForCard(card.id)).toMatchObject({ status: "queued", currentStepIndex: 1 });
    const queuedTask = await system.taskStore.get(card.id);
    expect(queuedTask?.lastSyncError).toBeUndefined();
    expect(queuedTask?.laneSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "card-x:0", status: "completed" }),
    ]));

    // The slot frees up: the queued step starts and the orchestrator follows it.
    emitCompleted(blockerRun.sessionId!);
    await vi.waitFor(async () => {
      expect((await system.taskStore.get(card.id))?.triggerSessionId).toBe("card-x:1");
    });

    emitCompleted("card-x:1");
    await vi.waitFor(async () => {
      expect((await system.taskStore.get(card.id))?.columnId).toBe("dev");
    });
    const advancedTask = await system.taskStore.get(card.id);
    expect(advancedTask?.lastSyncError).toBeUndefined();
    expect(advancedTask?.laneSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "card-x:1", status: "completed", stepIndex: 1 }),
    ]));
  });

  describe("rerunning a two-step lane", () => {
    async function setupTwoStepTodo() {
      const system = createInMemorySystem();
      const board = createKanbanBoard({
        id: "board-rerun",
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
                { id: "orchestrate", providerId: "claude", role: "ROUTA", specialistId: "todo-orchestrator" },
                { id: "contract", providerId: "claude", role: "ROUTA", specialistId: "contract-setter" },
              ],
            },
          },
          { id: "dev", name: "Dev", position: 2, stage: "dev" },
        ],
      });
      await system.kanbanBoardStore.save(board);
      const card = createTask({
        id: "card-r",
        title: "Card R",
        objective: "Rerun a two-step lane",
        workspaceId: "default",
        boardId: board.id,
        columnId: "todo",
        status: TaskStatus.PENDING,
      });
      await system.taskStore.save(card);

      let runCount = 0;
      triggerAssignedTaskAgentMock.mockImplementation(async (params: { task: { id: string }; stepIndex?: number }) => {
        runCount += 1;
        return { sessionId: `${params.task.id}:${params.stepIndex ?? "x"}:${runCount}`, transport: "acp" };
      });
      const emit = (type: AgentEventType, sessionId: string, success: boolean) => system.eventBus.emit({
        type,
        agentId: sessionId,
        workspaceId: "default",
        data: { sessionId, success, ...(success ? {} : { error: "step failed" }) },
        timestamp: new Date(),
      });

      startWorkflowOrchestrator(system);
      await processKanbanColumnTransition(system, {
        cardId: card.id,
        cardTitle: card.title,
        boardId: board.id,
        workspaceId: "default",
        fromColumnId: "backlog",
        toColumnId: "todo",
      });
      expect((await system.taskStore.get(card.id))?.triggerSessionId).toBe("card-r:0:1");

      // What PATCH retryTrigger does before it enqueues.
      const rerun = async () => {
        const current = (await system.taskStore.get(card.id))!;
        current.triggerSessionId = undefined;
        current.lastSyncError = undefined;
        await system.taskStore.save(current);
        getKanbanSessionQueue(system).removeCardJob(card.id);
        return enqueueKanbanTaskSession(system, {
          task: current,
          expectedColumnId: "todo",
          ignoreExistingTrigger: true,
          resumeLane: true,
        });
      };

      return { system, card, emit, rerun, orchestrator: getWorkflowOrchestrator(system) };
    }

    it("continues to the second step after a rerun of a failed first step", async () => {
      const { system, card, emit, rerun, orchestrator } = await setupTwoStepTodo();

      emit(AgentEventType.AGENT_FAILED, "card-r:0:1", false);
      await vi.waitFor(() => {
        expect(orchestrator.getAutomationForCard(card.id)?.status).toBe("failed");
      });

      const result = await rerun();
      expect(result.sessionId).toBe("card-r:0:2");
      expect(triggerAssignedTaskAgentMock).toHaveBeenLastCalledWith(expect.objectContaining({
        stepIndex: 0,
        step: expect.objectContaining({ specialistId: "todo-orchestrator" }),
      }));

      emit(AgentEventType.AGENT_COMPLETED, "card-r:0:2", true);
      await vi.waitFor(async () => {
        expect((await system.taskStore.get(card.id))?.triggerSessionId).toBe("card-r:1:3");
      });
      expect(triggerAssignedTaskAgentMock).toHaveBeenLastCalledWith(expect.objectContaining({
        stepIndex: 1,
        step: expect.objectContaining({ specialistId: "contract-setter" }),
      }));
      expect(orchestrator.getAutomationForCard(card.id)).toMatchObject({
        status: "running",
        currentStepIndex: 1,
        sessionId: "card-r:1:3",
      });
    });

    it("resumes at the step that never ran when the first step had completed", async () => {
      const { system, card, emit, rerun, orchestrator } = await setupTwoStepTodo();

      // Step 1 completes but step 2 cannot start (the case of card 1e7dd356).
      triggerAssignedTaskAgentMock.mockResolvedValueOnce({ error: "Failed to create ACP session." });
      emit(AgentEventType.AGENT_COMPLETED, "card-r:0:1", true);
      await vi.waitFor(() => {
        expect(orchestrator.getAutomationForCard(card.id)?.status).toBe("failed");
      });

      const result = await rerun();
      expect(result.sessionId).toMatch(/^card-r:1:/);
      expect(triggerAssignedTaskAgentMock).toHaveBeenLastCalledWith(expect.objectContaining({
        stepIndex: 1,
        step: expect.objectContaining({ specialistId: "contract-setter" }),
      }));
      expect(orchestrator.getAutomationForCard(card.id)).toMatchObject({
        status: "running",
        currentStepIndex: 1,
        sessionId: result.sessionId,
      });

      emit(AgentEventType.AGENT_COMPLETED, result.sessionId!, true);
      await vi.waitFor(() => {
        expect(orchestrator.getAutomationForCard(card.id)?.status).toBe("completed");
      });
      expect((await system.taskStore.get(card.id))?.lastSyncError).toBeUndefined();
    });
  });
});
