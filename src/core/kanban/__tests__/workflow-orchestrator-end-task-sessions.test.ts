// @vitest-environment node
/**
 * endTaskSessions ends each session's process at most once, whatever else
 * ended it before or at the same time, and never touches other sessions
 * (复盘 L145, AC5). forgetCard keeps late events of a deleted card from
 * starting anything (C5 b).
 */
import { describe, expect, it, vi } from "vitest";

import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, type TaskLaneSession } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

function lane(sessionId: string, columnId: string, status: TaskLaneSession["status"]): TaskLaneSession {
  return { sessionId, columnId, stepIndex: 0, status, startedAt: "2026-10-24T00:00:00.000Z" } as TaskLaneSession;
}

async function setup(prefix: string, options?: { devSteps?: number }) {
  const eventBus = new EventBus();
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const createSession = vi.fn().mockImplementation(async (params: { cardId: string }) => {
    const count = createSession.mock.calls.filter(([call]) => call.cardId === params.cardId).length;
    const sessionId = `${prefix}-${params.cardId}-${count}`;
    getHttpSessionStore().upsertSession({
      sessionId,
      workspaceId: "default",
      provider: "codex",
      cwd: "/tmp",
      createdAt: new Date().toISOString(),
    });
    return sessionId;
  });
  const killSession = vi.fn(async (_sessionId: string) => undefined);
  const devSteps = options?.devSteps ?? 1;
  const board = createKanbanBoard({
    id: `${prefix}-board`,
    workspaceId: "default",
    name: "Board",
    isDefault: true,
    columns: [
      { id: "todo", name: "Todo", stage: "todo", position: 0 },
      {
        id: "dev",
        name: "Dev",
        stage: "dev",
        position: 1,
        automation: {
          enabled: true,
          providerId: "codex",
          transitionType: "entry",
          steps: Array.from({ length: devSteps }, (_, index) => ({ id: `dev-${index}`, role: "CRAFTER", providerId: "codex" })),
        },
      },
      { id: "review", name: "Review", stage: "review", position: 2 },
    ],
  });
  await boardStore.save(board);

  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession, killSession);
  orchestrator.setResolveDevSessionSupervision(async () => ({
    mode: "watchdog_retry",
    inactivityTimeoutMinutes: 1,
    maxRecoveryAttempts: 1,
    completionRequirement: "turn_complete",
  }));
  const sendPrompt = vi.fn(async () => undefined);
  orchestrator.setSendKanbanSessionPrompt(sendPrompt);
  orchestrator.start();

  async function startCard(cardId: string) {
    const task = createTask({
      id: cardId,
      title: cardId,
      objective: "end sessions",
      workspaceId: "default",
      boardId: board.id,
      columnId: "dev",
    });
    await taskStore.save(task);
    eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "test",
      workspaceId: "default",
      data: { cardId, cardTitle: cardId, boardId: board.id, workspaceId: "default", fromColumnId: "todo", toColumnId: "dev" },
      timestamp: new Date(),
    });
    const sessionId = `${prefix}-${cardId}-1`;
    await vi.waitFor(() => {
      expect(orchestrator.getAutomationForCard(cardId)).toMatchObject({ sessionId, status: "running" });
    });
    const stored = await taskStore.get(cardId);
    if (stored) {
      stored.triggerSessionId = sessionId;
      stored.laneSessions = [lane(sessionId, "dev", "running")];
      await taskStore.save(stored);
    }
    return sessionId;
  }

  const emit = (type: AgentEventType, sessionId: string, data: Record<string, unknown>) => {
    eventBus.emit({ type, agentId: sessionId, workspaceId: "default", data: { sessionId, ...data }, timestamp: new Date() });
  };
  const killsOf = (sessionId: string) => killSession.mock.calls.filter(([id]) => id === sessionId).length;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  return { eventBus, orchestrator, taskStore, createSession, killSession, sendPrompt, startCard, emit, killsOf, settle };
}

/** Card K's dev session s1, K's review session s2 (record only), card J's session s3. */
async function setupThree(prefix: string) {
  const ctx = await setup(prefix);
  const s1 = await ctx.startCard("K");
  const s3 = await ctx.startCard("J");
  const k = await ctx.taskStore.get("K");
  if (k) {
    k.laneSessions = [...(k.laneSessions ?? []), lane("s2", "review", "running")];
    await ctx.taskStore.save(k);
  }
  return { ...ctx, s1, s2: "s2", s3 };
}

