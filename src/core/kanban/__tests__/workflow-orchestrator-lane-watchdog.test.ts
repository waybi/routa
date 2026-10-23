// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType, EventBus, type AgentEvent } from "../../events/event-bus";
import { createKanbanBoard, type KanbanColumnStage, type KanbanLaneSessionWatchdog } from "../../models/kanban";
import { createTask, TaskStatus } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { getTaskLaneSession, upsertTaskLaneSession } from "../task-lane-history";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

const MINUTE_MS = 60_000;

/**
 * A step outside the Dev lane whose agent never answers again (hung process,
 * lost reply, process gone without an exit event) used to stay `running`
 * forever: it held a board slot and its process was never ended
 * (2026-10-23, three Done-lane Main Pushers held 3 of 5 slots for 2+ hours).
 */
async function setup(prefix: string, options: {
  stage: KanbanColumnStage;
  idleMinutes: number;
  laneWatchdog?: KanbanLaneSessionWatchdog;
  queueFirstStart?: boolean;
  fallbackAgent?: boolean;
}) {
  const eventBus = new EventBus();
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const columnId = `${options.stage}-col`;
  const taskId = `${prefix}-task`;
  let started = 0;

  const startSession = async (stepIndex: number) => {
    started += 1;
    const sessionId = `${prefix}-session-${started}`;
    getHttpSessionStore().upsertSession({
      sessionId,
      workspaceId: "default",
      provider: "dsh",
      cwd: "/tmp",
      createdAt: new Date(Date.now() - options.idleMinutes * MINUTE_MS).toISOString(),
    });
    const task = await taskStore.get(taskId);
    if (task) {
      task.triggerSessionId = sessionId;
      upsertTaskLaneSession(task, { sessionId, columnId, stepIndex, status: "running" });
      await taskStore.save(task);
    }
    return sessionId;
  };

  const createSession = vi.fn().mockImplementation(async ({ stepIndex }: { stepIndex: number }) => {
    if (options.queueFirstStart && started === 0) {
      return { queued: true };
    }
    return startSession(stepIndex);
  });
  const killSession = vi.fn(async () => undefined);
  const sendKanbanSessionPrompt = vi.fn(async () => undefined);
  const timeouts: AgentEvent[] = [];
  eventBus.on(`${prefix}-observer`, (event) => {
    if (event.type === AgentEventType.AGENT_TIMEOUT) timeouts.push(event);
  });

  const board = createKanbanBoard({
    id: `${prefix}-board`,
    workspaceId: "default",
    name: "Main Board",
    isDefault: true,
    columns: [
      { id: "entry", name: "Entry", stage: "backlog", position: 0 },
      {
        id: columnId,
        name: options.stage,
        stage: options.stage,
        position: 1,
        automation: { enabled: true, providerId: "dsh", role: "CRAFTER", transitionType: "entry" },
      },
    ],
  });
  await boardStore.save(board);
  await taskStore.save(createTask({
    id: taskId,
    title: "Lane watchdog",
    objective: "A silent step outside Dev must end",
    workspaceId: "default",
    boardId: board.id,
    columnId,
    // A card in Done is COMPLETED while its Done lane still runs.
    status: options.stage === "done" ? TaskStatus.COMPLETED : TaskStatus.PENDING,
    ...(options.fallbackAgent
      ? { enableAutomaticFallback: true, fallbackAgentChain: [{ providerId: "codex", role: "CRAFTER" }] }
      : {}),
  }));

  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession, killSession);
  orchestrator.setSendKanbanSessionPrompt(sendKanbanSessionPrompt);
  // The Dev lane's own policy (short timeout, one retry) must not leak into other lanes.
  orchestrator.setResolveDevSessionSupervision(async () => ({
    mode: "watchdog_retry",
    inactivityTimeoutMinutes: 1,
    maxRecoveryAttempts: 1,
    completionRequirement: "turn_complete",
  }));
  if (options.laneWatchdog) {
    const laneWatchdog = options.laneWatchdog;
    orchestrator.setResolveLaneSessionWatchdog(async () => laneWatchdog);
  }
  orchestrator.start();

  eventBus.emit({
    type: AgentEventType.COLUMN_TRANSITION,
    agentId: "test",
    workspaceId: "default",
    data: {
      cardId: taskId,
      cardTitle: "Lane watchdog",
      boardId: board.id,
      workspaceId: "default",
      fromColumnId: "entry",
      toColumnId: columnId,
    },
    timestamp: new Date(),
  });
  await vi.waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));

  const scan = () => (orchestrator as unknown as { scanForInactiveSessions: () => Promise<void> })
    .scanForInactiveSessions();

  return {
    orchestrator,
    taskStore,
    taskId,
    createSession,
    killSession,
    sendKanbanSessionPrompt,
    timeouts,
    scan,
    startSession,
    firstSessionId: `${prefix}-session-1`,
  };
}

