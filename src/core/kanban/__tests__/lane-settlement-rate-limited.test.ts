// @vitest-environment node
/**
 * Card 28f64f39 (复盘 L202 后续): the two terminal paths besides the
 * orchestrator's main path record a 429 like the main path does (79804de2):
 * failed + rate_limited with retryAfterAt.
 *
 * - Path 1, settleUnhandledLaneEnd / settleEndedLaneSession mode "event":
 *   the end of a session no automation follows. Base time: now.
 * - Path 2, the startup sweep and revive (resolveSessionOutcome over the
 *   persisted history): the session's error entry. Base time: that entry's
 *   createdAt, else the sweep clock.
 *
 * Before, both recorded failed + agent_failed: revive reran at once (into the
 * next 429) and the run consumed the non-Dev repeat budget.
 * Only existing exports are called, so with the implementation reverted these
 * tests fail on assertions, not on imports.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock, killSessionMock } = vi.hoisted(() => ({
  triggerAssignedTaskAgentMock: vi.fn(),
  killSessionMock: vi.fn(async (_sessionId: string) => undefined),
}));

vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));
vi.mock("../../acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: killSessionMock, hasActiveSession: () => false }),
}));

import { AgentEventType, type AgentEvent } from "../../events/event-bus";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "../../models/task";
import { createWorkspace } from "../../models/workspace";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import { getConsecutiveRetryableEnvironmentFailureCount } from "../environment-failure";
import {
  settleEndedLaneSession,
  settleUnhandledLaneEnd,
  type LiveSessionHistory,
  type SessionHistoryEntry,
} from "../lane-session-settlement";
import { endStaleRunningLaneSessions, reviveMissingEntryAutomations } from "../restart-recovery";
import { getNonDevAutomationRunCount } from "../workflow-orchestrator";
import { resetWorkflowOrchestrator, startWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import {
  cleanupSessionCwd,
  createLaneHarness,
  deadProcessOptions,
  orchestratorOf,
  runToInterruptedStep,
} from "./lane-interrupt-harness";

const MIN = 60_000;
const T = "2026-10-23T11:38:12.345Z";
const T_MS = Date.parse(T);
const iso = (ms: number) => new Date(ms).toISOString();

/** Production 429 text (RunAI gateway, 2026-10-23) with its server reset time. */
const online429 = (resetsAtMs: number) =>
  `RunAI account rate limited (HTTP 429, rate_limit_error; upstream trial_rate_limited) resets_at=${iso(resetsAtMs)}`;
/** A 429 without any server time. */
const BARE_429 = "turn failed: usage_limit_reached";
const BOOM = "turn failed: boom";
const PROVIDER = 'Unknown provider: "x". Not registered in ProviderRegistry.';

const start: SessionHistoryEntry = { update: { sessionUpdate: "user_message" }, createdAt: "2026-10-23T11:30:00.000Z" };
/** createdAt null: an entry without a write time (loadHistoryFromDb fallback). */
const errorEntry = (message: string, createdAt: string | null = T): SessionHistoryEntry => ({
  update: { sessionUpdate: "error", error: { code: "prompt_failed_after_timeout", message } },
  ...(createdAt ? { createdAt } : {}),
});
const exitEntry = (createdAt: string): SessionHistoryEntry => ({
  update: { sessionUpdate: "error", error: { code: "process_exited", message: "process exited unexpectedly (code=1, signal=null)" } },
  createdAt,
});
const turnEnd = (stopReason: string): SessionHistoryEntry => ({ update: { sessionUpdate: "turn_complete", stopReason }, createdAt: T });

function ev(type: AgentEventType, sessionId: string, data: Record<string, unknown>): AgentEvent {
  return { type, agentId: sessionId, workspaceId: "ws", data: { sessionId, ...data }, timestamp: new Date() };
}
const EVENT = {
  failed: (id: string, error: string) => ev(AgentEventType.AGENT_FAILED, id, { success: false, error }),
  completedFalse: (id: string, error: string) => ev(AgentEventType.AGENT_COMPLETED, id, { success: false, error }),
  cancelled: (id: string, error: string) => ev(AgentEventType.AGENT_COMPLETED, id, { success: false, stopReason: "cancelled", error }),
  timeout: (id: string, error: string) => ev(AgentEventType.AGENT_TIMEOUT, id, { success: false, error }),
  endTurn: (id: string) => ev(AgentEventType.AGENT_COMPLETED, id, { success: true, stopReason: "end_turn" }),
};

const live = (entries: SessionHistoryEntry[] = []): LiveSessionHistory => ({
  getHistory: () => entries,
  getSessionActivity: () => undefined,
});

function running(sessionId: string, columnId: string, stepIndex: number): TaskLaneSession {
  return { sessionId, columnId, stepIndex, status: "running", startedAt: "2026-10-23T11:30:00.000Z" };
}
function ended(sessionId: string, columnId: string, stepIndex: number, extra: Partial<TaskLaneSession>): TaskLaneSession {
  return { ...running(sessionId, columnId, stepIndex), status: "failed", completedAt: "2026-10-23T11:00:00.000Z", ...extra };
}
/** n earlier rate-limited runs of the same step: a streak of retryable environment failures. */
const priorRateLimited = (n: number, columnId: string, stepIndex: number) =>
  Array.from({ length: n }, (_, i) => ended(`p${i}`, columnId, stepIndex, { recoveryReason: "rate_limited" }));

