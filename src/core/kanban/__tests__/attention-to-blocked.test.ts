// @vitest-environment node
/**
 * Card 64f2e31c (AC2, C1, C2, C15, F4): after a lane step ends, cards that
 * need attention (Done step failed, finished without a report, Done not on
 * main, interrupted after the retry) move to Blocked through move_card; the
 * judgement is collectTaskAttentionItems. A Blocked column configured with
 * enabled=true then starts the resolver; one without automation stays manual.
 */
import { describe, expect, it, vi } from "vitest";

const collectSpy = vi.hoisted(() => ({ mock: { calls: [] as unknown[][] } }));
vi.mock("../attention-rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../attention-rules")>();
  return {
    ...actual,
    collectTaskAttentionItems: (...args: Parameters<typeof actual.collectTaskAttentionItems>) => {
      collectSpy.mock.calls.push(args);
      return actual.collectTaskAttentionItems(...args);
    },
  };
});

import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard, type KanbanColumn } from "../../models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanTools } from "../../tools/kanban-tools";
import { collectTaskAttentionItems } from "../attention-rules";
import { decideAttentionRouting, isInterruptedRetrySpent, routeAttentionToBlocked, toAttentionTask } from "../attention-to-blocked";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";

const NOW = Date.UTC(2026, 9, 26, 12);
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function lane(columnId: string, status: TaskLaneSession["status"], startedAt: number, extra: Partial<TaskLaneSession> = {}): TaskLaneSession {
  return { sessionId: `${columnId}-${startedAt}`, columnId, status, startedAt: iso(startedAt), ...extra };
}

function card(columnId: string, laneSessions: TaskLaneSession[], extra: Partial<Task> = {}): Task {
  return {
    ...createTask({ id: `card-${columnId}`, title: "t", objective: "o", workspaceId: "default", boardId: "board-1", columnId }),
    laneSessions,
    ...extra,
  };
}

const pusherDone: KanbanColumn["automation"] = {
  enabled: true,
  steps: [{ id: "r", specialistId: "kanban-done-reporter" }, { id: "p", specialistId: "kanban-main-pusher" }],
};
const BOARD = {
  columns: [
    { id: "dev", name: "Dev", stage: "dev", position: 0 },
    { id: "done", name: "Done", stage: "done", position: 1, automation: pusherDone },
    { id: "blocked", name: "Blocked", stage: "blocked", position: 2 },
  ] as KanbanColumn[],
};

const report = { id: "c1", body: "## 完成汇报\n- 交付", createdAt: iso(NOW - MIN) };

describe("decideAttentionRouting (C2)", () => {
  const blocking: Array<[string, Task, Parameters<typeof decideAttentionRouting>[2]["landing"]]> = [
    ["doneFailed", card("done", [lane("done", "failed", NOW - 5 * MIN)]), undefined],
    ["noReport", card("done", [lane("done", "completed", NOW - 5 * MIN)]), undefined],
    ["unmerged", card("done", [lane("done", "completed", NOW - 5 * MIN)], { comments: [report] }), { landedOnBase: false, commitsSinceBase: 2 }],
    ["interrupted", card("dev", [lane("dev", "failed", NOW - 20 * MIN), lane("dev", "failed", NOW - 5 * MIN)]), undefined],
  ];

  it.each(blocking)("routes %s to Blocked with attention:<kind>", (kind, task, landing) => {
    const callsBefore = collectSpy.mock.calls.length;
    const decision = decideAttentionRouting(task, BOARD, { now: NOW, landing });
    expect(decision).toEqual({ action: "block", kind, reason: `attention:${kind}`, blockedColumnId: "blocked" });
    // The judgement is the shared rule, not a parallel one.
    expect(collectSpy.mock.calls.length).toBe(callsBefore + 1);
  });

  const controls: Array<[string, Task]> = [
    ["interrupted, first failure (retry not used yet)", card("dev", [lane("dev", "failed", NOW - 5 * MIN)])],
    ["already in Blocked", card("blocked", [lane("done", "failed", NOW - 5 * MIN)])],
    ["in Done for more than 7 days", card("done", [lane("done", "failed", NOW - 8 * 24 * 60 * MIN)])],
    ["resolved as landed", card("done", [lane("done", "failed", NOW - 5 * MIN)], {
      attentionResolution: { category: "landed", conclusion: "ok", resolvedAt: iso(NOW) },
    })],
  ];

  it.each(controls)("does not move: %s", (_label, task) => {
    expect(decideAttentionRouting(task, BOARD, { now: NOW }).action).toBe("none");
  });

  it("a rate-limited run waiting for its rerun is not spent; an environment failure is", () => {
    const waiting = card("dev", [
      lane("dev", "failed", NOW - 20 * MIN),
      lane("dev", "failed", NOW - 5 * MIN, { recoveryReason: "rate_limited", retryAfterAt: iso(NOW + 5 * MIN) }),
    ]);
    expect(isInterruptedRetrySpent(waiting, NOW)).toBe(false);
    const environment = card("dev", [lane("dev", "failed", NOW - 5 * MIN, { recoveryReason: "environment_failure" })]);
    expect(isInterruptedRetrySpent(environment, NOW)).toBe(true);
  });

  it("a board without a Blocked column never routes", () => {
    const board = { columns: BOARD.columns.filter((column) => column.stage !== "blocked") };
    expect(decideAttentionRouting(blocking[0][1], board, { now: NOW }).action).toBe("none");
  });
});