describe("inactivity watchdog outside the Dev lane", () => {
  it.each(["backlog", "todo", "review", "done"] as const)(
    "ends a %s step after 20 silent minutes as timed_out, without a retry",
    async (stage) => {
      const ctx = await setup(`lane-wd-${stage}`, { stage, idleMinutes: 21 });
      await vi.waitFor(() => {
        expect(ctx.orchestrator.getAutomationForCard(ctx.taskId)).toMatchObject({
          sessionId: ctx.firstSessionId,
          status: "running",
        });
      });

      await ctx.scan();

      await vi.waitFor(async () => {
        expect(ctx.orchestrator.getAutomationForCard(ctx.taskId)?.status).toBe("failed");
      });
      const task = await ctx.taskStore.get(ctx.taskId);
      expect(getTaskLaneSession(task!, ctx.firstSessionId)).toMatchObject({
        status: "timed_out",
        recoveryReason: "watchdog_inactivity",
      });
      expect(task?.lastSyncError).toContain("20 minutes without activity");
      // The board queue frees the slot on AGENT_TIMEOUT.
      expect(ctx.timeouts.map((event) => event.data?.sessionId)).toEqual([ctx.firstSessionId]);
      expect(ctx.killSession).toHaveBeenCalledWith(ctx.firstSessionId);
      expect(ctx.createSession).toHaveBeenCalledTimes(1);
      expect(ctx.sendKanbanSessionPrompt).not.toHaveBeenCalled();

      // A later scan does not fire again for the same step.
      await ctx.scan();
      expect(ctx.timeouts).toHaveLength(1);
      ctx.orchestrator.stop();
    },
  );

  it("keeps a Done step running through a quiet 19-minute stretch (long test run)", async () => {
    const ctx = await setup("lane-wd-quiet", { stage: "done", idleMinutes: 19 });
    await ctx.scan();

    expect(ctx.orchestrator.getAutomationForCard(ctx.taskId)).toMatchObject({
      sessionId: ctx.firstSessionId,
      status: "running",
    });
    expect(ctx.timeouts).toHaveLength(0);
    expect(ctx.killSession).not.toHaveBeenCalled();
    ctx.orchestrator.stop();
  });

  it("uses the board's own timeout when one is configured", async () => {
    const ctx = await setup("lane-wd-board", {
      stage: "review",
      idleMinutes: 6,
      laneWatchdog: { enabled: true, inactivityTimeoutMinutes: 5 },
    });
    await ctx.scan();

    await vi.waitFor(async () => {
      const task = await ctx.taskStore.get(ctx.taskId);
      expect(getTaskLaneSession(task!, ctx.firstSessionId)?.status).toBe("timed_out");
      expect(task?.lastSyncError).toContain("5 minutes without activity");
    });
    ctx.orchestrator.stop();
  });

  it("leaves the step alone when the board turned the watchdog off", async () => {
    const ctx = await setup("lane-wd-off", {
      stage: "done",
      idleMinutes: 300,
      laneWatchdog: { enabled: false, inactivityTimeoutMinutes: 20 },
    });
    await ctx.scan();

    expect(ctx.orchestrator.getAutomationForCard(ctx.taskId)?.status).toBe("running");
    expect(ctx.timeouts).toHaveLength(0);
    ctx.orchestrator.stop();
  });

  it("watches a step that waited in the board queue once the queue starts it", async () => {
    const ctx = await setup("lane-wd-queued", { stage: "done", idleMinutes: 25, queueFirstStart: true });
    expect(ctx.orchestrator.getAutomationForCard(ctx.taskId)).toMatchObject({ status: "queued" });

    // The board queue starts the step later and records it as the card's trigger session.
    const sessionId = await ctx.startSession(0);
    await ctx.scan();

    await vi.waitFor(async () => {
      const task = await ctx.taskStore.get(ctx.taskId);
      expect(getTaskLaneSession(task!, sessionId)?.status).toBe("timed_out");
    });
    expect(ctx.killSession).toHaveBeenCalledWith(sessionId);
    expect(ctx.timeouts.map((event) => event.data?.sessionId)).toEqual([sessionId]);
    ctx.orchestrator.stop();
  });

  it("does not hand a timed-out Done step to the card's fallback agent", async () => {
    const ctx = await setup("lane-wd-fallback", { stage: "done", idleMinutes: 21, fallbackAgent: true });
    await ctx.scan();

    await vi.waitFor(() => {
      expect(ctx.orchestrator.getAutomationForCard(ctx.taskId)?.status).toBe("failed");
    });
    expect(ctx.createSession).toHaveBeenCalledTimes(1);
    expect(ctx.killSession).toHaveBeenCalledWith(ctx.firstSessionId);
    ctx.orchestrator.stop();
  });
});
