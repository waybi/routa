// @vitest-environment node
/**
 * Card a00fb67b (L400; C2–C6, F2, F4): a "hold:<role>" label stops only that
 * role's session starts, on every start path; other roles still start. A
 * role-held start writes "hold:<role> 拦下" into lastSyncError and is not a
 * failure. Real orchestrator singleton, session queue and in-memory stores;
 * only the agent launch and the process manager are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerMock } = vi.hoisted(() => ({ triggerMock: vi.fn() }));

vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerMock,
  getInternalApiOrigin: () => "http://localhost",
}));
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: vi.fn(), hasActiveSession: () => false }),
}));

import { AgentEventType, type AgentEvent } from "../../events/event-bus";
import { createKanbanBoard, type KanbanAutomationStep, type KanbanColumn } from "../../models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "../../models/task";
import { createWorkspace } from "../../models/workspace";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import { KanbanTools } from "../../tools/kanban-tools";
import { decideInterruptedLaneResume, resumeInterruptedLaneSteps, stopInterruptedLaneResumeTimers } from "../interrupted-lane-resume";
import { KanbanSessionQueue } from "../kanban-session-queue";
import { clearLaneRerunClaims } from "../lane-rerun-claim";
import { reviveMissingEntryAutomations } from "../restart-recovery";
import { formatRoleHoldSyncError } from "../task-hold";
import {
  enqueueKanbanTaskSession,
  getKanbanSessionQueue,
  getWorkflowOrchestrator,
  processKanbanColumnTransition,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";

const BOARD_ID = "board-role-hold";
const WS = "default";
const PUSHER = "kanban-main-pusher";
const REPORTER = "kanban-done-reporter";
const GUARD = "kanban-review-guard";
const CRAFTER = "kanban-dev-crafter";
const ROLE_HOLD = `hold:${PUSHER}`;
const HELD_TEXT = formatRoleHoldSyncError(PUSHER);

const step = (specialistId: string): KanbanAutomationStep => ({
  id: specialistId, providerId: "claude", role: "GATE", specialistId, specialistName: specialistId,
});

function columns(options: { donePusher?: boolean } = {}): KanbanColumn[] {
  const steps: Record<string, KanbanAutomationStep[]> = {
    dev: [step(CRAFTER)],
    review: [step(GUARD)],
    done: options.donePusher === false ? [step(REPORTER)] : [step(PUSHER), step(REPORTER)],
  };
  return ["todo", "dev", "review", "done", "blocked"].map((id, position) => ({
    id, name: id, position, stage: id as KanbanColumn["stage"],
    automation: steps[id] ? { enabled: true, transitionType: "entry", steps: steps[id] } : undefined,
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

async function seed(system: RoutaSystem, id: string, columnId: string, extra: Partial<Task> = {}): Promise<Task> {
  const task: Task = {
    ...createTask({ id, title: `card ${id}`, objective: "o", workspaceId: WS, boardId: BOARD_ID, columnId, status: TaskStatus.PENDING }),
    ...extra,
  };
  await system.taskStore.save(task);
  return task;
}

type Started = { card: string; role: string | undefined };
const started = (): Started[] => triggerMock.mock.calls.map((call) => {
  const params = call[0] as { task: { id: string }; step?: { specialistId?: string } };
  return { card: params.task.id, role: params.step?.specialistId };
});
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/** The role-held start ended quietly with its reason on the card: no session, nothing failed. */
async function expectRoleHeld(system: RoutaSystem, id: string, columnId: string, seededRuns = 0): Promise<void> {
  expect(started().filter((entry) => entry.card === id)).toEqual([]);
  const saved = (await system.taskStore.get(id))!;
  expect(saved.columnId).toBe(columnId);
  expect(saved.triggerSessionId).toBeUndefined();
  expect(saved.lastSyncError).toBe(HELD_TEXT);
  expect(saved.lastSyncError).toContain("hold:kanban-main-pusher 拦下");
  expect(saved.laneSessions ?? []).toHaveLength(seededRuns);
  for (const entry of (saved.laneSessions ?? []).slice(seededRuns)) {
    expect(entry.status === "failed" || entry.status === "running").toBe(false);
  }
  const automation = getWorkflowOrchestrator(system).getAutomationForCard(id);
  expect(automation?.status === "queued" || automation?.status === "running" || automation?.status === "failed").toBe(false);
  const snapshot = await getKanbanSessionQueue(system).getBoardSnapshot(BOARD_ID);
  expect(snapshot.queuedCardIds).not.toContain(id);
  expect(snapshot.runningCards.map((card) => card.cardId)).not.toContain(id);
  expect(saved.columnId).not.toBe("blocked");
}

