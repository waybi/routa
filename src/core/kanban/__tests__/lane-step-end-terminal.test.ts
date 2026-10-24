// @vitest-environment node
/**
 * Card 6d8365ca (复盘 L189): a lane step's record must leave "running" in the
 * same end-of-step handling that sees the session end, also on the paths the
 * orchestrator skips (card ended by the user, teardown of a finished card, an
 * automation that already ended, a session it does not follow). Before, the
 * Done pusher and reporter of 25afcd82, e11cac2f and 497ae435 finished, yet
 * their lane records stayed "running" until the next restart swept them.
 *
 * Every case drives the real orchestrator singleton (real in-memory stores and
 * session queue); only the agent launch and the process manager are faked.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock, killSessionMock, reviveSpy, sweepSpy } = vi.hoisted(() => ({
  triggerAssignedTaskAgentMock: vi.fn(),
  killSessionMock: vi.fn(async (_sessionId: string) => undefined),
  reviveSpy: vi.fn(),
  sweepSpy: vi.fn(),
}));

vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));
vi.mock("../../acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: killSessionMock, hasActiveSession: () => false }),
}));
vi.mock("../restart-recovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../restart-recovery")>();
  return {
    ...actual,
    reviveMissingEntryAutomations: (...args: Parameters<typeof actual.reviveMissingEntryAutomations>) => {
      reviveSpy();
      return actual.reviveMissingEntryAutomations(...args);
    },
    endStaleRunningLaneSessions: (...args: Parameters<typeof actual.endStaleRunningLaneSessions>) => {
      sweepSpy();
      return actual.endStaleRunningLaneSessions(...args);
    },
  };
});

import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType, type AgentEvent } from "../../events/event-bus";
import type { Task } from "../../models/task";
import { resetWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import { upsertTaskLaneSession } from "../task-lane-history";
import { createTask } from "../../models/task";
import { InMemoryTaskStore } from "../../store/task-store";
import { endLaneRecordByOutcome, settleEndedLaneSession, type LiveSessionHistory } from "../lane-session-settlement";
import {
  cleanupSessionCwd,
  createLaneHarness,
  orchestratorOf,
  runToInterruptedStep,
  sessionCwd,
  settle,
  stepSpecialistId,
  WORKSPACE_ID,
  type LaneHarness,
} from "./lane-interrupt-harness";

type LaneRecord = NonNullable<Task["laneSessions"]>[number];

beforeEach(() => {
  resetWorkflowOrchestrator();
  triggerAssignedTaskAgentMock.mockReset();
  killSessionMock.mockClear();
  reviveSpy.mockClear();
  sweepSpy.mockClear();
});

afterEach(() => {
  resetWorkflowOrchestrator();
});

afterAll(() => {
  cleanupSessionCwd();
});

function endEvent(type: AgentEventType, sessionId: string, data: Record<string, unknown> = {}): AgentEvent {
  return { type, agentId: sessionId, workspaceId: WORKSPACE_ID, data: { sessionId, ...data }, timestamp: new Date() };
}

const EVENTS = {
  end_turn: (id: string) => endEvent(AgentEventType.AGENT_COMPLETED, id, { success: true, stopReason: "end_turn" }),
  cancelled: (id: string) => endEvent(AgentEventType.AGENT_COMPLETED, id, { success: false, stopReason: "cancelled" }),
  agent_failed: (id: string) => endEvent(AgentEventType.AGENT_FAILED, id, { success: false, error: "turn failed: usage_limit_reached" }),
  timeout: (id: string) => endEvent(AgentEventType.AGENT_TIMEOUT, id, { success: false, error: "No ACP activity for 20 minutes." }),
  exit_0: (id: string) => endEvent(AgentEventType.AGENT_FAILED, id, {
    success: false,
    error: "DeepSeek Harness process exited unexpectedly (code=0, signal=null)",
  }),
};

/** One end-of-step handling, awaited: what the orchestrator does when this event arrives. */
async function handleEnd(h: LaneHarness, event: AgentEvent): Promise<void> {
  const orchestrator = orchestratorOf(h) as unknown as { handleAgentCompletion(event: AgentEvent): Promise<void> };
  await orchestrator.handleAgentCompletion(event);
}

