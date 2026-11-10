// @vitest-environment node
/**
 * 复盘 L401 (card ca2ff7a3): the orchestrator reads the card once when a lane
 * step ends and awaits several things before it saves the card again. A hold
 * label, objective or comment written to the card in that window must survive
 * the save: the next-step start (startNextAutomationStep), the end-of-step
 * save (handleAgentCompletion) and the recovery start save on the card read
 * again, keeping only the finished step's end from the earlier copy.
 *
 * Injection: taskStore.get is wrapped; right before the Nth read of the card
 * after the step end is handed to the orchestrator (N=2: the first read is the
 * one in handleAgentCompletion), a changed card is saved to the store.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerMock, killSessionMock } = vi.hoisted(() => ({
  triggerMock: vi.fn(),
  killSessionMock: vi.fn(async (_sessionId: string) => undefined),
}));

vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerMock,
  getInternalApiOrigin: () => "http://localhost",
}));
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: killSessionMock, hasActiveSession: () => false }),
}));

import { AgentEventType, type AgentEvent } from "../../events/event-bus";
import type { Task, TaskCommentEntry, TaskLaneSession } from "../../models/task";
import { adoptFreshCard } from "../next-step-guard";
import { clearLaneRerunClaims } from "../lane-rerun-claim";
import { processKanbanColumnTransition, resetWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import {
  cleanupSessionCwd,
  createLaneHarness,
  orchestratorOf,
  settle,
  WORKSPACE_ID,
  type LaneHarness,
  type LaneShape,
} from "./lane-interrupt-harness";

const BEFORE: Record<LaneShape, string> = { todo: "backlog", review: "dev", done: "review", dev: "todo" };
const INJECTED_OBJECTIVE = "objective changed while the step ended";
const INJECTED_COMMENT: TaskCommentEntry = { id: "c-injected", body: "comment added while the step ended", createdAt: "2026-11-10T01:00:00.000Z" };

type Orchestrator = {
  handleAgentCompletion(event: AgentEvent): Promise<void>;
  startNextAutomationStep(...args: unknown[]): Promise<string>;
  createSession?: (...args: unknown[]) => Promise<unknown>;
};
const orch = (h: LaneHarness) => orchestratorOf(h) as unknown as Orchestrator;

function endTurn(sessionId: string): AgentEvent {
  return { type: AgentEventType.AGENT_COMPLETED, agentId: sessionId, workspaceId: WORKSPACE_ID, data: { sessionId, success: true, stopReason: "end_turn" }, timestamp: new Date() };
}
function failed(sessionId: string): AgentEvent {
  return { type: AgentEventType.AGENT_FAILED, agentId: sessionId, workspaceId: WORKSPACE_ID, data: { sessionId, success: false, error: "agent crashed" }, timestamp: new Date() };
}

async function enterLane(h: LaneHarness): Promise<string> {
  await processKanbanColumnTransition(h.system, {
    cardId: h.cardId, cardTitle: h.cardId, boardId: h.boardId, workspaceId: WORKSPACE_ID,
    fromColumnId: BEFORE[h.shape], toColumnId: h.shape,
  });
  return h.waitForStep(0);
}

/** Before the `readNo`-th read of the card from now on, save `mutate(card)` to the store (once). */
function injectBeforeRead(h: LaneHarness, mutate: (card: Task) => Task, readNo = 2): { injected: () => boolean; card: () => Task | undefined } {
  const store = h.system.taskStore;
  const original = store.get.bind(store);
  let reads = 0;
  let injectedCard: Task | undefined;
  store.get = async (id: string) => {
    if (id === h.cardId && !injectedCard) {
      reads += 1;
      if (reads === readNo) {
        injectedCard = mutate(structuredClone((await original(id))!));
        await store.save(injectedCard);
      }
    }
    return original(id);
  };
  return { injected: () => Boolean(injectedCard), card: () => injectedCard };
}