let clock = Date.now() - 3_600_000;
const run = (columnId: string, stepIndex: number, extra: Partial<TaskLaneSession> = {}): TaskLaneSession => ({
  sessionId: `old-${columnId}-${stepIndex}-${clock += 60_000}`, columnId, stepIndex, status: "completed", startedAt: new Date(clock).toISOString(), ...extra,
});

let info: ReturnType<typeof vi.spyOn>;
let seq = 0;

beforeEach(() => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetWorkflowOrchestrator();
  clearLaneRerunClaims();
  triggerMock.mockReset();
  triggerMock.mockImplementation(async (params: { task: { id: string } }) => ({ sessionId: `${params.task.id}:s${seq += 1}`, transport: "acp" }));
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  info.mockRestore();
  stopInterruptedLaneResumeTimers();
  resetWorkflowOrchestrator();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const holdLines = () => info.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.includes("[KanbanHold]"));

describe("F4 createAutomationSession (column transition)", () => {
  it("entering Done with hold:kanban-main-pusher: the pusher does not start; reason written; not failed", async () => {
    const system = await setup();
    await seed(system, "held", "done", { labels: ["req:x", ROLE_HOLD] });
    await processKanbanColumnTransition(system, { cardId: "held", cardTitle: "held", boardId: BOARD_ID, workspaceId: WS, fromColumnId: "review", toColumnId: "done" });
    await settle();
    await expectRoleHeld(system, "held", "done");
    // C18: the log line names the role and the scope.
    expect(holdLines()).toEqual([`[KanbanHold] card held hold:${PUSHER} (scope=role); no ${PUSHER} session started`]);
  });

  it("the lane's next step: pusher ends, hold:kanban-done-reporter stops the reporter; nothing failed, not Blocked", async () => {
    const system = await setup();
    await seed(system, "n", "done");
    await processKanbanColumnTransition(system, { cardId: "n", cardTitle: "n", boardId: BOARD_ID, workspaceId: WS, fromColumnId: "review", toColumnId: "done" });
    await vi.waitFor(() => expect(started()).toEqual([{ card: "n", role: PUSHER }]));
    const pusherSession = (await system.taskStore.get("n"))!.triggerSessionId!;
    await system.taskStore.save({ ...(await system.taskStore.get("n"))!, labels: [`hold:${REPORTER}`] });
    await (getWorkflowOrchestrator(system) as unknown as { handleAgentCompletion(event: AgentEvent): Promise<void> })
      .handleAgentCompletion(endTurn(pusherSession));
    await settle(80);
    expect(started()).toEqual([{ card: "n", role: PUSHER }]);
    const saved = (await system.taskStore.get("n"))!;
    expect(saved.columnId).toBe("done");
    expect(saved.lastSyncError).toBe(formatRoleHoldSyncError(REPORTER));
    expect((saved.laneSessions ?? []).filter((entry) => entry.status === "failed")).toEqual([]);
    expect(holdLines()).toEqual([`[KanbanHold] card n hold:${REPORTER} (scope=role); no ${REPORTER} session started`]);
    const automation = getWorkflowOrchestrator(system).getAutomationForCard("n");
    expect(automation?.status === "failed" || automation?.status === "running" || automation?.status === "queued").toBe(false);
  });

  it("entering Review with hold:kanban-main-pusher: the review guard starts as usual", async () => {
    const system = await setup();
    await seed(system, "c", "review", { labels: [ROLE_HOLD] });
    await processKanbanColumnTransition(system, { cardId: "c", cardTitle: "c", boardId: BOARD_ID, workspaceId: WS, fromColumnId: "dev", toColumnId: "review" });
    await vi.waitFor(() => expect(started()).toEqual([{ card: "c", role: GUARD }]));
    expect((await system.taskStore.get("c"))?.lastSyncError).toBeUndefined();
  });

  it("F2: whole-card hold entering Done or Review starts nothing and leaves lastSyncError as it was", async () => {
    const system = await setup();
    for (const [id, columnId] of [["d", "done"], ["r", "review"]] as const) {
      await seed(system, id, columnId, { labels: ["hold"], lastSyncError: "旧原因" });
      await processKanbanColumnTransition(system, { cardId: id, cardTitle: id, boardId: BOARD_ID, workspaceId: WS, fromColumnId: "dev", toColumnId: columnId });
    }
    await settle();
    expect(triggerMock).not.toHaveBeenCalled();
    expect((await system.taskStore.get("d"))?.lastSyncError).toBe("旧原因");
    expect((await system.taskStore.get("r"))?.lastSyncError).toBe("旧原因");
  });

  it("F2: no hold label: entering Done starts the pusher", async () => {
    const system = await setup();
    await seed(system, "c", "done", { labels: ["hold-xxx", "req:hold"] });
    await processKanbanColumnTransition(system, { cardId: "c", cardTitle: "c", boardId: BOARD_ID, workspaceId: WS, fromColumnId: "review", toColumnId: "done" });
    await vi.waitFor(() => expect(started()).toEqual([{ card: "c", role: PUSHER }]));
  });
});

