// @vitest-environment node
/**
 * Card 59f5b059 (AC4–AC6, C3–C5, C9–C11, C19, F2, F4): the Blocked resolver
 * gate in enqueueKanbanTaskSession. Every way a resolver session starts is
 * driven here once with a card that already spent 2 rounds (gate hit: no
 * session, needs_owner, one log line) and once with a fresh card (a session
 * starts as before).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerMock, killSessionMock } = vi.hoisted(() => ({
  triggerMock: vi.fn(),
  killSessionMock: vi.fn(),
}));

vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerMock,
  getInternalApiOrigin: () => "http://localhost",
}));
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: killSessionMock, hasActiveSession: () => false }),
}));

import { getHttpSessionStore } from "../../acp/http-session-store";
import { createKanbanBoard, type KanbanAutomationStep, type KanbanColumn } from "../../models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "../../models/task";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import { KanbanTools } from "../../tools/kanban-tools";
import { routeAttentionToBlocked } from "../attention-to-blocked";
import { countResolverSessions } from "../auto-resolution-record";
import { evaluateBlockedResolverGuard } from "../blocked-resolver-guard";
import { resumeInterruptedLaneStep, stopInterruptedLaneResumeTimers } from "../interrupted-lane-resume";
import { reviveMissingEntryAutomations } from "../restart-recovery";
import {
  enqueueKanbanTaskSession,
  getKanbanSessionQueue,
  getWorkflowOrchestrator,
  processKanbanColumnTransition,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";

const RESOLVER_ID = "kanban-blocked-resolver";
const RESOLVER: KanbanAutomationStep = { id: "resolve", providerId: "claude", role: "ROUTA", specialistId: RESOLVER_ID };
const TRIAGE: KanbanAutomationStep = { id: "triage", providerId: "claude", role: "ROUTA", specialistId: "kanban-blocked-triage" };
const BOARD_ID = "board-guard";
const CARD_ID = "card-guard-59f5b059";
const PUSH = "attention:push_conflict";

let clock = 0;
let seq = 0;
const at = () => new Date(clock += 60_000).toISOString();

function run(columnId: string, extra: Partial<TaskLaneSession> = {}): TaskLaneSession {
  seq += 1;
  return { sessionId: `old-${columnId}-${seq}`, columnId, status: "completed", startedAt: at(), ...extra };
}
const resolverRun = (reason: string | undefined, extra: Partial<TaskLaneSession> = {}) =>
  run("blocked", { specialistId: RESOLVER_ID, stepIndex: 0, ...(reason ? { attentionReason: reason } : {}), ...extra });
const devRun = () => run("dev", { specialistId: "kanban-dev-crafter", stepIndex: 0 });
const pusherRun = (status: TaskLaneSession["status"]) => run("done", { specialistId: "kanban-main-pusher", stepIndex: 1, status });
/** Two earlier Blocked stays, each with one resolver run of `reason`, each sent back to Dev. */
const twoRounds = (reason: string | undefined) => [resolverRun(reason), devRun(), resolverRun(reason), devRun()];

function columns(blockedSteps: KanbanAutomationStep[], blockedId = "blocked"): KanbanColumn[] {
  return [
    { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
    { id: "dev", name: "Dev", position: 1, stage: "dev" },
    { id: "done", name: "Done", position: 2, stage: "done" },
    {
      id: blockedId,
      name: "Blocked",
      position: 3,
      stage: "blocked",
      automation: { enabled: true, transitionType: "entry", steps: blockedSteps },
    },
  ];
}

async function setup(options: { steps?: KanbanAutomationStep[]; blockedId?: string } = {}) {
  const system = createInMemorySystem();
  const blockedId = options.blockedId ?? "blocked";
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: BOARD_ID,
    workspaceId: "default",
    name: "Board",
    isDefault: true,
    columns: columns(options.steps ?? [RESOLVER], blockedId),
  }));
  startWorkflowOrchestrator(system);
  return { system, blockedId };
}

async function seed(system: RoutaSystem, extra: Partial<Task> & { laneSessions?: TaskLaneSession[] }): Promise<Task> {
  const task: Task = {
    ...createTask({
      id: CARD_ID,
      title: "普通卡",
      objective: "实现功能",
      workspaceId: "default",
      boardId: BOARD_ID,
      columnId: "blocked",
      status: TaskStatus.BLOCKED,
    }),
    ...extra,
  };
  await system.taskStore.save(task);
  return task;
}

