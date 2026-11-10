// @vitest-environment node
/**
 * Card 29482e39: the orchestrator's auto-advance checks the target column's
 * deliveryRules like manual PATCH and move_card do. A failing check keeps the
 * card in its column and records why (lastSyncError + one card comment).
 *
 * Unit-level cases drive the orchestrator's autoAdvanceCard directly on an
 * in-memory system with the gate set explicitly; the integration cases run the
 * real singleton (startWorkflowOrchestrator wires the gate) through a Review
 * lane whose last step ends. Only the readiness probe (git) is faked; the rule
 * evaluation (buildTaskDeliveryTransitionErrorFromRules) is the real one.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock, readinessMock } = vi.hoisted(() => ({
  triggerAssignedTaskAgentMock: vi.fn(),
  readinessMock: vi.fn(),
}));

vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));
vi.mock("../../acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: vi.fn(async () => undefined), hasActiveSession: () => false }),
}));
vi.mock("../task-delivery-readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../task-delivery-readiness")>()),
  buildTaskDeliveryReadiness: readinessMock,
}));
vi.mock("../../models/task-attention-resolution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../models/task-attention-resolution")>();
  return { ...actual, attentionResolutionAfterMove: vi.fn(actual.attentionResolutionAfterMove) };
});

import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType } from "../../events/event-bus";
import { createKanbanBoard, type KanbanColumn, type KanbanDeliveryRules } from "../../models/kanban";
import { createTask, TaskStatus, type Task } from "../../models/task";
import { attentionResolutionAfterMove } from "../../models/task-attention-resolution";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import { AUTO_ADVANCE_BLOCKED_PREFIX, createAutoAdvanceDeliveryGate } from "../auto-advance-delivery-gate";
import { buildTaskDeliveryTransitionErrorFromRules, type TaskDeliveryReadiness } from "../task-delivery-readiness";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";
import { processKanbanColumnTransition, resetWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import {
  cleanupSessionCwd,
  createLaneHarness,
  emitAgentEvent,
  orchestratorOf,
  sessionCwd,
  settle,
  WORKSPACE_ID,
} from "./lane-interrupt-harness";

const WAIT = { timeout: 10_000, interval: 25 };
const BOARD_ID = "board-gate";

beforeEach(() => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetWorkflowOrchestrator();
  readinessMock.mockReset();
  triggerAssignedTaskAgentMock.mockReset();
  vi.mocked(attentionResolutionAfterMove).mockClear();
});

afterEach(() => {
  resetWorkflowOrchestrator();
  vi.unstubAllEnvs();
});

afterAll(() => cleanupSessionCwd());

function readiness(overrides: Partial<TaskDeliveryReadiness> = {}): TaskDeliveryReadiness {
  return {
    checked: true,
    branch: "issue/card",
    baseBranch: "main",
    baseRef: "origin/main",
    modified: 0,
    untracked: 0,
    ahead: 1,
    behind: 0,
    commitsSinceBase: 1,
    hasCommitsSinceBase: true,
    hasUncommittedChanges: false,
    isGitHubRepo: true,
    canCreatePullRequest: true,
    landedOnBase: false,
    hasLandedOwnCommits: false,
    ...overrides,
  };
}

const ZERO_COMMITS = { commitsSinceBase: 0, hasCommitsSinceBase: false, ahead: 0 };
const DIRTY = { hasUncommittedChanges: true, modified: 2, untracked: 1 };

function column(id: string, position: number, rules?: KanbanDeliveryRules | null): KanbanColumn {
  return {
    id,
    name: id === "done" ? "Done" : id[0].toUpperCase() + id.slice(1),
    position,
    stage: id as KanbanColumn["stage"],
    ...(rules !== undefined ? { automation: { enabled: false, deliveryRules: rules as KanbanDeliveryRules } } : {}),
  };
}

interface Rig {
  system: RoutaSystem;
  orchestrator: KanbanWorkflowOrchestrator;
  transitions: Array<{ cardId: string; to: string }>;
  advance(cardId: string, fromColumnId: string): Promise<void>;
  addCard(id: string, columnId: string, extra?: Partial<Task>): Promise<Task>;
  card(id: string): Promise<Task>;
}

/** An orchestrator (not started) over a two-column board: `from` then `to` (with rules). */
async function createRig(
  from: string,
  to: string,
  rules: KanbanDeliveryRules | null | undefined,
  options: { gate?: boolean } = {},
): Promise<Rig> {
  const system = createInMemorySystem();
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: BOARD_ID,
    workspaceId: WORKSPACE_ID,
    name: "Board",
    columns: [column(from, 0), column(to, 1, rules)],
  }));
  const orchestrator = new KanbanWorkflowOrchestrator(system.eventBus, system.kanbanBoardStore, system.taskStore);
  if (options.gate !== false) {
    orchestrator.setAutoAdvanceGate(createAutoAdvanceDeliveryGate({ system, taskStore: system.taskStore, boardStore: system.kanbanBoardStore }));
  }
  const transitions: Rig["transitions"] = [];
  system.eventBus.on("gate-test-transitions", (event) => {
    if (event.type === AgentEventType.COLUMN_TRANSITION) {
      transitions.push({ cardId: event.data.cardId as string, to: event.data.toColumnId as string });
    }
  });
  const rig: Rig = {
    system,
    orchestrator,
    transitions,
    advance: async (cardId, fromColumnId) => {
      const call = (orchestrator as unknown as {
        autoAdvanceCard(id: string, automation: Record<string, string>): Promise<void>;
      }).autoAdvanceCard.bind(orchestrator);
      await call(cardId, { boardId: BOARD_ID, columnId: fromColumnId, workspaceId: WORKSPACE_ID, cardTitle: cardId });
    },
    addCard: async (id, columnId, extra = {}) => {
      const task = {
        ...createTask({ id, title: id, objective: id, workspaceId: WORKSPACE_ID, boardId: BOARD_ID, columnId, status: TaskStatus.REVIEW_REQUIRED }),
        ...extra,
      } as Task;
      await system.taskStore.save(task);
      return task;
    },
    card: async (id) => (await system.taskStore.get(id))!,
  };
  return rig;
}