const ENQUEUE_PATHS = [
  ["plain (no step: the effective role)", {}],
  ["bypassQueue", { bypassQueue: true }],
  ["resumeLane", { resumeLane: true, ignoreExistingTrigger: true }],
  ["adoptLaneRun with the column's first step", { adoptLaneRun: true, ignoreExistingTrigger: true, stepIndex: 0, withFirstStep: true }],
] as const;

describe("F4 enqueueKanbanTaskSession, every execution path", () => {
  it.each(ENQUEUE_PATHS)("%s: Done pusher held; Review guard starts", async (_label, extra) => {
    const system = await setup();
    const { withFirstStep, ...pathParams } = { withFirstStep: false, ...extra };
    const doneStep = withFirstStep ? { step: step(PUSHER) } : {};
    const held = await seed(system, "held", "done", { labels: [ROLE_HOLD] });
    await getWorkflowOrchestrator(system).adoptLaneRun({ cardId: "held", columnId: "done", stepIndex: 0 });
    const result = await enqueueKanbanTaskSession(system, { task: held, expectedColumnId: "done", ...pathParams, ...doneStep });
    expect(result).toEqual({ queued: false, error: "on_hold" });
    await settle();
    await expectRoleHeld(system, "held", "done");
    expect((await system.taskStore.get("held"))?.laneSessions ?? []).toEqual([]);

    const reviewStep = withFirstStep ? { step: step(GUARD) } : {};
    const control = await seed(system, "control", "review", { labels: [ROLE_HOLD] });
    const controlResult = await enqueueKanbanTaskSession(system, { task: control, expectedColumnId: "review", ...pathParams, ...reviewStep });
    expect(controlResult.sessionId).toBeTruthy();
    await vi.waitFor(() => expect(started()).toEqual([{ card: "control", role: GUARD }]));
  });

  it("a full board: the held pusher is answered on_hold at once, not queued for a slot", async () => {
    const system = await setup({ limit: 1 });
    const busy = await seed(system, "busy", "dev");
    expect((await enqueueKanbanTaskSession(system, { task: busy, expectedColumnId: "dev" })).sessionId).toBeTruthy();
    for (const extra of [{}, { step: step(PUSHER), stepIndex: 0 }]) {
      const held = await seed(system, "held", "done", { labels: [ROLE_HOLD] });
      expect(await enqueueKanbanTaskSession(system, { task: held, expectedColumnId: "done", ...extra })).toEqual({ queued: false, error: "on_hold" });
      expect((await getKanbanSessionQueue(system).getBoardSnapshot(BOARD_ID)).queuedCardIds).toEqual([]);
    }
  });

  it("F2: whole-card hold on the same paths is still on_hold and writes nothing", async () => {
    for (const [, extra] of ENQUEUE_PATHS) {
      resetWorkflowOrchestrator();
      const system = await setup();
      const { withFirstStep, ...pathParams } = { withFirstStep: false, ...extra };
      const held = await seed(system, "held", "review", { labels: ["hold"] });
      const result = await enqueueKanbanTaskSession(system, {
        task: held, expectedColumnId: "review", ...pathParams, ...(withFirstStep ? { step: step(GUARD) } : {}),
      });
      expect(result).toEqual({ queued: false, error: "on_hold" });
      expect((await system.taskStore.get("held"))?.lastSyncError).toBeUndefined();
    }
    expect(triggerMock).not.toHaveBeenCalled();
  });
});

