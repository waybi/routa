// @vitest-environment node
/**
 * Card 14de4800: a lane step whose turn is cancelled while Routa keeps
 * running is re-run at the same step after a short backoff (retryAfterAt,
 * the rate-limit scheduler), unless the user cancelled it through
 * session/cancel (user_cancelled: never re-run, no budget used). The fuse,
 * the lane watchdog, environment and agent failures stop the rerun.
 * Real orchestrator, in-memory stores, fake timers; only session creation is mocked.
 * Contract items: C2①, C3, C4 (backoff path), F4.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard, type KanbanColumn } from "../../models/kanban";
import { createTask, type Task, type TaskLaneSession } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { decideInterruptedLaneResume } from "../interrupted-lane-resume";
import { clearUserCancelMarks, markUserCancelledSession } from "../lane-cancel-origin";
import { upsertTaskLaneSession } from "../task-lane-history";
import { getNonDevAutomationRunCount, KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

const NOW = new Date("2026-10-26T18:00:00.000Z");

type Lane = "dev" | "review" | "done";
const STEPS: Record<Lane, string[]> = {
  dev: ["kanban-dev-crafter"],
  review: ["kanban-qa-frontend", "kanban-review-guard"],
  done: ["kanban-main-pusher", "kanban-done-reporter"],
};

let counter = 0;

async function createHarness(lane: Lane, laneSessions: TaskLaneSession[] = []) {
  counter += 1;
  const eventBus = new EventBus();
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const cardId = `cancel-${lane}-${counter}`;
  const started: Array<{ sessionId: string; stepIndex: number }> = [];
  const createSession = vi.fn(async (params: { cardId: string; columnId: string; stepIndex: number; step: { specialistId?: string } }) => {
    counter += 1;
    const sessionId = `${params.cardId}:s${params.stepIndex}:${counter}`;
    const task = await taskStore.get(params.cardId);
    if (task) {
      upsertTaskLaneSession(task, { sessionId, columnId: params.columnId, stepIndex: params.stepIndex, specialistId: params.step.specialistId, status: "running" });
      task.triggerSessionId = sessionId;
      await taskStore.save(task);
    }
    getHttpSessionStore().upsertSession({ sessionId, workspaceId: "default", provider: "dsh", cwd: "/tmp", createdAt: new Date().toISOString() });
    started.push({ sessionId, stepIndex: params.stepIndex });
    return sessionId;
  });
  const column: KanbanColumn = {
    id: lane,
    name: lane,
    position: 1,
    stage: lane,
    automation: {
      enabled: true,
      transitionType: "entry",
      autoAdvanceOnSuccess: false,
      steps: STEPS[lane].map((specialistId) => ({ id: specialistId, providerId: "dsh", role: "CRAFTER", specialistId, specialistName: specialistId })),
    },
  };
  const columns: KanbanColumn[] = [{ id: "start", name: "start", position: 0, stage: "backlog" }, column];
  await boardStore.save(createKanbanBoard({ id: `board-${cardId}`, workspaceId: "default", name: "Board", isDefault: true, columns }));
  const task = createTask({ id: cardId, title: cardId, objective: "cancel", workspaceId: "default", boardId: `board-${cardId}`, columnId: lane });
  task.laneSessions = laneSessions;
  await taskStore.save(task);

  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession as never, async () => {});
  orchestrator.setResolveDevSessionSupervision(async () => ({
    mode: "watchdog_retry",
    inactivityTimeoutMinutes: 600,
    maxRecoveryAttempts: 2,
    completionRequirement: "turn_complete",
  }));
  orchestrator.setResolveLaneSessionWatchdog(async () => ({ enabled: true, inactivityTimeoutMinutes: 600 }));
  orchestrator.start();

  const emit = (type: AgentEventType, sessionId: string, data: Record<string, unknown> = {}) => eventBus.emit({
    type, agentId: sessionId, workspaceId: "default", data: { sessionId, ...data }, timestamp: new Date(),
  });
  const sessions = (stepIndex?: number) => started.filter((entry) => stepIndex === undefined || entry.stepIndex === stepIndex).map((entry) => entry.sessionId);
  const card = async () => (await taskStore.get(cardId))!;
  const record = async (sessionId: string) => (await card()).laneSessions?.find((entry) => entry.sessionId === sessionId);

  async function enterLane(): Promise<string> {
    eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "test",
      workspaceId: "default",
      data: { cardId, cardTitle: cardId, boardId: `board-${cardId}`, workspaceId: "default", fromColumnId: "start", toColumnId: lane },
      timestamp: new Date(),
    });
    await flush();
    expect(createSession).toHaveBeenCalledTimes(1);
    return sessions().at(-1)!;
  }

  async function runToStep(stepIndex: number): Promise<string> {
    let sessionId = await enterLane();
    for (let step = 1; step <= stepIndex; step += 1) {
      emit(AgentEventType.AGENT_COMPLETED, sessionId, { success: true, stopReason: "end_turn" });
      await flush();
      sessionId = sessions(step).at(-1)!;
    }
    return sessionId;
  }

  async function end(sessionId: string, type: AgentEventType, data: Record<string, unknown>): Promise<TaskLaneSession> {
    emit(type, sessionId, data);
    await flush();
    const ended = (await record(sessionId))!;
    expect(ended.status).not.toBe("running");
    return ended;
  }

  return { orchestrator, createSession, cardId, columns, card, record, sessions, runToStep, end };
}

const cancel = { success: false, stopReason: "cancelled" };

async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await vi.advanceTimersByTimeAsync(0);
}

function prior(lane: Lane, stepIndex: number, n: number): TaskLaneSession[] {
  return Array.from({ length: n }, (_, index) => ({
    sessionId: `prior-${index}`,
    columnId: lane,
    stepIndex,
    status: "failed" as const,
    recoveryReason: index % 2 ? "rate_limited" as const : "turn_cancelled" as const,
    startedAt: NOW.toISOString(),
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  clearUserCancelMarks();
});

afterEach(() => {
  clearUserCancelMarks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("C2①/AC3: a cancelled turn (not by the user) is re-run after a backoff", () => {
  it.each([
    { lane: "dev" as const, stepIndex: 0 },
    { lane: "review" as const, stepIndex: 1 },
    { lane: "done" as const, stepIndex: 0 },
  ])("$lane step $stepIndex: 0 sessions before retryAfterAt, 1 after, same step", async ({ lane, stepIndex }) => {
    const h = await createHarness(lane);
    const sessionId = await h.runToStep(stepIndex);
    const before = h.createSession.mock.calls.length;
    const ended = await h.end(sessionId, AgentEventType.AGENT_COMPLETED, cancel);
    expect(ended).toMatchObject({ status: "failed", recoveryReason: "turn_cancelled", stepIndex });
    // First cancel in a row: 1 minute (random 0.5 → no jitter).
    expect(ended.retryAfterAt).toBe(new Date(NOW.getTime() + 60_000).toISOString());
    expect((await h.card()).lastSyncError).toContain("turn_cancelled");

    await vi.advanceTimersByTimeAsync(59_000);
    await flush();
    expect(h.createSession.mock.calls.length).toBe(before);
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();
    expect(h.createSession.mock.calls.length).toBe(before + 1);
    expect(h.createSession.mock.calls.at(-1)?.[0]).toMatchObject({ stepIndex, step: expect.objectContaining({ specialistId: STEPS[lane][stepIndex] }) });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    await flush();
    expect(h.createSession.mock.calls.length).toBe(before + 1);

    // The rerun is adopted: when it completes, the lane goes on.
    const rerun = h.sessions(stepIndex).at(-1)!;
    expect((await h.record(rerun))?.status).toBe("running");
    h.orchestrator.stop();
  });

  it("the second cancel in a row waits 2 minutes", async () => {
    const h = await createHarness("dev");
    const first = await h.runToStep(0);
    await h.end(first, AgentEventType.AGENT_COMPLETED, cancel);
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();
    const second = h.sessions(0).at(-1)!;
    expect(second).not.toBe(first);
    const ended = await h.end(second, AgentEventType.AGENT_COMPLETED, cancel);
    expect(Date.parse(ended.retryAfterAt!) - Date.now()).toBe(2 * 60_000);
    h.orchestrator.stop();
  });
});

describe("C3/AC4: a user's own cancel is user_cancelled and never re-run", () => {
  it.each([
    { lane: "dev" as const, stepIndex: 0 },
    { lane: "review" as const, stepIndex: 1 },
  ])("$lane: 0 sessions on the backoff path and the startup path, no budget used", async ({ lane, stepIndex }) => {
    const h = await createHarness(lane);
    const sessionId = await h.runToStep(stepIndex);
    const runsBefore = getNonDevAutomationRunCount(await h.card(), lane, lane);
    const before = h.createSession.mock.calls.length;
    markUserCancelledSession(sessionId); // what POST /api/acp session/cancel does
    const ended = await h.end(sessionId, AgentEventType.AGENT_COMPLETED, cancel);
    expect(ended).toMatchObject({ status: "failed", recoveryReason: "user_cancelled" });
    expect(ended.retryAfterAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    await flush();
    expect(h.createSession.mock.calls.length).toBe(before);
    // Startup path decides the same way.
    expect(decideInterruptedLaneResume(await h.card(), h.columns, new Date())).toMatchObject({ kind: "skip" });
    // Budget: the user's cancel is not a run of the non-Dev repeat budget, nor a Dev recovery.
    expect(getNonDevAutomationRunCount(await h.card(), lane, lane)).toBe(lane === "dev" ? 0 : runsBefore - 1);
    expect((await h.card()).laneSessions?.filter((entry) => entry.recoveryReason === "user_cancelled")).toHaveLength(1);
    h.orchestrator.stop();
  });

  it("control: the same cancel without the user mark is turn_cancelled and re-run once", async () => {
    const h = await createHarness("review");
    const sessionId = await h.runToStep(1);
    const before = h.createSession.mock.calls.length;
    markUserCancelledSession("some-other-session");
    const ended = await h.end(sessionId, AgentEventType.AGENT_COMPLETED, cancel);
    expect(ended.recoveryReason).toBe("turn_cancelled");
    expect(decideInterruptedLaneResume(await h.card(), h.columns, new Date(Date.parse(ended.retryAfterAt!) + 1))).toMatchObject({ kind: "resume", stepIndex: 1 });
    await vi.advanceTimersByTimeAsync(61_000);
    await flush();
    expect(h.createSession.mock.calls.length).toBe(before + 1);
    h.orchestrator.stop();
  });
});

describe("C4/AC5/AC6: the backoff path stops at the fuse and leaves other failures alone", () => {
  it.each([
    { label: "4 earlier retryable failures + this cancel = 5 (fuse)", priorCount: 4, reruns: 0 },
    { label: "3 earlier retryable failures + this cancel = 4", priorCount: 3, reruns: 1 },
  ])("$label → $reruns rerun(s)", async ({ priorCount, reruns }) => {
    const h = await createHarness("done", prior("done", 0, priorCount));
    const sessionId = await h.runToStep(0);
    const before = h.createSession.mock.calls.length;
    const ended = await h.end(sessionId, AgentEventType.AGENT_COMPLETED, cancel);
    expect(ended.recoveryReason).toBe("turn_cancelled");
    if (reruns === 0) {
      expect(ended.retryAfterAt).toBeUndefined();
      expect((await h.card()).lastSyncError).toContain("熔断");
    }
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    await flush();
    expect(h.createSession.mock.calls.length - before).toBe(reruns);
    h.orchestrator.stop();
  });

  it.each([
    { label: "watchdog_inactivity (review lane watchdog)", type: AgentEventType.AGENT_TIMEOUT, data: {}, reason: "watchdog_inactivity" },
    { label: "environment_failure", type: AgentEventType.AGENT_FAILED, data: { success: false, error: 'Unknown provider: "x". Not registered in ProviderRegistry.' }, reason: "environment_failure" },
    { label: "agent_failed", type: AgentEventType.AGENT_FAILED, data: { success: false, error: "boom" }, reason: "agent_failed" },
  ])("$label → 0 reruns", async ({ type, data, reason }) => {
    const h = await createHarness("review");
    const sessionId = await h.runToStep(1);
    const before = h.createSession.mock.calls.length;
    const ended = await h.end(sessionId, type, data);
    expect(ended.recoveryReason).toBe(reason);
    expect(ended.retryAfterAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    await flush();
    expect(h.createSession.mock.calls.length).toBe(before);
    expect(decideInterruptedLaneResume(await h.card(), h.columns, new Date())).toMatchObject({ kind: "skip" });
    h.orchestrator.stop();
  });
});

describe("C3: Task model", () => {
  it("user_cancelled is a recovery reason the store keeps", async () => {
    const store = new InMemoryTaskStore();
    const task: Task = { ...createTask({ id: "m", title: "m", objective: "m", workspaceId: "default" }), laneSessions: [] };
    upsertTaskLaneSession(task, { sessionId: "u", columnId: "dev", status: "failed", recoveryReason: "user_cancelled" });
    await store.save(task);
    expect((await store.get("m"))?.laneSessions?.[0]?.recoveryReason).toBe("user_cancelled");
  });
});