const blockNotes = (task: Task) => (task.comments ?? []).filter((entry) => entry.body.startsWith(AUTO_ADVANCE_BLOCKED_PREFIX));

describe("C1 / AC1: Review -> Done with requireCommittedChanges and 0 commits", () => {
  it("keeps the card in review, emits no transition, records the original rule sentence once", async () => {
    const rig = await createRig("review", "done", { requireCommittedChanges: true });
    await rig.addCard("c1", "review");
    readinessMock.mockResolvedValue(readiness(ZERO_COMMITS));

    await rig.advance("c1", "review");

    const card = await rig.card("c1");
    const expected = buildTaskDeliveryTransitionErrorFromRules(readiness(ZERO_COMMITS), "Done", { requireCommittedChanges: true }, "done");
    expect(card.columnId).toBe("review");
    expect(card.status).toBe(TaskStatus.REVIEW_REQUIRED);
    expect(rig.transitions).toHaveLength(0);
    expect(expected).toContain("no committed changes");
    expect(card.lastSyncError).toBe(`${AUTO_ADVANCE_BLOCKED_PREFIX}${expected}`);
    expect(blockNotes(card)).toHaveLength(1);
    expect(blockNotes(card)[0].body).toBe(card.lastSyncError);
  });

  it("F4: Dev -> Review with requireCommittedChanges and 0 commits is blocked too", async () => {
    const rig = await createRig("dev", "review", { requireCommittedChanges: true, requireCleanWorktree: true });
    await rig.addCard("f4-dev", "dev", { status: TaskStatus.IN_PROGRESS });
    readinessMock.mockResolvedValue(readiness(ZERO_COMMITS));

    await rig.advance("f4-dev", "dev");

    const card = await rig.card("f4-dev");
    expect(card.columnId).toBe("dev");
    expect(rig.transitions).toHaveLength(0);
    expect(card.lastSyncError).toMatch(/^自动推进被拦：Cannot move task to "Review": no committed changes/);
  });
});

