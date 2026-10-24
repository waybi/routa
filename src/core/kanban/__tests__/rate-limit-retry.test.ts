// @vitest-environment node
/**
 * Card 79804de2: rate limits (HTTP 429) and restart interruptions are
 * retryable environment failures. They do not consume the non-Dev repeat
 * budget or the Dev recovery budget; a rate-limited step is re-run at its
 * planned time at the same step index; consecutive retryable failures in one
 * lane trip a fuse. Driven through the real orchestrator with in-memory
 * stores and fake timers; only session creation is mocked.
 * Contract items: C3, C4, C5, C6, F2④, F4 paths ①②③⑥.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard, type KanbanColumn, type KanbanDevSessionSupervision } from "../../models/kanban";
import { createTask, type Task, type TaskLaneSession, type TaskLaneSessionRecoveryReason } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanTools } from "../../tools/kanban-tools";
import { getConsecutiveRetryableEnvironmentFailureCount } from "../environment-failure";
import type { RateLimitRetryEntry, RateLimitRetryScheduler } from "../rate-limit-retry";
import { upsertTaskLaneSession } from "../task-lane-history";
import {
  getNonDevAutomationRunCount,
  hasExceededNonDevAutomationRepeatLimit,
  KanbanWorkflowOrchestrator,
} from "../workflow-orchestrator";

const NOW = new Date("2026-10-23T09:50:00.000Z");
const SERVER_RESET = "2026-10-23T09:56:07.846Z";
const RUNAI_429 = `{"type":"error","error":{"type":"rate_limit_error","message":"RunAI account rate limited (HTTP 429, rate_limit_error; upstream trial_rate_limited) resets_at=${SERVER_RESET}"}}`;
const USAGE_LIMIT = String.raw`Internal error: turn failed: {\"type\":\"error\",\"error\":{\"type\":\"usage_limit_reached\",\"message\":\"{\\\"code\\\":\\\"trial_rate_limited\\\"}\"}}`;

type Lane = "backlog" | "todo" | "dev" | "review" | "done" | "done-no-pusher";

const STEPS: Record<Lane, string[]> = {
  backlog: ["backlog-refiner"],
  todo: ["todo-orchestrator", "contract-setter"],
  dev: ["kanban-dev-crafter"],
  review: ["kanban-qa-frontend", "kanban-review-guard"],
  done: ["kanban-main-pusher", "kanban-done-reporter"],
  "done-no-pusher": ["kanban-done-reporter"],
};

const STAGE: Record<Lane, KanbanColumn["stage"]> = {
  backlog: "backlog",
  todo: "todo",
  dev: "dev",
  review: "review",
  done: "done",
  "done-no-pusher": "done",
};

function columnFor(lane: Lane): KanbanColumn {
  return {
    id: lane,
    name: lane,
    position: 1,
    stage: STAGE[lane],
    automation: {
      enabled: true,
      transitionType: "entry",
      autoAdvanceOnSuccess: false,
      steps: STEPS[lane].map((specialistId) => ({
        id: specialistId,
        providerId: "dsh",
        role: "CRAFTER",
        specialistId,
        specialistName: specialistId,
      })),
    },
  };
}

let counter = 0;

interface Harness {
  orchestrator: KanbanWorkflowOrchestrator;
  eventBus: EventBus;
  taskStore: InMemoryTaskStore;
  boardStore: InMemoryKanbanBoardStore;
  createSession: ReturnType<typeof vi.fn>;
  cardId: string;
  lane: Lane;
  card(): Promise<Task>;
  record(sessionId: string): Promise<TaskLaneSession | undefined>;
  scheduler(): RateLimitRetryScheduler;
  sessions(stepIndex?: number): string[];
}

async function createHarness(
  lane: Lane,
  options: { laneSessions?: TaskLaneSession[]; supervision?: Partial<KanbanDevSessionSupervision>; extraColumns?: Lane[] } = {},
): Promise<Harness> {
  counter += 1;
  const eventBus = new EventBus();
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const cardId = `card-${lane}-${counter}`;
  const store = getHttpSessionStore();
  const startedSessions: Array<{ sessionId: string; stepIndex: number }> = [];
  const createSession = vi.fn(async (params: {
    cardId: string;
    columnId: string;
    stepIndex: number;
    step: { specialistId?: string };
    supervision?: { attempt?: number; recoveryReason?: TaskLaneSessionRecoveryReason; recoveredFromSessionId?: string };
  }) => {
    counter += 1;
    const sessionId = `${params.cardId}:${params.columnId}:s${params.stepIndex}:${counter}`;
    const task = await taskStore.get(params.cardId);
    if (task) {
      upsertTaskLaneSession(task, {
        sessionId,
        columnId: params.columnId,
        stepIndex: params.stepIndex,
        specialistId: params.step.specialistId,
        attempt: params.supervision?.attempt,
        recoveredFromSessionId: params.supervision?.recoveredFromSessionId,
        recoveryReason: params.supervision?.recoveryReason,
        status: "running",
      });
      task.triggerSessionId = sessionId;
      await taskStore.save(task);
    }
    store.upsertSession({ sessionId, workspaceId: "default", provider: "dsh", cwd: "/tmp", createdAt: new Date().toISOString() });
    startedSessions.push({ sessionId, stepIndex: params.stepIndex });
    return sessionId;
  });

  const columns: KanbanColumn[] = [
    { id: "start", name: "start", position: 0, stage: "backlog" },
    columnFor(lane),
    ...(options.extraColumns ?? []).map((extra, index) => ({ ...columnFor(extra), position: 2 + index })),
    { id: "blocked", name: "blocked", position: 9, stage: "blocked" },
  ];
  await boardStore.save(createKanbanBoard({ id: `board-${cardId}`, workspaceId: "default", name: "Board", isDefault: true, columns }));
  const task = createTask({ id: cardId, title: `Card ${lane}`, objective: "rate limit", workspaceId: "default", boardId: `board-${cardId}`, columnId: lane });
  task.laneSessions = options.laneSessions ?? [];
  await taskStore.save(task);

  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession as never, async () => {});
  orchestrator.setResolveDevSessionSupervision(async () => ({
    mode: "watchdog_retry",
    inactivityTimeoutMinutes: 600,
    maxRecoveryAttempts: 2,
    completionRequirement: "turn_complete",
    ...options.supervision,
  }));
  orchestrator.setResolveLaneSessionWatchdog(async () => ({ enabled: true, inactivityTimeoutMinutes: 600 }));
  orchestrator.start();

  return {
    orchestrator,
    eventBus,
    taskStore,
    boardStore,
    createSession,
    cardId,
    lane,
    card: async () => (await taskStore.get(cardId))!,
    record: async (sessionId) => (await taskStore.get(cardId))?.laneSessions?.find((entry) => entry.sessionId === sessionId),
    scheduler: () => (orchestrator as unknown as { rateLimitRetries: RateLimitRetryScheduler }).rateLimitRetries,
    sessions: (stepIndex) => startedSessions.filter((entry) => stepIndex === undefined || entry.stepIndex === stepIndex).map((entry) => entry.sessionId),
  };
}

function emit(h: Harness, type: AgentEventType, sessionId: string, data: Record<string, unknown> = {}): void {
  h.eventBus.emit({ type, agentId: sessionId, workspaceId: "default", data: { sessionId, ...data }, timestamp: new Date() });
}

async function enterLane(h: Harness, toColumnId: string = h.lane): Promise<string> {
  const before = h.createSession.mock.calls.length;
  h.eventBus.emit({
    type: AgentEventType.COLUMN_TRANSITION,
    agentId: "test",
    workspaceId: "default",
    data: { cardId: h.cardId, cardTitle: "Card", boardId: `board-${h.cardId}`, workspaceId: "default", fromColumnId: "start", toColumnId },
    timestamp: new Date(),
  });
  await vi.waitFor(() => expect(h.createSession.mock.calls.length).toBe(before + 1));
  return h.sessions().at(-1)!;
}

/** Run the lane to `stepIndex` (earlier steps complete) and return that step's session. */
async function runToStep(h: Harness, stepIndex: number): Promise<string> {
  let sessionId = await enterLane(h);
  for (let step = 1; step <= stepIndex; step += 1) {
    emit(h, AgentEventType.AGENT_COMPLETED, sessionId, { success: true, stopReason: "end_turn" });
    await vi.waitFor(() => expect(h.sessions(step).length).toBeGreaterThan(0));
    sessionId = h.sessions(step).at(-1)!;
  }
  return sessionId;
}