describe("C2: Done lane with several steps (the role is judged on the step that really starts)", () => {
  it("(a) pusher not run yet, manual rerun (resumeLane): the pusher is held", async () => {
    const system = await setup();
    const held = await seed(system, "a", "done", { labels: [ROLE_HOLD] });
    expect(await enqueueKanbanTaskSession(system, { task: held, expectedColumnId: "done", resumeLane: true, ignoreExistingTrigger: true }))
      .toEqual({ queued: false, error: "on_hold" });
    await expectRoleHeld(system, "a", "done");
  });

  it("(a') pusher failed earlier, manual rerun reruns the pusher: held", async () => {
    const system = await setup();
    const held = await seed(system, "a", "done", { labels: [ROLE_HOLD], laneSessions: [run("done", 0, { status: "failed" })] });
    expect(await enqueueKanbanTaskSession(system, { task: held, expectedColumnId: "done", resumeLane: true, ignoreExistingTrigger: true }))
      .toEqual({ queued: false, error: "on_hold" });
    await expectRoleHeld(system, "a", "done", 1);
  });

  it("(b) pusher completed, rerun from the reporter: the reporter starts, no hold text", async () => {
    const system = await setup();
    const card = await seed(system, "b", "done", { labels: [ROLE_HOLD], laneSessions: [run("done", 0)] });
    const result = await enqueueKanbanTaskSession(system, { task: card, expectedColumnId: "done", resumeLane: true, ignoreExistingTrigger: true });
    expect(result.sessionId).toBeTruthy();
    await vi.waitFor(() => expect(started()).toEqual([{ card: "b", role: REPORTER }]));
    expect((await system.taskStore.get("b"))?.lastSyncError).toBeUndefined();
    expect(holdLines()).toEqual([]);
  });

  it("(c) board whose Done lane has only the reporter: entering Done starts the reporter", async () => {
    const system = await setup({ donePusher: false });
    await seed(system, "c", "done", { labels: [ROLE_HOLD] });
    await processKanbanColumnTransition(system, { cardId: "c", cardTitle: "c", boardId: BOARD_ID, workspaceId: WS, fromColumnId: "review", toColumnId: "done" });
    await vi.waitFor(() => expect(started()).toEqual([{ card: "c", role: REPORTER }]));
  });
});

describe("F4 startKanbanTaskSession re-reads the card", () => {
  it.each([true, false])("bypassQueue=%s: a stale caller copy without the label still starts no pusher", async (bypassQueue) => {
    const system = await setup();
    const stale = await seed(system, "s", "done");
    await system.taskStore.save({ ...stale, labels: [ROLE_HOLD] });
    const result = await enqueueKanbanTaskSession(system, { task: stale, expectedColumnId: "done", bypassQueue, step: step(PUSHER), stepIndex: 0 });
    expect(result).toEqual({ queued: false, error: "on_hold" });
    await expectRoleHeld(system, "s", "done");
  });

  it("control: a stale copy in Review with the same label starts the guard", async () => {
    const system = await setup();
    const stale = await seed(system, "s", "review");
    await system.taskStore.save({ ...stale, labels: [ROLE_HOLD] });
    const result = await enqueueKanbanTaskSession(system, { task: stale, expectedColumnId: "review", bypassQueue: true, step: step(GUARD), stepIndex: 0 });
    expect(result.sessionId).toBeTruthy();
    expect(started()).toEqual([{ card: "s", role: GUARD }]);
  });
});

function endTurn(sessionId: string): AgentEvent {
  return { type: AgentEventType.AGENT_COMPLETED, agentId: sessionId, workspaceId: WS, data: { sessionId, success: true, stopReason: "end_turn" }, timestamp: new Date() };
}