function guardLines(warn: ReturnType<typeof vi.spyOn>): string[] {
  return warn.mock.calls.map((call: unknown[]) => String(call[0])).filter((line: string) => line.includes("[BlockedResolverGuard]"));
}

async function expectGated(
  system: RoutaSystem,
  warn: ReturnType<typeof vi.spyOn>,
  gate: "rounds" | "patch-chain",
  options: { columnId?: string; contains?: string[]; lines?: number } = {},
) {
  expect(triggerMock).not.toHaveBeenCalled();
  const saved = (await system.taskStore.get(CARD_ID))!;
  expect(saved.columnId).toBe(options.columnId ?? "blocked");
  expect(saved.attentionResolution?.category).toBe("needs_owner");
  expect(saved.attentionResolution?.resolvedAt).toBeTruthy();
  const conclusion = saved.attentionResolution?.conclusion ?? "";
  expect(conclusion).toContain(gate === "rounds" ? "轮次闸" : "补丁链闸");
  for (const part of options.contains ?? []) expect(conclusion).toContain(part);
  expect((saved.laneSessions ?? []).filter((session) => session.status === "running")).toEqual([]);
  const automation = getWorkflowOrchestrator(system).getAutomationForCard(CARD_ID);
  expect(automation?.status === "queued" || automation?.status === "running").toBe(false);
  expect((await getKanbanSessionQueue(system).getBoardSnapshot(BOARD_ID)).queuedCardIds).not.toContain(CARD_ID);
  const lines = guardLines(warn);
  expect(lines).toHaveLength(options.lines ?? 1);
  expect(lines[0]).toContain(CARD_ID);
  expect(lines[0]).toContain(`blocked by ${gate}`);
}

async function expectStarted(system: RoutaSystem, warn: ReturnType<typeof vi.spyOn>, reason?: string) {
  await vi.waitFor(() => expect(triggerMock).toHaveBeenCalledTimes(1));
  expect(triggerMock.mock.calls[0]?.[0]?.step?.specialistId).toBe(RESOLVER_ID);
  const saved = (await system.taskStore.get(CARD_ID))!;
  expect(saved.attentionResolution?.category).not.toBe("needs_owner");
  const latest = saved.laneSessions?.at(-1);
  expect(latest).toMatchObject({ specialistId: RESOLVER_ID, status: "running" });
  if (reason) expect(latest?.attentionReason).toBe(reason);
  expect(guardLines(warn)).toEqual([]);
}

const transition = (system: RoutaSystem, toColumnId = "blocked") => processKanbanColumnTransition(system, {
  cardId: CARD_ID,
  cardTitle: "card",
  boardId: BOARD_ID,
  workspaceId: "default",
  fromColumnId: "dev",
  toColumnId,
});

function tools(system: RoutaSystem): KanbanTools {
  const instance = new KanbanTools(system.kanbanBoardStore, system.taskStore);
  instance.setEventBus(system.eventBus);
  instance.setAutomationSystem(system);
  return instance;
}

/** What PATCH /api/tasks/{id} retryTrigger does before it enqueues. */
async function retryTrigger(system: RoutaSystem) {
  const current = (await system.taskStore.get(CARD_ID))!;
  current.triggerSessionId = undefined;
  current.lastSyncError = undefined;
  await system.taskStore.save(current);
  getKanbanSessionQueue(system).removeCardJob(CARD_ID);
  return enqueueKanbanTaskSession(system, {
    task: current,
    expectedColumnId: current.columnId,
    ignoreExistingTrigger: true,
    resumeLane: true,
  });
}

const revive = (system: RoutaSystem) => reviveMissingEntryAutomations(system, "default", BOARD_ID, {
  sessionStore: getHttpSessionStore(),
  processManager: { hasActiveSession: () => false, killSession: killSessionMock } as never,
});

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetWorkflowOrchestrator();
  triggerMock.mockReset();
  let started = 0;
  triggerMock.mockImplementation(async () => ({ sessionId: `new-session-${started += 1}`, transport: "acp" }));
  clock = Date.now() - 6 * 3_600_000;
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  stopInterruptedLaneResumeTimers();
  resetWorkflowOrchestrator();
  vi.unstubAllEnvs();
});