async function waitEnded(h: Harness, sessionId: string): Promise<TaskLaneSession> {
  await vi.waitFor(async () => {
    const record = await h.record(sessionId);
    if (!record || record.status === "running") throw new Error(`${sessionId} still running`);
  });
  await flush();
  return (await h.record(sessionId))!;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
}

async function fail429(h: Harness, sessionId: string, error = RUNAI_429): Promise<TaskLaneSession> {
  emit(h, AgentEventType.AGENT_FAILED, sessionId, { success: false, error });
  return waitEnded(h, sessionId);
}

/** Advance to `ms` before (negative) or after (positive) the record's retryAfterAt. */
async function advanceToRetry(record: TaskLaneSession, offsetMs: number): Promise<void> {
  const target = Date.parse(record.retryAfterAt!) + offsetMs;
  await vi.advanceTimersByTimeAsync(Math.max(0, target - Date.now()));
  await flush();
}

const randomSpy = () => vi.spyOn(Math, "random").mockReturnValue(0.5);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  randomSpy();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("C3: rate limits and restart interruptions consume no budget", () => {
  it.each([
    { lane: "dev" as const, stepIndex: 0 },
    { lane: "done" as const, stepIndex: 0 },
  ])("$lane lane: three 429 failures in a row, then restart_interrupted and turn_cancelled", async ({ lane, stepIndex }) => {
    const h = await createHarness(lane);
    const countBefore = getNonDevAutomationRunCount(await h.card(), lane, STAGE[lane]);
    let sessionId = await runToStep(h, stepIndex);
    const failed: string[] = [];
    for (let round = 1; round <= 3; round += 1) {
      const record = await fail429(h, sessionId);
      failed.push(sessionId);
      expect(record).toMatchObject({ status: "failed", recoveryReason: "rate_limited", stepIndex });
      expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 0, attempt: 1 });
      if (round < 3) {
        await advanceToRetry(record, 1_000);
        sessionId = h.sessions(stepIndex).at(-1)!;
      }
    }
    const card = await h.card();
    card.laneSessions!.push(
      { sessionId: `${h.cardId}-restart`, columnId: lane, stepIndex, status: "timed_out", recoveryReason: "restart_interrupted", startedAt: NOW.toISOString() },
      { sessionId: `${h.cardId}-cancel`, columnId: lane, stepIndex, status: "failed", recoveryReason: "turn_cancelled", startedAt: NOW.toISOString() },
    );
    await h.taskStore.save(card);
    failed.push(`${h.cardId}-restart`, `${h.cardId}-cancel`);

    const after = await h.card();
    expect(getNonDevAutomationRunCount(after, lane, STAGE[lane])).toBe(countBefore);
    expect(hasExceededNonDevAutomationRepeatLimit(after, lane, STAGE[lane])).toBe(false);
    expect(after.laneSessions!.filter((entry) => failed.includes(entry.sessionId)).map((entry) => entry.recoveryReason))
      .toEqual(["rate_limited", "rate_limited", "rate_limited", "restart_interrupted", "turn_cancelled"]);
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 0, attempt: 1 });
    h.orchestrator.stop();
  });

  it("F4⑥: a cancelled turn (real path) keeps the Dev recovery counters", async () => {
    const h = await createHarness("dev");
    const sessionId = await enterLane(h);
    emit(h, AgentEventType.AGENT_COMPLETED, sessionId, { stopReason: "cancelled" });
    expect(await waitEnded(h, sessionId)).toMatchObject({ status: "failed", recoveryReason: "turn_cancelled" });
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 0, attempt: 1 });
    expect(h.createSession).toHaveBeenCalledTimes(1);
    h.orchestrator.stop();
  });
});