/** The session store's own record of how the turn ended (persisted history), without raising events. */
function recordTurnEnd(sessionId: string, stopReason: "end_turn" | "cancelled"): void {
  const store = getHttpSessionStore();
  if (!store.getSession(sessionId)) {
    store.upsertSession({ sessionId, cwd: sessionCwd(), workspaceId: WORKSPACE_ID, provider: "dsh", createdAt: new Date().toISOString() });
  }
  store.pushNotificationToHistory(sessionId, { sessionId, update: { sessionUpdate: "turn_complete", stopReason } });
}

function spyOnProgress(h: LaneHarness) {
  const orchestrator = orchestratorOf(h) as never as Record<string, (...args: unknown[]) => unknown>;
  return {
    nextStep: vi.spyOn(orchestrator, "startNextAutomationStep"),
    recover: vi.spyOn(orchestrator, "recoverAutomation"),
    starts: () => triggerAssignedTaskAgentMock.mock.calls.length,
    kills: () => killSessionMock.mock.calls.length,
  };
}

/** The automation is gone as after its 30 s cleanup (or the run was never adopted); not a user action. */
function dropAutomation(h: LaneHarness): void {
  (orchestratorOf(h) as unknown as { activeAutomations: Map<string, unknown> }).activeAutomations.delete(h.cardId);
}

async function laneRecord(h: LaneHarness, sessionId: string): Promise<LaneRecord | undefined> {
  return h.laneRecord(sessionId);
}

/** A running lane record for `sessionId` on the harness card, written like the session start does. */
async function addRunningRecord(h: LaneHarness, sessionId: string, stepIndex: number): Promise<void> {
  const card = await h.card();
  upsertTaskLaneSession(card, {
    sessionId,
    columnId: h.shape,
    stepIndex,
    stepName: stepSpecialistId(h.shape, stepIndex),
    role: "GATE",
    status: "running",
  });
  await h.system.taskStore.save(card);
}

describe("C1 / S1: a step that ends with end_turn is completed in the same handling", () => {
  it("S1 dev lane, tracked step: completed with completedAt when handleAgentCompletion returns", async () => {
    const h = await createLaneHarness("dev", triggerAssignedTaskAgentMock);
    const sessionId = await runToInterruptedStep(h);
    expect((await laneRecord(h, sessionId))?.status).toBe("running");

    await handleEnd(h, EVENTS.end_turn(sessionId));

    const record = await laneRecord(h, sessionId);
    expect(record?.status).toBe("completed");
    expect(record?.completedAt).toEqual(expect.any(String));
    expect(reviveSpy).not.toHaveBeenCalled();
    expect(sweepSpy).not.toHaveBeenCalled();
  });
});

describe("C2 / S2, S5: a tracked step that fails or times out is ended in the same handling", () => {
  it("S2 AGENT_FAILED: failed, completedAt, recoveryReason", async () => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const sessionId = await runToInterruptedStep(h);

    await handleEnd(h, EVENTS.agent_failed(sessionId));

    const record = await laneRecord(h, sessionId);
    expect(record).toMatchObject({ status: "failed", completedAt: expect.any(String) });
    expect(record?.recoveryReason).toBeTruthy();
  });

  it("S5 AGENT_TIMEOUT: timed_out with completedAt", async () => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const sessionId = await runToInterruptedStep(h);

    await handleEnd(h, EVENTS.timeout(sessionId));

    expect(await laneRecord(h, sessionId)).toMatchObject({ status: "timed_out", completedAt: expect.any(String) });
  });
});

describe("C3 / S6: the agent process exits with code 0 and no turn end was handled", () => {
  it.each([
    { label: "S6a tracked, history has turn_complete(end_turn)", tracked: true, history: true },
    { label: "S6a untracked, history has turn_complete(end_turn)", tracked: false, history: true },
    { label: "S6b tracked, no turn end in history", tracked: true, history: false },
    { label: "S6b untracked, no turn end in history", tracked: false, history: false },
  ])("$label", async ({ tracked, history }) => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const sessionId = await runToInterruptedStep(h);
    if (!tracked) dropAutomation(h);
    if (history) recordTurnEnd(sessionId, "end_turn");

    await handleEnd(h, EVENTS.exit_0(sessionId));

    const record = await laneRecord(h, sessionId);
    expect(record?.completedAt).toEqual(expect.any(String));
    if (history) {
      expect(record?.status).toBe("completed");
      expect(record?.recoveryReason).toBeUndefined();
    } else {
      expect(record?.status).toBe("failed");
      expect(record?.recoveryReason).toBeTruthy();
    }
  });
});

