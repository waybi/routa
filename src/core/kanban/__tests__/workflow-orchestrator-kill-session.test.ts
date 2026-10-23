// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

async function setup(prefix: string, options?: { maxRecoveryAttempts?: number; killSession?: () => Promise<void> }) {
  const eventBus = new EventBus();
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  let attempt = 0;
  const createSession = vi.fn().mockImplementation(async () => {
    attempt += 1;
    const sessionId = `${prefix}-session-${attempt}`;
    getHttpSessionStore().upsertSession({
      sessionId,
      workspaceId: "default",
      provider: "codex",
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
    });
    return sessionId;
  });
  const killSession = vi.fn(options?.killSession ?? (async () => undefined));

  const board = createKanbanBoard({
    id: `${prefix}-board`,
    workspaceId: "default",
    name: "Main Board",
    isDefault: true,
    columns: [
      { id: "todo", name: "Todo", stage: "todo", position: 0 },
      {
        id: "dev",
        name: "Dev",
        stage: "dev",
        position: 1,
        automation: { enabled: true, providerId: "codex", role: "DEVELOPER", transitionType: "entry" },
      },
    ],
  });
  await boardStore.save(board);
  const task = createTask({
    id: `${prefix}-task`,
    title: "Kill failed sessions",
    objective: "Failed sessions must not leak processes",
    workspaceId: "default",
    boardId: board.id,
    columnId: "dev",
  });
  await taskStore.save(task);

  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession, killSession);
  orchestrator.setResolveDevSessionSupervision(async () => ({
    mode: "watchdog_retry",
    inactivityTimeoutMinutes: 1,
    maxRecoveryAttempts: options?.maxRecoveryAttempts ?? 0,
    completionRequirement: "turn_complete",
  }));
  orchestrator.start();

  eventBus.emit({
    type: AgentEventType.COLUMN_TRANSITION,
    agentId: "test",
    workspaceId: "default",
    data: {
      cardId: task.id,
      cardTitle: task.title,
      boardId: board.id,
      workspaceId: "default",
      fromColumnId: "todo",
      toColumnId: "dev",
    },
    timestamp: new Date(),
  });
  const firstSessionId = `${prefix}-session-1`;
  await vi.waitFor(() => {
    expect(orchestrator.getAutomationForCard(task.id)).toMatchObject({ sessionId: firstSessionId, status: "running" });
  });

  return { eventBus, orchestrator, task, createSession, killSession, firstSessionId };
}

function emit(eventBus: EventBus, type: AgentEventType, sessionId: string, data: Record<string, unknown>) {
  eventBus.emit({
    type,
    agentId: sessionId,
    workspaceId: "default",
    data: { sessionId, ...data },
    timestamp: new Date(),
  });
}

