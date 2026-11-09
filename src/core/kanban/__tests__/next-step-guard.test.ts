// @vitest-environment node
/**
 * 复盘 L395 (card 9a2ef285): before a lane starts its next step in the same
 * column, the card is read again. The step is skipped when the card already
 * left the column (a reviewer moved it back to dev) or another live session
 * runs on the card. A lane session that ends within 30 s without any output
 * leaves a one-line exit reason on the card.
 *
 * Integration cases drive the real orchestrator singleton (in-memory stores
 * and session queue); only the agent launch and the process manager are faked.
 * The card move happens inside startNextAutomationStep's caller window: after
 * the completion handling read the card, before the next step is opened.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock, killSessionMock, liveSessions } = vi.hoisted(() => ({
  triggerAssignedTaskAgentMock: vi.fn(),
  killSessionMock: vi.fn(async (_sessionId: string) => undefined),
  liveSessions: new Set<string>(),
}));

vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));
vi.mock("../../acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: killSessionMock, hasActiveSession: (id: string) => liveSessions.has(id) }),
}));

import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType } from "../../events/event-bus";
import type { Task } from "../../models/task";
import { getKanbanSessionQueue, processKanbanColumnTransition, resetWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import { upsertTaskLaneSession } from "../task-lane-history";
import {
  buildQuickExitNote,
  decideNextStep,
  isQuickEmptyExit,
  QUICK_EXIT_MAX_SECONDS,
  type QuickExitSessionSource,
} from "../next-step-guard";
import {
  cleanupSessionCwd,
  createLaneHarness,
  emitAgentEvent,
  orchestratorOf,
  sessionCwd,
  settle,
  WORKSPACE_ID,
  type LaneHarness,
  type LaneShape,
} from "./lane-interrupt-harness";

const WAIT = { timeout: 5_000, interval: 25 };
const FALLBACK_STEP = 1;

beforeEach(() => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetWorkflowOrchestrator();
  triggerAssignedTaskAgentMock.mockReset();
  killSessionMock.mockClear();
  liveSessions.clear();
});

afterEach(() => {
  resetWorkflowOrchestrator();
  vi.unstubAllEnvs();
});

afterAll(() => {
  cleanupSessionCwd();
});

const BEFORE: Record<LaneShape, string> = { todo: "backlog", review: "dev", done: "review", dev: "todo" };

async function enterLane(h: LaneHarness): Promise<string> {
  await processKanbanColumnTransition(h.system, {
    cardId: h.cardId,
    cardTitle: `Card ${h.shape}`,
    boardId: h.boardId,
    workspaceId: WORKSPACE_ID,
    fromColumnId: BEFORE[h.shape],
    toColumnId: h.shape,
    fromColumnName: BEFORE[h.shape],
    toColumnName: h.shape,
  });
  return h.waitForStep(0);
}

/** The session store knows the session, as for every real lane session. */
function registerSession(sessionId: string): void {
  const store = getHttpSessionStore();
  if (!store.getSession(sessionId)) {
    store.upsertSession({ sessionId, cwd: sessionCwd(), workspaceId: WORKSPACE_ID, provider: "dsh", createdAt: new Date().toISOString() });
  }
}

/** The agent wrote something in this session (so it is not an empty exit). */
function recordOutput(sessionId: string, kind = "agent_message"): void {
  const store = getHttpSessionStore();
  registerSession(sessionId);
  store.pushNotificationToHistory(sessionId, { sessionId, update: { sessionUpdate: kind, content: { type: "text", text: "working" } } });
}

const starts = (h: LaneHarness, stepIndex: number) => h.sessionsByStep.get(stepIndex)?.length ?? 0;

/** Run `beforeStart` right before the orchestrator opens the next step (after the completion read the card). */
function hookNextStep(h: LaneHarness, beforeStart: () => Promise<void>) {
  const orchestrator = orchestratorOf(h) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const original = orchestrator.startNextAutomationStep.bind(orchestrator);
  return vi.spyOn(orchestrator, "startNextAutomationStep").mockImplementation(async (...args: unknown[]) => {
    await beforeStart();
    return original(...args);
  });
}

/** Simulates a reviewer moving the card to `columnId` without the orchestrator seeing a transition yet. */
async function moveCardSilently(h: LaneHarness, columnId: string): Promise<void> {
  const card = await h.card();
  await h.system.taskStore.save({ ...card, columnId });
}

async function addRunningRecord(h: LaneHarness, sessionId: string, columnId: string): Promise<void> {
  const card = await h.card();
  upsertTaskLaneSession(card, { sessionId, columnId, stepIndex: 0, stepName: "other", role: "CRAFTER", status: "running" });
  await h.system.taskStore.save(card);
}