describe("C6 / F4 drainQueue: label added while the job waits", () => {
  it("limit 1: the queued pusher is dropped with its reason, the queued review guard starts", async () => {
    const system = await setup({ limit: 1 });
    const a = await seed(system, "a", "dev");
    const runA = await enqueueKanbanTaskSession(system, { task: a, expectedColumnId: "dev" });
    expect(runA.sessionId).toBeTruthy();
    const p = await seed(system, "p", "done");
    const r = await seed(system, "r", "review");
    expect(await enqueueKanbanTaskSession(system, { task: p, expectedColumnId: "done" })).toEqual({ queued: true });
    expect(await enqueueKanbanTaskSession(system, { task: r, expectedColumnId: "review" })).toEqual({ queued: true });
    for (const id of ["p", "r"]) {
      await system.taskStore.save({ ...(await system.taskStore.get(id))!, labels: [ROLE_HOLD] });
    }
    system.eventBus.emit(endTurn(runA.sessionId!));
    await vi.waitFor(() => expect(started().map((entry) => entry.card)).toEqual(["a", "r"]));
    await settle();
    await expectRoleHeld(system, "p", "done");
    expect(started().find((entry) => entry.card === "r")?.role).toBe(GUARD);
  });

  it("standalone queue: role entry dropped and reported with the hold; other role and old entry without a role start", async () => {
    const system = createInMemorySystem();
    for (const id of ["a", "p", "r", "old", "whole"]) {
      await system.taskStore.save(createTask({ id, title: id, objective: id, workspaceId: WS, boardId: BOARD_ID, columnId: "done" }));
    }
    const dropped: unknown[][] = [];
    const queue = new KanbanSessionQueue(system.eventBus, system.taskStore, async () => 1, (...args) => { dropped.push(args); });
    queue.start();
    const starts: string[] = [];
    const job = (cardId: string, specialistId?: string) => ({
      cardId, cardTitle: cardId, boardId: BOARD_ID, workspaceId: WS, columnId: "done", specialistId,
      start: async () => { starts.push(cardId); return { sessionId: `${cardId}-session` }; },
    });
    expect((await queue.enqueue(job("a"))).sessionId).toBe("a-session");
    for (const [id, role] of [["p", PUSHER], ["r", GUARD], ["old", undefined], ["whole", PUSHER]] as const) {
      expect(await queue.enqueue(job(id, role))).toEqual({ queued: true });
      await system.taskStore.save({ ...(await system.taskStore.get(id))!, labels: id === "whole" ? ["hold"] : [ROLE_HOLD] });
    }
    for (const id of ["a", "r", "old"]) {
      system.eventBus.emit(endTurn(`${id}-session`));
      await settle(20);
    }
    await vi.waitFor(() => expect(starts).toEqual(["a", "r", "old"]));
    expect(dropped).toEqual([
      ["p", "done", { held: true, scope: "role", specialistId: PUSHER }],
      ["whole", "done", { held: true, scope: "card" }],
    ]);
    queue.stop();
  });
});

describe("C6 / F4 interrupted-lane-resume", () => {
  const interrupted = (stepIndex: number) => run("done", stepIndex, { status: "timed_out", recoveryReason: "restart_interrupted" });

  it("decide: pusher interrupted + hold:pusher → skip with the role; reporter interrupted → resume", () => {
    const cols = columns();
    expect(decideInterruptedLaneResume({ columnId: "done", laneSessions: [interrupted(0)], labels: [ROLE_HOLD] }, cols, new Date()))
      .toEqual({ kind: "skip", reason: `hold:${PUSHER}`, heldSpecialistId: PUSHER });
    const reporter = decideInterruptedLaneResume({ columnId: "done", laneSessions: [run("done", 0), interrupted(1)], labels: [ROLE_HOLD] }, cols, new Date());
    expect(reporter).toMatchObject({ kind: "resume", stepIndex: 1, step: { specialistId: REPORTER } });
    // F2: the whole-card hold keeps its own skip.
    expect(decideInterruptedLaneResume({ columnId: "done", laneSessions: [interrupted(1)], labels: ["hold"] }, cols, new Date()))
      .toEqual({ kind: "skip", reason: "on hold" });
  });

  it("startup resume: the held pusher card is skipped with its reason; the reporter card resumes", async () => {
    const system = await setup();
    await seed(system, "held", "done", { labels: [ROLE_HOLD], laneSessions: [interrupted(0)] });
    await seed(system, "rep", "done", { labels: [ROLE_HOLD], laneSessions: [run("done", 0), interrupted(1)] });
    const result = await resumeInterruptedLaneSteps(system);
    expect(result.resumed.map((entry) => entry.split(":")[0])).toEqual(["rep"]);
    await vi.waitFor(() => expect(started()).toEqual([{ card: "rep", role: REPORTER }]));
    await settle();
    await expectRoleHeld(system, "held", "done", 1);
    expect((await system.taskStore.get("held"))?.laneSessions?.at(-1)?.recoveryReason).toBe("restart_interrupted");
    // Stopped by the resume's own check, before any start path ran.
    expect(holdLines()).toEqual([]);
  });

  it("the label added between the first decision and the fresh read: the second check skips it", async () => {
    const system = await setup();
    await seed(system, "late", "done", { labels: [ROLE_HOLD], laneSessions: [interrupted(0)] });
    const list = system.taskStore.listByWorkspace.bind(system.taskStore);
    vi.spyOn(system.taskStore, "listByWorkspace").mockImplementation(async (id: string) =>
      (await list(id)).map((task) => ({ ...task, labels: [] })));
    const result = await resumeInterruptedLaneSteps(system);
    expect(result.resumed).toEqual([]);
    await settle();
    await expectRoleHeld(system, "late", "done", 1);
  });
});