async function newSystem(): Promise<RoutaSystem> {
  const system = createInMemorySystem();
  await system.workspaceStore.save(createWorkspace({ id: "ws", title: "WS", metadata: { "kanbanSessionConcurrencyLimit:board": "10" } }));
  const gate = (specialistId: string) => ({ id: specialistId, providerId: "claude", role: "GATE" as const, specialistId });
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: "board",
    workspaceId: "ws",
    name: "Board",
    isDefault: true,
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      {
        id: "review", name: "Review", position: 1, stage: "review",
        automation: { enabled: true, transitionType: "entry", autoAdvanceOnSuccess: false, steps: [gate("kanban-qa-frontend"), gate("kanban-review-guard")] },
      },
      {
        id: "done", name: "Done", position: 2, stage: "done",
        automation: { enabled: true, transitionType: "entry", steps: [gate("kanban-main-pusher"), gate("kanban-done-reporter")] },
      },
    ],
  }));
  return system;
}

async function saveCard(system: RoutaSystem, id: string, columnId: string, laneSessions: TaskLaneSession[], extra: Partial<Task> = {}) {
  await system.taskStore.save({
    ...createTask({ id, title: id, objective: id, workspaceId: "ws", boardId: "board", columnId, status: TaskStatus.IN_PROGRESS }),
    laneSessions,
    ...extra,
  } as Task);
}

async function rec(system: RoutaSystem, cardId: string, sessionId: string) {
  return (await system.taskStore.get(cardId))?.laneSessions?.find((entry) => entry.sessionId === sessionId);
}

function sweepOptions(byId: Record<string, SessionHistoryEntry[]>, now?: Date) {
  return {
    ...deadProcessOptions,
    readSessionEndHistory: vi.fn(async (sessionId: string) => byId[sessionId] ?? []),
    ...(now ? { now: () => now } : {}),
  };
}

const starts = () => triggerAssignedTaskAgentMock.mock.calls.map(([params]) => params as { task: { id: string }; stepIndex?: number; step?: { specialistId?: string } });

function expectWithin(value: string | undefined, lo: number, hi: number): void {
  expect(typeof value).toBe("string");
  const ms = Date.parse(value!);
  expect(ms).toBeGreaterThanOrEqual(lo);
  expect(ms).toBeLessThanOrEqual(hi);
}

/** Path 1 on a card in review: settle `event` for running record s-1 (step 1). */
async function settleReview(params: {
  event: AgentEvent;
  mode?: "event" | "teardown";
  history?: SessionHistoryEntry[];
  cardColumn?: string;
  prior?: TaskLaneSession[];
  record?: TaskLaneSession;
}) {
  const system = await newSystem();
  const record = params.record ?? running("s-1", "review", 1);
  await saveCard(system, "c", params.cardColumn ?? "review", [...(params.prior ?? []), record]);
  await settleEndedLaneSession({
    taskStore: system.taskStore,
    sessions: live(params.history),
    event: params.event,
    mode: params.mode ?? "event",
    cardId: "c",
  });
  return { system, record: await rec(system, "c", record.sessionId), card: (await system.taskStore.get("c"))! };
}