/** Save `mutate(card)` while the orchestrator awaits isCompletionSatisfied (after its read, before any save). */
function injectDuringCompletionCheck(h: LaneHarness, mutate: (card: Task) => Task): { injected: () => boolean } {
  const target = orch(h) as unknown as { isCompletionSatisfied(...args: unknown[]): Promise<boolean> };
  const original = target.isCompletionSatisfied.bind(target);
  let injected = false;
  vi.spyOn(target, "isCompletionSatisfied").mockImplementation(async (...args: unknown[]) => {
    if (!injected) {
      injected = true;
      await h.system.taskStore.save(mutate(structuredClone((await h.system.taskStore.get(h.cardId))!)));
    }
    return original(...args);
  });
  return { injected: () => injected };
}

/** A session launch that first saves `mutate(card)` (inside the launch await), then returns `result` or throws. */
function launchThatInjects(h: LaneHarness, mutate: (card: Task) => Task, outcome: { result?: unknown; error?: string }) {
  return async () => {
    await h.system.taskStore.save(mutate(structuredClone((await h.system.taskStore.get(h.cardId))!)));
    if (outcome.error) throw new Error(outcome.error);
    return outcome.result;
  };
}

const withObjectiveAndComment = (card: Task): Task => ({
  ...card,
  objective: INJECTED_OBJECTIVE,
  comment: "legacy comment added while the step ended",
  comments: [...(card.comments ?? []), INJECTED_COMMENT],
});
const withHold = (card: Task): Task => ({ ...card, labels: [...(card.labels ?? []), "hold"] });

function expectInjectedObjectiveAndComment(card: Task): void {
  expect(card.objective).toBe(INJECTED_OBJECTIVE);
  expect(card.comment).toBe("legacy comment added while the step ended");
  expect(card.comments).toContainEqual(INJECTED_COMMENT);
}

function recordStartNext(h: LaneHarness): () => Promise<string[]> {
  const spy = vi.spyOn(orch(h), "startNextAutomationStep");
  return async () => Promise.all(spy.mock.results.map((result) => result.value as Promise<string>));
}

beforeEach(() => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetWorkflowOrchestrator();
  clearLaneRerunClaims();
  triggerMock.mockReset();
  killSessionMock.mockClear();
});