describe("F2④/AC4: ordinary failures keep consuming the budget", () => {
  it("Dev agent_failed: recoveryAttempts +1 each time, stops after maxRecoveryAttempts", async () => {
    const h = await createHarness("dev");
    let sessionId = await enterLane(h);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      emit(h, AgentEventType.AGENT_FAILED, sessionId, { success: false, error: "boom" });
      await vi.waitFor(() => expect(h.createSession).toHaveBeenCalledTimes(attempt + 1));
      expect(await h.record(sessionId)).toMatchObject({ status: "failed", recoveryReason: "agent_failed" });
      expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: attempt, attempt: attempt + 1 });
      sessionId = h.sessions().at(-1)!;
    }
    emit(h, AgentEventType.AGENT_FAILED, sessionId, { success: false, error: "boom" });
    await waitEnded(h, sessionId);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(h.createSession).toHaveBeenCalledTimes(3);
    expect(h.scheduler()?.size ?? 0).toBe(0);
    h.orchestrator.stop();
  });

  it("Dev ralph_loop completion_criteria_not_met: recoveryAttempts +1", async () => {
    const h = await createHarness("dev", { supervision: { mode: "ralph_loop", completionRequirement: "completion_summary" } });
    const sessionId = await enterLane(h);
    emit(h, AgentEventType.AGENT_COMPLETED, sessionId, { success: true, stopReason: "end_turn" });
    await vi.waitFor(() => expect(h.createSession).toHaveBeenCalledTimes(2));
    expect(await h.record(sessionId)).toMatchObject({ recoveryReason: "completion_criteria_not_met" });
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 1, attempt: 2 });
    h.orchestrator.stop();
  });

  it("C5(b): AGENT_TIMEOUT whose last message has no 429 stays watchdog_inactivity and is recovered", async () => {
    const h = await createHarness("dev");
    const sessionId = await enterLane(h);
    getHttpSessionStore().pushNotificationToHistory(sessionId, { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "processed 429 rows" } } } as never);
    emit(h, AgentEventType.AGENT_TIMEOUT, sessionId, { success: false, error: "No ACP activity for 10 minutes." });
    await vi.waitFor(() => expect(h.createSession).toHaveBeenCalledTimes(2));
    expect(await h.record(sessionId)).toMatchObject({ status: "timed_out", recoveryReason: "watchdog_inactivity" });
    expect((await h.record(sessionId))?.retryAfterAt).toBeUndefined();
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 1 });
    h.orchestrator.stop();
  });

  it.each([
    { lane: "backlog" as const, stepIndex: 0, label: "Backlog" },
    { lane: "todo" as const, stepIndex: 0, label: "Todo" },
    { lane: "review" as const, stepIndex: 0, label: "Review QA Frontend" },
    { lane: "review" as const, stepIndex: 1, label: "Review Guard" },
    { lane: "done" as const, stepIndex: 0, label: "Done pusher" },
    { lane: "done" as const, stepIndex: 1, label: "Done reporter (board with pusher)" },
    { lane: "done-no-pusher" as const, stepIndex: 0, label: "Done reporter (board without pusher)" },
  ])("$label agent_failed: run count +1, no automatic rerun", async ({ lane, stepIndex }) => {
    const h = await createHarness(lane);
    const sessionId = await runToStep(h, stepIndex);
    emit(h, AgentEventType.AGENT_FAILED, sessionId, { success: false, error: "boom" });
    expect(await waitEnded(h, sessionId)).toMatchObject({ status: "failed", recoveryReason: "agent_failed" });
    const card = await h.card();
    // The lane's completed earlier steps plus this failed run.
    expect(getNonDevAutomationRunCount(card, lane, STAGE[lane])).toBe(stepIndex + 1);
    expect(card.lastSyncError).toBe("boom");
    expect((await h.record(sessionId))?.retryAfterAt).toBeUndefined();
    const calls = h.createSession.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(h.createSession).toHaveBeenCalledTimes(calls);
    // Optional chaining: this F2 case also runs unchanged on the pre-change orchestrator.
    expect(h.scheduler()?.size ?? 0).toBe(0);
    // More real runs reach the limit of 3.
    for (let extra = stepIndex + 1; extra < 3; extra += 1) {
      card.laneSessions!.push({ sessionId: `x${extra}`, columnId: lane, status: "failed", recoveryReason: "agent_failed", startedAt: NOW.toISOString() });
    }
    expect(hasExceededNonDevAutomationRepeatLimit(card, lane, STAGE[lane])).toBe(true);
    h.orchestrator.stop();
  });
});

