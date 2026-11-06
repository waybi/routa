// @vitest-environment node
/**
 * Card beb29624 (C2–C5, C7 MCP, C14, F2, F4): a card with the "hold" label
 * starts no agent session on any automatic path, and the skip is not a
 * failure. Every case runs the real orchestrator singleton, session queue
 * and in-memory stores; only the agent launch and the process manager are
 * faked. Each hold case has a control card without hold that still starts.
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
import { createKanbanBoard, type KanbanAutomationStep, type KanbanColumn } from "../../models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "../../models/task";
import { createWorkspace } from "../../models/workspace";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import { KanbanTools } from "../../tools/kanban-tools";
import { KanbanSessionQueue } from "../kanban-session-queue";
import { resumeInterruptedLaneSteps, stopInterruptedLaneResumeTimers } from "../interrupted-lane-resume";
import { clearLaneRerunClaims } from "../lane-rerun-claim";
import { endStaleRunningLaneSessions, reviveMissingEntryAutomations } from "../restart-recovery";
import {
  enqueueKanbanTaskSession,
  getKanbanSessionQueue,
  getWorkflowOrchestrator,
  processKanbanColumnTransition,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";
import {
  cleanupSessionCwd,
  createLaneHarness,
  orchestratorOf,
  runToInterruptedStep,
  settle,
  type LaneHarness,
} from "./lane-interrupt-harness";

const BOARD_ID = "board-hold";
const WS = "default";
const COLUMN_IDS = ["backlog", "todo", "dev", "review", "done", "blocked"] as const;
type ColumnId = typeof COLUMN_IDS[number];

const step = (id: string, specialistId = id): KanbanAutomationStep => ({
  id, providerId: "claude", role: "GATE", specialistId, specialistName: specialistId,
});

function columns(options: { donePusher?: boolean } = {}): KanbanColumn[] {
  const steps: Record<ColumnId, KanbanAutomationStep[]> = {
    backlog: [step("refiner")],
    todo: [step("todo-a"), step("todo-b")],
    dev: [step("crafter")],
    review: [step("qa"), step("guard")],
    done: options.donePusher === false ? [step("kanban-done-reporter")] : [step("kanban-main-pusher"), step("kanban-done-reporter")],
    blocked: [step("triage", "kanban-blocked-triage")],
  };
  return COLUMN_IDS.map((id, position) => ({
    id, name: id, position, stage: id,
    automation: { enabled: true, transitionType: "entry", steps: steps[id] },
  }));
}

async function setup(options: { limit?: number; donePusher?: boolean } = {}): Promise<RoutaSystem> {
  const system = createInMemorySystem();
  await system.workspaceStore.save(createWorkspace({
    id: WS, title: "Default", metadata: { [`kanbanSessionConcurrencyLimit:${BOARD_ID}`]: String(options.limit ?? 10) },
  }));
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: BOARD_ID, workspaceId: WS, name: "Board", isDefault: true, columns: columns(options),
  }));
  startWorkflowOrchestrator(system);
  return system;
}

async function seed(system: RoutaSystem, id: string, columnId: ColumnId, extra: Partial<Task> = {}): Promise<Task> {
  const task: Task = {
    ...createTask({
      id, title: `card ${id}`, objective: "track only", workspaceId: WS, boardId: BOARD_ID, columnId,
      status: columnId === "blocked" ? TaskStatus.BLOCKED : TaskStatus.PENDING,
    }),
    ...extra,
  };
  await system.taskStore.save(task);
  return task;
}

const startedCards = () => triggerMock.mock.calls.map((call) => (call[0] as { task: { id: string } }).task.id);

/** The hold card ended quietly: no session, no failure, not queued anywhere. */
async function expectHeld(system: RoutaSystem, id: string, columnId: string): Promise<void> {
  expect(startedCards()).not.toContain(id);
  const saved = (await system.taskStore.get(id))!;
  expect(saved.columnId).toBe(columnId);
  expect(saved.triggerSessionId).toBeUndefined();
  expect(saved.lastSyncError).toBeUndefined();
  expect((saved.laneSessions ?? []).filter((entry) => entry.status === "running")).toEqual([]);
  expect((saved.comments ?? []).length).toBe(0);
  const automation = getWorkflowOrchestrator(system).getAutomationForCard(id);
  expect(automation?.status === "queued" || automation?.status === "running").toBe(false);
  const snapshot = await getKanbanSessionQueue(system).getBoardSnapshot(BOARD_ID);
  expect(snapshot.queuedCardIds).not.toContain(id);
  expect(snapshot.runningCards.map((card) => card.cardId)).not.toContain(id);
}