describe("C2 / AC3: single rules against readiness states", () => {
  it("AC3: requireCleanWorktree blocks a dirty worktree, then lets the same card through once clean", async () => {
    const rig = await createRig("review", "done", { requireCleanWorktree: true });
    await rig.addCard("ac3", "review");
    readinessMock.mockResolvedValue(readiness(DIRTY));
    await rig.advance("ac3", "review");
    let card = await rig.card("ac3");
    expect(card.columnId).toBe("review");
    expect(card.lastSyncError).toContain("still has uncommitted changes (2 modified, 1 untracked)");
    expect(rig.transitions).toHaveLength(0);

    readinessMock.mockResolvedValue(readiness());
    await rig.advance("ac3", "review");
    card = await rig.card("ac3");
    expect(card.columnId).toBe("done");
    expect(rig.transitions).toEqual([{ cardId: "ac3", to: "done" }]);
  });

  it.each([
    ["requireCleanWorktree, dirty", { requireCleanWorktree: true }, readiness(DIRTY), true],
    ["requirePullRequestReady, PR not ready", { requirePullRequestReady: true }, readiness({ canCreatePullRequest: false }), true],
    ["requireCommittedChanges, unmerged commits", { requireCommittedChanges: true }, readiness({ commitsSinceBase: 3 }), false],
    ["requireCommittedChanges, no linked repo", { requireCommittedChanges: true },
      readiness({ checked: false, ...ZERO_COMMITS, reason: "Task has no linked repository or worktree." }), false],
    ["requireCommittedChanges, linked path is not a git repo", { requireCommittedChanges: true },
      readiness({ checked: false, ...ZERO_COMMITS, reason: "Linked repository is missing or is not a git repository." }), true],
  ] as Array<[string, KanbanDeliveryRules, TaskDeliveryReadiness, boolean]>)("%s", async (_name, rules, state, blocked) => {
    const rig = await createRig("review", "done", rules);
    await rig.addCard("c2", "review");
    readinessMock.mockResolvedValue(state);
    await rig.advance("c2", "review");

    const card = await rig.card("c2");
    const manual = buildTaskDeliveryTransitionErrorFromRules(state, "Done", rules, "done");
    expect(manual !== null).toBe(blocked);
    if (blocked) {
      expect(card.columnId).toBe("review");
      expect(card.lastSyncError).toBe(`${AUTO_ADVANCE_BLOCKED_PREFIX}${manual}`);
      expect(rig.transitions).toHaveLength(0);
    } else {
      expect(card.columnId).toBe("done");
      expect(rig.transitions).toHaveLength(1);
    }
  });
});