describe("C4 / S7: Done lane pusher then reporter", () => {
  it("S7 both steps completed with completedAt, reporter started once, late pusher event changes nothing", async () => {
    const h = await createLaneHarness("done", triggerAssignedTaskAgentMock);
    const pusher = await runToInterruptedStep(h);

    await handleEnd(h, EVENTS.end_turn(pusher));
    const afterPusher = (await h.card()).laneSessions ?? [];
    expect(afterPusher.find((entry) => entry.sessionId === pusher)).toMatchObject({ status: "completed", completedAt: expect.any(String) });
    const reporterRecord = afterPusher.find((entry) => entry.stepIndex === 1);
    expect(reporterRecord).toMatchObject({ status: "running", columnId: "done" });
    const reporter = reporterRecord!.sessionId;

    await handleEnd(h, EVENTS.end_turn(reporter));
    const pusherCompletedAt = (await laneRecord(h, pusher))?.completedAt;

    await handleEnd(h, EVENTS.end_turn(pusher));
    await settle();

    const lane = (await h.card()).laneSessions ?? [];
    const doneLane = lane.filter((entry) => entry.columnId === "done");
    expect(doneLane).toHaveLength(2);
    expect(doneLane.map((entry) => entry.status)).toEqual(["completed", "completed"]);
    expect(doneLane.every((entry) => typeof entry.completedAt === "string")).toBe(true);
    expect(lane.filter((entry) => entry.status === "running")).toEqual([]);
    expect((await laneRecord(h, pusher))?.completedAt).toBe(pusherCompletedAt);
    const reporterStarts = triggerAssignedTaskAgentMock.mock.calls
      .filter(([params]) => (params as { step?: { specialistId?: string } }).step?.specialistId === stepSpecialistId("done", 1));
    expect(reporterStarts).toHaveLength(1);
  });
});

/**
 * Skip paths: the record is settled, nothing else happens (no step, kill,
 * fallback or recovery). A user-ended or torn-down session is never "failed":
 * revive would re-run a finished card's step (3054a54f).
 */
describe("C5 / S8–S11: skip paths still settle the record and only the record", () => {
  type Kind = keyof typeof EVENTS;
  const EXPECTED: Record<Exclude<Kind, "exit_0">, { status: LaneRecord["status"]; reason?: string }> = {
    end_turn: { status: "completed" },
    cancelled: { status: "failed", reason: "turn_cancelled" },
    agent_failed: { status: "failed", reason: "agent_failed" },
    timeout: { status: "timed_out" },
  };

  async function expectSettledOnly(
    h: LaneHarness,
    sessionId: string,
    event: AgentEvent,
    expected: { status: LaneRecord["status"]; reason?: string },
    secondEvents: Array<(id: string) => AgentEvent> = [EVENTS.agent_failed, EVENTS.end_turn],
  ) {
    const spies = spyOnProgress(h);
    const startsBefore = spies.starts();
    const killsBefore = spies.kills();

    await handleEnd(h, event);

    const record = await laneRecord(h, sessionId);
    expect(record?.status).toBe(expected.status);
    expect(record?.completedAt).toEqual(expect.any(String));
    if (expected.reason) expect(record?.recoveryReason).toBe(expected.reason);
    if (expected.status === "completed" || expected.status === "transitioned") expect(record?.recoveryReason).toBeUndefined();
    expect(spies.starts()).toBe(startsBefore);
    expect(spies.kills()).toBe(killsBefore);
    expect(spies.nextStep).not.toHaveBeenCalled();
    expect(spies.recover).not.toHaveBeenCalled();

    // A second end event of the same session changes nothing.
    const settled = await laneRecord(h, sessionId);
    for (const next of secondEvents) await handleEnd(h, next(sessionId));
    expect(await laneRecord(h, sessionId)).toEqual(settled);
  }

  it.each([
    { history: true, expected: "completed" as const },
    { history: false, expected: "transitioned" as const },
  ])("S8 card ended by the user (cardEndedSessionIds), end_turn in history=$history → $expected", async ({ history, expected }) => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const sessionId = await runToInterruptedStep(h);
    (orchestratorOf(h) as unknown as { cardEndedSessionIds: Set<string> }).cardEndedSessionIds.add(sessionId);
    if (history) recordTurnEnd(sessionId, "end_turn");

    await expectSettledOnly(h, sessionId, EVENTS.agent_failed(sessionId), { status: expected });
  });

  it.each([
    { history: true, expected: "completed" as const },
    { history: false, expected: "transitioned" as const },
  ])("S9 teardown failure of a finished card, end_turn in history=$history → $expected", async ({ history, expected }) => {
    const h = await createLaneHarness("done", triggerAssignedTaskAgentMock);
    const pusher = await runToInterruptedStep(h);
    (orchestratorOf(h) as unknown as { teardownSessionIds: Set<string> }).teardownSessionIds.add(pusher);
    if (history) recordTurnEnd(pusher, "end_turn");

    // Only failures are teardown here; a success event would be the live step's own end.
    await expectSettledOnly(h, pusher, EVENTS.agent_failed(pusher), { status: expected }, [EVENTS.agent_failed, EVENTS.timeout]);
  });

  const kinds = Object.keys(EXPECTED) as Array<Exclude<Kind, "exit_0">>;

  it.each(kinds)("S10 automation already ended, then %s", async (kind) => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const sessionId = await runToInterruptedStep(h);
    const automation = orchestratorOf(h).getAutomationForCard(h.cardId)!;
    automation.status = "completed";

    await expectSettledOnly(h, sessionId, EVENTS[kind](sessionId), EXPECTED[kind]);
  });

  it.each(kinds)("S10 automation dropped after its 30 s cleanup, then a late %s", async (kind) => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const sessionId = await runToInterruptedStep(h);
    dropAutomation(h);

    await expectSettledOnly(h, sessionId, EVENTS[kind](sessionId), EXPECTED[kind]);
  });

  it.each(kinds)("S11 a session the automation does not follow (earlier run of the card), then %s", async (kind) => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const current = await runToInterruptedStep(h);
    const stray = `${h.cardId}:stray`;
    await addRunningRecord(h, stray, 0);

    await expectSettledOnly(h, stray, EVENTS[kind](stray), EXPECTED[kind]);
    // The step the orchestrator follows is untouched.
    expect((await laneRecord(h, current))?.status).toBe("running");
    expect(orchestratorOf(h).getAutomationForCard(h.cardId)?.sessionId).toBe(current);
  });
});