describe("a conclusion stops holding once the card left Blocked (high-risk review, 2nd rejection)", () => {
  // A Review card whose run failed twice after the resolver's conclusion an hour ago.
  const reviewCard = (category?: "waiting" | "handed_off" | "needs_owner") => card("review", [
    lane("review", "failed", NOW - 20 * MIN),
    lane("review", "failed", NOW - 5 * MIN),
  ], category ? { attentionResolution: { category, conclusion: "c", resolvedAt: iso(NOW - 60 * MIN) } } : {});
  const board = { columns: [...BOARD.columns, { id: "review", name: "Review", stage: "review", position: 3 } as KanbanColumn] };

  it.each([undefined, "waiting", "handed_off", "needs_owner"] as const)(
    "resolution %s: the card is back in the inbox and routed to Blocked",
    (category) => {
      const task = reviewCard(category);
      expect(collectTaskAttentionItems(toAttentionTask(task), { hasMainPusher: true, now: NOW }).map((item) => item.kind)).toEqual(["interrupted"]);
      expect(decideAttentionRouting(task, board, { now: NOW }).action).toBe("block");
    },
  );

  it.each(["waiting", "handed_off", "needs_owner"] as const)("resolution %s still holds while the card is in Blocked", (category) => {
    const task = card("blocked", [lane("done", "failed", NOW - 90 * MIN)], {
      attentionResolution: { category, conclusion: "c", resolvedAt: iso(NOW - 60 * MIN) },
    });
    const kinds = collectTaskAttentionItems(toAttentionTask(task), { hasMainPusher: true, now: NOW }).map((item) => item.kind);
    expect(kinds).toEqual(category === "needs_owner" ? ["blocked"] : []);
  });

  it("an escalation that still holds is not rewritten on the next lane end", async () => {
    const taskStore = new InMemoryTaskStore();
    const boardStore = new InMemoryKanbanBoardStore();
    await boardStore.save(createKanbanBoard({ id: "board-1", workspaceId: "default", name: "B", columns: BOARD.columns }));
    const earlier = { category: "needs_owner" as const, conclusion: "first escalation", resolvedAt: iso(NOW - MIN) };
    const task = card("done", [lane("done", "failed", NOW - 5 * MIN)], {
      comments: [record("attention:doneFailed"), record("attention:doneFailed")],
      attentionResolution: earlier,
    });
    await taskStore.save(task);
    const decision = await routeAttentionToBlocked({ taskStore, kanbanBoardStore: boardStore, moveCard: vi.fn(), now: () => NOW }, task.id);
    expect(decision.action).toBe("escalate");
    expect((await taskStore.get(task.id))?.attentionResolution).toEqual(earlier);
  });
});

function record(reason: string): { id: string; body: string; createdAt: string } {
  return {
    id: `r-${Math.random()}`,
    createdAt: iso(NOW - MIN),
    body: [
      "## 自动处理记录",
      "### 卡在哪", `${reason}；Done 列最后一次运行失败`,
      "### 判断", "own_failure",
      "### 做了什么", "move_card dev",
      "### 结果核对", "卡在 dev",
      "### 没做什么、为什么", "无",
    ].join("\n"),
  };
}

