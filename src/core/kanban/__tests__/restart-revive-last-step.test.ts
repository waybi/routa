// @vitest-environment node
/**
 * Card 6d8365ca, review round 1 (R2, R2b) and the rebase onto a04533b5:
 *
 * - When revive finds that the latest run of the card's lane is the lane's
 *   last step and it really completed (end_turn in the session history, or
 *   already recorded completed), nothing is left to run there: revive starts
 *   no session. Before the fix, a Dev crafter that ended its turn was re-run
 *   by re-entering Dev, and a Review Guard that ended its turn made revive
 *   re-run the whole Review lane from QA Frontend.
 * - Steps whose session has no end keep the old rules (rerun that step), and a
 *   lane the card never ran, or re-entered after leaving it, still starts at
 *   its first step (S16).
 * - A step session of a column the card already left ends late: its record is
 *   completed or transitioned, never failed (rebased onto leaveLane, 382763e1).
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
import { reviveMissingEntryAutomations } from "../restart-recovery";
import {
  processKanbanColumnTransition,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";
import {
  cleanupSessionCwd,
  createLaneHarness,
  orchestratorOf,
  runToInterruptedStep,
  WORKSPACE_ID,
  type LaneHarness,
} from "./lane-interrupt-harness";

type HistoryEntry = { update: Record<string, unknown>; createdAt?: string };

const T_END = "2026-10-24T01:00:00.000Z";

const HISTORY: Record<"end_turn" | "no_end", HistoryEntry[]> = {
  end_turn: [
    { update: { sessionUpdate: "tool_call", title: "npm test" }, createdAt: "2026-10-24T00:50:00.000Z" },
    { update: { sessionUpdate: "turn_complete", stopReason: "end_turn" }, createdAt: T_END },
  ],
  no_end: [
    { update: { sessionUpdate: "tool_call", title: "npm test" }, createdAt: "2026-10-24T00:50:00.000Z" },
  ],
};

const STEPS = {
  todo: ["todo-orchestrator", "contract-setter"],
  dev: ["kanban-dev-crafter"],
  review: ["kanban-qa-frontend", "kanban-review-guard"],
} as const;
type Lane = keyof typeof STEPS;

function options(history: HistoryEntry[]) {
  return {
    sessionStore: { getSession: () => undefined } as never,
    processManager: { hasActiveSession: () => false } as never,
    readSessionEndHistory: vi.fn(async (_sessionId: string) => history),
  };
}

async function newSystem(): Promise<RoutaSystem> {
  const system = createInMemorySystem();
  await system.workspaceStore.save(createWorkspace({
    id: "ws",
    title: "WS",
    metadata: { "kanbanSessionConcurrencyLimit:board": "10" },
  }));
  const lane = (id: Lane, position: number) => ({
    id,
    name: id,
    position,
    stage: id,
    automation: {
      enabled: true,
      transitionType: "entry" as const,
      autoAdvanceOnSuccess: false,
      steps: STEPS[id].map((specialistId) => ({
        id: specialistId,
        providerId: "claude",
        role: id === "dev" ? "CRAFTER" : "GATE",
        specialistId,
        specialistName: specialistId,
      })),
    },
  });
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: "board",
    workspaceId: "ws",
    name: "Board",
    isDefault: true,
    columns: [
      { id: "backlog", name: "backlog", position: 0, stage: "backlog" },
      lane("todo", 1),
      lane("dev", 2),
      lane("review", 3),
      { id: "done", name: "done", position: 4, stage: "done" },
    ],
  }));
  return system;
}

function record(sessionId: string, columnId: string, stepIndex: number, status: TaskLaneSession["status"]): TaskLaneSession {
  return {
    sessionId,
    columnId,
    stepIndex,
    status,
    startedAt: "2026-10-24T00:40:00.000Z",
    ...(status === "running" ? {} : { completedAt: "2026-10-24T00:45:00.000Z" }),
  };
}

/** The card sits in `lane`; every step before the last completed, the last one is still recorded running. */
function lastStepRunning(lane: Lane): TaskLaneSession[] {
  const last = STEPS[lane].length - 1;
  return STEPS[lane].map((_, stepIndex) => (
    stepIndex === last ? record("s-last", lane, stepIndex, "running") : record(`s-${stepIndex}`, lane, stepIndex, "completed")
  ));
}