async function failedRecords(ctx: { taskStore: InMemoryTaskStore }) {
  const all = [await ctx.taskStore.get("K"), await ctx.taskStore.get("J")];
  return all.flatMap((task) => (task?.laneSessions ?? []).filter((entry) => entry.status === "failed").map((entry) => entry.sessionId));
}

describe("endTaskSessions lifecycle (C7 / AC5)", () => {
  it("(a) after the step completed normally, ending again kills nothing more", async () => {
    const ctx = await setupThree("end-a");
    ctx.emit(AgentEventType.AGENT_COMPLETED, ctx.s1, { success: true });
    await vi.waitFor(() => expect(ctx.killsOf(ctx.s1)).toBe(1));
    await ctx.orchestrator.endTaskSessions([ctx.s1], "of a deleted card");
    await ctx.settle();
    expect(ctx.killsOf(ctx.s1)).toBe(1);
    expect(ctx.killsOf(ctx.s2) + ctx.killsOf(ctx.s3)).toBe(0);
    expect(ctx.createSession).toHaveBeenCalledTimes(2);
    expect(await failedRecords(ctx)).toEqual([]);
    ctx.orchestrator.stop();
  });

  it("(b) after the process crashed, ending again does not kill twice or throw", async () => {
    const ctx = await setupThree("end-b");
    const createdBefore = ctx.createSession.mock.calls.length;
    ctx.orchestrator.forgetCard("K");
    ctx.emit(AgentEventType.AGENT_FAILED, ctx.s1, { success: false, error: "process exited (code=1)" });
    await ctx.settle();
    await expect(ctx.orchestrator.endTaskSessions([ctx.s1], "of a deleted card")).resolves.toBeUndefined();
    await ctx.settle();
    expect(ctx.killsOf(ctx.s1)).toBeLessThanOrEqual(1);
    expect(ctx.killsOf(ctx.s2) + ctx.killsOf(ctx.s3)).toBe(0);
    expect(ctx.createSession).toHaveBeenCalledTimes(createdBefore);
    expect(await failedRecords(ctx)).toEqual([]);
    ctx.orchestrator.stop();
  });

  it("(b2) a crash handled by the orchestrator, then ending: one kill in total", async () => {
    const ctx = await setupThree("end-b2");
    ctx.emit(AgentEventType.AGENT_FAILED, ctx.s1, { success: false, error: "process exited (code=1)" });
    await vi.waitFor(() => expect(ctx.killsOf(ctx.s1)).toBe(1));
    await ctx.orchestrator.endTaskSessions([ctx.s1], "of a deleted card");
    expect(ctx.killsOf(ctx.s1)).toBe(1);
    expect(ctx.killsOf(ctx.s2) + ctx.killsOf(ctx.s3)).toBe(0);
    ctx.orchestrator.stop();
  });

  it("(c) ending the same session twice kills once", async () => {
    const ctx = await setupThree("end-c");
    await ctx.orchestrator.endTaskSessions([ctx.s1], "of a deleted card");
    await ctx.orchestrator.endTaskSessions([ctx.s1, ctx.s1], "of a deleted card");
    await ctx.settle();
    expect(ctx.killsOf(ctx.s1)).toBe(1);
    expect(ctx.killsOf(ctx.s2) + ctx.killsOf(ctx.s3)).toBe(0);
    expect(ctx.createSession).toHaveBeenCalledTimes(2);
    expect(await failedRecords(ctx)).toEqual([]);
    ctx.orchestrator.stop();
  });

  it("(d) ending concurrently with the normal end kills once", async () => {
    const ctx = await setupThree("end-d");
    await Promise.all([
      ctx.orchestrator.endTaskSessions([ctx.s1], "of a deleted card"),
      (async () => {
        ctx.emit(AgentEventType.AGENT_COMPLETED, ctx.s1, { success: true });
        await ctx.settle();
      })(),
      ctx.orchestrator.endTaskSessions([ctx.s1], "of a card the user moved to another column"),
    ]);
    await ctx.settle();
    expect(ctx.killsOf(ctx.s1)).toBe(1);
    expect(ctx.killsOf(ctx.s2) + ctx.killsOf(ctx.s3)).toBe(0);
    expect(ctx.createSession).toHaveBeenCalledTimes(2);
    expect(await failedRecords(ctx)).toEqual([]);
    ctx.orchestrator.stop();
  });

  it("the failure raised by an ended session is teardown: no failed record, no recovery prompt, no new session", async () => {
    const ctx = await setupThree("end-teardown");
    await ctx.orchestrator.endTaskSessions([ctx.s1], "of a card the user moved to another column");
    ctx.emit(AgentEventType.AGENT_FAILED, ctx.s1, { success: false, error: "dsh process exited (code=0)" });
    await ctx.settle();
    expect(ctx.killsOf(ctx.s1)).toBe(1);
    expect(ctx.createSession).toHaveBeenCalledTimes(2);
    expect(ctx.sendPrompt).not.toHaveBeenCalled();
    expect(await failedRecords(ctx)).toEqual([]);
    ctx.orchestrator.stop();
  });
});