describe("workflow orchestrator kills failed session processes", () => {
  it("kills the session once on AGENT_FAILED", async () => {
    const ctx = await setup("kill-failed");
    emit(ctx.eventBus, AgentEventType.AGENT_FAILED, ctx.firstSessionId, { success: false, error: "boom" });

    await vi.waitFor(() => {
      expect(ctx.orchestrator.getAutomationForCard(ctx.task.id)?.status).toBe("failed");
    });
    expect(ctx.killSession).toHaveBeenCalledTimes(1);
    expect(ctx.killSession).toHaveBeenCalledWith(ctx.firstSessionId);
    ctx.orchestrator.stop();
  });

  it("kills the session once on AGENT_TIMEOUT", async () => {
    const ctx = await setup("kill-timeout");
    emit(ctx.eventBus, AgentEventType.AGENT_TIMEOUT, ctx.firstSessionId, { success: false, error: "idle" });

    await vi.waitFor(() => {
      expect(ctx.orchestrator.getAutomationForCard(ctx.task.id)?.status).toBe("failed");
    });
    expect(ctx.killSession).toHaveBeenCalledTimes(1);
    expect(ctx.killSession).toHaveBeenCalledWith(ctx.firstSessionId);
    ctx.orchestrator.stop();
  });

  it("kills the session once when the watchdog finds acpStatus=error", async () => {
    const ctx = await setup("kill-acp-error");
    getHttpSessionStore().upsertSession({
      sessionId: ctx.firstSessionId,
      workspaceId: "default",
      provider: "codex",
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
      acpStatus: "error",
      acpError: "worker crashed",
    });

    const watchdog = ctx.orchestrator as unknown as { scanForInactiveSessions: () => Promise<void> };
    await watchdog.scanForInactiveSessions();
    await watchdog.scanForInactiveSessions();

    await vi.waitFor(() => {
      expect(ctx.orchestrator.getAutomationForCard(ctx.task.id)?.status).toBe("failed");
    });
    expect(ctx.killSession).toHaveBeenCalledTimes(1);
    expect(ctx.killSession).toHaveBeenCalledWith(ctx.firstSessionId);
    ctx.orchestrator.stop();
  });

  it("ends the session once its step completes, without waiting for Done", async () => {
    const ctx = await setup("kill-success");
    emit(ctx.eventBus, AgentEventType.AGENT_COMPLETED, ctx.firstSessionId, { success: true });

    await vi.waitFor(() => {
      expect(ctx.orchestrator.getAutomationForCard(ctx.task.id)?.status).toBe("completed");
      expect(ctx.killSession).toHaveBeenCalledTimes(1);
    });
    expect(ctx.killSession).toHaveBeenCalledWith(ctx.firstSessionId);

    // A second lifecycle event for the same session does not end it again.
    emit(ctx.eventBus, AgentEventType.AGENT_COMPLETED, ctx.firstSessionId, { success: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ctx.killSession).toHaveBeenCalledTimes(1);
    ctx.orchestrator.stop();
  });

  it("waits for the turn to end before ending a session whose completion was synthesized", async () => {
    const ctx = await setup("kill-synth");
    emit(ctx.eventBus, AgentEventType.AGENT_COMPLETED, ctx.firstSessionId, { success: true, synthesizedBy: "updateTask" });

    await vi.waitFor(() => {
      expect(ctx.orchestrator.getAutomationForCard(ctx.task.id)?.status).toBe("completed");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ctx.killSession).not.toHaveBeenCalled();

    emit(ctx.eventBus, AgentEventType.AGENT_COMPLETED, ctx.firstSessionId, { success: true });
    await vi.waitFor(() => expect(ctx.killSession).toHaveBeenCalledWith(ctx.firstSessionId));
    expect(ctx.killSession).toHaveBeenCalledTimes(1);
    ctx.orchestrator.stop();
  });

  it("does not prompt a failed session it ended, so no agent is re-spawned for it", async () => {
    const ctx = await setup("kill-no-respawn", { maxRecoveryAttempts: 1 });
    const sendPrompt = vi.fn(async () => undefined);
    ctx.orchestrator.setSendKanbanSessionPrompt(sendPrompt);
    emit(ctx.eventBus, AgentEventType.AGENT_FAILED, ctx.firstSessionId, { success: false, error: "boom" });

    await vi.waitFor(() => {
      expect(ctx.orchestrator.getAutomationForCard(ctx.task.id)).toMatchObject({
        sessionId: "kill-no-respawn-session-2",
        status: "running",
      });
    });
    expect(ctx.killSession).toHaveBeenCalledWith(ctx.firstSessionId);
    expect(sendPrompt).not.toHaveBeenCalledWith(expect.objectContaining({ sessionId: ctx.firstSessionId }));
    ctx.orchestrator.stop();
  });

  it("kills only the failed session and still recovers when kill throws", async () => {
    const ctx = await setup("kill-recover", {
      maxRecoveryAttempts: 1,
      killSession: async () => {
        throw new Error("process already gone");
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    emit(ctx.eventBus, AgentEventType.AGENT_FAILED, ctx.firstSessionId, { success: false, error: "boom" });

    await vi.waitFor(() => {
      expect(ctx.orchestrator.getAutomationForCard(ctx.task.id)).toMatchObject({
        sessionId: "kill-recover-session-2",
        status: "running",
        recoveryAttempts: 1,
      });
    });
    expect(ctx.killSession).toHaveBeenCalledTimes(1);
    expect(ctx.killSession).toHaveBeenCalledWith(ctx.firstSessionId);
    expect(ctx.createSession).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    ctx.orchestrator.stop();
  });
});
