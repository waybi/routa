// @vitest-environment node
/**
 * Card 6d8365ca, C7 / C8 / C13: the startup sweep (and revive, which shares
 * it) records a "running" lane step whose session already ended by the
 * session's real outcome, read from the persisted session history. Before,
 * it recorded every such step as interrupted (timed_out) or, outside the
 * card's column, transitioned, and the retro, which only trusts "completed",
 * reported "Done pusher and reporter missing" for cards 25afcd82, e11cac2f
 * and 497ae435. Steps without an end in the history keep the old rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock } = vi.hoisted(() => ({ triggerAssignedTaskAgentMock: vi.fn() }));

vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));

import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus, VerificationVerdict, type Task, type TaskLaneSession } from "../../models/task";
import { createWorkspace } from "../../models/workspace";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import { endStaleRunningLaneSessions, reviveMissingEntryAutomations } from "../restart-recovery";
import { resetWorkflowOrchestrator, startWorkflowOrchestrator } from "../workflow-orchestrator-singleton";

type HistoryEntry = { update: Record<string, unknown>; createdAt?: string };

const T_END = "2026-10-23T11:38:12.345Z";

const HISTORY: Record<string, HistoryEntry[]> = {
  end_turn: [
    { update: { sessionUpdate: "user_message" }, createdAt: "2026-10-23T11:31:00.000Z" },
    { update: { sessionUpdate: "tool_call", title: "git push" }, createdAt: "2026-10-23T11:35:00.000Z" },
    { update: { sessionUpdate: "turn_complete", stopReason: "end_turn" }, createdAt: T_END },
    // The process exits after the turn (Routa ended it): not a failure of the step.
    { update: { sessionUpdate: "error", error: { code: "process_exited", message: "process exited unexpectedly (code=0, signal=null)" } }, createdAt: "2026-10-23T11:38:20.000Z" },
  ],
  end_turn_no_time: [
    { update: { sessionUpdate: "user_message" } },
    { update: { sessionUpdate: "turn_complete", stopReason: "end_turn" } },
  ],
  error: [
    { update: { sessionUpdate: "user_message" }, createdAt: "2026-10-23T11:31:00.000Z" },
    { update: { sessionUpdate: "error", error: { code: "prompt_failed_after_timeout", message: "turn failed: usage_limit_reached" } }, createdAt: T_END },
  ],
  cancelled: [
    { update: { sessionUpdate: "user_message" }, createdAt: "2026-10-23T11:31:00.000Z" },
    { update: { sessionUpdate: "turn_complete", stopReason: "cancelled" }, createdAt: T_END },
  ],
  exit_nonzero: [
    { update: { sessionUpdate: "user_message" }, createdAt: "2026-10-23T11:31:00.000Z" },
    { update: { sessionUpdate: "tool_call", title: "npm test" }, createdAt: "2026-10-23T11:33:00.000Z" },
    { update: { sessionUpdate: "error", error: { code: "process_exited", message: "process exited unexpectedly (code=1, signal=null)" } }, createdAt: T_END },
  ],
  no_end: [
    { update: { sessionUpdate: "user_message" }, createdAt: "2026-10-23T11:31:00.000Z" },
    { update: { sessionUpdate: "tool_call", title: "npm test" }, createdAt: "2026-10-23T11:33:00.000Z" },
  ],
};

/** Persisted history of the previous process's sessions; the in-memory session store is empty (not hydrated). */
function historyReader(byId: Record<string, HistoryEntry[]>) {
  return vi.fn(async (sessionId: string) => byId[sessionId] ?? []);
}

function options(reader: ReturnType<typeof historyReader>) {
  return {
    sessionStore: { getSession: () => undefined } as never,
    processManager: { hasActiveSession: () => false } as never,
    readSessionEndHistory: reader,
  };
}

function running(sessionId: string, columnId: string, stepIndex: number): TaskLaneSession {
  return { sessionId, columnId, stepIndex, status: "running", startedAt: "2026-10-23T11:30:00.000Z" };
}

async function newSystem(): Promise<RoutaSystem> {
  const system = createInMemorySystem();
  await system.workspaceStore.save(createWorkspace({
    id: "ws",
    title: "WS",
    metadata: { "kanbanSessionConcurrencyLimit:board": "10" },
  }));
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: "board",
    workspaceId: "ws",
    name: "Board",
    isDefault: true,
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      {
        id: "review",
        name: "Review",
        position: 1,
        stage: "review",
        automation: {
          enabled: true,
          transitionType: "entry",
          autoAdvanceOnSuccess: false,
          steps: [
            { id: "qa", providerId: "claude", role: "GATE", specialistId: "kanban-qa-frontend" },
            { id: "guard", providerId: "claude", role: "GATE", specialistId: "kanban-review-guard" },
          ],
        },
      },
      {
        id: "done",
        name: "Done",
        position: 2,
        stage: "done",
        automation: {
          enabled: true,
          transitionType: "entry",
          steps: [
            { id: "pusher", providerId: "claude", role: "GATE", specialistId: "kanban-main-pusher" },
            { id: "reporter", providerId: "claude", role: "GATE", specialistId: "kanban-done-reporter" },
          ],
        },
      },
    ],
  }));
  return system;
}