beforeEach(() => {
  resetWorkflowOrchestrator();
  triggerAssignedTaskAgentMock.mockReset();
  triggerAssignedTaskAgentMock.mockImplementation(async (params: { task: { id: string }; stepIndex?: number }) => ({
    sessionId: `${params.task.id}:new:${params.stepIndex ?? "x"}:${Math.round(performance.now() * 1000)}`,
    transport: "acp",
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  resetWorkflowOrchestrator();
});

afterAll(() => {
  cleanupSessionCwd();
});

describe("C1 / AC1: path 1 (mode event) records a 429 as failed + rate_limited with retryAfterAt", () => {
  it.each([
    { label: "AGENT_FAILED", make: EVENT.failed },
    { label: "AGENT_COMPLETED success=false", make: EVENT.completedFalse },
  ])("$label with the online 429 text → retryAfterAt in [resets_at, +60 s], no lastSyncError", async ({ make }) => {
    const resetsAt = Date.now() + 10 * MIN;
    const { record, card } = await settleReview({ event: make("s-1", online429(resetsAt)) });
    expect(record?.status).toBe("failed");
    expect(record?.recoveryReason).toBe("rate_limited");
    expectWithin(record?.retryAfterAt, resetsAt, resetsAt + MIN);
    expect(card.lastSyncError).toBeUndefined();
  });

  it("F4 1c: settleUnhandledLaneEnd mode event gives the same record", async () => {
    const system = await newSystem();
    await saveCard(system, "c", "review", [running("s-1", "review", 1)]);
    const resetsAt = Date.now() + 10 * MIN;
    await settleUnhandledLaneEnd(system.taskStore, live(), EVENT.failed("s-1", online429(resetsAt)), "event", "c");
    const record = await rec(system, "c", "s-1");
    expect(record?.recoveryReason).toBe("rate_limited");
    expectWithin(record?.retryAfterAt, resetsAt, resetsAt + MIN);
  });

  it("C14: plain event error, 429 only in the session's own error entry → rate_limited", async () => {
    const resetsAt = Date.now() + 10 * MIN;
    const { record } = await settleReview({ event: EVENT.failed("s-1", BOOM), history: [start, errorEntry(online429(resetsAt))] });
    expect(record?.recoveryReason).toBe("rate_limited");
    expectWithin(record?.retryAfterAt, resetsAt, resetsAt + MIN);
  });

  it("no server time: 1st rate limit of the lane → now + 5 min ±20%", async () => {
    const before = Date.now();
    const { record } = await settleReview({ event: EVENT.failed("s-1", BARE_429) });
    expect(record?.recoveryReason).toBe("rate_limited");
    expectWithin(record?.retryAfterAt, before + 4 * MIN, Date.now() + 6 * MIN);
  });
});

describe("F2 / AC7: path 1 keeps every other end as before", () => {
  it.each([
    { label: "F2-f turn failed: boom", event: EVENT.failed("s-1", BOOM), status: "failed", reason: "agent_failed" },
    { label: "F2-e provider not registered", event: EVENT.failed("s-1", PROVIDER), status: "failed", reason: "environment_failure" },
    { label: "F2-g AGENT_COMPLETED cancelled (429 text)", event: EVENT.cancelled("s-1", BARE_429), status: "failed", reason: "turn_cancelled" },
    { label: "F2-d AGENT_TIMEOUT", event: EVENT.timeout("s-1", "No ACP activity for 20 minutes."), status: "timed_out", reason: "watchdog_inactivity" },
    { label: "F2-d AGENT_TIMEOUT with 429 text", event: EVENT.timeout("s-1", BARE_429), status: "timed_out", reason: "watchdog_inactivity" },
    { label: "F2-a AGENT_COMPLETED success", event: EVENT.endTurn("s-1"), status: "completed", reason: undefined },
  ])("$label → $status / $reason, no retryAfterAt", async ({ event, status, reason }) => {
    const { record } = await settleReview({ event });
    expect(record?.status).toBe(status);
    expect(record?.recoveryReason).toBe(reason);
    expect(record?.retryAfterAt).toBeUndefined();
  });

  it.each([
    { label: "F2-i teardown, end_turn in history", mode: "teardown" as const, history: [turnEnd("end_turn")], cardColumn: "review", status: "completed" },
    { label: "F2-i teardown, no history", mode: "teardown" as const, history: [], cardColumn: "review", status: "transitioned" },
    { label: "F2-i event, card already left the column", mode: "event" as const, history: [], cardColumn: "done", status: "transitioned" },
  ])("$label, 429 event → $status, never failed, no retryAfterAt", async ({ mode, history, cardColumn, status }) => {
    const { record } = await settleReview({ event: EVENT.failed("s-1", online429(Date.now() + 10 * MIN)), mode, history, cardColumn });
    expect(record?.status).toBe(status);
    expect(record?.recoveryReason).toBeUndefined();
    expect(record?.retryAfterAt).toBeUndefined();
  });

  it("a failure event of a session whose turn really ended is completed (429 text or not)", async () => {
    const { record } = await settleReview({ event: EVENT.failed("s-1", BARE_429), history: [turnEnd("end_turn")] });
    expect(record?.status).toBe("completed");
    expect(record?.retryAfterAt).toBeUndefined();
  });
});

describe("C2 / AC2: path 2 (startup sweep) records a 429 error entry as failed + rate_limited", () => {
  const resetsAt = T_MS + 10 * MIN;
  it.each([
    { label: "(a) 429 is the last entry", history: [start, errorEntry(online429(resetsAt))] },
    { label: "(b) 429, then the process exit 5 s later", history: [start, errorEntry(online429(resetsAt)), exitEntry(iso(T_MS + 5_000))] },
  ])("$label → completedAt = the 429 entry's time, retryAfterAt in [resets_at, +60 s]", async ({ history }) => {
    const system = await newSystem();
    await saveCard(system, "c", "review", [running("s-1", "review", 1)], { triggerSessionId: "s-1" });
    await endStaleRunningLaneSessions(system, sweepOptions({ "s-1": history }, new Date(T_MS + 3 * 60 * MIN)));
    const record = await rec(system, "c", "s-1");
    expect(record?.status).toBe("failed");
    expect(record?.recoveryReason).toBe("rate_limited");
    expect(record?.completedAt).toBe(T);
    expectWithin(record?.retryAfterAt, resetsAt, resetsAt + MIN);
  });
});

describe("C3 / AC3: path 2 counts the backoff from the session's end", () => {
  async function sweep(history: SessionHistoryEntry[], now: Date) {
    const system = await newSystem();
    await saveCard(system, "c", "review", [running("s-1", "review", 1)]);
    vi.spyOn(Math, "random").mockReturnValue(0.75); // factor 1 + (0.75 * 2 - 1) * 0.2 = 1.1
    await endStaleRunningLaneSessions(system, sweepOptions({ "s-1": history }, now));
    vi.mocked(Math.random).mockRestore();
    return rec(system, "c", "s-1");
  }

  it("with createdAt: retryAfterAt = endedAt + 5 min × 1.1, whatever the sweep clock", async () => {
    const early = await sweep([start, errorEntry(BARE_429)], new Date(T_MS + MIN));
    const late = await sweep([start, errorEntry(BARE_429)], new Date(T_MS + 3 * 60 * MIN));
    expect(early?.recoveryReason).toBe("rate_limited");
    expect(early?.completedAt).toBe(T);
    const delta = Date.parse(early!.retryAfterAt!) - T_MS;
    expect(delta).toBeGreaterThanOrEqual(4 * MIN);
    expect(delta).toBeLessThanOrEqual(6 * MIN);
    expect(early?.retryAfterAt).toBe(iso(T_MS + 5.5 * MIN));
    expect(late?.retryAfterAt).toBe(early?.retryAfterAt);
  });

  it("without createdAt (loadHistoryFromDb fallback): from the sweep clock, no throw", async () => {
    const now = new Date(T_MS + 2 * 60 * MIN);
    const record = await sweep([{ update: { sessionUpdate: "user_message" } }, errorEntry(BARE_429, null)], now);
    expect(record?.recoveryReason).toBe("rate_limited");
    expect(record?.retryAfterAt).toBe(iso(now.getTime() + 5.5 * MIN));
  });
});

describe("C4 / AC4: revive reruns the rate-limited step only once retryAfterAt passed", () => {
  async function revive(nowMs: number) {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await saveCard(system, "c", "review", [ended("s-0", "review", 0, { status: "completed", recoveryReason: undefined }), running("s-1", "review", 1)], { triggerSessionId: "s-1" });
    await reviveMissingEntryAutomations(system, "ws", "board", sweepOptions({ "s-1": [start, errorEntry(BARE_429)] }, new Date(nowMs)));
    return { record: await rec(system, "c", "s-1"), starts: starts() };
  }

  it("(a) now after retryAfterAt: the same revive call starts 1 session at the same step", async () => {
    const { record, starts: started } = await revive(T_MS + 60 * MIN);
    expect(record?.recoveryReason).toBe("rate_limited");
    expect(Date.parse(record!.retryAfterAt!)).toBeLessThan(T_MS + 60 * MIN);
    expect(started.map((params) => params.stepIndex)).toEqual([1]);
  });

  it("(b) F4 2b: now before retryAfterAt: recorded rate_limited, 0 sessions", async () => {
    const { record, starts: started } = await revive(T_MS + MIN);
    expect(record?.recoveryReason).toBe("rate_limited");
    expect(Date.parse(record!.retryAfterAt!)).toBeGreaterThan(T_MS + MIN);
    expect(started).toHaveLength(0);
  });
});

describe("C5 / AC6: budget and fuse match the main path", () => {
  const nonDev = (task: Task | undefined) => getNonDevAutomationRunCount(task, "review", "review");

  it("(i) review, both paths: the non-Dev repeat count does not grow, the retryable streak grows by 1; control: boom grows the count", async () => {
    const prior = [ended("s-0", "review", 0, { status: "completed", recoveryReason: undefined })];
    const baseline = nonDev({ laneSessions: prior } as Task);
    const p1 = await settleReview({ prior, event: EVENT.failed("s-1", BARE_429) });
    const p1Boom = await settleReview({ prior, event: EVENT.failed("s-1", BOOM) });
    const sweepWith = async (message: string) => {
      const system = await newSystem();
      await saveCard(system, "c", "review", [...prior, running("s-1", "review", 1)]);
      await endStaleRunningLaneSessions(system, sweepOptions({ "s-1": [start, errorEntry(message)] }));
      return (await system.taskStore.get("c"))!;
    };
    const p2 = await sweepWith(BARE_429);
    const p2Boom = await sweepWith(BOOM);
    for (const card of [p1.card, p2]) {
      expect(card.laneSessions?.at(-1)?.recoveryReason).toBe("rate_limited");
      expect(nonDev(card)).toBe(baseline);
      expect(getConsecutiveRetryableEnvironmentFailureCount(card, "review")).toBe(1);
    }
    for (const card of [p1Boom.card, p2Boom]) expect(nonDev(card)).toBe(baseline + 1);
  });

  it("(ii) Dev, both paths: automation.recoveryAttempts unchanged, the retryable streak grows by 1", async () => {
    for (const path of ["settle", "sweep"] as const) {
      resetWorkflowOrchestrator();
      const h = await createLaneHarness("dev", triggerAssignedTaskAgentMock, { cardId: `card-dev-${path}` });
      const sessionId = await runToInterruptedStep(h);
      const automation = orchestratorOf(h).getAutomationForCard(h.cardId)!;
      const attemptsBefore = automation.recoveryAttempts;
      if (path === "settle") {
        automation.status = "completed"; // no automation follows the session: the :958 settle path
        await (orchestratorOf(h) as unknown as { handleAgentCompletion(event: AgentEvent): Promise<void> })
          .handleAgentCompletion({ ...EVENT.failed(sessionId, BARE_429), workspaceId: "default" });
      } else {
        await endStaleRunningLaneSessions(h.system, sweepOptions({ [sessionId]: [start, errorEntry(BARE_429)] }));
      }
      const card = await h.card();
      expect(card.laneSessions?.find((entry) => entry.sessionId === sessionId)?.recoveryReason).toBe("rate_limited");
      expect(automation.recoveryAttempts).toBe(attemptsBefore);
      expect(getConsecutiveRetryableEnvironmentFailureCount(card, "dev")).toBe(1);
    }
  });

  it.each([
    { label: "(iii) 4 earlier + this one = 5: fuse, no retryAfterAt, revive starts 0", prior: 4, retry: false, started: 0 },
    { label: "(iv) control, 3 earlier + this one = 4: retryAfterAt, revive after it starts 1", prior: 3, retry: true, started: 1 },
  ])("path 1 $label", async ({ prior, retry, started }) => {
    const { system, record } = await settleReview({ prior: priorRateLimited(prior, "review", 1), event: EVENT.failed("s-1", BARE_429) });
    expect(record?.recoveryReason).toBe("rate_limited");
    expect(Boolean(record?.retryAfterAt)).toBe(retry);
    startWorkflowOrchestrator(system);
    await reviveMissingEntryAutomations(system, "ws", "board", { ...deadProcessOptions, now: () => new Date(Date.now() + 24 * 60 * MIN) });
    expect(starts()).toHaveLength(started);
  });

  it.each([
    { label: "(iii) 4 earlier + this one = 5: fuse, no retryAfterAt, revive starts 0", prior: 4, retry: false, started: 0 },
    { label: "(iv) control, 3 earlier + this one = 4: retryAfterAt, revive after it starts 1", prior: 3, retry: true, started: 1 },
  ])("path 2 (revive) $label", async ({ prior, retry, started }) => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await saveCard(system, "c", "review", [...priorRateLimited(prior, "review", 1), running("s-1", "review", 1)]);
    await reviveMissingEntryAutomations(system, "ws", "board", sweepOptions({ "s-1": [start, errorEntry(BARE_429)] }, new Date(T_MS + 24 * 60 * MIN)));
    const record = await rec(system, "c", "s-1");
    expect(record?.recoveryReason).toBe("rate_limited");
    expect(Boolean(record?.retryAfterAt)).toBe(retry);
    expect(starts()).toHaveLength(started);
  });
});

describe("C6 / AC7: an ended rate_limited record is never rewritten", () => {
  it("sweep, revive (now before X), settle event and settle teardown keep it toEqual; revive starts 0", async () => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    const X = iso(Date.now() + 60 * MIN);
    const record = ended("s-1", "review", 1, { recoveryReason: "rate_limited", retryAfterAt: X, completedAt: T });
    await saveCard(system, "c", "review", [record]);
    const before = await rec(system, "c", "s-1");
    const history = { "s-1": [start, errorEntry(BARE_429)] };
    const steps: Array<() => Promise<unknown>> = [
      () => endStaleRunningLaneSessions(system, sweepOptions(history)),
      () => reviveMissingEntryAutomations(system, "ws", "board", sweepOptions(history, new Date())),
      () => settleEndedLaneSession({ taskStore: system.taskStore, sessions: live([errorEntry(BARE_429)]), event: EVENT.failed("s-1", BARE_429), mode: "event", cardId: "c" }),
      () => settleEndedLaneSession({ taskStore: system.taskStore, sessions: live(), event: EVENT.failed("s-1", BARE_429), mode: "teardown", cardId: "c" }),
    ];
    for (const step of steps) {
      await step();
      expect(await rec(system, "c", "s-1")).toEqual(before);
    }
    expect(starts()).toHaveLength(0);
  });
});

describe("C7: a record the startup sweep ends in a column the card left", () => {
  it("is failed + rate_limited without retryAfterAt; the current column's revive is neither blocked nor triggered by it", async () => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await saveCard(system, "c", "done", [running("s-1", "review", 1)]);
    await endStaleRunningLaneSessions(system, sweepOptions({ "s-1": [start, errorEntry(online429(T_MS + 10 * MIN))] }));
    const record = await rec(system, "c", "s-1");
    expect(record?.status).toBe("failed");
    expect(record?.recoveryReason).toBe("rate_limited");
    expect(record?.retryAfterAt).toBeUndefined();

    await reviveMissingEntryAutomations(system, "ws", "board", { ...deadProcessOptions, now: () => new Date(T_MS) });
    expect(starts().map((params) => params.step?.specialistId)).toEqual(["kanban-main-pusher"]);
  });
});