async function saveCard(system: RoutaSystem, columnId: string, extra: Partial<Task>): Promise<void> {
  await system.taskStore.save({
    ...createTask({ id: "c", title: "c", objective: "c", workspaceId: "ws", boardId: "board", columnId, status: TaskStatus.IN_PROGRESS }),
    ...extra,
  } as Task);
}

async function laneRecord(system: RoutaSystem, sessionId: string) {
  return (await system.taskStore.get("c"))?.laneSessions?.find((entry) => entry.sessionId === sessionId);
}

/** Specialists revive started, in order. */
function startedSpecialists(): string[] {
  return triggerAssignedTaskAgentMock.mock.calls.map(([params]) => (
    (params as { step?: { specialistId?: string }; task: Task }).step?.specialistId
      ?? (params as { task: Task }).task.assignedSpecialistId
      ?? "?"
  ));
}

beforeEach(() => {
  resetWorkflowOrchestrator();
  triggerAssignedTaskAgentMock.mockReset();
  killSessionMock.mockClear();
  triggerAssignedTaskAgentMock.mockImplementation(async (params: { task: { id: string }; stepIndex?: number }) => ({
    sessionId: `${params.task.id}:new:${params.stepIndex ?? "x"}:${triggerAssignedTaskAgentMock.mock.calls.length}`,
    transport: "acp",
  }));
});

afterEach(() => {
  resetWorkflowOrchestrator();
});

afterAll(() => {
  cleanupSessionCwd();
});

describe("R2 / R2b: revive starts nothing when the lane's last step really completed", () => {
  it.each([
    { lane: "dev" as const, label: "Dev single step (crafter)" },
    { lane: "review" as const, label: "Review last step (Guard, stepIndex 1)" },
    { lane: "todo" as const, label: "Todo last step (Contract Setter, stepIndex 1)" },
  ])("$label: end_turn in the history → completed, no session started, also on a second revive", async ({ lane }) => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await saveCard(system, lane, { triggerSessionId: "s-last", laneSessions: lastStepRunning(lane) });

    await reviveMissingEntryAutomations(system, "ws", "board", options(HISTORY.end_turn));

    expect(await laneRecord(system, "s-last")).toMatchObject({ status: "completed", completedAt: T_END });
    expect(startedSpecialists()).toEqual([]);

    // The next revive (every board load) sees an already completed last step.
    await reviveMissingEntryAutomations(system, "ws", "board", options(HISTORY.end_turn));
    expect(startedSpecialists()).toEqual([]);
    expect((await system.taskStore.get("c"))?.laneSessions).toHaveLength(STEPS[lane].length);
  });
});

describe("old rules kept: steps without an end, a lane never run, a re-entered lane", () => {
  it.each([
    { lane: "dev" as const, expected: ["kanban-dev-crafter"] },
    { lane: "review" as const, expected: ["kanban-review-guard"] },
    { lane: "todo" as const, expected: ["contract-setter"] },
  ])("$lane last step with no end in the history: interrupted, that step is rerun once", async ({ lane, expected }) => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await saveCard(system, lane, { triggerSessionId: "s-last", laneSessions: lastStepRunning(lane) });

    await reviveMissingEntryAutomations(system, "ws", "board", options(HISTORY.no_end));

    expect(await laneRecord(system, "s-last")).toMatchObject({ status: "timed_out", recoveryReason: "restart_interrupted" });
    expect(startedSpecialists()).toEqual(expected);
  });

  it.each(["dev", "review", "todo"] as const)("S16 %s lane with no lane record: starts its first step once", async (lane) => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await saveCard(system, lane, { laneSessions: [] });

    await reviveMissingEntryAutomations(system, "ws", "board", options(HISTORY.end_turn));

    expect(startedSpecialists()).toEqual([STEPS[lane][0]]);
  });

  it("a card back in Dev after Review (old crafter completed, no new Dev run yet): re-enters Dev once", async () => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await saveCard(system, "dev", {
      laneSessions: [
        record("s-dev-1", "dev", 0, "completed"),
        record("s-qa-1", "review", 0, "completed"),
        record("s-guard-1", "review", 1, "completed"),
      ],
    });

    await reviveMissingEntryAutomations(system, "ws", "board", options(HISTORY.end_turn));

    expect(startedSpecialists()).toEqual(["kanban-dev-crafter"]);
  });
});