describe("a deleted card's late events start nothing (C5 b)", () => {
  it.each([
    ["AGENT_COMPLETED", AgentEventType.AGENT_COMPLETED, { success: true }],
    ["AGENT_FAILED", AgentEventType.AGENT_FAILED, { success: false, error: "process exited" }],
  ])("late %s after the delete", async (_label, type, data) => {
    const ctx = await setup(`late-${type}`, { devSteps: 2 });
    const s1 = await ctx.startCard("K");
    const k = await ctx.taskStore.get("K");
    ctx.orchestrator.forgetCard("K");
    await ctx.taskStore.delete("K");
    await ctx.orchestrator.endTaskSessions(k ? [s1] : [], "of a deleted card");
    ctx.emit(type, s1, data);
    await ctx.settle();
    expect(ctx.createSession.mock.calls.filter(([call]) => call.cardId === "K")).toHaveLength(1);
    expect(ctx.killsOf(s1)).toBe(1);
    ctx.orchestrator.stop();
  });

  it("forgetCard with a column only drops that column's automation", async () => {
    const ctx = await setup("forget-col");
    await ctx.startCard("K");
    ctx.orchestrator.forgetCard("K", { columnId: "review" });
    expect(ctx.orchestrator.getAutomationForCard("K")).toBeDefined();
    ctx.orchestrator.forgetCard("K", { columnId: "dev" });
    expect(ctx.orchestrator.getAutomationForCard("K")).toBeUndefined();
    ctx.orchestrator.stop();
  });
});

describe("F3-3 random endTaskSessions sequences", () => {
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  it("200 random sequences kill each distinct session exactly once", async () => {
    const SEED = 4512;
    console.info(`[F3-3] seed=${SEED}`);
    const rand = mulberry32(SEED);
    let mismatches = 0;
    for (let round = 0; round < 200; round += 1) {
      const killSession = vi.fn(async (_id: string) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const orchestrator = new KanbanWorkflowOrchestrator(
        new EventBus(),
        new InMemoryKanbanBoardStore(),
        new InMemoryTaskStore(),
        undefined,
        killSession,
      );
      const ids = Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, i) => `r${round}-s${i}`);
      const normalEnd = (orchestrator as unknown as {
        endFinishedStepSession: (id: string, event: { type: AgentEventType; data: Record<string, unknown> }) => Promise<void>;
      }).endFinishedStepSession.bind(orchestrator);
      const requested = new Set<string>();
      const calls: Array<Promise<void>> = [];
      const steps = 2 + Math.floor(rand() * 8);
      for (let index = 0; index < steps; index += 1) {
        const batch = ids.filter(() => rand() < 0.5);
        if (rand() < 0.3) batch.push(...batch);
        const useNormalEnd = rand() < 0.2 && batch.length > 0;
        (useNormalEnd ? batch.slice(0, 1) : batch).forEach((id) => requested.add(id));
        const call = useNormalEnd
          ? normalEnd(batch[0], { type: AgentEventType.AGENT_COMPLETED, data: { sessionId: batch[0] } })
          : orchestrator.endTaskSessions(batch, "random");
        if (rand() < 0.5) calls.push(call);
        else await call;
      }
      await Promise.all(calls);
      if (killSession.mock.calls.length !== requested.size) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });
});