describe("F3: every rule switch x readiness state (128 cases)", () => {
  /** Written from the requirement, not from the code under test. */
  function judgeBlocked(rules: KanbanDeliveryRules, state: { checked: boolean; commits: boolean; dirty: boolean; prReady: boolean }): boolean {
    if (!state.checked) return false;
    return Boolean(
      (rules.requireCommittedChanges && !state.commits)
      || (rules.requireCleanWorktree && state.dirty)
      || (rules.requirePullRequestReady && !state.prReady),
    );
  }

  it("blocks exactly when an enabled rule's condition fails, with the manual path's sentence", async () => {
    const rig = await createRig("review", "done", { requireCommittedChanges: true });
    const board = (await rig.system.kanbanBoardStore.get(BOARD_ID))!;
    let index = 0;
    let blockedCount = 0;
    for (let mask = 0; mask < 8; mask += 1) {
      const rules: KanbanDeliveryRules = {
        requireCommittedChanges: Boolean(mask & 1),
        requireCleanWorktree: Boolean(mask & 2),
        requirePullRequestReady: Boolean(mask & 4),
      };
      board.columns[1].automation = { enabled: false, deliveryRules: rules };
      await rig.system.kanbanBoardStore.save(board);
      for (let bits = 0; bits < 16; bits += 1) {
        const state = { checked: Boolean(bits & 1), commits: Boolean(bits & 2), dirty: Boolean(bits & 4), prReady: Boolean(bits & 8) };
        const probe = readiness({
          checked: state.checked,
          reason: state.checked ? undefined : "Task has no linked repository or worktree.",
          commitsSinceBase: state.commits ? 2 : 0,
          hasCommitsSinceBase: state.commits,
          ...(state.dirty ? DIRTY : {}),
          canCreatePullRequest: state.prReady,
        });
        readinessMock.mockResolvedValue(probe);
        const id = `f3-${index}`;
        index += 1;
        await rig.addCard(id, "review");
        await rig.advance(id, "review");
        const card = await rig.card(id);
        const label = `rules=${mask} state=${JSON.stringify(state)}`;
        if (judgeBlocked(rules, state)) {
          blockedCount += 1;
          expect(card.columnId, label).toBe("review");
          expect(card.lastSyncError, label).toBe(
            `${AUTO_ADVANCE_BLOCKED_PREFIX}${buildTaskDeliveryTransitionErrorFromRules(probe, "Done", rules, "done")}`,
          );
        } else {
          expect(card.columnId, label).toBe("done");
          expect(card.lastSyncError, label).toBeUndefined();
        }
      }
    }
    expect(index).toBe(128);
    expect(rig.transitions).toHaveLength(128 - blockedCount);
    expect(blockedCount).toBeGreaterThan(0);
  });
});