function endEvent(type: AgentEventType, sessionId: string, data: Record<string, unknown>): AgentEvent {
  return { type, agentId: sessionId, workspaceId: WORKSPACE_ID, data: { sessionId, ...data }, timestamp: new Date() };
}

const LATE_EVENTS = {
  agent_failed: (id: string) => endEvent(AgentEventType.AGENT_FAILED, id, { success: false, error: "turn failed: usage_limit_reached" }),
  exit_nonzero: (id: string) => endEvent(AgentEventType.AGENT_FAILED, id, {
    success: false,
    error: "DeepSeek Harness process exited unexpectedly (code=1, signal=null)",
  }),
  timeout: (id: string) => endEvent(AgentEventType.AGENT_TIMEOUT, id, { success: false, error: "No ACP activity for 20 minutes." }),
  cancelled: (id: string) => endEvent(AgentEventType.AGENT_COMPLETED, id, { success: false, stopReason: "cancelled" }),
  end_turn: (id: string) => endEvent(AgentEventType.AGENT_COMPLETED, id, { success: true, stopReason: "end_turn" }),
};

/** The card leaves Review the way move_card does: saved in the new column, then the column transition. */
async function moveCard(h: LaneHarness, toColumnId: "dev" | "done"): Promise<void> {
  const card = await h.card();
  await h.system.taskStore.save({ ...card, columnId: toColumnId, updatedAt: new Date() });
  await processKanbanColumnTransition(h.system, {
    cardId: h.cardId,
    cardTitle: card.title,
    boardId: h.boardId,
    workspaceId: WORKSPACE_ID,
    fromColumnId: "review",
    toColumnId,
    fromColumnName: "review",
    toColumnName: toColumnId,
  });
}

describe("rebase onto 382763e1 / a04533b5: a late end of a session in a column the card left", () => {
  const cases = (Object.keys(LATE_EVENTS) as Array<keyof typeof LATE_EVENTS>).flatMap((kind) => [
    { kind, tracked: true, to: "done" as const },
    { kind, tracked: false, to: "done" as const },
    { kind, tracked: false, to: "dev" as const },
  ]);

  it.each(cases)("Review Guard, card moved to $to, tracked=$tracked, late $kind → completed or transitioned, not failed", async ({ kind, tracked, to }) => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const guard = await runToInterruptedStep(h);
    if (!tracked) {
      // Not followed by the orchestrator (a run it never adopted, or its automation already cleaned up).
      (orchestratorOf(h) as unknown as { activeAutomations: Map<string, unknown> }).activeAutomations.delete(h.cardId);
    }
    await moveCard(h, to);
    const startsBefore = triggerAssignedTaskAgentMock.mock.calls.length;

    await (orchestratorOf(h) as unknown as { handleAgentCompletion(event: AgentEvent): Promise<void> })
      .handleAgentCompletion(LATE_EVENTS[kind](guard));

    const entry = await h.laneRecord(guard);
    expect(["completed", "transitioned"]).toContain(entry?.status);
    expect(entry?.recoveryReason).toBeUndefined();
    expect(entry?.completedAt).toEqual(expect.any(String));
    expect(triggerAssignedTaskAgentMock.mock.calls.length).toBe(startsBefore);
  });
});

/**
 * Card f2b2621a C3 / AC4: after replaying 0907188b onto 79804de2, revive runs
 * the rate-limit / fuse guard (a) before the completed-last-step guard (b).
 * Review lane (QA Frontend, Review Guard), clock injected through `now`.
 */