/**
 * Card f2b2621a (replay of 6d8365ca onto 79804de2): settling an ended session
 * never rewrites a record that already ended. A rate-limited failure keeps its
 * recoveryReason and retryAfterAt, so revive still waits for retryAfterAt.
 */
describe("f2b2621a C2 / AC5: settlement keeps a rate_limited record as it is", () => {
  const RETRY_AT = "2099-01-01T00:10:00.000Z";
  const noHistory: LiveSessionHistory = { getHistory: () => [], getSessionActivity: () => undefined };

  async function storeWith(record: Partial<LaneRecord>): Promise<{ store: InMemoryTaskStore; id: string }> {
    const store = new InMemoryTaskStore();
    const task = createTask({ id: "card-ac5", title: "AC5", objective: "AC5", workspaceId: WORKSPACE_ID, columnId: "review" });
    upsertTaskLaneSession(task, { sessionId: "s-ac5", columnId: "review", stepIndex: 0, ...record });
    await store.save(task);
    return { store, id: task.id };
  }

  async function settleThreeWays(store: InMemoryTaskStore, id: string): Promise<LaneRecord | undefined> {
    for (const mode of ["event", "teardown"] as const) {
      await settleEndedLaneSession({ taskStore: store, sessions: noHistory, event: EVENTS.agent_failed("s-ac5"), mode, cardId: id });
    }
    const task = (await store.get(id))!;
    endLaneRecordByOutcome(task, "s-ac5", { kind: "failed", reason: "agent_failed" });
    await store.save(task);
    return (await store.get(id))?.laneSessions?.find((entry) => entry.sessionId === "s-ac5");
  }

  it("failed + rate_limited + retryAfterAt stays failed + rate_limited + the same retryAfterAt", async () => {
    const { store, id } = await storeWith({ status: "failed", recoveryReason: "rate_limited", retryAfterAt: RETRY_AT });
    const record = await settleThreeWays(store, id);
    expect(record?.status).toBe("failed");
    expect(record?.recoveryReason).toBe("rate_limited");
    expect(record?.retryAfterAt).toBe(RETRY_AT);
  });

  it("control: the same calls on a running record end it", async () => {
    const { store, id } = await storeWith({ status: "running" });
    const record = await settleThreeWays(store, id);
    expect(record?.status).not.toBe("running");
    expect(record?.status).toBe("failed");
    expect(record?.recoveryReason).toBe("agent_failed");
  });
});