describe("AC6: the six required cases", () => {
  it("manual move_card into Blocked for the 3rd time is stopped (C3)", async () => {
    const { system } = await setup();
    await seed(system, { columnId: "dev", status: TaskStatus.IN_PROGRESS, lastSyncError: `${PUSH} 推送失败`, laneSessions: twoRounds(PUSH) });
    const moved = await tools(system).moveCard({ cardId: CARD_ID, targetColumnId: "blocked" });
    expect(moved.success).toBe(true);
    await vi.waitFor(async () => expect((await system.taskStore.get(CARD_ID))?.attentionResolution?.category).toBe("needs_owner"));
    await expectGated(system, warn, "rounds", { contains: [PUSH, "2 轮"] });
    expect((await system.taskStore.get(CARD_ID))?.lastSyncError).toBe(`${PUSH} 推送失败`);
  });

  it("system routeAttentionToBlocked for the 3rd time does not move the card (C2)", async () => {
    const { system } = await setup();
    await seed(system, {
      columnId: "done",
      status: TaskStatus.COMPLETED,
      laneSessions: [...twoRounds("attention:doneFailed"), run("done", { specialistId: "kanban-done-reporter", status: "failed" })],
    });
    const moveCard = vi.fn(async () => ({ success: true }));
    const decision = await routeAttentionToBlocked({
      taskStore: system.taskStore,
      kanbanBoardStore: system.kanbanBoardStore,
      moveCard,
      now: () => clock,
    }, CARD_ID);
    expect(decision.action).toBe("escalate");
    expect(moveCard).not.toHaveBeenCalled();
    await expectGated(system, warn, "rounds", { columnId: "done", contains: ["attention:doneFailed", "2 轮"] });
  });

  it("no record comment but 2 resolver sessions: stopped (old sessions count as attention:blocked)", async () => {
    const { system } = await setup();
    const task = await seed(system, { laneSessions: twoRounds(undefined), comments: [] });
    const result = await enqueueKanbanTaskSession(system, { task, expectedColumnId: "blocked", ignoreExistingTrigger: true, step: RESOLVER, stepIndex: 0 });
    expect(result).toEqual({ queued: false, error: "blocked-resolver-guard:rounds" });
    expect(result.sessionId).toBeUndefined();
    await expectGated(system, warn, "rounds", { contains: ["attention:blocked", "2 轮"] });
  });

  it("a patch card whose push hit a conflict is stopped on its 1st Blocked entry (C4 a)", async () => {
    const { system } = await setup();
    await seed(system, {
      title: "补丁卡：重推 59f5",
      objective: "git cherry-pick a1b2c3d 后推送",
      lastSyncError: "attention:doneFailed — rebase conflict",
      laneSessions: [devRun(), pusherRun("failed")],
    });
    await transition(system);
    await expectGated(system, warn, "patch-chain", { contains: ["attention:doneFailed"] });
  });

  it("a normal card entering Blocked for the 1st time starts the resolver (C4 c: same push failure)", async () => {
    const { system } = await setup();
    await seed(system, { lastSyncError: "attention:doneFailed — rebase conflict", laneSessions: [devRun(), pusherRun("failed")] });
    await transition(system);
    await expectStarted(system, warn, "attention:doneFailed");
  });

  it("PATCH retryTrigger after 2 rounds is stopped (retryTrigger clears lastSyncError; the runs keep the reason)", async () => {
    const { system } = await setup();
    await seed(system, { laneSessions: [resolverRun(PUSH), devRun(), resolverRun(PUSH, { status: "failed" })] });
    const result = await retryTrigger(system);
    expect(result).toEqual({ queued: false, error: "blocked-resolver-guard:rounds" });
    await expectGated(system, warn, "rounds", { contains: [PUSH, "2 轮"] });
  });
});