describe("f2b2621a C3: revive guards (a) rate limit / fuse and (b) completed last step", () => {
  const NOW = new Date("2026-10-24T08:00:00.000Z");
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
  const qaDone = record("s-qa", "review", 0, "completed");
  const failedGuard = (id: string, reason: TaskLaneSession["recoveryReason"], retryAfterAt?: string): TaskLaneSession => (
    { ...record(id, "review", 1, "failed"), recoveryReason: reason, ...(retryAfterAt ? { retryAfterAt } : {}) }
  );

  it.each([
    { label: "(i) latest rate_limited, retryAfterAt now+10 min", lane: [qaDone, failedGuard("s-g", "rate_limited", at(10))], expected: [] },
    { label: "(ii) latest rate_limited, retryAfterAt now-1 min", lane: [qaDone, failedGuard("s-g", "rate_limited", at(-1))], expected: ["kanban-review-guard"] },
    {
      label: "(iii) 5 retryable environment failures in a row (fuse)",
      lane: [qaDone, ...[1, 2, 3, 4, 5].map((n) => failedGuard(`s-g${n}`, "rate_limited", at(-n)))],
      expected: [],
    },
    { label: "(iv) latest is the last step, completed", lane: [qaDone, record("s-g", "review", 1, "completed")], expected: [] },
    { label: "(v) latest is a non-last step, completed", lane: [qaDone], expected: ["kanban-review-guard"] },
    { label: "(vi) latest is the last step, failed + agent_failed", lane: [qaDone, failedGuard("s-g", "agent_failed")], expected: ["kanban-review-guard"] },
  ])("$label → starts $expected", async ({ lane, expected }) => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await saveCard(system, "review", { laneSessions: lane });

    await reviveMissingEntryAutomations(system, "ws", "board", { ...options(HISTORY.end_turn), now: () => NOW });

    expect(startedSpecialists()).toEqual(expected);
  });
});

/**
 * F3 batch cross-check (seeded): random lanes of 1–3 steps × latest record ×
 * retryable failures in a row, judged by the requirement: rate_limited with
 * retryAfterAt after now → 0 sessions; ≥5 retryable environment failures in a
 * row → 0; latest is the last step and completed → 0; latest is an earlier
 * step, completed → exactly its next step. Other combinations only must not throw.
 */