/**
 * F3 batch cross-check (seeded): random existing records × settlement calls,
 * judged by the requirement itself: an ended record is unchanged field by
 * field; a running record ends with the status the call stands for.
 */
describe("f2b2621a F3: settlement batch cross-check", () => {
  const SEED = 20261024;
  const ROUNDS = 10_000;
  const STATUSES = ["running", "completed", "failed"] as const;
  const REASONS = [undefined, "agent_failed", "environment_failure", "rate_limited", "turn_cancelled", "restart_interrupted"] as const;
  const CALLS = ["event_completed", "event_failed", "teardown", "outcome_completed", "outcome_failed"] as const;
  type Call = typeof CALLS[number];
  type Judge = (before: LaneRecord, after: LaneRecord, call: Call, turnEnded: boolean) => boolean;

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

  const expectedEnd = (call: Call, turnEnded: boolean): { status: string; reason?: string } => {
    if (call === "event_completed" || call === "outcome_completed") return { status: "completed" };
    if (call === "teardown") return { status: turnEnded ? "completed" : "transitioned" };
    // A failure event of a session whose turn really ended is that turn's end (the real outcome wins).
    if (call === "event_failed" && turnEnded) return { status: "completed" };
    return { status: "failed", reason: "agent_failed" };
  };

  const judge: Judge = (before, after, call, turnEnded) => {
    if (before.status !== "running") return JSON.stringify(after) === JSON.stringify(before);
    const end = expectedEnd(call, turnEnded);
    return after.status === end.status && (!end.reason || after.recoveryReason === end.reason);
  };
  // Planted error: "an ended record is rewritten too" must be caught.
  const plantedJudge: Judge = (_before, after, call, turnEnded) => after.status === expectedEnd(call, turnEnded).status;

  async function crossCheck(check: Judge): Promise<number> {
    const next = rng(SEED);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
    const store = new InMemoryTaskStore();
    let mismatches = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const status = pick(STATUSES);
      const reason = pick(REASONS);
      const retry = pick([undefined, "2000-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"] as const);
      const call = pick(CALLS);
      const turnEnded = next() < 0.5;
      const sessionId = `s-${round}`;
      const task = createTask({ id: `card-${round}`, title: "F3", objective: "F3", workspaceId: WORKSPACE_ID, columnId: "review" });
      upsertTaskLaneSession(task, { sessionId, columnId: "review", stepIndex: 0, status, recoveryReason: reason, retryAfterAt: retry });
      if (status !== "running") task.laneSessions![0].completedAt = "2001-01-01T00:00:00.000Z";
      await store.save(task);
      const before = structuredClone((await store.get(task.id))!.laneSessions![0]);
      const history = turnEnded ? [{ update: { sessionUpdate: "turn_complete", stopReason: "end_turn" } }] : [];
      const sessions: LiveSessionHistory = { getHistory: () => history, getSessionActivity: () => undefined };
      if (call.startsWith("outcome_")) {
        const saved = (await store.get(task.id))!;
        endLaneRecordByOutcome(saved, sessionId, call === "outcome_completed"
          ? { kind: "completed" }
          : { kind: "failed", reason: "agent_failed" });
        await store.save(saved);
      } else {
        const event = call === "event_completed" ? EVENTS.end_turn(sessionId) : EVENTS.agent_failed(sessionId);
        const mode = call === "teardown" ? "teardown" : "event";
        await settleEndedLaneSession({ taskStore: store, sessions, event, mode, cardId: task.id });
      }
      const after = (await store.get(task.id))!.laneSessions![0];
      if (!check(before, after, call, turnEnded)) mismatches += 1;
    }
    return mismatches;
  }

  it(`seed ${SEED}, ${ROUNDS} rounds: 0 mismatches; the planted judge is caught`, async () => {
    const mismatches = await crossCheck(judge);
    const planted = await crossCheck(plantedJudge);
    console.log(`[F3 settlement] seed=${SEED} rounds=${ROUNDS} mismatches=${mismatches} plantedMismatches=${planted}`);
    expect(mismatches).toBe(0);
    expect(planted).toBeGreaterThan(0);
  }, 120_000);
});