const PATH1_CASES: Array<{ lane: Lane; stepIndex: number; label: string }> = [
  { lane: "backlog", stepIndex: 0, label: "Backlog" },
  { lane: "todo", stepIndex: 0, label: "Todo" },
  { lane: "dev", stepIndex: 0, label: "Dev" },
  { lane: "review", stepIndex: 0, label: "Review QA Frontend" },
  { lane: "review", stepIndex: 1, label: "Review Guard" },
  { lane: "done", stepIndex: 0, label: "Done pusher" },
  { lane: "done", stepIndex: 1, label: "Done reporter (board with pusher)" },
  { lane: "done-no-pusher", stepIndex: 0, label: "Done reporter (board without pusher)" },
];

describe("C4/F4①: a 429 failure reruns the same step at retryAfterAt", () => {
  it.each(PATH1_CASES)("$label", async ({ lane, stepIndex }) => {
    const h = await createHarness(lane);
    const sessionId = await runToStep(h, stepIndex);
    // Only the lane's completed earlier steps count; the 429 run does not.
    const countBefore = STAGE[lane] === "dev" ? 0 : stepIndex;
    const callsBefore = h.createSession.mock.calls.length;

    const record = await fail429(h, sessionId);
    expect(record).toMatchObject({ status: "failed", recoveryReason: "rate_limited", stepIndex });
    // Server reset 09:56:07.846Z plus 0.5 × 60 s.
    expect(record.retryAfterAt).toBe("2026-10-23T09:56:37.846Z");
    const card = await h.card();
    expect(card.lastSyncError).toMatch(/^\[environment\] rate_limited：限流，预计 \d{2}:\d{2} 重试$/);
    expect(getNonDevAutomationRunCount(card, lane, STAGE[lane])).toBe(countBefore);
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 0, attempt: 1 });

    await advanceToRetry(record, -1_000);
    expect(h.createSession).toHaveBeenCalledTimes(callsBefore);
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(callsBefore + 1);
    expect(h.createSession.mock.calls.at(-1)![0]).toMatchObject({
      columnId: lane,
      stepIndex,
      step: expect.objectContaining({ specialistId: STEPS[lane][stepIndex] }),
    });
    const rerun = h.sessions(stepIndex).at(-1)!;
    expect(await h.record(rerun)).toMatchObject({ status: "running", stepIndex });
    expect((await h.record(rerun))?.recoveryReason).toBeUndefined();
    expect((await h.card()).lastSyncError).toBeUndefined();
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 0, attempt: 1, currentStepIndex: stepIndex, sessionId: rerun });

    // The rerun is followed by the orchestrator: its success moves the lane on.
    emit(h, AgentEventType.AGENT_COMPLETED, rerun, { success: true, stopReason: "end_turn" });
    expect(await waitEnded(h, rerun)).toMatchObject({ status: "completed" });
    if (stepIndex + 1 < STEPS[lane].length) {
      await vi.waitFor(() => expect(h.sessions(stepIndex + 1).length).toBeGreaterThan(0));
    }
    h.orchestrator.stop();
  });

  it("Dev rerun keeps the recovery counters it had before the 429", async () => {
    const h = await createHarness("dev");
    const first = await enterLane(h);
    emit(h, AgentEventType.AGENT_FAILED, first, { success: false, error: "boom" });
    await vi.waitFor(() => expect(h.createSession).toHaveBeenCalledTimes(2));
    const second = h.sessions().at(-1)!;
    const record = await fail429(h, second);
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 1, attempt: 2 });
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(3);
    expect(h.createSession.mock.calls.at(-1)![0]).toMatchObject({ supervision: expect.objectContaining({ attempt: 2 }) });
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 1, attempt: 2 });
    h.orchestrator.stop();
  });

  it("without a server reset time: first backoff is 5 minutes ±20%", async () => {
    const h = await createHarness("review");
    const sessionId = await enterLane(h);
    const record = await fail429(h, sessionId, USAGE_LIMIT);
    expect(Date.parse(record.retryAfterAt!) - Date.parse(record.completedAt!)).toBe(5 * 60_000);
    await advanceToRetry(record, -1_000);
    expect(h.createSession).toHaveBeenCalledTimes(1);
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    h.orchestrator.stop();
  });
});