async function saveCard(system: RoutaSystem, id: string, columnId: string, extra: Partial<Task>): Promise<void> {
  await system.taskStore.save({
    ...createTask({ id, title: id, objective: id, workspaceId: "ws", boardId: "board", columnId, status: TaskStatus.IN_PROGRESS }),
    ...extra,
  } as Task);
}

async function record(system: RoutaSystem, cardId: string, sessionId: string) {
  return (await system.taskStore.get(cardId))?.laneSessions?.find((entry) => entry.sessionId === sessionId);
}

beforeEach(() => {
  resetWorkflowOrchestrator();
  triggerAssignedTaskAgentMock.mockReset();
  triggerAssignedTaskAgentMock.mockImplementation(async (params: { task: { id: string }; stepIndex?: number }) => ({
    sessionId: `${params.task.id}:new:${params.stepIndex ?? "x"}`,
    transport: "acp",
  }));
});

afterEach(() => {
  resetWorkflowOrchestrator();
});

describe("C7: the startup sweep records an ended session by its real outcome", () => {
  it.each([
    { label: "current column (trigger session)", columnId: "review", trigger: true },
    { label: "current column", columnId: "review", trigger: false },
    { label: "a column the card already left", columnId: "dev", trigger: false },
  ])("S20 turn_complete(end_turn), $label → completed at the session's end time", async ({ columnId, trigger }) => {
    const system = await newSystem();
    await saveCard(system, "c", "review", {
      triggerSessionId: trigger ? "s-end" : undefined,
      laneSessions: [running("s-end", columnId, 0)],
    });

    const result = await endStaleRunningLaneSessions(system, options(historyReader({ "s-end": HISTORY.end_turn })));

    expect(result.sessions).toEqual(["s-end"]);
    const entry = await record(system, "c", "s-end");
    expect(entry).toMatchObject({ status: "completed", completedAt: T_END });
    expect(entry?.recoveryReason).toBeUndefined();
    expect((await system.taskStore.get("c"))?.triggerSessionId).toBeUndefined();
  });

  it("S20 without an end time: completed at the sweep time", async () => {
    const system = await newSystem();
    await saveCard(system, "c", "review", { laneSessions: [running("s-end", "review", 0)] });
    const before = Date.now();

    await endStaleRunningLaneSessions(system, options(historyReader({ "s-end": HISTORY.end_turn_no_time })));

    const entry = await record(system, "c", "s-end");
    expect(entry?.status).toBe("completed");
    const completedAt = Date.parse(entry?.completedAt ?? "");
    expect(completedAt).toBeGreaterThanOrEqual(before);
    expect(completedAt).toBeLessThanOrEqual(Date.now());
  });

  it.each([
    { kind: "error", reason: undefined },
    { kind: "cancelled", reason: "turn_cancelled" },
    { kind: "exit_nonzero", reason: undefined },
  ])("S21 $kind → failed with a recovery reason, at the session's end time", async ({ kind, reason }) => {
    for (const columnId of ["review", "dev"]) {
      const system = await newSystem();
      await saveCard(system, "c", "review", { laneSessions: [running("s-bad", columnId, 0)] });

      await endStaleRunningLaneSessions(system, options(historyReader({ "s-bad": HISTORY[kind] })));

      const entry = await record(system, "c", "s-bad");
      expect(entry).toMatchObject({ status: "failed", completedAt: T_END });
      expect(entry?.recoveryReason).toBeTruthy();
      if (reason) expect(entry?.recoveryReason).toBe(reason);
    }
  });

  it.each([
    { label: "current column", columnId: "review", expected: { status: "timed_out", recoveryReason: "restart_interrupted" } },
    { label: "a column the card already left", columnId: "dev", expected: { status: "transitioned" } },
  ])("S22 no end in the history, $label → old rule", async ({ columnId, expected }) => {
    for (const history of [HISTORY.no_end, []]) {
      const system = await newSystem();
      await saveCard(system, "c", "review", { laneSessions: [running("s-open", columnId, 0)] });

      await endStaleRunningLaneSessions(system, options(historyReader({ "s-open": history })));

      const entry = await record(system, "c", "s-open");
      expect(entry).toMatchObject({ ...expected, completedAt: expect.any(String) });
      if (expected.status === "transitioned") expect(entry?.recoveryReason).toBeUndefined();
    }
  });
});