describe("f2b2621a F3: revive batch cross-check", () => {
  const SEED = 20261024;
  const ROUNDS = 10_000;
  const NOW = new Date("2026-10-24T08:00:00.000Z");
  const RETRYABLE = ["rate_limited", "turn_cancelled", "restart_interrupted"] as const;
  const REASONS = [undefined, "agent_failed", ...RETRYABLE] as const;
  const STATUSES = ["completed", "failed", "timed_out"] as const;
  type Case = { steps: number; latest: TaskLaneSession; lane: TaskLaneSession[] };
  type Expect = { starts: number; stepIndex?: number } | "any";
  type Judge = (c: Case) => Expect;

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

  const retryableInARow = (lane: TaskLaneSession[]) => {
    let count = 0;
    for (const entry of [...lane].reverse()) {
      if (!(entry.status === "failed" || entry.status === "timed_out")) break;
      if (!RETRYABLE.includes(entry.recoveryReason as typeof RETRYABLE[number])) break;
      count += 1;
    }
    return count;
  };

  const judge: Judge = ({ steps, latest, lane }) => {
    const retryAt = latest.retryAfterAt ? Date.parse(latest.retryAfterAt) : undefined;
    if (latest.recoveryReason === "rate_limited" && retryAt !== undefined && retryAt > NOW.getTime()) return { starts: 0 };
    if (retryableInARow(lane) >= 5) return { starts: 0 };
    if (latest.status === "completed" && latest.stepIndex === steps - 1) return { starts: 0 };
    if (latest.status === "completed") return { starts: 1, stepIndex: latest.stepIndex! + 1 };
    return "any";
  };
  // Planted error: the rate-limit wait read the wrong way round must be caught.
  const plantedJudge: Judge = (c) => {
    const retryAt = c.latest.retryAfterAt ? Date.parse(c.latest.retryAfterAt) : undefined;
    if (c.latest.recoveryReason === "rate_limited" && retryAt !== undefined && retryAt < NOW.getTime()) return { starts: 0 };
    return judge({ ...c, latest: { ...c.latest, recoveryReason: undefined } });
  };

  async function batchSystem(): Promise<RoutaSystem> {
    const system = createInMemorySystem();
    await system.workspaceStore.save(createWorkspace({ id: "ws", title: "WS", metadata: { "kanbanSessionConcurrencyLimit:board": "100000" } }));
    const lane = (steps: number, position: number) => ({
      id: `l${steps}`,
      name: `l${steps}`,
      position,
      stage: "dev" as const,
      automation: {
        enabled: true,
        transitionType: "entry" as const,
        autoAdvanceOnSuccess: false,
        steps: Array.from({ length: steps }, (_, index) => ({
          id: `l${steps}-s${index}`, providerId: "claude", role: "CRAFTER", specialistId: `l${steps}-s${index}`,
        })),
      },
    });
    await system.kanbanBoardStore.save(createKanbanBoard({
      id: "board", workspaceId: "ws", name: "Board", isDefault: true, columns: [lane(1, 0), lane(2, 1), lane(3, 2)],
    }));
    return system;
  }

  async function crossCheck(check: Judge): Promise<{ mismatches: number; decided: number }> {
    resetWorkflowOrchestrator();
    const system = await batchSystem();
    startWorkflowOrchestrator(system);
    const next = rng(SEED);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
    let mismatches = 0;
    let decided = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      const steps = 1 + Math.floor(next() * 3);
      const column = `l${steps}`;
      const stepIndex = Math.floor(next() * steps);
      const status = pick(STATUSES);
      const reason = pick(REASONS);
      const retryAfterAt = pick([undefined, -10, -1, 1, 10] as const);
      const lane: TaskLaneSession[] = Array.from({ length: stepIndex }, (_, index) => record(`r${round}-p${index}`, column, index, "completed"));
      const failures = Math.floor(next() * 7);
      for (let index = 0; index < failures; index += 1) {
        lane.push({ ...record(`r${round}-f${index}`, column, stepIndex, "failed"), recoveryReason: pick(RETRYABLE) });
      }
      const latest: TaskLaneSession = {
        ...record(`r${round}-latest`, column, stepIndex, status),
        ...(reason ? { recoveryReason: reason } : {}),
        ...(retryAfterAt === undefined ? {} : { retryAfterAt: new Date(NOW.getTime() + retryAfterAt * 60_000).toISOString() }),
      };
      lane.push(latest);
      const id = `card-${round}`;
      await system.taskStore.save({
        ...createTask({ id, title: id, objective: id, workspaceId: "ws", boardId: "board", columnId: column, status: TaskStatus.IN_PROGRESS }),
        laneSessions: lane,
      } as Task);
      const before = triggerAssignedTaskAgentMock.mock.calls.length;
      await reviveMissingEntryAutomations(system, "ws", "board", { ...options(HISTORY.end_turn), now: () => NOW });
      const started = startedSpecialists().slice(before);
      const expected = check({ steps, latest, lane });
      if (expected !== "any") {
        decided += 1;
        const ok = started.length === expected.starts
          && (expected.stepIndex === undefined || started[0] === `${column}-s${expected.stepIndex}`);
        if (!ok) mismatches += 1;
      }
      await system.taskStore.delete(id);
    }
    return { mismatches, decided };
  }

  it(`seed ${SEED}, ${ROUNDS} rounds: 0 mismatches; the planted judge is caught`, async () => {
    // 20,000 revives log lane-resolution warnings; keep the runner output small (spawnSync buffer).
    const quiet = (["warn", "error", "log", "info"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const real = await crossCheck(judge);
    triggerAssignedTaskAgentMock.mockClear();
    const planted = await crossCheck(plantedJudge);
    quiet.forEach((spy) => spy.mockRestore());
    console.log(`[F3 revive] seed=${SEED} rounds=${ROUNDS} decided=${real.decided} mismatches=${real.mismatches} plantedMismatches=${planted.mismatches}`);
    expect(real.mismatches).toBe(0);
    expect(real.decided).toBeGreaterThan(ROUNDS / 3);
    expect(planted.mismatches).toBeGreaterThan(0);
  }, 600_000);
});