describe("并发保护：readiness 等待期间输入改变", () => {
  it.each([
    ["人工移回 dev", { columnId: "dev" }],
    ["同列换运行身份", { triggerSessionId: "replacement-run" }],
    ["同列改状态", { status: TaskStatus.IN_PROGRESS }],
    ["同期编辑内容", { title: "新的标题", comment: "人工备注" }],
    ["同列更换工作副本", { worktreeId: "new-worktree" }],
  ] as Array<[string, Partial<Task>]>)('%s 不被旧检查覆盖（放行和拦截）', async (_name, edit) => {
    for (const probe of [readiness(), readiness(ZERO_COMMITS)]) {
      const rig = await createRig("review", "done", { requireCommittedChanges: true });
      await rig.addCard("race", "review", { triggerSessionId: "old-run" });
      let finish!: (value: TaskDeliveryReadiness) => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => { entered = resolve; });
      readinessMock.mockImplementationOnce(() => {
        entered();
        return new Promise<TaskDeliveryReadiness>((resolve) => { finish = resolve; });
      });
      const pending = rig.advance("race", "review");
      await started;
      const latest = { ...await rig.card("race"), ...edit };
      await rig.system.taskStore.save(latest);
      const saved = await rig.card("race");
      const save = vi.spyOn(rig.system.taskStore, "save");
      finish(probe);
      await pending;
      expect(await rig.card("race")).toEqual(saved);
      expect(save).not.toHaveBeenCalled();
      expect(rig.transitions).toHaveLength(0);
      save.mockRestore();
    }
  });

  it.each(["delete", "rules", "order"])("检查期间 %s 变化取消本次推进且不写旧评论", async (change) => {
    const rig = await createRig("review", "done", { requireCommittedChanges: true });
    await rig.addCard("race-board", "review");
    let finish!: (value: TaskDeliveryReadiness) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    readinessMock.mockImplementationOnce(() => {
      entered();
      return new Promise<TaskDeliveryReadiness>((resolve) => { finish = resolve; });
    });
    const pending = rig.advance("race-board", "review");
    await started;
    if (change === "delete") await rig.system.taskStore.delete("race-board");
    else {
      const board = (await rig.system.kanbanBoardStore.get(BOARD_ID))!;
      if (change === "rules") board.columns[1].automation!.deliveryRules = { requireCleanWorktree: true };
      else board.columns.push(column("dev", 0.5));
      await rig.system.kanbanBoardStore.save(board);
    }
    finish(readiness(ZERO_COMMITS));
    await pending;
    expect((await rig.system.taskStore.get("race-board"))?.lastSyncError).toBeUndefined();
    expect(rig.transitions).toHaveLength(0);
  });

  it("gate 返回后与最终保存前仍重读卡，取消已换列的推进", async () => {
    const rig = await createRig("review", "done", undefined);
    await rig.addCard("post-gate", "review");
    rig.orchestrator.setAutoAdvanceGate(async () => {
      await rig.system.taskStore.save({ ...await rig.card("post-gate"), columnId: "dev" });
      return false;
    });
    await rig.advance("post-gate", "review");
    expect((await rig.card("post-gate")).columnId).toBe("dev");
    expect(rig.transitions).toHaveLength(0);
  });

  it("原始 null 规则直接传到 gate，不探测 git", async () => {
    const rig = await createRig("review", "done", undefined);
    const task = await rig.addCard("raw-null", "review");
    const gate = createAutoAdvanceDeliveryGate({ system: rig.system, taskStore: rig.system.taskStore, boardStore: rig.system.kanbanBoardStore });
    const from = column("review", 0);
    const to = column("done", 1, null);
    expect(to.automation!.deliveryRules).toBeNull();
    // Board hydration normalizes null to undefined; the gate must still skip git
    // when handed the original wire shape before hydration.
    const board = createKanbanBoard({ id: BOARD_ID, workspaceId: WORKSPACE_ID, name: "Board" });
    board.columns = [from, to];
    vi.spyOn(rig.system.kanbanBoardStore, "get").mockResolvedValue(board);
    expect(await gate(task, from, to)).toBe(false);
    expect(readinessMock).not.toHaveBeenCalled();
  });
});

describe("C3: the readiness probe throws", () => {
  it("fails closed: card stays, reason says the check errored, nothing escapes", async () => {
    const rig = await createRig("review", "done", { requireCommittedChanges: true });
    await rig.addCard("c3", "review");
    readinessMock.mockRejectedValue(new Error("git rev-parse failed: boom"));
    const save = vi.spyOn(rig.system.taskStore, "save");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(rig.advance("c3", "review")).resolves.toBeUndefined();

    const card = await rig.card("c3");
    expect(card.columnId).toBe("review");
    expect(card.lastSyncError).toBe("自动推进被拦：检查出错：git rev-parse failed: boom");
    expect(save).toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalledWith("[WorkflowOrchestrator] Auto-advance failed:", expect.anything());
    expect(rig.transitions).toHaveLength(0);
    errors.mockRestore();
  });
});