afterEach(() => {
  resetWorkflowOrchestrator();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

afterAll(() => cleanupSessionCwd());

describe("C1 / AC2 / F4-825: objective and comment written while a Todo step ends", () => {
  it("survive the next-step save; the next step starts once", async () => {
    const h = await createLaneHarness("todo", triggerMock);
    const first = await enterLane(h);
    const injection = injectBeforeRead(h, withObjectiveAndComment);
    await orch(h).handleAgentCompletion(endTurn(first));
    await settle();

    expect(injection.injected()).toBe(true);
    expect(triggerMock).toHaveBeenCalledTimes(2);
    expect(h.latestSession(1)).toBeTruthy();
    expectInjectedObjectiveAndComment(await h.card());
  });
});

describe("C3 / AC1: the finished step's end is carried onto the fresh card", () => {
  it("lane record completed once, sessionIds, triggerSessionId, lastSyncError, updatedAt; injected fields kept", async () => {
    const h = await createLaneHarness("todo", triggerMock);
    const first = await enterLane(h);
    const readAtEnd = (await h.card()).updatedAt;
    const injection = injectBeforeRead(h, (card) => withObjectiveAndComment({ ...card, lastSyncError: "older note" }));
    await settle(5);
    await orch(h).handleAgentCompletion(endTurn(first));
    await settle();

    expect(injection.injected()).toBe(true);
    const card = await h.card();
    const records = (card.laneSessions ?? []).filter((entry) => entry.sessionId === first);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("completed");
    expect(card.sessionIds).toContain(first);
    expect(card.triggerSessionId).not.toBe(first);
    expect(card.lastSyncError).toBeUndefined();
    expect(new Date(card.updatedAt).getTime()).toBeGreaterThan(new Date(readAtEnd).getTime());
    expectInjectedObjectiveAndComment(card);
  });
});

describe("C2 / AC3: hold added while a step ends", () => {
  it("Todo: hold stays, step 1 starts no session, nothing failed (startNextAutomationStep returns queued)", async () => {
    const h = await createLaneHarness("todo", triggerMock);
    const first = await enterLane(h);
    const results = recordStartNext(h);
    const injection = injectBeforeRead(h, withHold);
    await orch(h).handleAgentCompletion(endTurn(first));
    await settle();

    expect(injection.injected()).toBe(true);
    expect(await results()).toEqual(["queued"]);
    expect(triggerMock).toHaveBeenCalledTimes(1);
    const card = await h.card();
    expect(card.labels).toContain("hold");
    expect(card.columnId).toBe("todo");
    expect(card.lastSyncError).toBeUndefined();
    expect((card.laneSessions ?? []).find((entry) => entry.sessionId === first)?.status).toBe("completed");
    const automation = orchestratorOf(h).getAutomationForCard(h.cardId);
    expect(automation?.status === "queued" || automation?.status === "running" || automation?.status === "failed").toBe(false);
  });

  it("F4-896: Review last step ends, hold added in the end-of-step window: card moves to Done and Done starts no session", async () => {
    const h = await createLaneHarness("review", triggerMock);
    const board = (await h.system.kanbanBoardStore.get(h.boardId))!;
    board.columns = board.columns.map((column) => column.id === "done"
      ? { ...column, automation: { enabled: true, transitionType: "entry", steps: [{ id: "kanban-main-pusher", providerId: "claude", role: "GATE", specialistId: "kanban-main-pusher", specialistName: "pusher" }] } }
      : column);
    await h.system.kanbanBoardStore.save(board);
    const first = await enterLane(h);
    await orch(h).handleAgentCompletion(endTurn(first));
    const last = await h.waitForStep(1);
    const startsBefore = triggerMock.mock.calls.length;

    const injection = injectDuringCompletionCheck(h, withHold);
    await orch(h).handleAgentCompletion(endTurn(last));
    await vi.waitFor(async () => expect((await h.card()).columnId).toBe("done"), { timeout: 5_000 });
    await settle(80);

    expect(injection.injected()).toBe(true);
    expect(triggerMock.mock.calls.length).toBe(startsBefore);
    const card = await h.card();
    expect(card.labels).toContain("hold");
    expect((card.laneSessions ?? []).filter((entry) => entry.columnId === "done")).toEqual([]);
  });

  it("F4-896: hold and objective written while the step start runs, which then fails (no session id), survive the failure save", async () => {
    const h = await createLaneHarness("todo", triggerMock);
    const first = await enterLane(h);
    const results = recordStartNext(h);
    orch(h).createSession = launchThatInjects(h, (card) => withHold(withObjectiveAndComment(card)), { result: { sessionId: null } });
    await orch(h).handleAgentCompletion(endTurn(first));
    await settle();

    expect(await results()).toEqual(["failed"]);
    const card = await h.card();
    expect(card.labels).toContain("hold");
    expectInjectedObjectiveAndComment(card);
    expect(card.lastSyncError).toBeTruthy();
  });

  it("F4-1354: the step start throws after the hold: hold survives the catch save", async () => {
    const h = await createLaneHarness("todo", triggerMock);
    const first = await enterLane(h);
    const injection = injectBeforeRead(h, withHold);
    orch(h).createSession = async () => { throw new Error("launch exploded"); };
    await orch(h).handleAgentCompletion(endTurn(first));
    await settle();

    expect(injection.injected()).toBe(true);
    const card = await h.card();
    expect(card.labels).toContain("hold");
    expect(card.lastSyncError).toContain("launch exploded");
  });

  it("F4-1354: hold written while the step start runs, which then throws: hold survives the catch save", async () => {
    const h = await createLaneHarness("todo", triggerMock);
    const first = await enterLane(h);
    orch(h).createSession = launchThatInjects(h, withHold, { error: "launch exploded" });
    await orch(h).handleAgentCompletion(endTurn(first));
    await settle();

    const card = await h.card();
    expect(card.labels).toContain("hold");
    expect(card.lastSyncError).toContain("launch exploded");
  });
});

describe("C4: fields the fresh card no longer has are not written back", () => {
  it("removed label and removed optional field stay removed, also through the failure save", async () => {
    for (const startFails of [false, true]) {
      resetWorkflowOrchestrator();
      triggerMock.mockReset();
      const h = await createLaneHarness("todo", triggerMock, { card: { labels: ["foo", "keep"], scope: "old scope" } });
      const first = await enterLane(h);
      if (startFails) orch(h).createSession = async () => ({ sessionId: null });
      const injection = injectBeforeRead(h, (card) => {
        const { scope: _scope, ...rest } = card;
        return { ...rest, labels: ["keep"] } as Task;
      });
      await orch(h).handleAgentCompletion(endTurn(first));
      await settle();

      expect(injection.injected()).toBe(true);
      const card = await h.card();
      expect(card.labels).toEqual(["keep"]);
      expect("scope" in card && card.scope !== undefined).toBe(false);
    }
  });
});

describe("C5: the guard's second read throws", () => {
  it("falls back to the earlier copy: next step starts once, warns, nothing failed", async () => {
    const h = await createLaneHarness("todo", triggerMock);
    const first = await enterLane(h);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = h.system.taskStore;
    const original = store.get.bind(store);
    let reads = 0;
    store.get = async (id: string) => {
      if (id === h.cardId && (reads += 1) === 2) throw new Error("store offline");
      return original(id);
    };
    await expect(orch(h).handleAgentCompletion(endTurn(first))).resolves.toBeUndefined();
    await settle();

    expect(triggerMock).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("[NextStepGuard] Could not read card"))).toBe(true);
    expect(orchestratorOf(h).getAutomationForCard(h.cardId)?.status).toBe("running");
    const card = await h.card();
    expect((card.laneSessions ?? []).find((entry) => entry.sessionId === first)?.status).toBe("completed");
  });
});