describe("C4: guards when the rerun time comes", () => {
  async function failedReviewGuard(): Promise<{ h: Harness; record: TaskLaneSession }> {
    const h = await createHarness("review");
    const sessionId = await runToStep(h, 1);
    const record = await fail429(h, sessionId);
    return { h, record };
  }

  it("card moved to another column (store write, no event)", async () => {
    const { h, record } = await failedReviewGuard();
    const card = await h.card();
    await h.taskStore.save({ ...card, columnId: "blocked" });
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    h.orchestrator.stop();
  });

  it("card moved by a column transition cancels the timer", async () => {
    const { h, record } = await failedReviewGuard();
    expect(h.scheduler().size).toBe(1);
    const card = await h.card();
    await h.taskStore.save({ ...card, columnId: "blocked" });
    h.eventBus.emit({
      type: AgentEventType.COLUMN_TRANSITION,
      agentId: "test",
      workspaceId: "default",
      data: { cardId: h.cardId, cardTitle: "Card", boardId: `board-${h.cardId}`, workspaceId: "default", fromColumnId: "review", toColumnId: "blocked" },
      timestamp: new Date(),
    });
    await flush();
    expect(h.scheduler().size).toBe(0);
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    h.orchestrator.stop();
  });

  // Review round 1: main's leaveLane (382763e1/a04533b5) and this card's
  // timer cancel both sit on the column-transition path; drive the real
  // move_card tool so both run together.
  it("move_card to blocked (leaveLane path) cancels the timer: no session at the rerun time", async () => {
    const { h, record } = await failedReviewGuard();
    expect(h.scheduler().get(h.cardId)).toMatchObject({ columnId: "review", stepIndex: 1 });
    const tools = new KanbanTools(h.boardStore, h.taskStore);
    tools.setEventBus(h.eventBus);
    expect((await tools.moveCard({ cardId: h.cardId, targetColumnId: "blocked" })).success).toBe(true);
    await flush();
    expect((await h.card()).columnId).toBe("blocked");
    expect(h.scheduler().size).toBe(0);
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toBeUndefined();
    await advanceToRetry(record, 1_000);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    expect((await h.card()).laneSessions?.some((entry) => entry.status === "running")).toBe(false);
    h.orchestrator.stop();
  });

  it("forgetCard (user move or delete) cancels the timer", async () => {
    const { h, record } = await failedReviewGuard();
    h.orchestrator.forgetCard(h.cardId, { columnId: "review" });
    expect(h.scheduler().size).toBe(0);
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    h.orchestrator.stop();
  });

  it("a step of the column is already running", async () => {
    const { h, record } = await failedReviewGuard();
    const card = await h.card();
    card.laneSessions!.push({ sessionId: "manual-rerun", columnId: "review", stepIndex: 1, status: "running", startedAt: new Date().toISOString() });
    await h.taskStore.save(card);
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    h.orchestrator.stop();
  });

  it("the column's latest record is no longer the rate-limited one", async () => {
    const { h, record } = await failedReviewGuard();
    const card = await h.card();
    card.laneSessions!.push({ sessionId: "manual-failed", columnId: "review", stepIndex: 1, status: "failed", recoveryReason: "agent_failed", startedAt: new Date().toISOString() });
    await h.taskStore.save(card);
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    h.orchestrator.stop();
  });

  it("orchestrator stopped before the rerun time", async () => {
    const { h, record } = await failedReviewGuard();
    h.orchestrator.stop();
    expect(h.scheduler().size).toBe(0);
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
  });

  it("scheduling the same card twice starts one session", async () => {
    const { h, record } = await failedReviewGuard();
    const entry: RateLimitRetryEntry = { ...h.scheduler().get(h.cardId)! };
    h.scheduler().schedule(entry);
    h.scheduler().schedule({ ...entry });
    expect(h.scheduler().size).toBe(1);
    await advanceToRetry(record, 1_000);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.createSession).toHaveBeenCalledTimes(3);
    h.orchestrator.stop();
  });
});