describe("C5 / AC4: attention resolution through the shared helper", () => {
  const landed = { category: "landed" as const, conclusion: "已在主干", resolvedAt: "2026-11-09T07:00:00.000Z", ref: "abc1234" };
  const probeFromTask = (task: Task) => readiness({
    ...ZERO_COMMITS,
    resolvedAsDelivered: task.attentionResolution?.category === "landed" || task.attentionResolution?.category === "superseded",
  });

  it("lets a landed card from Blocked into Done; the helper gets (resolution, from, to)", async () => {
    const rig = await createRig("blocked", "done", { requireCommittedChanges: true });
    await rig.addCard("c5", "blocked", { attentionResolution: landed });
    readinessMock.mockImplementation(async (task: Task) => probeFromTask(task));

    await rig.advance("c5", "blocked");

    expect((await rig.card("c5")).columnId).toBe("done");
    expect(vi.mocked(attentionResolutionAfterMove)).toHaveBeenCalledWith(landed, "blocked", "done");
    expect(readinessMock.mock.calls[0][0].attentionResolution).toEqual(landed);
  });

  it("drops the conclusion on Review -> Done (helper rule), so the 0-commit card is blocked", async () => {
    const rig = await createRig("review", "done", { requireCommittedChanges: true });
    await rig.addCard("c5b", "review", { attentionResolution: landed });
    readinessMock.mockImplementation(async (task: Task) => probeFromTask(task));

    await rig.advance("c5b", "review");

    expect((await rig.card("c5b")).columnId).toBe("review");
    expect(vi.mocked(attentionResolutionAfterMove)).toHaveBeenCalledWith(landed, "review", "done");
    expect(readinessMock.mock.calls[0][0].attentionResolution).toBeUndefined();
  });
});

describe("F2 / AC2: unchanged shapes", () => {
  it.each([
    ["no automation", undefined],
    ["deliveryRules null", null],
    ["all three rules false", { requireCommittedChanges: false, requireCleanWorktree: false, requirePullRequestReady: false }],
  ] as Array<[string, KanbanDeliveryRules | null | undefined]>)("%s: advances and never probes git", async (_name, rules) => {
    const rig = await createRig("review", "done", rules);
    await rig.addCard("f2", "review");

    await rig.advance("f2", "review");

    expect((await rig.card("f2")).columnId).toBe("done");
    expect(rig.transitions).toEqual([{ cardId: "f2", to: "done" }]);
    expect(readinessMock).toHaveBeenCalledTimes(0);
  });

  it("an orchestrator without the gate behaves as before (advances regardless of rules)", async () => {
    const rig = await createRig("review", "done", { requireCommittedChanges: true }, { gate: false });
    await rig.addCard("f2-nogate", "review");
    readinessMock.mockResolvedValue(readiness(ZERO_COMMITS));

    await rig.advance("f2-nogate", "review");

    expect((await rig.card("f2-nogate")).columnId).toBe("done");
    expect(readinessMock).toHaveBeenCalledTimes(0);
  });
});