describe("F4-852 / F4-1389: fallback start and recovery start", () => {
  it("fallback after a failed step keeps the injected objective and comment", async () => {
    const h = await createLaneHarness("todo", triggerMock, { fallback: true });
    const first = await enterLane(h);
    const results = recordStartNext(h);
    const injection = injectBeforeRead(h, withObjectiveAndComment);
    await orch(h).handleAgentCompletion(failed(first));
    await settle();

    expect(injection.injected()).toBe(true);
    expect(await results()).toEqual(["started"]);
    expect(triggerMock).toHaveBeenCalledTimes(2);
    expectInjectedObjectiveAndComment(await h.card());
  });

  it("Dev recovery (ralph_loop) keeps the objective and comment written while the step ended", async () => {
    const h = await createLaneHarness("dev", triggerMock);
    const first = await enterLane(h);
    const injection = injectDuringCompletionCheck(h, withObjectiveAndComment);
    await orch(h).handleAgentCompletion(failed(first));
    await settle();

    expect(injection.injected()).toBe(true);
    await vi.waitFor(() => expect(triggerMock).toHaveBeenCalledTimes(2));
    const card = await h.card();
    expectInjectedObjectiveAndComment(card);
    // Dev has a single step: the second launch is the recovery of step 0.
    expect((triggerMock.mock.calls[1][0] as { stepIndex?: number }).stepIndex ?? 0).toBe(0);
    expect(orchestratorOf(h).getAutomationForCard(h.cardId)?.attempt).toBe(2);
  });

  it("F4-1426: hold written while the recovery start runs, which then throws: hold survives the catch save", async () => {
    const h = await createLaneHarness("dev", triggerMock);
    const first = await enterLane(h);
    orch(h).createSession = launchThatInjects(h, withHold, { error: "recovery launch exploded" });
    await orch(h).handleAgentCompletion(failed(first));
    await settle();

    const card = await h.card();
    expect(card.labels).toContain("hold");
    expect(card.lastSyncError).toContain("recovery launch exploded");
  });
});