describe("F2 / AC7: path 2 keeps every other end as before", () => {
  it.each([
    { label: "F2-f turn failed: boom", history: [start, errorEntry(BOOM)], status: "failed", reason: "agent_failed" },
    { label: "F2-e provider text (path 2 has no environment_failure rule)", history: [start, errorEntry(PROVIDER)], status: "failed", reason: "agent_failed" },
    { label: "F2-g turn_complete cancelled", history: [start, turnEnd("cancelled")], status: "failed", reason: "turn_cancelled" },
    { label: "F2-a turn_complete end_turn", history: [start, turnEnd("end_turn")], status: "completed", reason: undefined },
    { label: "F2-c no end, current column", history: [start], status: "timed_out", reason: "restart_interrupted" },
  ])("$label → $status / $reason, no retryAfterAt", async ({ history, status, reason }) => {
    const system = await newSystem();
    await saveCard(system, "c", "review", [running("s-1", "review", 1)]);
    await endStaleRunningLaneSessions(system, sweepOptions({ "s-1": history }));
    const record = await rec(system, "c", "s-1");
    expect(record?.status).toBe(status);
    expect(record?.recoveryReason).toBe(reason);
    expect(record?.retryAfterAt).toBeUndefined();
  });

  it("F2-j no end, a column the card left → transitioned", async () => {
    const system = await newSystem();
    await saveCard(system, "c", "done", [running("s-1", "review", 1)]);
    await endStaleRunningLaneSessions(system, sweepOptions({ "s-1": [start] }));
    expect(await rec(system, "c", "s-1")).toMatchObject({ status: "transitioned" });
  });

  it("F2-b a finished card's completed last Done record stays completed; revive starts 0", async () => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    const records = [ended("s-p", "done", 0, { status: "completed", recoveryReason: undefined }), ended("s-r", "done", 1, { status: "completed", recoveryReason: undefined })];
    await saveCard(system, "c", "done", records, { status: TaskStatus.COMPLETED });
    const before = (await system.taskStore.get("c"))!.laneSessions;
    const history = { "s-p": [start, errorEntry(BARE_429)], "s-r": [start, errorEntry(BARE_429), exitEntry(T)] };
    await endStaleRunningLaneSessions(system, sweepOptions(history));
    await reviveMissingEntryAutomations(system, "ws", "board", sweepOptions(history, new Date()));
    expect((await system.taskStore.get("c"))!.laneSessions).toEqual(before);
    expect(starts()).toHaveLength(0);
  });

  it("F2-f the 3rd non-Dev agent_failed run stops revive; F2-h an agent_failed card reruns its step, an environment_failure card is skipped", async () => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    const failedRun = (id: string) => ended(id, "review", 1, { recoveryReason: "agent_failed" });
    await saveCard(system, "limit", "review", [failedRun("l0"), failedRun("l1"), running("l2", "review", 1)]);
    await saveCard(system, "rerun", "review", [running("r1", "review", 1)]);
    await saveCard(system, "env", "review", [ended("e1", "review", 1, { recoveryReason: "environment_failure" })]);
    await reviveMissingEntryAutomations(system, "ws", "board", sweepOptions({ l2: [start, errorEntry(BOOM)], r1: [start, errorEntry(BOOM)] }, new Date()));
    expect(await rec(system, "limit", "l2")).toMatchObject({ status: "failed", recoveryReason: "agent_failed" });
    expect(getNonDevAutomationRunCount(await system.taskStore.get("limit"), "review", "review")).toBe(3);
    expect(starts().map((params) => [params.task.id, params.stepIndex])).toEqual([["rerun", 1]]);
  });

  it.each(["backlog", "todo", "dev", "review", "done"] as const)("F2-k %s: boom through the sweep → agent_failed, non-Dev count +1 outside Dev", async (column) => {
    const system = await newSystem();
    await saveCard(system, "c", column, [running("s-1", column, 0)]);
    await endStaleRunningLaneSessions(system, sweepOptions({ "s-1": [start, errorEntry(BOOM)] }));
    const card = await system.taskStore.get("c");
    expect(card?.laneSessions?.[0]).toMatchObject({ status: "failed", recoveryReason: "agent_failed" });
    expect(getNonDevAutomationRunCount(card, column, column)).toBe(column === "dev" ? 0 : 1);
  });
});