describe("C1 / C4 / F4 integration: the singleton wires the gate into a real Review lane", () => {
  function recordOutput(sessionId: string): void {
    const store = getHttpSessionStore();
    if (!store.getSession(sessionId)) {
      store.upsertSession({ sessionId, cwd: sessionCwd(), workspaceId: WORKSPACE_ID, provider: "dsh", createdAt: new Date().toISOString() });
    }
    store.pushNotificationToHistory(sessionId, { sessionId, update: { sessionUpdate: "agent_message", content: { type: "text", text: "working" } } });
  }

  it.each([false, true])("启用 Done 自动化：可交付=%s，启动次数与闸门结论一致", async (deliverable) => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const board = (await h.system.kanbanBoardStore.get(h.boardId))!;
    const done = board.columns.find((entry) => entry.id === "done")!;
    done.automation = {
      enabled: true,
      transitionType: "entry",
      deliveryRules: { requireCommittedChanges: true },
      steps: [{ id: "done-pusher", providerId: "dsh", role: "CRAFTER", specialistId: "done-pusher" }],
    };
    await h.system.kanbanBoardStore.save(board);
    readinessMock.mockResolvedValue(readiness(deliverable ? {} : ZERO_COMMITS));
    await processKanbanColumnTransition(h.system, {
      cardId: h.cardId, cardTitle: "Card review", boardId: h.boardId, workspaceId: WORKSPACE_ID,
      fromColumnId: "dev", toColumnId: "review", fromColumnName: "dev", toColumnName: "review",
    });
    for (const step of [0, 1]) {
      const sessionId = await h.waitForStep(step);
      recordOutput(sessionId);
      emitAgentEvent(h.system, AgentEventType.AGENT_COMPLETED, sessionId, { success: true, stopReason: "end_turn" });
    }
    await vi.waitFor(async () => {
      const card = await h.card();
      expect(deliverable ? card.columnId === "done" : !!card.lastSyncError).toBe(true);
      if (deliverable) expect(triggerAssignedTaskAgentMock.mock.calls.some(([params]) => params.task.columnId === "done")).toBe(true);
    }, WAIT);
    await settle(60);
    const doneCalls = triggerAssignedTaskAgentMock.mock.calls.filter(([params]) => params.task.columnId === "done");
    expect(doneCalls).toHaveLength(deliverable ? 1 : 0);
    expect((await h.card()).columnId).toBe(deliverable ? "done" : "review");
    expect(h.transitions.filter((entry) => entry.to === "done")).toHaveLength(deliverable ? 1 : 0);
  });

  it("Review last step ends -> Done (requireCommittedChanges, 0 commits) is blocked once, repeats add nothing", async () => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const board = (await h.system.kanbanBoardStore.get(h.boardId))!;
    board.columns = board.columns.map((entry) => entry.id === "done"
      ? { ...entry, name: "Done", automation: { enabled: false, deliveryRules: { requireCommittedChanges: true } } }
      : entry);
    await h.system.kanbanBoardStore.save(board);
    readinessMock.mockResolvedValue(readiness(ZERO_COMMITS));
    expect((orchestratorOf(h) as unknown as { autoAdvanceGate?: unknown }).autoAdvanceGate).toBeTypeOf("function");

    await processKanbanColumnTransition(h.system, {
      cardId: h.cardId, cardTitle: "Card review", boardId: h.boardId, workspaceId: WORKSPACE_ID,
      fromColumnId: "dev", toColumnId: "review", fromColumnName: "dev", toColumnName: "review",
    });
    const s0 = await h.waitForStep(0);
    recordOutput(s0);
    emitAgentEvent(h.system, AgentEventType.AGENT_COMPLETED, s0, { success: true, stopReason: "end_turn" });
    const s1 = await h.waitForStep(1);
    recordOutput(s1);
    emitAgentEvent(h.system, AgentEventType.AGENT_COMPLETED, s1, { success: true, stopReason: "end_turn" });
    await vi.waitFor(async () => {
      if (!(await h.card()).lastSyncError?.startsWith(AUTO_ADVANCE_BLOCKED_PREFIX)) throw new Error("not blocked yet");
    }, WAIT);
    await settle(60);

    const blocked = await h.card();
    expect(blocked.columnId).toBe("review");
    expect(h.transitions.filter((entry) => entry.to === "done")).toHaveLength(0);
    expect(blocked.lastSyncError).toContain("no committed changes");
    expect(blockNotes(blocked)).toHaveLength(1);
    const snapshot = { triggerSessionId: blocked.triggerSessionId, status: blocked.status, laneSessions: blocked.laneSessions };
    const launches = triggerAssignedTaskAgentMock.mock.calls.length;

    // C4: a restart sweep / revive re-triggers the advance twice.
    const advance = (orchestratorOf(h) as unknown as {
      autoAdvanceCard(id: string, automation: Record<string, string>): Promise<void>;
    });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await advance.autoAdvanceCard(h.cardId, { boardId: h.boardId, columnId: "review", workspaceId: WORKSPACE_ID, cardTitle: "Card review" });
    }
    await settle(60);
    const after = await h.card();
    expect(after.columnId).toBe("review");
    expect(blockNotes(after)).toHaveLength(1);
    expect({ triggerSessionId: after.triggerSessionId, status: after.status, laneSessions: after.laneSessions }).toEqual(snapshot);
    expect(triggerAssignedTaskAgentMock.mock.calls.length).toBe(launches);
    expect(h.transitions.filter((entry) => entry.to === "done")).toHaveLength(0);
  });
});