let info: ReturnType<typeof vi.spyOn>;
let sessionSeq = 0;

beforeEach(() => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetWorkflowOrchestrator();
  clearLaneRerunClaims();
  triggerMock.mockReset();
  killSessionMock.mockClear();
  triggerMock.mockImplementation(async (params: { task: { id: string } }) => ({
    sessionId: `${params.task.id}:session-${sessionSeq += 1}`, transport: "acp",
  }));
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  info.mockRestore();
  stopInterruptedLaneResumeTimers();
  resetWorkflowOrchestrator();
  vi.unstubAllEnvs();
});

afterAll(() => cleanupSessionCwd());

const holdLines = () => info.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.includes("[KanbanHold]"));

const ENQUEUE_PATHS = [
  ["plain", {}],
  ["bypassQueue", { bypassQueue: true }],
  ["resumeLane", { resumeLane: true, ignoreExistingTrigger: true }],
  ["adoptLaneRun", { adoptLaneRun: true, ignoreExistingTrigger: true, stepIndex: 0 }],
] as const;

describe("C2: enqueueKanbanTaskSession, every column × every execution path", () => {
  for (const columnId of COLUMN_IDS) {
    it.each(ENQUEUE_PATHS)(`${columnId} / %s: hold → on_hold; control card starts once`, async (_label, extra) => {
      const system = await setup();
      const firstStep = columns().find((column) => column.id === columnId)!.automation!.steps![0];
      const pathParams = "adoptLaneRun" in extra ? { ...extra, step: firstStep } : extra;
      const held = await seed(system, `held-${columnId}`, columnId, { labels: ["req:x", "HOLD"] });
      // The column transition marked the lane queued before asking for a session.
      await getWorkflowOrchestrator(system).adoptLaneRun({ cardId: held.id, columnId, stepIndex: 0 });
      expect(getWorkflowOrchestrator(system).getAutomationForCard(held.id)?.status).toBe("queued");

      const result = await enqueueKanbanTaskSession(system, { task: held, expectedColumnId: columnId, ...pathParams });
      expect(result).toEqual({ queued: false, error: "on_hold" });
      await settle();
      await expectHeld(system, held.id, columnId);
      expect((await system.taskStore.get(held.id))?.laneSessions ?? []).toEqual([]);
      expect((await getKanbanSessionQueue(system).getBoardSnapshot(BOARD_ID)).runningCount).toBe(0);
      expect(holdLines()).toEqual([`[KanbanHold] card ${held.id} on hold; no session started`]);

      // F2: the same call for a card without hold still starts a session.
      const control = await seed(system, `control-${columnId}`, columnId, { labels: ["req:x", "deploy:host"] });
      const controlResult = await enqueueKanbanTaskSession(system, { task: control, expectedColumnId: columnId, ...pathParams });
      expect(controlResult.sessionId).toBe(`${control.id}:session-${sessionSeq}`);
      await vi.waitFor(() => expect(startedCards()).toEqual([control.id]));
    });
  }
});

