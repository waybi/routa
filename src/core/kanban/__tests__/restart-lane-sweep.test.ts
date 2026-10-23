// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock, sweepMock, driverMock } = vi.hoisted(() => ({
  triggerAssignedTaskAgentMock: vi.fn(),
  sweepMock: vi.fn(),
  driverMock: vi.fn(() => "sqlite"),
}));

vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));

import { createInMemorySystem } from "../../routa-system";
import { createKanbanBoard } from "../../models/kanban";
import { createTask, TaskStatus, VerificationVerdict, type Task } from "../../models/task";
import { createWorkspace } from "../../models/workspace";
import { endStaleRunningLaneSessions } from "../restart-recovery";

/**
 * A restart ends every agent process, but lane records stayed "running" until
 * someone POSTed revive for that board, and revive only looks at the current
 * column. Records whose end was never recorded stayed "running" forever
 * (2026-10-23: Done Reporter a1d9bffc on card 25afcd82, Contract Setter
 * c11d8b88 on card c84b2e5e). The startup sweep ends them.
 */
describe("startup sweep of stale running lane sessions", () => {
  // Sessions of the previous process: hydrated from the database, owned by
  // an instance id that is not this process.
  const deadSession = { acpStatus: undefined, ownerInstanceId: "next-1175", leaseExpiresAt: "2999-01-01T00:00:00.000Z" };
  const liveSessionIds = new Set<string>();
  const options = {
    sessionStore: { getSession: (id: string) => (id.startsWith("dead-") ? deadSession : undefined) } as never,
    processManager: { hasActiveSession: (id: string) => liveSessionIds.has(id) } as never,
  };

  function running(sessionId: string, columnId: string, stepIndex: number) {
    return { sessionId, columnId, stepIndex, status: "running" as const, startedAt: "2026-10-23T08:31:00.000Z" };
  }

  async function setup() {
    const system = createInMemorySystem();
    await system.workspaceStore.save(createWorkspace({ id: "ws-a", title: "A" }));
    await system.workspaceStore.save(createWorkspace({ id: "ws-b", title: "B" }));
    const board = createKanbanBoard({
      id: "board-a",
      workspaceId: "ws-a",
      name: "Board",
      isDefault: true,
      columns: [
        { id: "todo", name: "Todo", position: 0, stage: "todo" },
        { id: "review", name: "Review", position: 1, stage: "review" },
        { id: "done", name: "Done", position: 2, stage: "done" },
      ],
    });
    await system.kanbanBoardStore.save(board);
    const card = (id: string, workspaceId: string, columnId: string, extra: Partial<Task>): Task => ({
      ...createTask({ id, title: id, objective: id, workspaceId, boardId: board.id, columnId, status: TaskStatus.PENDING }),
      ...extra,
    });
    // Done card whose reporter ended without the orchestrator noticing.
    await system.taskStore.save(card("card-done", "ws-a", "done", {
      status: TaskStatus.COMPLETED,
      verificationVerdict: VerificationVerdict.APPROVED,
      triggerSessionId: "dead-reporter",
      laneSessions: [
        { ...running("dead-pusher", "done", 0), status: "completed" },
        running("dead-reporter", "done", 1),
      ],
    }));
    // Todo card in another workspace: a stale record in the current column
    // and one left behind in a column the card has already left.
    await system.taskStore.save(card("card-todo", "ws-b", "todo", {
      triggerSessionId: "dead-other-trigger",
      laneSessions: [
        running("dead-review-guard", "review", 0),
        running("dead-contract", "todo", 1),
      ],
    }));
    // A step this process is running right now stays untouched.
    liveSessionIds.add("live-guard");
    await system.taskStore.save(card("card-live", "ws-a", "review", {
      triggerSessionId: "live-guard",
      laneSessions: [running("live-guard", "review", 0)],
    }));
    return system;
  }

  beforeEach(() => {
    liveSessionIds.clear();
    triggerAssignedTaskAgentMock.mockReset();
  });

  it("ends every dead running record, in any column, and keeps live ones", async () => {
    const system = await setup();

    const result = await endStaleRunningLaneSessions(system, options);

    expect(result.sessions.sort()).toEqual(["dead-contract", "dead-reporter", "dead-review-guard"]);
    expect(result.cards).toBe(2);

    const done = await system.taskStore.get("card-done");
    expect(done?.triggerSessionId).toBeUndefined();
    // Card has a verdict: same terminal status revive gives it.
    expect(done?.laneSessions?.find((entry) => entry.sessionId === "dead-reporter"))
      .toMatchObject({ status: "transitioned", completedAt: expect.any(String) });

    const todo = await system.taskStore.get("card-todo");
    expect(todo?.triggerSessionId).toBeUndefined();
    expect(todo?.laneSessions?.find((entry) => entry.sessionId === "dead-contract"))
      .toMatchObject({ status: "timed_out", completedAt: expect.any(String) });
    expect(todo?.laneSessions?.find((entry) => entry.sessionId === "dead-review-guard"))
      .toMatchObject({ status: "transitioned", completedAt: expect.any(String) });

    const live = await system.taskStore.get("card-live");
    expect(live?.triggerSessionId).toBe("live-guard");
    expect(live?.laneSessions?.[0]).toMatchObject({ status: "running" });
    expect(live?.laneSessions?.[0]?.completedAt).toBeUndefined();

    expect(triggerAssignedTaskAgentMock).not.toHaveBeenCalled();
  });

  it("finds nothing to end on a second run", async () => {
    const system = await setup();
    await endStaleRunningLaneSessions(system, options);

    const again = await endStaleRunningLaneSessions(system, options);

    expect(again).toEqual({ cards: 0, sessions: [] });
  });
});