describe("rounds per reason (C15)", () => {
  it("the third round of the same reason is not moved but handed to the owner", async () => {
    const taskStore = new InMemoryTaskStore();
    const boardStore = new InMemoryKanbanBoardStore();
    await boardStore.save(createKanbanBoard({ id: "board-1", workspaceId: "default", name: "B", columns: BOARD.columns }));
    const task = card("done", [lane("done", "failed", NOW - 5 * MIN)], {
      comments: [record("attention:doneFailed"), record("attention:doneFailed")],
    });
    await taskStore.save(task);
    const moveCard = vi.fn(async () => ({ success: true }));

    const decision = await routeAttentionToBlocked({ taskStore, kanbanBoardStore: boardStore, moveCard, now: () => NOW }, task.id);

    expect(decision.action).toBe("escalate");
    expect(moveCard).not.toHaveBeenCalled();
    const saved = await taskStore.get(task.id);
    expect(saved?.columnId).toBe("done");
    expect(saved?.attentionResolution?.category).toBe("needs_owner");
  });

  it("records of another reason do not count", async () => {
    const task = card("done", [lane("done", "failed", NOW - 5 * MIN)], {
      comments: [record("attention:interrupted"), record("attention:interrupted")],
    });
    expect(decideAttentionRouting(task, BOARD, { now: NOW }).action).toBe("block");
  });

  it("a rejected move restores lastSyncError", async () => {
    const taskStore = new InMemoryTaskStore();
    const boardStore = new InMemoryKanbanBoardStore();
    await boardStore.save(createKanbanBoard({ id: "board-1", workspaceId: "default", name: "B", columns: BOARD.columns }));
    const task = card("done", [lane("done", "failed", NOW - 5 * MIN)], { lastSyncError: "boom" });
    await taskStore.save(task);
    const moveCard = vi.fn(async () => ({ success: false, error: "gate" }));

    const decision = await routeAttentionToBlocked({ taskStore, kanbanBoardStore: boardStore, moveCard, now: () => NOW }, task.id);

    expect(decision.action).toBe("none");
    expect((await taskStore.get(task.id))?.lastSyncError).toBe("boom");
  });
});