describe("C2 / AC1 / C14: column transitions (PATCH columnId, POST /api/tasks, MCP move) for a held card", () => {
  for (const columnId of COLUMN_IDS) {
    it(`entering ${columnId}: no session, no lane record, automation dropped`, async () => {
      const system = await setup();
      await seed(system, "held", columnId, { labels: ["Hold"] });
      await processKanbanColumnTransition(system, {
        cardId: "held", cardTitle: "held", boardId: BOARD_ID, workspaceId: WS, fromColumnId: "__created__", toColumnId: columnId,
      });
      await settle();
      await expectHeld(system, "held", columnId);
      expect((await system.taskStore.get("held"))?.laneSessions ?? []).toEqual([]);
    });
  }

  it.each([true, false])("C14: Done with pusher=%s → neither Main Pusher nor Done Reporter starts", async (donePusher) => {
    const system = await setup({ donePusher });
    await seed(system, "held", "review", { labels: ["hold"] });
    const moved = await kanbanTools(system).moveCard({ cardId: "held", targetColumnId: "done" });
    expect(moved.success).toBe(true);
    await settle(80);
    await expectHeld(system, "held", "done");
  });

  it("F2: the same transition for a card with labels null / [] / hold-xxx starts its first step", async () => {
    for (const labels of [null, [], ["hold-xxx"]] as const) {
      resetWorkflowOrchestrator();
      triggerMock.mockClear();
      const system = await setup();
      await seed(system, "control", "todo", { labels: labels as never });
      await processKanbanColumnTransition(system, {
        cardId: "control", cardTitle: "control", boardId: BOARD_ID, workspaceId: WS, fromColumnId: "backlog", toColumnId: "todo",
      });
      await vi.waitFor(() => expect(startedCards()).toEqual(["control"]));
      expect(getWorkflowOrchestrator(system).getAutomationForCard("control")?.status).toBe("running");
    }
  });
});

function kanbanTools(system: RoutaSystem): KanbanTools {
  const tools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
  tools.setEventBus(system.eventBus);
  tools.setAutomationSystem(system);
  return tools;
}

describe("C7: MCP kanban-tools", () => {
  it("createCard with labels [hold] into an automated column: tool succeeds, no session, no warning", async () => {
    const system = await setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const created = await kanbanTools(system).createCard({ boardId: BOARD_ID, columnId: "todo", title: "track", workspaceId: WS, labels: ["hold"] });
    expect(created.success).toBe(true);
    const id = (created.data as { cardId?: string; id?: string }).cardId ?? (created.data as { id: string }).id;
    await settle(80);
    await expectHeld(system, id, "todo");
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("[KanbanTools]"))).toEqual([]);
    warn.mockRestore();
  });

  it("control: createCard without hold starts the column's first step once", async () => {
    const system = await setup();
    const created = await kanbanTools(system).createCard({ boardId: BOARD_ID, columnId: "todo", title: "work", workspaceId: WS });
    expect(created.success).toBe(true);
    await vi.waitFor(() => expect(triggerMock).toHaveBeenCalledTimes(1));
  });
});

function endTurn(sessionId: string): AgentEvent {
  return { type: AgentEventType.AGENT_COMPLETED, agentId: sessionId, workspaceId: WS, data: { sessionId, success: true, stopReason: "end_turn" }, timestamp: new Date() };
}

describe("C3: the board queue drops a card put on hold while it waited", () => {
  it("limit 1: A runs, B (later held) and C wait; A ends → B dropped without a slot, C starts", async () => {
    const system = await setup({ limit: 1 });
    const a = await seed(system, "a", "dev");
    const b = await seed(system, "b", "dev");
    const c = await seed(system, "c", "dev");
    const runA = await enqueueKanbanTaskSession(system, { task: a, expectedColumnId: "dev" });
    expect(runA.sessionId).toBeTruthy();
    expect(await enqueueKanbanTaskSession(system, { task: b, expectedColumnId: "dev" })).toEqual({ queued: true });
    expect(await enqueueKanbanTaskSession(system, { task: c, expectedColumnId: "dev" })).toEqual({ queued: true });
    await getWorkflowOrchestrator(system).adoptLaneRun({ cardId: "b", columnId: "dev", stepIndex: 0 });

    await system.taskStore.save({ ...(await system.taskStore.get("b"))!, labels: ["hold"] });
    system.eventBus.emit(endTurn(runA.sessionId!));
    await vi.waitFor(() => expect(startedCards()).toEqual(["a", "c"]));
    await settle();

    await expectHeld(system, "b", "dev");
    const snapshot = await getKanbanSessionQueue(system).getBoardSnapshot(BOARD_ID);
    expect(snapshot.runningCards.map((card) => card.cardId)).toEqual(["c"]);
    expect(snapshot.queuedCount).toBe(0);
    expect(holdLines()).toEqual(["[KanbanHold] card b on hold; no session started"]);
    // Enqueued again, the held card is not answered "already queued".
    expect(await enqueueKanbanTaskSession(system, { task: (await system.taskStore.get("b"))!, expectedColumnId: "dev" }))
      .toEqual({ queued: false, error: "on_hold" });
  });

  it("startKanbanTaskSession re-reads the card: a caller's stale copy without hold still starts nothing", async () => {
    for (const bypassQueue of [true, false]) {
      resetWorkflowOrchestrator();
      triggerMock.mockClear();
      const system = await setup();
      const stale = await seed(system, "held", "dev");
      await system.taskStore.save({ ...stale, labels: ["hold"] });
      const result = await enqueueKanbanTaskSession(system, { task: stale, expectedColumnId: "dev", bypassQueue });
      expect(result).toEqual({ queued: false, error: "on_hold" });
      await expectHeld(system, "held", "dev");
    }
  });
});

