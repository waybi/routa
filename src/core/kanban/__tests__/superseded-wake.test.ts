// @vitest-environment node
/**
 * Wake of Blocked resolvers when the card they wait for enters Done.
 * Part A drives wakeSupersededBlockedCards with an enqueue stub (filters,
 * dedupe, errors, board shapes, a 1200-case matrix against an independent
 * judge). Part B drives the real event bus and enqueueKanbanTaskSession.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerMock, liveSessions } = vi.hoisted(() => ({
  triggerMock: vi.fn(),
  liveSessions: new Set<string>(),
}));

vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerMock,
  getInternalApiOrigin: () => "http://localhost",
}));
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: vi.fn(), hasActiveSession: (id: string) => liveSessions.has(id) }),
}));

import { createKanbanBoard, type KanbanAutomationStep, type KanbanBoard, type KanbanColumn } from "../../models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "../../models/task";
import type { TaskAttentionResolution } from "../../models/task-attention-resolution";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import { emitColumnTransition, type ColumnTransitionData } from "../column-transition";
import { resetSupersededWakeForTests, wakeSupersededBlockedCards, type SupersededWakeDeps } from "../superseded-wake";
import { resetWorkflowOrchestrator, startWorkflowOrchestrator } from "../workflow-orchestrator-singleton";

const RESOLVER_ID = "kanban-blocked-resolver";
const OTHER: KanbanAutomationStep = { id: "triage", providerId: "claude", role: "ROUTA", specialistId: "kanban-blocked-triage" };
const RESOLVER: KanbanAutomationStep = { id: "resolve", providerId: "claude", role: "ROUTA", specialistId: RESOLVER_ID, model: "m-1" };
const X = "5cf1e338-aaaa-bbbb-cccc-000000000001";
const WS = "default";
const BOARD_ID = "board-wake";

function columns(opts: { doneId?: string; blockedId?: string; steps?: KanbanAutomationStep[] } = {}): KanbanColumn[] {
  return [
    { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
    { id: "todo", name: "Todo", position: 1, stage: "todo" },
    { id: "dev", name: "Dev", position: 2, stage: "dev" },
    { id: "review", name: "Review", position: 3, stage: "review" },
    { id: opts.doneId ?? "done", name: "Done", position: 4, stage: "done" },
    {
      id: opts.blockedId ?? "blocked", name: "Blocked", position: 5, stage: "blocked",
      automation: { enabled: true, transitionType: "entry", steps: opts.steps ?? [OTHER, RESOLVER] },
    },
  ];
}

function board(opts: Parameters<typeof columns>[0] = {}): KanbanBoard {
  return createKanbanBoard({ id: BOARD_ID, workspaceId: WS, name: "B", isDefault: true, columns: columns(opts) });
}

function oldCard(id: string, over: Partial<Task> = {}, res: Partial<TaskAttentionResolution> | null = {}): Task {
  return {
    ...createTask({ id, title: id, objective: "o", workspaceId: WS, boardId: BOARD_ID, columnId: "blocked", status: TaskStatus.BLOCKED }),
    ...(res === null ? {} : {
      attentionResolution: { category: "superseded", conclusion: "c", ref: X, resolvedAt: new Date().toISOString(), ...res } as TaskAttentionResolution,
    }),
    ...over,
  };
}

const move = (over: Partial<ColumnTransitionData> = {}): ColumnTransitionData => ({
  cardId: X, cardTitle: "x", boardId: BOARD_ID, workspaceId: WS, fromColumnId: "review", toColumnId: "done", ...over,
});

function deps(tasks: Task[], b: KanbanBoard | undefined | null = board(), enqueue = vi.fn(async () => ({ queued: true }))) {
  const d: SupersededWakeDeps = {
    taskStore: { listByWorkspace: async (ws: string) => tasks.filter((t) => t.workspaceId === ws) },
    kanbanBoardStore: { get: async () => b ?? undefined },
    enqueue: enqueue as unknown as SupersededWakeDeps["enqueue"],
  };
  return { d, enqueue };
}

let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetSupersededWakeForTests();
  resetWorkflowOrchestrator();
  liveSessions.clear();
  triggerMock.mockReset();
  let n = 0;
  triggerMock.mockImplementation(async () => ({ sessionId: `new-${n += 1}`, transport: "acp" }));
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  info.mockRestore();
  warn.mockRestore();
  resetWorkflowOrchestrator();
  vi.unstubAllEnvs();
});

describe("A: wakeSupersededBlockedCards (enqueue stub)", () => {
  it("C1/AC1: full id and padded 8-char prefix both wake once, with the resolver step", async () => {
    const a = oldCard("old-a", {}, { category: "superseded", ref: X });
    const b = oldCard("old-b", {}, { category: "waiting", ref: `  ${X.slice(0, 8)} ` });
    const { d, enqueue } = deps([a, b]);
    await wakeSupersededBlockedCards(d, move());
    expect(enqueue).toHaveBeenCalledTimes(2);
    for (const call of enqueue.mock.calls as unknown as [Record<string, unknown>][]) {
      expect(call[0]).toMatchObject({ expectedColumnId: "blocked", stepIndex: 1, adoptLaneRun: true, ignoreExistingTrigger: true });
      expect((call[0].step as KanbanAutomationStep).specialistId).toBe(RESOLVER_ID);
    }
    expect((enqueue.mock.calls as unknown as [{ task: Task }][]).map((c) => c[0].task.id).sort()).toEqual(["old-a", "old-b"]);
  });

  it.each([
    ["ref points to another card", oldCard("o", {}, { ref: "zzzzzzzz-1" }), move()],
    ["old card in todo", oldCard("o", { columnId: "todo" }), move()],
    ["needs_owner", oldCard("o", {}, { category: "needs_owner" }), move()],
    ["landed", oldCard("o", {}, { category: "landed" }), move()],
    ["handed_off", oldCard("o", {}, { category: "handed_off" }), move()],
    ["X enters review", oldCard("o"), move({ toColumnId: "review", fromColumnId: "dev" })],
    ["done to done", oldCard("o"), move({ fromColumnId: "done" })],
    ["other workspace", oldCard("o", { workspaceId: "other" }), move()],
    ["no attentionResolution", oldCard("o", {}, null), move()],
    ["empty ref", oldCard("o", {}, { ref: "" }), move()],
    ["missing boardId", oldCard("o"), { ...move(), boardId: undefined } as unknown as ColumnTransitionData],
    ["missing cardId", oldCard("o"), { ...move(), cardId: undefined } as unknown as ColumnTransitionData],
    ["missing toColumnId", oldCard("o"), { ...move(), toColumnId: undefined } as unknown as ColumnTransitionData],
    ["no data", oldCard("o"), undefined as unknown as ColumnTransitionData],
  ])("C2/AC2: %s -> 0 enqueues, no throw", async (_name, task, data) => {
    const { d, enqueue } = deps([task]);
    await expect(wakeSupersededBlockedCards(d, data)).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("C3/AC3: sequential, concurrent and Done->Blocked->Done repeats wake once", async () => {
    const { d, enqueue } = deps([oldCard("old-a")]);
    await wakeSupersededBlockedCards(d, move());
    await wakeSupersededBlockedCards(d, move());
    expect(enqueue).toHaveBeenCalledTimes(1);

    resetSupersededWakeForTests();
    enqueue.mockClear();
    await Promise.all([wakeSupersededBlockedCards(d, move()), wakeSupersededBlockedCards(d, move())]);
    expect(enqueue).toHaveBeenCalledTimes(1);

    resetSupersededWakeForTests();
    enqueue.mockClear();
    await wakeSupersededBlockedCards(d, move());
    await wakeSupersededBlockedCards(d, move({ fromColumnId: "done", toColumnId: "blocked" }));
    await wakeSupersededBlockedCards(d, move());
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("C12: after a simulated restart the same pair wakes once more", async () => {
    const { d, enqueue } = deps([oldCard("old-a")]);
    await wakeSupersededBlockedCards(d, move());
    resetSupersededWakeForTests();
    await wakeSupersededBlockedCards(d, move());
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it("C6/AC4: guard error -> info only; other error -> warn; queued ok; throw swallowed; second card still woken", async () => {
    for (const error of ["blocked-resolver-guard:rounds", "blocked-resolver-guard:patch-chain"]) {
      resetSupersededWakeForTests();
      info.mockClear();
      const { d } = deps([oldCard("old-a")], board(), vi.fn(async () => ({ queued: false, error })));
      await expect(wakeSupersededBlockedCards(d, move())).resolves.toBeUndefined();
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0]?.[0])).toContain(error);
      expect(warn).not.toHaveBeenCalled();
    }

    resetSupersededWakeForTests();
    const other = deps([oldCard("old-a")], board(), vi.fn(async () => ({ queued: false, error: "boom" })));
    await wakeSupersededBlockedCards(other.d, move());
    expect(warn).toHaveBeenCalledTimes(1);

    resetSupersededWakeForTests();
    warn.mockClear();
    const queued = deps([oldCard("old-a")], board(), vi.fn(async () => ({ queued: true })));
    await wakeSupersededBlockedCards(queued.d, move());
    expect(queued.enqueue).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();

    resetSupersededWakeForTests();
    const enqueue = vi.fn()
      .mockRejectedValueOnce(new Error("first fails"))
      .mockResolvedValue({ queued: true });
    const both = deps([oldCard("old-a"), oldCard("old-b")], board(), enqueue as never);
    await expect(wakeSupersededBlockedCards(both.d, move())).resolves.toBeUndefined();
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it("C7: board shapes", async () => {
    const noStep = deps([oldCard("old-a")], board({ steps: [OTHER] }));
    await wakeSupersededBlockedCards(noStep.d, move());
    expect(noStep.enqueue).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    resetSupersededWakeForTests();
    const custom = deps([oldCard("old-a", { columnId: "stuck" })], board({ doneId: "shipped", blockedId: "stuck" }));
    await wakeSupersededBlockedCards(custom.d, move({ toColumnId: "shipped" }));
    expect(custom.enqueue).toHaveBeenCalledTimes(1);
    expect(custom.enqueue.mock.calls[0]).toMatchObject([{ expectedColumnId: "stuck", stepIndex: 1 }]);
    // the literal "done" is not Done on this board
    resetSupersededWakeForTests();
    custom.enqueue.mockClear();
    await wakeSupersededBlockedCards(custom.d, move({ toColumnId: "done" }));
    expect(custom.enqueue).not.toHaveBeenCalled();

    const missing = deps([oldCard("old-a")], null);
    await expect(wakeSupersededBlockedCards(missing.d, move())).resolves.toBeUndefined();
    expect(missing.enqueue).not.toHaveBeenCalled();
  });

  it("C14: the enqueued step is the board's own step object", async () => {
    const { d, enqueue } = deps([oldCard("old-a")]);
    await wakeSupersededBlockedCards(d, move());
    expect((enqueue.mock.calls[0] as unknown as [{ step: KanbanAutomationStep }])[0].step).toBe(
      (await d.kanbanBoardStore.get(BOARD_ID))!.columns.find((c) => c.id === "blocked")!.automation!.steps![1],
    );
  });

  it("C15: prefix collision wakes on either Done card (recorded behaviour)", async () => {
    const { d, enqueue } = deps([oldCard("old-a", {}, { ref: X.slice(0, 8) })]);
    await wakeSupersededBlockedCards(d, move({ cardId: `${X.slice(0, 8)}-other-card` }));
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("F3: 1200-case matrix agrees with an independent judge", async () => {
    const cats = ["superseded", "waiting", "needs_owner", "landed", undefined];
    const cols = ["blocked", "todo", "dev", "done"];
    const refs = [X, X.slice(0, 8), `  ${X.slice(0, 8)}`, "other-card-id", "", undefined];
    const moves: Array<[string, string]> = [["review", "done"], ["dev", "done"], ["done", "done"], ["review", "blocked"], ["todo", "dev"]];
    const wss = [WS, "other"];
    let cases = 0;
    for (const cat of cats) for (const col of cols) for (const ref of refs) for (const [from, to] of moves) for (const ws of wss) {
      resetSupersededWakeForTests();
      const task = oldCard("old", { columnId: col, workspaceId: ws }, cat ? { category: cat as never, ref } : null);
      const { d, enqueue } = deps([task]);
      await wakeSupersededBlockedCards(d, move({ fromColumnId: from, toColumnId: to }));
      const expected = col === "blocked" && (cat === "superseded" || cat === "waiting")
        && ref !== undefined && [X, X.slice(0, 8)].includes(ref.trim())
        && to === "done" && from !== "done" && ws === WS ? 1 : 0;
      expect(enqueue.mock.calls.length, JSON.stringify({ cat, col, ref, from, to, ws })).toBe(expected);
      cases += 1;
    }
    expect(cases).toBe(1200);
  });
});

describe("B: real event bus and enqueueKanbanTaskSession", () => {
  const dev = (): TaskLaneSession => ({ sessionId: "s-dev", columnId: "dev", status: "completed", startedAt: new Date(Date.now() - 3_600_000).toISOString(), specialistId: "kanban-dev-crafter", stepIndex: 0 });
  const resolverRun = (n: number): TaskLaneSession => ({
    sessionId: `s-res-${n}`, columnId: "blocked", status: "completed", specialistId: RESOLVER_ID, stepIndex: 1,
    startedAt: new Date(Date.now() - (6 - n) * 3_600_000).toISOString(), attentionReason: "attention:push_conflict",
  });

  async function setup(tasks: Task[]): Promise<RoutaSystem> {
    const system = createInMemorySystem();
    await system.kanbanBoardStore.save(board());
    for (const t of tasks) await system.taskStore.save(t);
    startWorkflowOrchestrator(system);
    return system;
  }
  const emitDone = (system: RoutaSystem) => emitColumnTransition(system.eventBus, move());

  it("C5/F4: stale triggerSessionId still starts one new resolver round; double start does not double it", async () => {
    const system = await setup([oldCard("old-a", { triggerSessionId: "dead-session", laneSessions: [dev()] })]);
    startWorkflowOrchestrator(system);
    emitDone(system);
    await vi.waitFor(() => expect(triggerMock).toHaveBeenCalledTimes(1));
    expect(triggerMock.mock.calls[0]?.[0]?.step?.specialistId).toBe(RESOLVER_ID);
    await new Promise((r) => setTimeout(r, 50));
    expect(triggerMock).toHaveBeenCalledTimes(1);
  });

  it("C5: a live resolver session is not doubled", async () => {
    liveSessions.add("s-live");
    const running: TaskLaneSession = { sessionId: "s-live", columnId: "blocked", status: "running", specialistId: RESOLVER_ID, stepIndex: 1, startedAt: new Date().toISOString() };
    const system = await setup([oldCard("old-a", { triggerSessionId: "s-live", laneSessions: [dev(), running] })]);
    emitDone(system);
    await new Promise((r) => setTimeout(r, 100));
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("C4/AC4: rounds gate stops the wake; info logged; Done card unaffected", async () => {
    const xCard: Task = { ...createTask({ id: X, title: "x", objective: "o", workspaceId: WS, boardId: BOARD_ID, columnId: "done", status: TaskStatus.COMPLETED }) };
    const old = oldCard("old-a", { lastSyncError: "attention:push_conflict x", laneSessions: [resolverRun(1), dev(), resolverRun(2), dev()] });
    const system = await setup([xCard, old]);
    emitDone(system);
    await vi.waitFor(() => expect(info.mock.calls.some((c: unknown[]) => String(c[0]).includes("blocked-resolver-guard:rounds"))).toBe(true));
    expect(triggerMock).not.toHaveBeenCalled();
    expect((await system.taskStore.get(X))?.columnId).toBe("done");
    expect((await system.taskStore.get("old-a"))?.attentionResolution?.category).toBe("needs_owner");
  });

  it("C4: patch-chain gate stops the wake", async () => {
    const old = oldCard("old-a", {
      title: "补丁卡：重推 59f5", objective: "git cherry-pick a1b2c3d 后推送",
      lastSyncError: "attention:doneFailed — rebase conflict",
      laneSessions: [dev(), { sessionId: "s-push", columnId: "done", status: "failed", specialistId: "kanban-main-pusher", stepIndex: 1, startedAt: new Date(Date.now() - 1_800_000).toISOString() }],
    });
    const system = await setup([old]);
    emitDone(system);
    await vi.waitFor(() => expect(info.mock.calls.some((c: unknown[]) => String(c[0]).includes("blocked-resolver-guard:patch-chain"))).toBe(true));
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("F2: non-Done transitions wake nothing", async () => {
    const system = await setup([oldCard("old-a", { laneSessions: [dev()] })]);
    for (const [from, to] of [["backlog", "todo"], ["todo", "dev"], ["dev", "review"], ["review", "blocked"]]) {
      emitColumnTransition(system.eventBus, move({ fromColumnId: from, toColumnId: to }));
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(triggerMock).not.toHaveBeenCalled();
  });
});