const deadProcess = {
  sessionStore: { getSession: () => undefined } as never,
  processManager: { hasActiveSession: () => false, killSession: vi.fn() } as never,
};

describe("F4 restart-recovery (revive)", () => {
  it("Done card stopped at the pusher step: not replayed, not failed, no recoveryReason; review card revives", async () => {
    const system = await setup();
    await seed(system, "held", "done", { labels: [ROLE_HOLD] });
    await seed(system, "failed", "done", { labels: [ROLE_HOLD], laneSessions: [run("done", 0, { status: "failed", recoveryReason: undefined })] });
    await seed(system, "rev", "review", { labels: [ROLE_HOLD] });
    await seed(system, "rep", "done", { labels: [ROLE_HOLD], laneSessions: [run("done", 0)] });
    await reviveMissingEntryAutomations(system, WS, BOARD_ID, deadProcess);
    await vi.waitFor(() => expect(started().map((entry) => `${entry.card}:${entry.role}`).sort()).toEqual([`rep:${REPORTER}`, `rev:${GUARD}`]));
    await settle();
    await expectRoleHeld(system, "held", "done");
    await expectRoleHeld(system, "failed", "done", 1);
    // Stopped by revive's own check: no claim, no start path, so no start-gate log line.
    expect(holdLines()).toEqual([]);
    expect((await system.taskStore.get("held"))?.laneSessions ?? []).toEqual([]);
    const failed = (await system.taskStore.get("failed"))!;
    expect(failed.laneSessions).toHaveLength(1);
    expect(failed.laneSessions?.[0]?.recoveryReason).toBeUndefined();
  });

  it("a finished Done lane is left alone and gets no hold text", async () => {
    const system = await setup();
    await seed(system, "fin", "done", { labels: [ROLE_HOLD], laneSessions: [run("done", 0), run("done", 1)] });
    await reviveMissingEntryAutomations(system, WS, BOARD_ID, deadProcess);
    await settle();
    expect(triggerMock).not.toHaveBeenCalled();
    expect((await system.taskStore.get("fin"))?.lastSyncError).toBeUndefined();
  });
});

function kanbanTools(system: RoutaSystem): KanbanTools {
  const tools = new KanbanTools(system.kanbanBoardStore, system.taskStore);
  tools.setEventBus(system.eventBus);
  tools.setAutomationSystem(system);
  return tools;
}

describe("F4 / C4 MCP kanban-tools", () => {
  it("move_card into Done: pusher held; into Review: guard starts", async () => {
    const system = await setup();
    await seed(system, "m", "review", { labels: [ROLE_HOLD] });
    await seed(system, "n", "dev", { labels: [ROLE_HOLD] });
    expect((await kanbanTools(system).moveCard({ cardId: "m", targetColumnId: "done" })).success).toBe(true);
    expect((await kanbanTools(system).moveCard({ cardId: "n", targetColumnId: "review" })).success).toBe(true);
    await vi.waitFor(() => expect(started()).toEqual([{ card: "n", role: GUARD }]));
    await settle(80);
    await expectRoleHeld(system, "m", "done");
  });

  it("createCard straight into Done with hold:pusher: tool succeeds, no warning (the hold is not a failure)", async () => {
    const system = await setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const created = await kanbanTools(system).createCard({ boardId: BOARD_ID, columnId: "done", title: "t", workspaceId: WS, labels: [ROLE_HOLD] });
    expect(created.success).toBe(true);
    const id = (created.data as { cardId?: string; id?: string }).cardId ?? (created.data as { id: string }).id;
    await settle(80);
    await expectRoleHeld(system, id, "done");
    expect(warn.mock.calls.filter((call) => String(call[0]).includes("[KanbanTools]"))).toEqual([]);
  });
});