describe("startup sweep wiring", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    sweepMock.mockReset().mockResolvedValue({ cards: 1, sessions: ["dead-reporter"] });
    driverMock.mockReset().mockReturnValue("sqlite");
    vi.doMock("../restart-recovery", () => ({ endStaleRunningLaneSessions: sweepMock }));
    vi.doMock("../../db/index", () => ({ getDatabaseDriver: driverMock }));
    vi.doMock("../../routa-system", () => ({ getRoutaSystem: () => ({}) }));
    vi.doMock("../../acp/http-session-store", () => ({ getHttpSessionStore: () => ({}) }));
    vi.doMock("../../acp/processer", () => ({ getAcpProcessManager: () => ({}) }));
    delete process.env.NEXT_PHASE;
    delete process.env.ROUTA_ACP_RUNNER_URL;
    delete process.env.ROUTA_SKIP_RUNTIME_SERVICES;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.doUnmock("../restart-recovery");
    vi.doUnmock("../../db/index");
    vi.doUnmock("../../routa-system");
    vi.doUnmock("../../acp/http-session-store");
    vi.doUnmock("../../acp/processer");
  });

  it("runs on a local SQLite server start", async () => {
    const { endStaleRunningLaneSessionsOnStartup } = await import("../startup-lane-sweep");
    await endStaleRunningLaneSessionsOnStartup();
    expect(sweepMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["next build", () => { process.env.NEXT_PHASE = "phase-production-build"; }],
    ["an ACP runner", () => { process.env.ROUTA_ACP_RUNNER_URL = "http://runner"; }],
    ["a shared Postgres database", () => { driverMock.mockReturnValue("postgres"); }],
  ])("does not run under %s", async (_label, arrange) => {
    arrange();
    const { endStaleRunningLaneSessionsOnStartup } = await import("../startup-lane-sweep");
    await endStaleRunningLaneSessionsOnStartup();
    expect(sweepMock).not.toHaveBeenCalled();
  });

  it("instrumentation register() runs the sweep before serving", async () => {
    vi.doMock("@/core/telemetry/node-otel", () => ({ initializeNextRuntimeTelemetry: () => ({ enabled: false }) }));
    vi.doMock("@/core/scheduling/scheduler-service", () => ({ startSchedulerService: vi.fn() }));
    vi.doMock("@/core/background-worker", () => ({ startBackgroundWorker: vi.fn() }));
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.ROUTA_RUNTIME_SERVICES_DELAY_MS = "60000";
    vi.useFakeTimers();
    try {
      const { register } = await import("@/instrumentation");
      await register();
      expect(sweepMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.doUnmock("@/core/telemetry/node-otel");
      vi.doUnmock("@/core/scheduling/scheduler-service");
      vi.doUnmock("@/core/background-worker");
    }
  });
});