describe("C3: enqueueKanbanTaskSession itself, both execution paths", () => {
  it.each([false, true])("bypassQueue=%s: queued=false, no session, needs_owner, not in the queue", async (bypassQueue) => {
    const { system } = await setup();
    const task = await seed(system, { lastSyncError: `${PUSH} 推送失败`, laneSessions: twoRounds(PUSH) });
    const result = await enqueueKanbanTaskSession(system, {
      task, expectedColumnId: "blocked", ignoreExistingTrigger: true, bypassQueue, step: RESOLVER, stepIndex: 0,
    });
    expect(result.queued).toBe(false);
    expect(result.sessionId).toBeUndefined();
    await expectGated(system, warn, "rounds", { contains: [PUSH, "2 轮"] });
    expect((await system.taskStore.get(CARD_ID))?.laneSessions).toHaveLength(4);
  });

  it("a step-less start resolves the lane's specialist and is stopped too", async () => {
    const { system } = await setup();
    const task = await seed(system, { lastSyncError: `${PUSH} x`, laneSessions: twoRounds(PUSH) });
    const result = await enqueueKanbanTaskSession(system, { task, expectedColumnId: "blocked", ignoreExistingTrigger: true });
    expect(result.error).toBe("blocked-resolver-guard:rounds");
    await expectGated(system, warn, "rounds");
  });
});

describe("C4: patch chain gate evidence", () => {
  it("(b) pusher completed but its comment names a conflict → stopped", async () => {
    const { system } = await setup();
    const pusher = pusherRun("completed");
    await seed(system, {
      title: "补丁：重推原卡",
      laneSessions: [devRun(), pusher],
      comments: [{ id: "c1", body: "rebase 冲突：src/a.ts", createdAt: at(), sessionId: pusher.sessionId }],
    });
    await transition(system);
    await expectGated(system, warn, "patch-chain");
  });

  it("(d) patch card, pusher completed, no conflict comment → resolver starts", async () => {
    const { system } = await setup();
    await seed(system, {
      title: "补丁卡：重推",
      laneSessions: [devRun(), pusherRun("completed")],
      comments: [{ id: "c1", body: "推送成功", createdAt: at() }],
    });
    await transition(system);
    await expectStarted(system, warn, "attention:blocked");
  });

  it("patch chain also stops a retryTrigger", async () => {
    const { system } = await setup();
    await seed(system, { title: "补丁卡", laneSessions: [devRun(), pusherRun("timed_out")] });
    const result = await retryTrigger(system);
    expect(result.error).toBe("blocked-resolver-guard:patch-chain");
    await expectGated(system, warn, "patch-chain");
  });
});

describe("C5: a resolver run records its reason", () => {
  it("the new lane session keeps attention:review_failed after lastSyncError is cleared", async () => {
    const { system } = await setup();
    const task = await seed(system, { lastSyncError: "attention:review_failed xxx" });
    const result = await enqueueKanbanTaskSession(system, { task, expectedColumnId: "blocked", ignoreExistingTrigger: true, bypassQueue: true, step: RESOLVER, stepIndex: 0 });
    expect(result.sessionId).toBe("new-session-1");
    const saved = (await system.taskStore.get(CARD_ID))!;
    expect(saved.lastSyncError).toBeUndefined();
    expect(saved.laneSessions?.at(-1)?.attentionReason).toBe("attention:review_failed");
    expect(countResolverSessions(saved.laneSessions, "blocked", "attention:review_failed")).toBe(1);
  });

  it("a Dev session carries no attentionReason and its enqueue is unchanged (F2-2)", async () => {
    const { system } = await setup();
    const task = await seed(system, { columnId: "dev", status: TaskStatus.IN_PROGRESS, lastSyncError: "attention:review_failed xxx" });
    const result = await enqueueKanbanTaskSession(system, { task, expectedColumnId: "dev", ignoreExistingTrigger: true, bypassQueue: true });
    expect(result).toEqual({ sessionId: "new-session-1", queued: false, error: undefined });
    expect((await system.taskStore.get(CARD_ID))?.laneSessions?.at(-1)).not.toHaveProperty("attentionReason");
  });
});