describe("C5/F4②③: watchdog timeouts and late errors", () => {
  function pushLastMessage(sessionId: string, text: string): void {
    getHttpSessionStore().pushNotificationToHistory(sessionId, {
      sessionId,
      update: { sessionUpdate: "acp_status", status: "error", error: text },
    } as never);
  }

  it.each(["dev", "done"] as const)("(a)/F4③ %s: AGENT_TIMEOUT with a usage_limit_reached last message", async (lane) => {
    const h = await createHarness(lane);
    const sessionId = await enterLane(h);
    pushLastMessage(sessionId, USAGE_LIMIT);
    emit(h, AgentEventType.AGENT_TIMEOUT, sessionId, { success: false, error: "No ACP activity for 10 minutes." });
    const record = await waitEnded(h, sessionId);
    expect(record).toMatchObject({ status: "timed_out", recoveryReason: "rate_limited", stepIndex: 0 });
    expect(Date.parse(record.retryAfterAt!) - Date.parse(record.completedAt!)).toBe(5 * 60_000);
    expect((await h.card()).lastSyncError).toMatch(/^\[environment\] rate_limited：限流，预计/);
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 0 });
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    expect(h.createSession.mock.calls.at(-1)![0]).toMatchObject({ stepIndex: 0 });
    h.orchestrator.stop();
  });

  it("(c) TIMEOUT with a 429 last message, then FAILED(429): one rerun", async () => {
    const h = await createHarness("dev");
    const sessionId = await enterLane(h);
    pushLastMessage(sessionId, USAGE_LIMIT);
    emit(h, AgentEventType.AGENT_TIMEOUT, sessionId, { success: false, error: "No ACP activity for 10 minutes." });
    const record = await waitEnded(h, sessionId);
    emit(h, AgentEventType.AGENT_FAILED, sessionId, { success: false, error: USAGE_LIMIT });
    await flush();
    expect(h.scheduler().size).toBe(1);
    await advanceToRetry(record, 1_000);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    h.orchestrator.stop();
  });

  it("(d) TIMEOUT without 429, FAILED(429) 12 s later: stays watchdog_inactivity, no timer", async () => {
    const h = await createHarness("dev");
    const sessionId = await enterLane(h);
    emit(h, AgentEventType.AGENT_TIMEOUT, sessionId, { success: false, error: "No ACP activity for 10 minutes." });
    await waitEnded(h, sessionId);
    await vi.advanceTimersByTimeAsync(12_000);
    emit(h, AgentEventType.AGENT_FAILED, sessionId, { success: false, error: USAGE_LIMIT });
    await flush();
    expect(await h.record(sessionId)).toMatchObject({ status: "timed_out", recoveryReason: "watchdog_inactivity" });
    expect(h.scheduler().size).toBe(0);
    h.orchestrator.stop();
  });

  it.each(["dev", "done"] as const)("(e)/F4② %s: FAILED with an empty error, only acpError has rate_limit_error", async (lane) => {
    const h = await createHarness(lane);
    const sessionId = await enterLane(h);
    const store = getHttpSessionStore();
    store.upsertSession({ ...store.getSession(sessionId)!, acpError: RUNAI_429 });
    emit(h, AgentEventType.AGENT_FAILED, sessionId, { success: false, error: "" });
    const record = await waitEnded(h, sessionId);
    expect(record).toMatchObject({ status: "failed", recoveryReason: "rate_limited", retryAfterAt: "2026-10-23T09:56:37.846Z" });
    expect(h.orchestrator.getAutomationForCard(h.cardId)).toMatchObject({ recoveryAttempts: 0 });
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    h.orchestrator.stop();
  });
});