function endTurn(h: LaneHarness, sessionId: string): void {
  emitAgentEvent(h.system, AgentEventType.AGENT_COMPLETED, sessionId, { success: true, stopReason: "end_turn" });
}

function failTurn(h: LaneHarness, sessionId: string): void {
  emitAgentEvent(h.system, AgentEventType.AGENT_FAILED, sessionId, { success: false, error: "turn failed: boom" });
}

/** Wait until the step ended and the orchestrator either started step `next` or recorded a skip. */
async function waitForOutcome(h: LaneHarness, sessionId: string, next: number): Promise<void> {
  await vi.waitFor(async () => {
    const record = await h.laneRecord(sessionId);
    if (!record || record.status === "running") throw new Error("still running");
    const card = await h.card().catch(() => undefined);
    if (starts(h, next) === 0 && !card?.lastSyncError?.includes("跳过")) throw new Error("no outcome yet");
  }, WAIT);
  await settle(60);
}

function automationOf(h: LaneHarness): { status: string } | undefined {
  return (orchestratorOf(h) as unknown as { activeAutomations: Map<string, { status: string }> }).activeAutomations.get(h.cardId);
}

describe("C1 / AC1: the card left the column before the next step starts", () => {
  it("todo: no step 1 session, step 0 stays completed, card stays in dev, reason written", async () => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    recordOutput(s0);
    hookNextStep(h, () => moveCardSilently(h, "dev"));

    endTurn(h, s0);
    await waitForOutcome(h, s0, 1);

    const card = await h.card();
    expect(starts(h, 1)).toBe(0);
    expect(card.columnId).toBe("dev");
    expect(card.lastSyncError).toContain("跳过：卡已离开 todo");
    expect(card.laneSessions?.filter((entry) => entry.stepIndex === 1)).toEqual([]);
    expect((await h.laneRecord(s0))?.status).toBe("completed");
  });
});

describe("C2 / AC2: another live session runs on the card", () => {
  it.each([
    { label: "dev builder session", column: "dev" },
    { label: "session in the same column", column: "todo" },
  ])("$label: no step 1 session, reason names that session", async ({ column }) => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    recordOutput(s0);
    const liveId = `live-${column}-builder`;
    await addRunningRecord(h, liveId, column);
    liveSessions.add(liveId);

    endTurn(h, s0);
    await waitForOutcome(h, s0, 1);

    expect(starts(h, 1)).toBe(0);
    expect((await h.card()).lastSyncError).toContain(`跳过：已有会话 ${liveId} 在跑`);
  });
});

describe("C3: zombies and the finished session itself do not block", () => {
  it("a running record whose process is dead: step 1 starts", async () => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    recordOutput(s0);
    await addRunningRecord(h, "zombie-dev", "dev");

    endTurn(h, s0);
    await waitForOutcome(h, s0, 1);

    expect(starts(h, 1)).toBe(1);
    expect((await h.card()).lastSyncError ?? "").not.toContain("跳过");
  });

  it("only the finished session is still live: step 1 starts", async () => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    recordOutput(s0);
    liveSessions.add(s0);

    endTurn(h, s0);
    await waitForOutcome(h, s0, 1);

    expect(starts(h, 1)).toBe(1);
    expect((await h.card()).lastSyncError ?? "").not.toContain("跳过");
  });
});

describe("C4: a skipped step settles its automation", () => {
  it.each(["left_column", "live_session"] as const)("%s: automation ended, queue free, finished session ended, next entry runs", async (kind) => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    recordOutput(s0);
    if (kind === "left_column") hookNextStep(h, () => moveCardSilently(h, "dev"));
    else {
      await addRunningRecord(h, "live-dev", "dev");
      liveSessions.add("live-dev");
    }

    endTurn(h, s0);
    await waitForOutcome(h, s0, 1);

    expect(automationOf(h)?.status).not.toMatch(/^(running|queued)$/);
    const snapshot = await getKanbanSessionQueue(h.system).getBoardSnapshot(h.boardId);
    expect(snapshot.runningCount).toBe(0);
    expect(snapshot.queuedCount).toBe(0);
    expect(killSessionMock.mock.calls.map(([id]) => id)).toContain(s0);

    // The card enters the lane again later: a new automation starts normally.
    liveSessions.clear();
    await moveCardSilently(h, "todo");
    await processKanbanColumnTransition(h.system, {
      cardId: h.cardId,
      cardTitle: "Card todo",
      boardId: h.boardId,
      workspaceId: WORKSPACE_ID,
      fromColumnId: "dev",
      toColumnId: "todo",
      fromColumnName: "dev",
      toColumnName: "todo",
    });
    await h.waitForStep(0, 2);
    expect(starts(h, 0)).toBe(2);
  });
});