describe("F2: without injection every lane starts its next step as before", () => {
  it.each(["todo", "review", "done"] as const)("%s: step 1 starts once; finished record, sessionIds, trigger, lastSyncError", async (shape) => {
    const h = await createLaneHarness(shape, triggerMock);
    const first = await enterLane(h);
    await orch(h).handleAgentCompletion(endTurn(first));
    const second = await h.waitForStep(1);
    await settle();

    expect(triggerMock).toHaveBeenCalledTimes(2);
    const card = await h.card();
    expect(card.columnId).toBe(shape);
    expect((card.laneSessions ?? []).filter((entry) => entry.sessionId === first).map((entry) => entry.status)).toEqual(["completed"]);
    expect((card.laneSessions ?? []).find((entry) => entry.sessionId === second)?.status).toBe("running");
    expect(card.sessionIds).toContain(first);
    expect(card.triggerSessionId).toBe(second);
    expect(card.lastSyncError).toBeUndefined();
    expect(card.objective).toBe(`Lane ${shape} interrupted`);
  });
});

// ---------------------------------------------------------------------------
// F3: random cross-check of the pure merge, judged from AC1 (not "same as before").

// laneHandoffs / jitContextSnapshot: lane bookkeeping upsertTaskLaneSession keeps
// in step with the lane records (an empty handoff list, the lane experience).
const CARRIED = new Set(["sessionIds", "triggerSessionId", "lastSyncError", "updatedAt", "laneSessions", "laneHandoffs", "jitContextSnapshot"]);

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function randomCard(rand: () => number, sessions: string[]): Task {
  const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
  const card: Record<string, unknown> = {
    id: "card", title: pick(["a", "b"]), objective: pick(["o1", "o2", "o3"]), comments: rand() < 0.5 ? [] : [{ id: pick(["c1", "c2"]), body: "x", createdAt: "t" }],
    columnId: pick(["todo", "dev", "review"]), status: "PENDING", workspaceId: "w",
    sessionIds: sessions.filter(() => rand() < 0.5), dependencies: [],
    createdAt: new Date(0), updatedAt: new Date(Math.floor(rand() * 1e9)),
  };
  if (rand() < 0.6) card.labels = sessions.length && rand() < 0.5 ? ["hold"] : [pick(["foo", "bar"])];
  if (rand() < 0.5) card.scope = pick(["s1", "s2"]);
  if (rand() < 0.5) card.triggerSessionId = pick(sessions);
  if (rand() < 0.5) card.lastSyncError = pick(["e1", "e2"]);
  if (rand() < 0.4) card.comment = pick(["legacy1", "legacy2"]);
  card.laneSessions = sessions.filter(() => rand() < 0.6).map((sessionId): TaskLaneSession => ({
    sessionId, columnId: "todo", stepIndex: 0, status: pick(["running", "completed", "failed"]), startedAt: "t",
  }));
  return card as unknown as Task;
}

type Merge = (task: Task, fresh: Task, finished: string | undefined, lastSyncError: string | undefined, now: Date) => void;