describe("spot checks C9–C11, C19", () => {
  it("C9: an in-effect needs_owner keeps its conclusion over two hits; column and lastSyncError untouched", async () => {
    const { system } = await setup();
    const own = { category: "needs_owner" as const, conclusion: "老板自定结论", resolvedAt: at() };
    const task = await seed(system, { lastSyncError: `${PUSH} x`, laneSessions: twoRounds(PUSH), attentionResolution: own });
    for (let index = 0; index < 2; index += 1) {
      const result = await enqueueKanbanTaskSession(system, { task, expectedColumnId: "blocked", ignoreExistingTrigger: true, step: RESOLVER, stepIndex: 0 });
      expect(result.error).toBe("blocked-resolver-guard:rounds");
    }
    const saved = (await system.taskStore.get(CARD_ID))!;
    expect(saved.attentionResolution).toEqual(own);
    expect(saved.columnId).toBe("blocked");
    expect(saved.lastSyncError).toBe(`${PUSH} x`);
    expect(triggerMock).not.toHaveBeenCalled();
    expect(guardLines(warn)).toHaveLength(2);
  });

  it("C10: 2 rounds of another reason do not stop a new reason", async () => {
    const { system } = await setup();
    await seed(system, { lastSyncError: `${PUSH} 推送失败`, laneSessions: twoRounds("attention:review_failed") });
    await transition(system);
    await expectStarted(system, warn, PUSH);
  });

  it("C11: moved out, the owner's move back in is stopped again and needs_owner is rewritten", async () => {
    const { system } = await setup();
    await seed(system, { columnId: "dev", status: TaskStatus.IN_PROGRESS, lastSyncError: `${PUSH} x`, laneSessions: twoRounds(PUSH) });
    const kanban = tools(system);
    await kanban.moveCard({ cardId: CARD_ID, targetColumnId: "blocked" });
    await vi.waitFor(async () => expect((await system.taskStore.get(CARD_ID))?.attentionResolution?.category).toBe("needs_owner"));
    await kanban.moveCard({ cardId: CARD_ID, targetColumnId: "dev" });
    expect((await system.taskStore.get(CARD_ID))?.attentionResolution).toBeUndefined();
    await kanban.moveCard({ cardId: CARD_ID, targetColumnId: "blocked" });
    await vi.waitFor(async () => expect((await system.taskStore.get(CARD_ID))?.attentionResolution?.category).toBe("needs_owner"));
    expect(triggerMock).not.toHaveBeenCalled();
    expect(guardLines(warn)).toHaveLength(2);
  });

  it("C19: no Blocked column / resolver outside Blocked / another specialist in Blocked → none", () => {
    const task = { id: CARD_ID, title: "补丁卡", objective: "", columnId: "blocked", laneSessions: twoRounds(PUSH), lastSyncError: `${PUSH} x` };
    const noBlocked = { columns: columns([RESOLVER]).filter((column) => column.stage !== "blocked") };
    expect(evaluateBlockedResolverGuard({ task, board: noBlocked, specialistId: RESOLVER_ID })).toEqual({ gate: "none" });
    expect(evaluateBlockedResolverGuard({ task: { ...task, columnId: "dev" }, board: { columns: columns([RESOLVER]) }, specialistId: RESOLVER_ID })).toEqual({ gate: "none" });
    expect(evaluateBlockedResolverGuard({ task, board: { columns: columns([RESOLVER]) }, specialistId: "kanban-pr-publisher" })).toEqual({ gate: "none" });
    expect(evaluateBlockedResolverGuard({ task, board: { columns: columns([RESOLVER]) }, specialistId: RESOLVER_ID }).gate).toBe("rounds");
  });
});