describe("C5: empty values", () => {
  it("the card was deleted before the next step: no session, no throw, automation not left running", async () => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    recordOutput(s0);
    const orchestrator = orchestratorOf(h) as unknown as { handleAgentCompletion(event: unknown): Promise<void> };
    hookNextStep(h, () => h.system.taskStore.delete(h.cardId));

    await expect(orchestrator.handleAgentCompletion({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: s0,
      workspaceId: WORKSPACE_ID,
      data: { sessionId: s0, success: true, stopReason: "end_turn" },
      timestamp: new Date(),
    })).resolves.toBeUndefined();
    await settle(60);

    expect(starts(h, 1)).toBe(0);
    expect(automationOf(h)?.status).not.toMatch(/^(running|queued)$/);
  });

  it("laneSessions empty or missing: allowed", () => {
    const isActive = () => true;
    expect(decideNextStep({ task: { columnId: "todo", laneSessions: [] }, columnId: "todo", isActive })).toEqual({ allowed: true });
    expect(decideNextStep({ task: { columnId: "todo" } as never, columnId: "todo", isActive })).toEqual({ allowed: true });
  });
});

describe("F4: both entry branches and every multi-step column", () => {
  it.each(["todo", "review", "done"] as const)("hasNextStep branch, %s: left column is skipped", async (shape) => {
    const h = await createLaneHarness(shape, triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    recordOutput(s0);
    hookNextStep(h, () => moveCardSilently(h, "blocked"));

    endTurn(h, s0);
    await waitForOutcome(h, s0, 1);

    expect(starts(h, 1)).toBe(0);
    expect((await h.card()).lastSyncError).toContain(`跳过：卡已离开 ${shape}`);
    expect((await h.card()).columnId).toBe("blocked");
  });

  it.each([
    { kind: "left column", expected: "跳过：卡已离开 todo" },
    { kind: "live session", expected: "跳过：已有会话 live-fallback 在跑" },
  ])("fallback branch: $kind is skipped", async ({ kind, expected }) => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock, { fallback: true });
    const s0 = await enterLane(h);
    recordOutput(s0);
    if (kind === "left column") hookNextStep(h, () => moveCardSilently(h, "dev"));
    else {
      await addRunningRecord(h, "live-fallback", "dev");
      liveSessions.add("live-fallback");
    }

    failTurn(h, s0);
    await waitForOutcome(h, s0, FALLBACK_STEP);

    expect(starts(h, FALLBACK_STEP)).toBe(0);
    expect((await h.card()).lastSyncError).toContain(expected);
  });
});

describe("F2: unchanged paths (card still in the column, nothing else live)", () => {
  it.each(["todo", "review", "done"] as const)("%s step 0 -> step 1 starts once, no skip, no exit note", async (shape) => {
    const h = await createLaneHarness(shape, triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    recordOutput(s0);

    endTurn(h, s0);
    await waitForOutcome(h, s0, 1);

    expect(starts(h, 1)).toBe(1);
    const error = (await h.card()).lastSyncError ?? "";
    expect(error).not.toContain("跳过");
    expect(error).not.toContain("存活");
  });

  it("review last step auto-advances to done; done reporter (no next step) starts nothing", async () => {
    const review = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const r0 = await enterLane(review);
    recordOutput(r0);
    endTurn(review, r0);
    const r1 = await review.waitForStep(1);
    recordOutput(r1);
    endTurn(review, r1);
    await vi.waitFor(() => {
      if (!review.transitions.some((t) => t.from === "review" && t.to === "done")) throw new Error("not advanced");
    }, WAIT);
    expect(starts(review, 1)).toBe(1);

    resetWorkflowOrchestrator();
    triggerAssignedTaskAgentMock.mockReset();
    const done = await createLaneHarness("done", triggerAssignedTaskAgentMock, { cardId: "card-done-f2" });
    const d0 = await enterLane(done);
    recordOutput(d0);
    endTurn(done, d0);
    const d1 = await done.waitForStep(1);
    recordOutput(d1);
    endTurn(done, d1);
    await vi.waitFor(async () => {
      if ((await done.laneRecord(d1))?.status === "running") throw new Error("running");
    }, WAIT);
    await settle(60);
    expect(starts(done, 0) + starts(done, 1)).toBe(2);
    expect((await done.card()).lastSyncError ?? "").not.toContain("跳过");
  });

  it("fallback branch starts the fallback step once", async () => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock, { fallback: true });
    const s0 = await enterLane(h);
    recordOutput(s0);

    failTurn(h, s0);
    await waitForOutcome(h, s0, FALLBACK_STEP);

    expect(starts(h, FALLBACK_STEP)).toBe(1);
    expect((await h.card()).lastSyncError ?? "").not.toContain("跳过");
  });
});