describe("F4: the new record reaches every execution path", () => {
  const harnessEnd = async (teardown: boolean) => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock, { cardId: `card-f4-${teardown}` });
    const sessionId = await runToInterruptedStep(h);
    const orchestrator = orchestratorOf(h) as unknown as {
      cardEndedSessionIds: Set<string>;
      activeAutomations: Map<string, unknown>;
      handleAgentCompletion(event: AgentEvent): Promise<void>;
    };
    if (teardown) orchestrator.cardEndedSessionIds.add(sessionId);
    else orchestrator.activeAutomations.delete(h.cardId);
    const resetsAt = Date.now() + 10 * MIN;
    await orchestrator.handleAgentCompletion({ ...EVENT.failed(sessionId, online429(resetsAt)), workspaceId: "default" });
    return { record: await h.laneRecord(sessionId), resetsAt };
  };

  it("1a orchestrator :958 (no automation follows the session) → rate_limited + retryAfterAt", async () => {
    const { record, resetsAt } = await harnessEnd(false);
    expect(record?.status).toBe("failed");
    expect(record?.recoveryReason).toBe("rate_limited");
    expectWithin(record?.retryAfterAt, resetsAt, resetsAt + MIN);
  });

  it("1b orchestrator :719 is teardown mode (card ended by the user) → transitioned, no retryAfterAt", async () => {
    const { record } = await harnessEnd(true);
    expect(record?.status).toBe("transitioned");
    expect(record?.retryAfterAt).toBeUndefined();
  });
});