describe("F2 / F4: every entry, fresh card starts / 2-round card is stopped", () => {
  const twoStep = [TRIAGE, { ...RESOLVER, id: "resolve-2" }];
  const triageRun = (extra: Partial<TaskLaneSession> = {}) => run("blocked", { specialistId: TRIAGE.specialistId, stepIndex: 0, attentionReason: PUSH, ...extra });
  const resolver2 = (extra: Partial<TaskLaneSession> = {}) => run("blocked", { specialistId: RESOLVER_ID, stepIndex: 1, attentionReason: PUSH, ...extra });

  it.each([
    ["column transition (web drag PATCH columnId emits the same event)", "transition"],
    ["MCP move_card", "move"],
    ["PATCH retryTrigger (resumeLane)", "retry"],
  ] as const)("%s: fresh card starts, 2-round card stopped", async (_label, entry) => {
    for (const spent of [false, true]) {
      resetWorkflowOrchestrator();
      triggerMock.mockClear();
      warn.mockClear();
      const { system } = await setup();
      const history = spent ? (entry === "retry" ? [resolverRun(PUSH), devRun(), resolverRun(PUSH, { status: "failed" })] : twoRounds(PUSH)) : [devRun()];
      await seed(system, {
        columnId: entry === "move" ? "dev" : "blocked",
        lastSyncError: `${PUSH} x`,
        laneSessions: history,
      });
      if (entry === "transition") await transition(system);
      if (entry === "move") expect((await tools(system).moveCard({ cardId: CARD_ID, targetColumnId: "blocked" })).success).toBe(true);
      if (entry === "retry") await retryTrigger(system);
      if (spent) {
        await vi.waitFor(async () => expect((await system.taskStore.get(CARD_ID))?.attentionResolution?.category).toBe("needs_owner"));
        await expectGated(system, warn, "rounds", { contains: [PUSH] });
      } else {
        await expectStarted(system, warn, entry === "retry" ? "attention:blocked" : PUSH);
      }
    }
  });

  it("revive, rerun of the failed step (restart-recovery 393)", async () => {
    for (const spent of [false, true]) {
      resetWorkflowOrchestrator();
      triggerMock.mockClear();
      warn.mockClear();
      const { system } = await setup({ steps: twoStep });
      const earlier = spent ? [resolver2(), devRun()] : [];
      await seed(system, { laneSessions: [...earlier, triageRun(), resolver2({ status: "failed" })] });
      await revive(system);
      if (spent) await expectGated(system, warn, "rounds", { contains: [PUSH, "2 轮"] });
      else await expectStarted(system, warn, PUSH);
    }
  });

  it("revive, the lane's next step (restart-recovery 418)", async () => {
    for (const spent of [false, true]) {
      resetWorkflowOrchestrator();
      triggerMock.mockClear();
      warn.mockClear();
      const { system } = await setup({ steps: twoStep });
      const earlier = spent ? [resolver2(), devRun(), resolver2(), devRun()] : [];
      await seed(system, { laneSessions: [...earlier, triageRun({ status: "transitioned" })] });
      await revive(system);
      if (spent) await expectGated(system, warn, "rounds", { contains: [PUSH, "2 轮"] });
      else await expectStarted(system, warn, PUSH);
    }
  });

  it("revive through a column re-entry (restart-recovery processKanbanColumnTransition)", async () => {
    for (const spent of [false, true]) {
      resetWorkflowOrchestrator();
      triggerMock.mockClear();
      warn.mockClear();
      const { system } = await setup();
      await seed(system, { lastSyncError: `${PUSH} x`, laneSessions: spent ? twoRounds(PUSH) : [devRun()] });
      await revive(system);
      if (spent) {
        await vi.waitFor(async () => expect((await system.taskStore.get(CARD_ID))?.attentionResolution?.category).toBe("needs_owner"));
        await expectGated(system, warn, "rounds");
      } else {
        await expectStarted(system, warn, PUSH);
      }
    }
  });

  it("interrupted-lane-resume (153)", async () => {
    for (const spent of [false, true]) {
      resetWorkflowOrchestrator();
      triggerMock.mockClear();
      warn.mockClear();
      const { system } = await setup();
      const earlier = spent ? [resolverRun(PUSH), devRun()] : [];
      await seed(system, { laneSessions: [...earlier, resolverRun(PUSH, { status: "failed", recoveryReason: "restart_interrupted" })] });
      await resumeInterruptedLaneStep(system, CARD_ID);
      if (spent) await expectGated(system, warn, "rounds", { contains: [PUSH, "2 轮"] });
      else await expectStarted(system, warn, PUSH);
    }
  });

  it("kanban-tools createCard into Blocked (1179): a new card has no rounds and starts", async () => {
    const { system } = await setup();
    const created = await tools(system).createCard({ boardId: BOARD_ID, columnId: "blocked", title: "新卡", workspaceId: "default" });
    expect(created.success).toBe(true);
    await vi.waitFor(() => expect(triggerMock).toHaveBeenCalledTimes(1));
    expect(triggerMock.mock.calls[0]?.[0]?.step?.specialistId).toBe(RESOLVER_ID);
  });

  it("a board whose Blocked column is found by stage (id 'stuck') is gated the same way", async () => {
    const { system } = await setup({ blockedId: "stuck" });
    await seed(system, {
      columnId: "stuck",
      lastSyncError: `${PUSH} x`,
      laneSessions: [run("stuck", { specialistId: RESOLVER_ID, attentionReason: PUSH }), devRun(), run("stuck", { specialistId: RESOLVER_ID, attentionReason: PUSH }), devRun()],
    });
    await transition(system, "stuck");
    await expectGated(system, warn, "rounds", { columnId: "stuck", contains: [PUSH] });
  });
});