describe("C6 / AC3: a session that ends within 30 s without output leaves an exit reason", () => {
  const T0 = Date.parse("2026-11-09T10:00:00.000Z");
  function source(history: Array<Record<string, unknown>>): QuickExitSessionSource {
    return {
      getHistory: () => history.map((update) => ({ update })),
      getSession: () => ({ createdAt: new Date(T0).toISOString() }),
      getSessionActivity: () => undefined,
    };
  }
  function laneTask(aliveSeconds: number): Task {
    return {
      laneSessions: [{
        sessionId: "s-quick",
        status: "completed",
        startedAt: new Date(T0).toISOString(),
        completedAt: new Date(T0 + aliveSeconds * 1000).toISOString(),
      }],
    } as Task;
  }
  const event = {
    type: AgentEventType.AGENT_COMPLETED,
    agentId: "s-quick",
    workspaceId: WORKSPACE_ID,
    data: { sessionId: "s-quick", success: true, stopReason: "end_turn" },
    timestamp: new Date(),
  };

  it.each([
    { label: "A <30 s, no output", alive: 4, history: [{ sessionUpdate: "turn_complete", stopReason: "end_turn" }], note: true },
    { label: "B <30 s, agent_message", alive: 4, history: [{ sessionUpdate: "agent_message" }], note: false },
    { label: "C <30 s, tool_call", alive: 4, history: [{ sessionUpdate: "tool_call" }], note: false },
    { label: "D 31 s, no output", alive: 31, history: [], note: false },
  ])("$label", ({ alive, history, note }) => {
    const text = buildQuickExitNote(laneTask(alive), "s-quick", source(history), { event });
    if (note) {
      expect(text).toContain("会话 s-quick");
      expect(text).toContain(`存活 ${alive} 秒`);
      expect(text).toContain("stopReason=end_turn");
    } else {
      expect(text).toBeUndefined();
    }
  });

  it("exit code is reported when there is no stopReason", () => {
    const exitEvent = { ...event, type: AgentEventType.AGENT_FAILED, data: { sessionId: "s-quick", error: "process exited unexpectedly (code=0, signal=null)" } };
    expect(buildQuickExitNote(laneTask(2), "s-quick", source([]), { event: exitEvent })).toContain("退出码=0");
  });

  it("session unknown to the session store (e.g. after a restart): no note", () => {
    const unknown: QuickExitSessionSource = { ...source([]), getSession: () => undefined };
    expect(buildQuickExitNote(laneTask(2), "s-quick", unknown, { event })).toBeUndefined();
  });

  it("history read error: no note, no throw", () => {
    const broken: QuickExitSessionSource = { ...source([]), getHistory: () => { throw new Error("gone"); } };
    expect(buildQuickExitNote(laneTask(2), "s-quick", broken)).toBeUndefined();
  });

  it("A integration, dev lane: the note lands on the card; status and step count unchanged", async () => {
    const h = await createLaneHarness("dev", triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    registerSession(s0);
    endTurn(h, s0);
    await vi.waitFor(async () => {
      if (!(await h.card()).lastSyncError?.includes(`会话 ${s0} 存活`)) throw new Error("no note");
    }, WAIT);
    const record = await h.laneRecord(s0);
    expect(record?.status).toBe("completed");
    expect(record?.recoveryReason).toBeUndefined();
    expect(starts(h, 0)).toBe(1);
  });

  it("A integration, todo step 0 quick exit then step 1 starts: note logged, card error untouched, one start", async () => {
    const h = await createLaneHarness("todo", triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    registerSession(s0);
    const info = vi.spyOn(console, "info");
    endTurn(h, s0);
    await waitForOutcome(h, s0, 1);
    expect(starts(h, 1)).toBe(1);
    // The next session's start clears lastSyncError and a note there would hide step 1's own failure: log only.
    expect(info.mock.calls.some((args) => String(args[0]).includes(`会话 ${s0} 存活`))).toBe(true);
    expect((await h.card()).lastSyncError ?? "").not.toContain("存活");
  });

  it("B integration: output in the session, no note", async () => {
    const h = await createLaneHarness("dev", triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    recordOutput(s0, "tool_call");
    endTurn(h, s0);
    await vi.waitFor(async () => {
      if ((await h.laneRecord(s0))?.status === "running") throw new Error("running");
    }, WAIT);
    await settle(60);
    expect((await h.card()).lastSyncError ?? "").not.toContain("存活");
  });

  it("E integration, a failure reason already set: it is kept and the note is appended", async () => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const s0 = await enterLane(h);
    registerSession(s0);
    const card = await h.card();
    await h.system.taskStore.save({ ...card, lastSyncError: "上次失败：限流 429" });
    failTurn(h, s0);
    await vi.waitFor(async () => {
      if (!(await h.card()).lastSyncError?.includes(`会话 ${s0} 存活`)) throw new Error("no note");
    }, WAIT);
    const after = await h.card();
    expect(after.lastSyncError).toContain("上次失败：限流 429");
    const record = await h.laneRecord(s0);
    expect(record?.status).toBe("failed");
    expect(record?.recoveryReason).toBe("agent_failed");
    expect(starts(h, 0) + starts(h, 1)).toBe(1);
  });
});

describe("F3: random cross-check against rules written from the requirement", () => {
  /** Tiny seeded PRNG so a failure can be replayed. */
  function rng(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
  }
  type Entry = { sessionId: string; status: string; columnId: string };

  function oracle(
    input: { exists: boolean; column: string; entries: Entry[]; finished: string; live: Set<string> },
    bug = false,
  ): string {
    if (!input.exists || input.column !== "todo") return "left_column";
    const blocking = input.entries.find((entry) => entry.status === "running"
      && input.live.has(entry.sessionId)
      && (bug || entry.sessionId !== input.finished));
    return blocking ? `live:${blocking.sessionId}` : "allowed";
  }

  function generate(random: () => number) {
    const finished = "s-finished";
    const ids = [finished, "s-a", "s-b", "s-c", "s-d"];
    const statuses = ["running", "completed", "failed", "timed_out", "transitioned"];
    const columns = ["todo", "dev", "review"];
    const entries: Entry[] = Array.from({ length: Math.floor(random() * 6) }, () => ({
      sessionId: ids[Math.floor(random() * ids.length)],
      status: statuses[Math.floor(random() * statuses.length)],
      columnId: columns[Math.floor(random() * columns.length)],
    }));
    const live = new Set(ids.filter(() => random() < 0.5));
    return { exists: random() > 0.1, column: random() < 0.8 ? "todo" : "dev", entries, finished, live };
  }

  function actual(input: ReturnType<typeof generate>): string {
    const decision = decideNextStep({
      task: input.exists ? { columnId: input.column, laneSessions: input.entries as never } : undefined,
      columnId: "todo",
      finishedSessionId: input.finished,
      isActive: (id) => input.live.has(id),
    });
    if (decision.allowed) return "allowed";
    return decision.kind === "left_column" ? "left_column" : `live:${decision.liveSessionId}`;
  }

  function countMismatches(bug: boolean): number {
    const random = rng(20261109);
    let mismatches = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const input = generate(random);
      if (actual(input) !== oracle(input, bug)) mismatches += 1;
    }
    return mismatches;
  }

  it("decideNextStep: 10,000 random inputs, 0 mismatches; a planted bug is caught", () => {
    expect(countMismatches(true)).toBeGreaterThan(0);
    expect(countMismatches(false)).toBe(0);
  });

  it("isQuickEmptyExit: 10,000 random inputs, 0 mismatches; a planted bug is caught", () => {
    const kinds = ["agent_message", "agent_message_chunk", "tool_call", "tool_call_update", "turn_complete", "agent_thought_chunk", "plan", "error"];
    const check = (bug: boolean) => {
      const random = rng(7);
      let mismatches = 0;
      for (let i = 0; i < 10_000; i += 1) {
        const aliveMs = Math.floor(random() * 120_000);
        const history = Array.from({ length: Math.floor(random() * 4) }, () => kinds[Math.floor(random() * kinds.length)]);
        const hasOutput = history.some((kind) => ["agent_message", "agent_message_chunk", "tool_call", "tool_call_update"].includes(kind));
        const expected = aliveMs < (bug ? 60 : QUICK_EXIT_MAX_SECONDS) * 1000 && !hasOutput;
        if (isQuickEmptyExit(aliveMs, history) !== expected) mismatches += 1;
      }
      return mismatches;
    };
    expect(check(true)).toBeGreaterThan(0);
    expect(check(false)).toBe(0);
  });
});