describe("lane end → Blocked through move_card (C1, C2, F4)", () => {
  async function setup(blockedAutomation?: KanbanColumn["automation"], afterLaneEnd?: (cardId: string) => Promise<unknown>, failure = { type: AgentEventType.AGENT_FAILED, data: { success: false, error: "boom" } as Record<string, unknown> }, priorFailures = 0) {
    const eventBus = new EventBus();
    const boardStore = new InMemoryKanbanBoardStore();
    const taskStore = new InMemoryTaskStore();
    await boardStore.save(createKanbanBoard({
      id: "board-1",
      workspaceId: "default",
      name: "Main",
      isDefault: true,
      columns: [
        { id: "review", name: "Review", stage: "review", position: 0 },
        { id: "done", name: "Done", stage: "done", position: 1, automation: { enabled: true, transitionType: "entry", steps: [{ id: "done-reporter", role: "GATE", specialistId: "kanban-done-reporter" }] } },
        { id: "blocked", name: "Blocked", stage: "blocked", position: 2, ...(blockedAutomation ? { automation: blockedAutomation } : {}) },
      ],
    }));
    const createSession = vi.fn(async (params: { cardId: string; columnId: string; stepIndex: number }) => {
      const sessionId = `${params.cardId}-${params.columnId}-${params.stepIndex}`;
      const task = await taskStore.get(params.cardId);
      if (task) {
        task.triggerSessionId = sessionId;
        task.laneSessions = [...(task.laneSessions ?? []), {
          sessionId, columnId: params.columnId, stepIndex: params.stepIndex, status: "running", startedAt: new Date().toISOString(),
        }];
        await taskStore.save(task);
      }
      return sessionId;
    });
    const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession as never, vi.fn(async () => undefined));
    const tools = new KanbanTools(boardStore, taskStore);
    tools.setEventBus(eventBus);
    const transitions: Array<{ from?: string; to?: string }> = [];
    eventBus.on("test-transitions", (event) => {
      if (event.type === AgentEventType.COLUMN_TRANSITION) transitions.push({ from: event.data?.fromColumnId as string, to: event.data?.toColumnId as string });
    });
    orchestrator.setAfterLaneEnd(afterLaneEnd ?? ((cardId) => routeAttentionToBlocked({
      taskStore, kanbanBoardStore: boardStore, moveCard: (params) => tools.moveCard(params),
    }, cardId)));
    orchestrator.start();

    await taskStore.save(createTask({
      id: "c", title: "Card c", objective: "o", workspaceId: "default", boardId: "board-1", columnId: "done", status: TaskStatus.COMPLETED,
    }));
    await orchestrator.processColumnTransition({ cardId: "c", cardTitle: "Card c", boardId: "board-1", workspaceId: "default", fromColumnId: "review", toColumnId: "done" });
    if (priorFailures) {
      const task = (await taskStore.get("c"))!;
      task.laneSessions!.unshift(...Array.from({ length: priorFailures }, (_, i) => lane("done", "failed", Date.now() - (priorFailures - i) * MIN, { recoveryReason: "turn_cancelled" })));
      await taskStore.save(task);
    }
    eventBus.emit({ type: failure.type, agentId: "x", workspaceId: "default", data: { sessionId: "c-done-0", ...failure.data }, timestamp: new Date() });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const startsIn = (columnId: string) => createSession.mock.calls.filter(([params]) => params.columnId === columnId).length;
    return { orchestrator, taskStore, transitions, startsIn };
  }

  it.each([
    { label: "cancelled", type: AgentEventType.AGENT_COMPLETED, data: { success: false, stopReason: "cancelled" } },
    { label: "rate-limited", type: AgentEventType.AGENT_FAILED, data: { success: false, error: "429 Too Many Requests" } },
  ])("a $label Done step with a retry stays in Done instead of Blocked", async (failure) => {
    const { orchestrator, taskStore, transitions, startsIn } = await setup(undefined, undefined, failure);
    try {
      const task = (await taskStore.get("c"))!;
      expect(task.laneSessions?.at(-1)?.retryAfterAt).toBeTruthy();
      expect(task.columnId).toBe("done");
      expect(transitions).not.toContainEqual({ from: "done", to: "blocked" });
      expect(startsIn("blocked")).toBe(0);
    } finally { orchestrator.stop(); }
  });

  it("a cancelled Done step whose retry fuse is spent still goes to Blocked", async () => {
    const { orchestrator, taskStore } = await setup(undefined, undefined, {
      type: AgentEventType.AGENT_COMPLETED, data: { success: false, stopReason: "cancelled" },
    }, 4);
    try {
      const task = (await taskStore.get("c"))!;
      expect(task.laneSessions?.at(-1)?.retryAfterAt).toBeUndefined();
      expect(task.columnId).toBe("blocked");
    } finally { orchestrator.stop(); }
  });

  it("a failed Done step moves the card to a manual Blocked column: no resolver starts", async () => {
    const { orchestrator, taskStore, transitions, startsIn } = await setup();
    const task = await taskStore.get("c");
    expect(task?.columnId).toBe("blocked");
    expect(task?.lastSyncError).toMatch(/^attention:doneFailed/);
    expect(transitions).toContainEqual({ from: "done", to: "blocked" });
    expect(startsIn("blocked")).toBe(0);
    orchestrator.stop();
  });

  it("a Blocked column with enabled=true starts the resolver once", async () => {
    const { orchestrator, taskStore, startsIn } = await setup({
      enabled: true, transitionType: "entry", steps: [{ id: "blocked-resolver", role: "CRAFTER", specialistId: "kanban-blocked-resolver" }],
    });
    expect((await taskStore.get("c"))?.columnId).toBe("blocked");
    expect(startsIn("blocked")).toBe(1);
    orchestrator.stop();
  });

  it("a failing after-lane-end hook is caught: no unhandled rejection, the card stays put", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hook = vi.fn(async () => { throw new Error("hook exploded"); });
    try {
      const { orchestrator, taskStore } = await setup(undefined, hook);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(hook).toHaveBeenCalledWith("c");
      expect(unhandled).toEqual([]);
      expect(warn).toHaveBeenCalledWith("[WorkflowOrchestrator] afterLaneEnd failed", "c", expect.any(Error));
      expect((await taskStore.get("c"))?.columnId).toBe("done");
      orchestrator.stop();
    } finally {
      process.off("unhandledRejection", onUnhandled);
      warn.mockRestore();
    }
  });

  it("a Blocked column with enabled=false stays manual", async () => {
    const { orchestrator, startsIn } = await setup({
      enabled: false, transitionType: "entry", steps: [{ id: "blocked-resolver", role: "CRAFTER", specialistId: "kanban-blocked-resolver" }],
    });
    expect(startsIn("blocked")).toBe(0);
    orchestrator.stop();
  });
});