describe("C3: KanbanSessionQueue.drainQueue on its own", () => {
  it("a held queued entry is dropped before its start runs; the drop is reported; the next entry starts", async () => {
    const system = createInMemorySystem();
    for (const id of ["a", "b", "c"]) await system.taskStore.save(createTask({ id, title: id, objective: id, workspaceId: WS, boardId: BOARD_ID, columnId: "dev" }));
    const dropped: Array<[string, string | undefined]> = [];
    const queue = new KanbanSessionQueue(system.eventBus, system.taskStore, async () => 1, (cardId, columnId) => dropped.push([cardId, columnId]));
    queue.start();
    const starts: string[] = [];
    const job = (cardId: string) => ({
      cardId, cardTitle: cardId, boardId: BOARD_ID, workspaceId: WS, columnId: "dev",
      start: async () => { starts.push(cardId); return { sessionId: `${cardId}-session` }; },
    });
    expect((await queue.enqueue(job("a"))).sessionId).toBe("a-session");
    expect(await queue.enqueue(job("b"))).toEqual({ queued: true });
    expect(await queue.enqueue(job("c"))).toEqual({ queued: true });
    await system.taskStore.save({ ...(await system.taskStore.get("b"))!, labels: ["hold"] });

    system.eventBus.emit(endTurn("a-session"));
    await vi.waitFor(() => expect(starts).toEqual(["a", "c"]));
    expect(dropped).toEqual([["b", "dev"]]);
    const snapshot = await queue.getBoardSnapshot(BOARD_ID);
    expect(snapshot.runningCards.map((card) => card.cardId)).toEqual(["c"]);
    expect(snapshot.queuedCardIds).toEqual([]);
    queue.stop();
  });
});

describe("C4 / AC4: hold added while a step runs", () => {
  async function holdRunningCard(h: LaneHarness): Promise<void> {
    const card = await h.card();
    await h.system.taskStore.save({ ...card, labels: [...(card.labels ?? []), "hold"] });
  }
  const handleEnd = (h: LaneHarness, event: AgentEvent) =>
    (orchestratorOf(h) as unknown as { handleAgentCompletion(event: AgentEvent): Promise<void> }).handleAgentCompletion(event);

  it("Todo step 0 running → hold: the session keeps running; at its end step 1 is not started and nothing is failed", async () => {
    const h = await createLaneHarness("todo", triggerMock);
    await processKanbanColumnTransition(h.system, {
      cardId: h.cardId, cardTitle: "c", boardId: h.boardId, workspaceId: WS, fromColumnId: "backlog", toColumnId: "todo",
    });
    const first = await h.waitForStep(0);
    await holdRunningCard(h);
    await settle();
    expect(killSessionMock).not.toHaveBeenCalled();
    expect((await h.laneRecord(first))?.status).toBe("running");
    expect(orchestratorOf(h).getAutomationForCard(h.cardId)?.status).toBe("running");

    await handleEnd(h, endTurn(first));
    await settle();

    expect(triggerMock).toHaveBeenCalledTimes(1);
    const card = await h.card();
    expect(card.columnId).toBe("todo");
    expect(card.lastSyncError).toBeUndefined();
    expect(card.comments ?? []).toEqual([]);
    expect((await h.laneRecord(first))?.status).toBe("completed");
    const automation = orchestratorOf(h).getAutomationForCard(h.cardId);
    expect(automation?.status === "queued" || automation?.status === "running" || automation?.status === "failed").toBe(false);
  });

  it("control: without hold the same step end starts step 1", async () => {
    const h = await createLaneHarness("todo", triggerMock);
    await runToInterruptedStep(h);
    expect(h.latestSession(1)).toBeTruthy();
    expect(triggerMock).toHaveBeenCalledTimes(2);
  });

  it("Review last step running → hold: its end auto-advances to Done, and Done starts no session", async () => {
    const h = await createLaneHarness("review", triggerMock);
    const board = (await h.system.kanbanBoardStore.get(h.boardId))!;
    board.columns = board.columns.map((column) => column.id === "done"
      ? { ...column, automation: { enabled: true, transitionType: "entry", steps: [step("kanban-main-pusher")] } }
      : column);
    await h.system.kanbanBoardStore.save(board);
    const last = await runToInterruptedStep(h);
    const startsBefore = triggerMock.mock.calls.length;
    await holdRunningCard(h);

    await handleEnd(h, endTurn(last));
    await vi.waitFor(async () => expect((await h.card()).columnId).toBe("done"), { timeout: 5_000 });
    await settle(80);

    expect(triggerMock.mock.calls.length).toBe(startsBefore);
    const card = await h.card();
    expect(card.lastSyncError).toBeUndefined();
    expect(card.triggerSessionId).toBeUndefined();
    expect((card.laneSessions ?? []).filter((entry) => entry.columnId === "done")).toEqual([]);
  });
});