describe("C8: revive treats a step whose session really completed as completed", () => {
  it("Review step 0 completed for real: revive starts step 1 once and does not rerun step 0", async () => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await saveCard(system, "rv", "review", { triggerSessionId: "s-qa", laneSessions: [running("s-qa", "review", 0)] });

    await reviveMissingEntryAutomations(system, "ws", "board", options(historyReader({ "s-qa": HISTORY.end_turn })));

    expect(await record(system, "rv", "s-qa")).toMatchObject({ status: "completed", completedAt: T_END });
    const starts = triggerAssignedTaskAgentMock.mock.calls.map(([params]) => (params as { stepIndex?: number }).stepIndex);
    expect(starts).toEqual([1]);
    expect(await record(system, "rv", "rv:new:1")).toMatchObject({ status: "running", stepIndex: 1 });
  });

  it("Done reporter (last step) completed for real on a COMPLETED card: nothing starts", async () => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await saveCard(system, "dn", "done", {
      status: TaskStatus.COMPLETED,
      verificationVerdict: VerificationVerdict.APPROVED,
      triggerSessionId: "s-rep",
      laneSessions: [{ ...running("s-push", "done", 0), status: "completed" }, running("s-rep", "done", 1)],
    });

    await reviveMissingEntryAutomations(system, "ws", "board", options(historyReader({ "s-rep": HISTORY.end_turn })));

    expect(await record(system, "dn", "s-rep")).toMatchObject({ status: "completed", completedAt: T_END });
    expect(triggerAssignedTaskAgentMock).not.toHaveBeenCalled();
  });
});

describe("C13: the sweep reads history only for running records", () => {
  it("50 cards, 2 running records: 2 history reads", async () => {
    const system = await newSystem();
    const byId: Record<string, HistoryEntry[]> = {};
    for (let index = 0; index < 50; index += 1) {
      const sessionId = `s-${index}`;
      byId[sessionId] = HISTORY.end_turn;
      const isRunning = index === 7 || index === 31;
      await saveCard(system, `card-${index}`, "review", {
        triggerSessionId: isRunning ? sessionId : undefined,
        laneSessions: [isRunning ? running(sessionId, "review", 0) : { ...running(sessionId, "review", 0), status: "completed" }],
      });
    }
    const reader = historyReader(byId);

    await endStaleRunningLaneSessions(system, options(reader));

    expect(reader).toHaveBeenCalledTimes(2);
    expect(reader.mock.calls.map(([id]) => id).sort()).toEqual(["s-31", "s-7"]);
  });
});

/**
 * Card f2b2621a C6: `RestartRecoveryOptions` keeps both optional fields of the
 * two merged cards, and one revive call honours both: the session history
 * (6d8365ca) for stale running records and the injected clock (79804de2) for
 * a rate-limited step's retryAfterAt.
 */
describe("f2b2621a C6: readSessionEndHistory and now work in the same revive call", () => {
  const NOW = new Date("2000-01-01T00:00:00.000Z");
  const RETRY_AT = "2000-01-01T00:10:00.000Z"; // after the injected now, long before the real clock

  async function seed(system: RoutaSystem): Promise<void> {
    await saveCard(system, "a", "review", { triggerSessionId: "s-a", laneSessions: [running("s-a", "review", 0)] });
    await saveCard(system, "b", "review", { laneSessions: [running("s-b", "review", 0)] });
    await saveCard(system, "rl", "review", {
      laneSessions: [
        { ...running("s-qa", "review", 0), status: "completed" },
        { ...running("s-rl", "review", 1), status: "failed", recoveryReason: "rate_limited", retryAfterAt: RETRY_AT },
      ],
    });
  }

  const startedCards = () => triggerAssignedTaskAgentMock.mock.calls
    .map(([params]) => (params as { task: { id: string } }).task.id);

  it("records a / b by their history and skips the rate-limited card by the injected now", async () => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await seed(system);
    const reader = historyReader({ "s-a": HISTORY.end_turn, "s-b": HISTORY.error });

    await reviveMissingEntryAutomations(system, "ws", "board", { ...options(reader), now: () => NOW });

    expect(await record(system, "a", "s-a")).toMatchObject({ status: "completed", completedAt: T_END });
    expect(await record(system, "b", "s-b")).toMatchObject({ status: "failed", recoveryReason: "agent_failed" });
    expect(await record(system, "rl", "s-rl")).toMatchObject({ status: "failed", recoveryReason: "rate_limited", retryAfterAt: RETRY_AT });
    expect(startedCards()).not.toContain("rl");
    expect(startedCards().sort()).toEqual(["a", "b"]);
  });

  it("control: without the injected now (real clock, past retryAfterAt) the rate-limited step is rerun", async () => {
    const system = await newSystem();
    startWorkflowOrchestrator(system);
    await seed(system);

    await reviveMissingEntryAutomations(system, "ws", "board", options(historyReader({ "s-a": HISTORY.end_turn, "s-b": HISTORY.error })));

    expect(startedCards()).toContain("rl");
  });
});