describe("F4 MCP update_task APPROVED converges Review into Done", () => {
  it("the card moves to Done, the pusher is held with its reason; control without the label starts the pusher", async () => {
    for (const labels of [[ROLE_HOLD], ["req:x"]]) {
      resetWorkflowOrchestrator();
      triggerMock.mockClear();
      const system = await setup();
      await seed(system, "v", "review", { labels, laneSessions: [run("review", 0)] });
      const result = await system.tools.updateTask({ taskId: "v", updates: { verificationVerdict: "APPROVED", verificationReport: "ok" }, agentId: "guard-1" });
      expect(result.success).toBe(true);
      await vi.waitFor(async () => expect((await system.taskStore.get("v"))?.columnId).toBe("done"));
      if (labels[0] === ROLE_HOLD) {
        await vi.waitFor(async () => expect((await system.taskStore.get("v"))?.lastSyncError).toBe(HELD_TEXT));
        await settle();
        await expectRoleHeld(system, "v", "done", 1);
      } else {
        await vi.waitFor(() => expect(started()).toEqual([{ card: "v", role: PUSHER }]));
      }
    }
  });
});

describe("C5: the reason is written on the stored card", () => {
  it("a field written by someone else after the caller read the card is kept; only lastSyncError changes", async () => {
    const system = await setup();
    const stale = await seed(system, "x", "done", { labels: [ROLE_HOLD], objective: "old" });
    const other = { ...stale, objective: "written meanwhile", labels: [ROLE_HOLD, "req:new"] };
    await system.taskStore.save(other);
    const before = (await system.taskStore.get("x"))!;
    const result = await enqueueKanbanTaskSession(system, { task: stale, expectedColumnId: "done", step: step(PUSHER), stepIndex: 0 });
    expect(result).toEqual({ queued: false, error: "on_hold" });
    const after = (await system.taskStore.get("x"))!;
    expect(after.objective).toBe("written meanwhile");
    expect(after.labels).toEqual([ROLE_HOLD, "req:new"]);
    expect({ ...after, lastSyncError: undefined, updatedAt: undefined }).toEqual({ ...before, lastSyncError: undefined, updatedAt: undefined });
    expect(after.lastSyncError).toBe(HELD_TEXT);
  });

  it("the re-read throws: still a hold (no failure, no throw), the error is logged", async () => {
    const system = await setup();
    const card = await seed(system, "y", "done", { labels: [ROLE_HOLD] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(system.taskStore, "get").mockRejectedValueOnce(new Error("store down"));
    const result = await enqueueKanbanTaskSession(system, { task: card, expectedColumnId: "done", step: step(PUSHER), stepIndex: 0 });
    expect(result).toEqual({ queued: false, error: "on_hold" });
    expect(triggerMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((call) => String(call[0]).includes("could not record hold:kanban-main-pusher"))).toBe(true);
  });

  it("C21: a running pusher is not interrupted when the label is added; only the next start is stopped", async () => {
    const system = await setup();
    const card = await seed(system, "z", "done");
    await processKanbanColumnTransition(system, { cardId: "z", cardTitle: "z", boardId: BOARD_ID, workspaceId: WS, fromColumnId: "review", toColumnId: "done" });
    await vi.waitFor(() => expect(started()).toEqual([{ card: "z", role: PUSHER }]));
    await system.taskStore.save({ ...(await system.taskStore.get("z"))!, labels: [ROLE_HOLD] });
    await settle();
    const saved = (await system.taskStore.get("z"))!;
    expect(saved.triggerSessionId).toBeTruthy();
    expect(saved.laneSessions?.at(-1)?.status).toBe("running");
    expect(card.id).toBe("z");
  });
});