/** Independent judge from AC1; returns the first violation or undefined. */
function judge(stale: Task, fresh: Task, result: Task, finished: string | undefined, lastSyncError: string | undefined, now: Date): string | undefined {
  const freshKeys = new Set(Object.keys(fresh));
  for (const key of Object.keys(result)) {
    if (!freshKeys.has(key) && !CARRIED.has(key)) return `extra key ${key}`;
  }
  for (const key of freshKeys) {
    if (CARRIED.has(key)) continue;
    if (JSON.stringify((result as never)[key]) !== JSON.stringify((fresh as never)[key])) return `field ${key} not taken from the fresh card`;
  }
  const expectedHandoffs = fresh.laneHandoffs ?? (finished && stale.laneSessions?.some((entry) => entry.sessionId === finished) ? [] : undefined);
  if (JSON.stringify(result.laneHandoffs) !== JSON.stringify(expectedHandoffs)) return "laneHandoffs";
  if (result.lastSyncError !== lastSyncError) return "lastSyncError";
  if (result.updatedAt !== now) return "updatedAt";
  const expectedIds = [...(fresh.sessionIds ?? [])];
  if (finished && !expectedIds.includes(finished)) expectedIds.push(finished);
  if (JSON.stringify(result.sessionIds ?? []) !== JSON.stringify(expectedIds)) return "sessionIds";
  const expectedTrigger = finished && fresh.triggerSessionId === finished ? undefined : fresh.triggerSessionId;
  if (result.triggerSessionId !== expectedTrigger) return "triggerSessionId";
  const staleRecord = finished ? stale.laneSessions?.find((entry) => entry.sessionId === finished) : undefined;
  for (const record of fresh.laneSessions ?? []) {
    if (record.sessionId === staleRecord?.sessionId) continue;
    const kept = result.laneSessions?.filter((entry) => entry.sessionId === record.sessionId) ?? [];
    if (kept.length !== 1 || kept[0].status !== record.status) return `lane record ${record.sessionId} of the fresh card`;
  }
  if (staleRecord) {
    const carried = result.laneSessions?.filter((entry) => entry.sessionId === staleRecord.sessionId) ?? [];
    if (carried.length !== 1 || carried[0].status !== staleRecord.status) return "finished lane record";
  }
  return undefined;
}

function crossCheck(merge: Merge, runs: number, seed: number): { checked: number; failures: string[] } {
  const rand = rng(seed);
  const failures: string[] = [];
  for (let index = 0; index < runs; index += 1) {
    const sessions = ["s1", "s2", "s3"].slice(0, 1 + Math.floor(rand() * 3));
    const stale = randomCard(rand, sessions);
    const fresh = randomCard(rand, sessions);
    const finished = rand() < 0.9 ? sessions[Math.floor(rand() * sessions.length)] : undefined;
    const lastSyncError = rand() < 0.5 ? undefined : "kept error";
    const now = new Date(2e12 + index);
    const staleCopy = structuredClone(stale);
    const freshCopy = structuredClone(fresh);
    const task = structuredClone(stale);
    merge(task, structuredClone(fresh), finished, lastSyncError, now);
    const violation = judge(staleCopy, freshCopy, task, finished, lastSyncError, now);
    if (violation) failures.push(`#${index}: ${violation}`);
  }
  return { checked: runs, failures };
}

describe("F3: random cross-check of adoptFreshCard (10,000 pairs)", () => {
  it("the judge catches a planted error (objective taken from the earlier copy)", () => {
    const planted: Merge = (task, fresh, finished, lastSyncError, now) => {
      const staleObjective = task.objective;
      adoptFreshCard(task, fresh, finished, lastSyncError, now);
      task.objective = staleObjective;
    };
    expect(crossCheck(planted, 2_000, 7).failures.length).toBeGreaterThan(0);
  });

  it("the judge catches a merge that keeps keys the fresh card does not have", () => {
    const planted: Merge = (task, fresh, finished, lastSyncError, now) => {
      const old = { ...task };
      adoptFreshCard(task, fresh, finished, lastSyncError, now);
      Object.assign(task, { ...old, ...task });
    };
    expect(crossCheck(planted, 2_000, 11).failures.length).toBeGreaterThan(0);
  });

  it("adoptFreshCard passes every pair", () => {
    const { checked, failures } = crossCheck((task, fresh, finished, lastSyncError, now) => adoptFreshCard(task, fresh, finished, lastSyncError, now), 10_000, 20261110);
    expect(checked).toBe(10_000);
    expect(failures.slice(0, 5)).toEqual([]);
  });
});