let clock = Date.now() - 3_600_000;
const at = () => new Date(clock += 60_000).toISOString();
const run = (columnId: string, stepIndex: number, extra: Partial<TaskLaneSession> = {}): TaskLaneSession => ({
  sessionId: `old-${columnId}-${stepIndex}-${clock}`, columnId, stepIndex, status: "completed", startedAt: at(), ...extra,
});

const REVIVE_SHAPES: Array<[string, () => TaskLaneSession[]]> = [
  ["running leftover (restart ended it)", () => [run("review", 0), run("review", 1, { status: "running" })]],
  ["previous step completed, next step due", () => [run("review", 0)]],
  ["timed_out step to rerun", () => [run("review", 0), run("review", 1, { status: "timed_out", recoveryReason: "restart_interrupted" })]],
  ["no run yet (column re-entry)", () => []],
];

const deadProcess = {
  sessionStore: { getSession: () => undefined } as never,
  processManager: { hasActiveSession: () => false, killSession: killSessionMock } as never,
};

describe("C5: revive / restart recovery / interrupted resume / startup sweep", () => {
  it.each(REVIVE_SHAPES)("revive, %s: held card left alone, control card started once", async (_label, history) => {
    const system = await setup();
    await seed(system, "held", "review", { labels: ["hold"], laneSessions: history() });
    await seed(system, "control", "review", { laneSessions: history() });
    await reviveMissingEntryAutomations(system, WS, BOARD_ID, deadProcess);
    await vi.waitFor(() => expect(startedCards()).toEqual(["control"]));
    await settle();
    await expectHeld(system, "held", "review");
    const held = (await system.taskStore.get("held"))!;
    expect(held.laneSessions).toHaveLength(history().length);
  });

  it("startup: the sweep only ends stale records; the interrupted resume skips the held card", async () => {
    const system = await setup();
    const history = () => [run("review", 0), run("review", 1, { status: "running" })];
    await seed(system, "held", "review", { labels: ["hold"], laneSessions: history() });
    await seed(system, "control", "review", { laneSessions: history() });

    const swept = await endStaleRunningLaneSessions(system, deadProcess);
    expect(swept.cards).toBe(2);
    expect(triggerMock).not.toHaveBeenCalled();
    expect((await system.taskStore.get("held"))?.laneSessions?.at(-1)).toMatchObject({ status: "timed_out", recoveryReason: "restart_interrupted" });

    const resumed = await resumeInterruptedLaneSteps(system);
    expect(resumed.resumed.map((entry) => entry.split(":")[0])).toEqual(["control"]);
    await vi.waitFor(() => expect(startedCards()).toEqual(["control"]));
    await settle();
    await expectHeld(system, "held", "review");
  });
});