/**
 * F3 batch cross-check (seeded). Expected records come from a decision table
 * written from the card's AC over a hand-labelled error corpus; the table
 * never calls the classifier under test. FUSE and EXIT_TIME_FROM are the
 * knobs the planted-error runs flip.
 */
describe("F3: seeded batch cross-check of both paths", () => {
  const SEED = 28_642_839;
  const ROUNDS = 10_000;
  type Path = "event" | "teardown" | "sweep" | "revive";
  type EventKind = "failed" | "completedFalse" | "cancelled" | "timeout";
  type HistoryKind = "error" | "error_exit" | "end_turn" | "cancelled" | "none" | "error_no_time";
  type Text = { label: string; is429: boolean; server: boolean; provider?: boolean; make: (resetsAtMs: number) => string };
  const CORPUS: Text[] = [
    { label: "online429", is429: true, server: true, make: online429 },
    { label: "usage_limit", is429: true, server: false, make: () => "turn failed: usage_limit_reached" },
    { label: "usage_limit+resets", is429: true, server: true, make: (r) => `{"error":{"type":"usage_limit_reached","resets_at":"${iso(r)}"}}` },
    { label: "http429", is429: true, server: false, make: () => "upstream returned HTTP 429 Too Many Requests" },
    { label: "http429+resets", is429: true, server: true, make: (r) => `HTTP 429 resets_at=${iso(r)}` },
    { label: "boom", is429: false, server: false, make: () => BOOM },
    { label: "provider", is429: false, server: false, provider: true, make: () => PROVIDER },
  ];

  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  interface Round {
    path: Path; inColumn: boolean; alreadyEnded: boolean; prior: number;
    eventKind: EventKind; historyKind: HistoryKind; eventText: Text; historyText: Text;
  }
  interface Knobs { fuse: number; exitTime: boolean }
  type Expected = { status: string; reason?: string; completedAt?: string; retry: "none" | "any" | [number, number] | { after: number } };

  const EXIT_AT = iso(T_MS + 5_000);
  const SWEEP_NOW = T_MS + 2 * 60 * MIN;
  const REVIVE_NOW = T_MS + MIN;

  /** Expected outcome of the session history alone (path 2, and path 1's "really completed" rule). */
  function byHistory(r: Round, knobs: Knobs): { kind: "completed" } | { kind: "failed"; reason: string; at?: string; is429?: boolean; server?: boolean } | undefined {
    switch (r.historyKind) {
      case "end_turn": return { kind: "completed" };
      case "cancelled": return { kind: "failed", reason: "turn_cancelled", at: T };
      case "none": return undefined;
      case "error":
      case "error_exit":
      case "error_no_time": {
        const at = r.historyKind === "error_no_time" ? undefined : r.historyKind === "error_exit" && knobs.exitTime ? EXIT_AT : T;
        return { kind: "failed", reason: r.historyText.is429 ? "rate_limited" : "agent_failed", at, is429: r.historyText.is429, server: r.historyText.server };
      }
    }
  }

  /** The server time is a lower bound and never earlier than the base; else 5 min ±20% for the lane's 1st rate limit. */
  function retryWindow(server: boolean, resetsAt: number, count: number, base: number, baseHi: number, knobs: Knobs): Expected["retry"] {
    if (count >= knobs.fuse) return "none";
    if (server) return [Math.max(resetsAt, base), Math.max(resetsAt, baseHi) + MIN];
    return count === 1 ? [base + 4 * MIN, baseHi + 6 * MIN] : { after: base };
  }

  function expected(r: Round, knobs: Knobs, now: [number, number], resetsAt: number): Expected | "unchanged" | "not_failed" {
    if (r.alreadyEnded) return "unchanged";
    const history = byHistory(r, knobs);
    const count = r.prior + 1;
    if (r.path === "event" || r.path === "teardown") {
      if (r.path === "teardown" || !r.inColumn) return { status: history?.kind === "completed" ? "completed" : "transitioned", retry: "none" };
      if (r.eventKind === "timeout") return { status: "timed_out", reason: "watchdog_inactivity", retry: "none" };
      if (r.eventKind === "cancelled") return { status: "failed", reason: "turn_cancelled", retry: "none" };
      if (history?.kind === "completed") return { status: "completed", retry: "none" };
      if (r.eventText.provider) return { status: "failed", reason: "environment_failure", retry: "none" };
      const historyFailure = history?.kind === "failed" ? history : undefined;
      if (r.eventText.is429 || historyFailure?.is429) {
        const server = (r.eventText.is429 && r.eventText.server) || Boolean(historyFailure?.is429 && historyFailure.server);
        return { status: "failed", reason: "rate_limited", retry: retryWindow(server, resetsAt, count, now[0], now[1], knobs) };
      }
      return { status: "failed", reason: "agent_failed", retry: "none" };
    }
    // Revive only ends records of the card's current column; entering that column may close an older lane's record, never as failed.
    if (r.path === "revive" && !r.inColumn) return "not_failed";
    if (!history) return { status: r.inColumn ? "timed_out" : "transitioned", reason: r.inColumn ? "restart_interrupted" : undefined, retry: "none" };
    if (history.kind === "completed") return { status: "completed", completedAt: T, retry: "none" };
    if (history.reason !== "rate_limited" || !r.inColumn) return { status: "failed", reason: history.reason, completedAt: history.at, retry: "none" };
    const base = history.at ? Date.parse(T) : r.path === "sweep" ? SWEEP_NOW : REVIVE_NOW;
    return { status: "failed", reason: "rate_limited", completedAt: history.at, retry: retryWindow(Boolean(history.server), resetsAt, count, base, base, knobs) };
  }

  function historyFor(r: Round, resetsAtMs: number): SessionHistoryEntry[] {
    const text = r.historyText.make(resetsAtMs);
    switch (r.historyKind) {
      case "end_turn": return [start, turnEnd("end_turn")];
      case "cancelled": return [start, turnEnd("cancelled")];
      case "none": return [start];
      case "error": return [start, errorEntry(text)];
      case "error_exit": return [start, errorEntry(text), exitEntry(EXIT_AT)];
      case "error_no_time": return [{ update: { sessionUpdate: "user_message" } }, errorEntry(text, null)];
    }
  }

  function matches(exp: Expected | "unchanged" | "not_failed", before: TaskLaneSession, after: TaskLaneSession | undefined): boolean {
    if (!after) return false;
    if (exp === "unchanged") return JSON.stringify(after) === JSON.stringify(before);
    if (exp === "not_failed") return after.status !== "failed" && !after.recoveryReason && !after.retryAfterAt;
    if (after.status !== exp.status || after.recoveryReason !== exp.reason) return false;
    if (exp.completedAt && after.completedAt !== exp.completedAt) return false;
    if (exp.retry === "none") return after.retryAfterAt === undefined;
    if (!after.retryAfterAt) return false;
    const ms = Date.parse(after.retryAfterAt);
    if (Array.isArray(exp.retry)) return ms >= exp.retry[0] && ms <= exp.retry[1];
    return exp.retry === "any" || ms > exp.retry.after;
  }

  async function crossCheck(knobs: Knobs): Promise<{ mismatches: number; first?: string }> {
    const next = rng(SEED);
    const pick = <V,>(items: readonly V[]): V => items[Math.floor(next() * items.length)];
    const shared = await newSystem();
    startWorkflowOrchestrator(shared);
    let mismatches = 0;
    let first: string | undefined;
    for (let round = 0; round < ROUNDS; round += 1) {
      const r: Round = {
        path: pick(["event", "teardown", "sweep", "revive"] as const),
        inColumn: next() < 0.75,
        alreadyEnded: next() < 0.15,
        prior: Math.floor(next() * 7),
        eventKind: pick(["failed", "completedFalse", "cancelled", "timeout"] as const),
        historyKind: pick(["error", "error_exit", "end_turn", "cancelled", "none", "error_no_time"] as const),
        eventText: pick(CORPUS),
        historyText: pick(CORPUS),
      };
      const id = `x${round}`;
      const sessionId = `${id}-s`;
      const cardColumn = r.inColumn ? "review" : "done";
      const record = r.alreadyEnded
        ? ended(sessionId, "review", 1, { recoveryReason: "agent_failed", completedAt: "2001-01-01T00:00:00.000Z" })
        : running(sessionId, "review", 1);
      const laneSessions = [...priorRateLimited(r.prior, "review", 1).map((entry) => ({ ...entry, sessionId: `${id}-${entry.sessionId}` })), record];
      const card = { ...createTask({ id, title: id, objective: id, workspaceId: `w${round}`, boardId: "board", columnId: cardColumn, status: TaskStatus.IN_PROGRESS }), laneSessions } as Task;
      const eventPath = r.path === "event" || r.path === "teardown";
      const baseMs = eventPath ? Date.now() : T_MS;
      const resetsAt = baseMs + 10 * MIN;
      const history = historyFor(r, resetsAt);
      let now: [number, number] = [0, 0];
      let after: TaskLaneSession | undefined;
      if (eventPath) {
        const system = await newSystem();
        await system.taskStore.save(card);
        const text = r.eventText.make(resetsAt);
        now = [Date.now(), 0];
        await settleEndedLaneSession({ taskStore: system.taskStore, sessions: live(history), event: EVENT[r.eventKind](sessionId, text), mode: r.path === "teardown" ? "teardown" : "event", cardId: id });
        now[1] = Date.now();
        after = await rec(system, id, sessionId);
      } else if (r.path === "sweep") {
        const store = shared.taskStore;
        await store.save(card);
        const system = { workspaceStore: { list: async () => [{ id: `w${round}` }] }, taskStore: store } as unknown as RoutaSystem;
        await endStaleRunningLaneSessions(system, sweepOptions({ [sessionId]: history }, new Date(SWEEP_NOW)));
        after = (await store.get(id))?.laneSessions?.find((entry) => entry.sessionId === sessionId);
      } else {
        await shared.taskStore.save(card);
        await reviveMissingEntryAutomations(shared, `w${round}`, "board", sweepOptions({ [sessionId]: history }, new Date(REVIVE_NOW)));
        after = (await shared.taskStore.get(id))?.laneSessions?.find((entry) => entry.sessionId === sessionId);
      }
      const exp = expected(r, knobs, now, resetsAt);
      if (!matches(exp, record, after)) {
        mismatches += 1;
        first ??= JSON.stringify({ round, ...r, eventText: r.eventText.label, historyText: r.historyText.label, exp, after });
      }
    }
    return { mismatches, first };
  }

  it(`seed ${SEED}, ${ROUNDS} rounds: 0 mismatches; both planted errors are caught`, async () => {
    const real = await crossCheck({ fuse: 5, exitTime: false });
    resetWorkflowOrchestrator();
    const plantedExit = await crossCheck({ fuse: 5, exitTime: true });
    resetWorkflowOrchestrator();
    const plantedFuse = await crossCheck({ fuse: 6, exitTime: false });
    console.log(`[F3 28f64f39] seed=${SEED} rounds=${ROUNDS} mismatches=${real.mismatches} plantedExitTime=${plantedExit.mismatches} plantedFuse6=${plantedFuse.mismatches}`);
    console.log(`[F3 28f64f39] first mismatch: ${real.first ?? "none"}`);
    console.log(`[F3 28f64f39] planted exit-time minimal counterexample: ${plantedExit.first}`);
    console.log(`[F3 28f64f39] planted fuse=6 minimal counterexample: ${plantedFuse.first}`);
    expect(real.mismatches).toBe(0);
    expect(plantedExit.mismatches).toBeGreaterThan(0);
    expect(plantedFuse.mismatches).toBeGreaterThan(0);
  }, 300_000);
});