function rateLimitedLanes(columnId: string, count: number): TaskLaneSession[] {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `pre-${columnId}-${counter}-${index}-${Math.random()}`,
    columnId,
    stepIndex: 0,
    status: "failed" as const,
    recoveryReason: "rate_limited" as const,
    startedAt: "2026-10-23T08:00:00.000Z",
  }));
}

describe("C6: fuse after consecutive retryable failures", () => {
  it("(a) the 5th consecutive 429 is not rerun and says so", async () => {
    const h = await createHarness("dev");
    let sessionId = await enterLane(h);
    for (let round = 1; round <= 4; round += 1) {
      const record = await fail429(h, sessionId);
      expect(record.retryAfterAt).toBeDefined();
      await advanceToRetry(record, 1_000);
      sessionId = h.sessions().at(-1)!;
    }
    expect(h.createSession).toHaveBeenCalledTimes(5);
    const fifth = await fail429(h, sessionId);
    expect(fifth).toMatchObject({ recoveryReason: "rate_limited" });
    expect(fifth.retryAfterAt).toBeUndefined();
    expect(h.scheduler().size).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60_000);
    expect(h.createSession).toHaveBeenCalledTimes(5);
    const lastSyncError = (await h.card()).lastSyncError!;
    expect(lastSyncError.startsWith("[environment]")).toBe(true);
    expect(lastSyncError).toContain("熔断");
    expect(lastSyncError).toContain("5");
    h.orchestrator.stop();
  });

  it.each([
    { label: "(b) a completed run", breaker: { status: "completed" as const } },
    { label: "(c) an agent_failed run", breaker: { status: "failed" as const, recoveryReason: "agent_failed" as const } },
  ])("$label resets the streak: the 9th failure is still rerun", async ({ breaker }) => {
    const laneSessions = [
      ...rateLimitedLanes("dev", 4),
      { sessionId: `breaker-${counter}`, columnId: "dev", stepIndex: 0, startedAt: "2026-10-23T08:00:00.000Z", ...breaker },
      ...rateLimitedLanes("dev", 3),
    ];
    const h = await createHarness("dev", { laneSessions });
    const sessionId = await enterLane(h);
    const record = await fail429(h, sessionId);
    expect(getConsecutiveRetryableEnvironmentFailureCount(await h.card(), "dev")).toBe(4);
    expect(record.retryAfterAt).toBeDefined();
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    h.orchestrator.stop();
  });

  it("(e) 4 failures in Dev, then the first 429 in Review counts as 1", async () => {
    const h = await createHarness("review", { laneSessions: rateLimitedLanes("dev", 4) });
    const sessionId = await enterLane(h);
    const record = await fail429(h, sessionId);
    expect(getConsecutiveRetryableEnvironmentFailureCount(await h.card(), "review")).toBe(1);
    await advanceToRetry(record, 1_000);
    expect(h.createSession).toHaveBeenCalledTimes(2);
    h.orchestrator.stop();
  });
});
