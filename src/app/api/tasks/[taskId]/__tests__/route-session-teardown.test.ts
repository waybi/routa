// @vitest-environment node
/**
 * Deleting a card or moving it by hand ends the agent processes of its
 * sessions (复盘 L145). Real in-memory system, real orchestrator singleton
 * and session queue; only the process manager, agent trigger and the start of
 * new lane steps are replaced.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentEventType } from "@/core/events/event-bus";
import { createKanbanBoard, type KanbanColumn } from "@/core/models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import type { RoutaSystem } from "@/core/routa-system";

const h = vi.hoisted(() => ({
  system: undefined as unknown as RoutaSystem,
  killSession: vi.fn(async (_sessionId: string) => undefined),
  triggerAssignedTaskAgent: vi.fn(),
  enqueue: vi.fn(),
  processTransition: vi.fn(),
}));

vi.mock("@/core/routa-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/routa-system")>()),
  getRoutaSystem: () => h.system,
}));

vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: h.killSession, hasActiveSession: () => false }),
}));

vi.mock("@/core/kanban/agent-trigger", () => ({
  triggerAssignedTaskAgent: h.triggerAssignedTaskAgent,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/kanban/workflow-orchestrator-singleton")>()),
  enqueueKanbanTaskSession: (...args: unknown[]) => h.enqueue(...args),
  processKanbanColumnTransition: (...args: unknown[]) => h.processTransition(...args),
}));

import { createInMemorySystem } from "@/core/routa-system";
import { getKanbanSessionQueue, resetWorkflowOrchestrator } from "@/core/kanban/workflow-orchestrator-singleton";
import { reviveMissingEntryAutomations } from "@/core/kanban/restart-recovery";
import { DELETE, PATCH } from "../route";

const WS = "ws-teardown";
const BOARD = "board-teardown";

function step(id: string) {
  return { id, role: "CRAFTER", providerId: "codex", specialistId: id, specialistName: id };
}

function columns(overrides?: { doneRequiredArtifacts?: string[]; doneReporterOnly?: boolean }): KanbanColumn[] {
  return [
    { id: "backlog", name: "Backlog", stage: "backlog", position: 0, automation: { enabled: true, steps: [step("backlog-refiner")] } },
    { id: "todo", name: "Todo", stage: "todo", position: 1, automation: { enabled: true, steps: [step("todo-orchestrator")] } },
    { id: "dev", name: "Dev", stage: "dev", position: 2, automation: { enabled: true, steps: [step("dev-crafter")] } },
    { id: "review", name: "Review", stage: "review", position: 3, automation: { enabled: true, steps: [step("review-guard")] } },
    {
      id: "done",
      name: "Done",
      stage: "done",
      position: 4,
      automation: {
        enabled: true,
        steps: overrides?.doneReporterOnly ? [step("done-reporter")] : [step("done-pusher"), step("done-reporter")],
        ...(overrides?.doneRequiredArtifacts ? { requiredArtifacts: overrides.doneRequiredArtifacts } : {}),
      },
    } as KanbanColumn,
    { id: "blocked", name: "Blocked", stage: "blocked", position: 5 },
  ];
}

function lane(sessionId: string, columnId: string, status: TaskLaneSession["status"]): TaskLaneSession {
  return { sessionId, columnId, stepIndex: 0, status, startedAt: "2026-10-24T00:00:00.000Z" } as TaskLaneSession;
}

async function saveCard(params: {
  id: string;
  columnId: string;
  laneSessions?: TaskLaneSession[];
  triggerSessionId?: string;
}): Promise<Task> {
  const task = createTask({
    id: params.id,
    title: `Card ${params.id}`,
    objective: "teardown",
    workspaceId: WS,
    boardId: BOARD,
    columnId: params.columnId,
    status: params.columnId === "done" ? TaskStatus.COMPLETED : TaskStatus.IN_PROGRESS,
    triggerSessionId: params.triggerSessionId,
  });
  task.laneSessions = params.laneSessions ?? [];
  task.sessionIds = [...new Set(task.laneSessions.map((entry) => entry.sessionId))];
  await h.system.taskStore.save(task);
  return task;
}

/** Simulates the start of the target column's first step: session s-new-<column>. */
const started: Array<{ cardId: string; columnId: string; via: "transition" | "enqueue" }> = [];
async function startFirstStep(cardId: string, columnId: string, via: "transition" | "enqueue") {
  const board = await h.system.kanbanBoardStore.get(BOARD);
  const column = board?.columns.find((entry) => entry.id === columnId);
  if (!column?.automation?.enabled) return {};
  const task = await h.system.taskStore.get(cardId);
  if (!task) return {};
  const sessionId = `s-new-${columnId}`;
  task.triggerSessionId = sessionId;
  task.laneSessions = [...(task.laneSessions ?? []), lane(sessionId, columnId, "running")];
  await h.system.taskStore.save(task);
  started.push({ cardId, columnId, via });
  return { sessionId };
}

function patch(taskId: string, body: Record<string, unknown>) {
  return PATCH(new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ taskId }) });
}

function del(taskId: string) {
  return DELETE(new NextRequest(`http://localhost/api/tasks/${taskId}`, { method: "DELETE" }), {
    params: Promise.resolve({ taskId }),
  });
}

function killedIds(): string[] {
  return h.killSession.mock.calls.map(([sessionId]) => sessionId);
}

async function setupSystem(options?: { doneRequiredArtifacts?: string[]; doneReporterOnly?: boolean; concurrencyLimit?: number }) {
  resetWorkflowOrchestrator();
  h.system = createInMemorySystem();
  const metadata = options?.concurrencyLimit
    ? { [`kanbanSessionConcurrencyLimit:${BOARD}`]: String(options.concurrencyLimit) }
    : undefined;
  await h.system.workspaceStore.save(createWorkspace({ id: WS, title: "Teardown", metadata }));
  await h.system.kanbanBoardStore.save(createKanbanBoard({
    id: BOARD,
    workspaceId: WS,
    name: "Board",
    isDefault: true,
    columns: columns(options),
  }));
}

beforeEach(async () => {
  vi.clearAllMocks();
  started.length = 0;
  h.killSession.mockImplementation(async () => undefined);
  h.processTransition.mockImplementation(async (_system: unknown, transition: { cardId: string; toColumnId: string }) => {
    await startFirstStep(transition.cardId, transition.toColumnId, "transition");
  });
  h.enqueue.mockImplementation(async (_system: unknown, params: { task: Task; expectedColumnId?: string }) => {
    const result = await startFirstStep(params.task.id, params.expectedColumnId ?? params.task.columnId ?? "", "enqueue");
    return { ...result, queued: false };
  });
  await setupSystem();
});

afterEach(() => {
  resetWorkflowOrchestrator();
});

describe("DELETE /api/tasks/{id} ends the card's sessions (C4, F4-1)", () => {
  it("kills each session of the card once and nothing of another card", async () => {
    await saveCard({
      id: "K",
      columnId: "dev",
      laneSessions: [lane("s-todo", "todo", "completed"), lane("s-dev", "dev", "running")],
      triggerSessionId: "s-dev",
    });
    await saveCard({ id: "X", columnId: "dev", laneSessions: [lane("s-x", "dev", "running")], triggerSessionId: "s-x" });

    const response = await del("K");

    expect(response.status).toBe(200);
    expect(await h.system.taskStore.get("K")).toBeFalsy();
    expect([...killedIds()].sort()).toEqual(["s-dev", "s-todo"]);
    expect(h.killSession).toHaveBeenCalledTimes(2);
    expect(killedIds()).not.toContain("s-x");
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.processTransition).not.toHaveBeenCalled();
    expect(h.triggerAssignedTaskAgent).not.toHaveBeenCalled();
    expect((await h.system.taskStore.get("X"))?.triggerSessionId).toBe("s-x");
  });

  it("returns 200 without kills for a card with no sessions and for an unknown id", async () => {
    await saveCard({ id: "EMPTY", columnId: "todo" });
    expect((await del("EMPTY")).status).toBe(200);
    expect((await del("NOPE")).status).toBe(200);
    expect(h.killSession).not.toHaveBeenCalled();
  });

  it("still deletes the card and returns 200 when killSession throws", async () => {
    h.killSession.mockImplementation(async () => {
      throw new Error("process gone");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await saveCard({ id: "K", columnId: "dev", laneSessions: [lane("s-dev", "dev", "running")], triggerSessionId: "s-dev" });

    const response = await del("K");

    expect(response.status).toBe(200);
    expect(await h.system.taskStore.get("K")).toBeFalsy();
    expect(h.killSession).toHaveBeenCalledWith("s-dev");
    warn.mockRestore();
  });
});

describe("a deleted card starts nothing again (C5 a, c)", () => {
  it("(a) its queued step never starts; the next queued card still does", async () => {
    await setupSystem({ concurrencyLimit: 1 });
    await saveCard({ id: "R", columnId: "dev" });
    await saveCard({ id: "K", columnId: "dev" });
    await saveCard({ id: "E", columnId: "dev" });
    const queue = getKanbanSessionQueue(h.system);
    queue.start();
    const startR = vi.fn(async () => ({ sessionId: "s-r" }));
    const startK = vi.fn(async () => ({ sessionId: "s-k" }));
    const startE = vi.fn(async () => ({ sessionId: "s-e" }));
    const job = (cardId: string, start: () => Promise<{ sessionId: string }>) => ({
      cardId, cardTitle: cardId, boardId: BOARD, workspaceId: WS, columnId: "dev", start,
    });
    expect(await queue.enqueue(job("R", startR))).toMatchObject({ sessionId: "s-r" });
    expect(await queue.enqueue(job("K", startK))).toMatchObject({ queued: true });
    expect(await queue.enqueue(job("E", startE))).toMatchObject({ queued: true });

    expect((await del("K")).status).toBe(200);
    h.system.eventBus.emit({
      type: AgentEventType.AGENT_COMPLETED,
      agentId: "s-r",
      workspaceId: WS,
      data: { sessionId: "s-r", success: true },
      timestamp: new Date(),
    });

    await vi.waitFor(() => expect(startE).toHaveBeenCalledTimes(1));
    expect(startK).not.toHaveBeenCalled();
    queue.stop();
  });

  it("(c) a revive right after the delete starts nothing for the card", async () => {
    await saveCard({ id: "K", columnId: "dev", laneSessions: [lane("s-dev", "dev", "running")], triggerSessionId: "s-dev" });
    await saveCard({ id: "E", columnId: "dev" });
    expect((await del("K")).status).toBe(200);
    h.killSession.mockClear();

    await reviveMissingEntryAutomations(h.system, WS, BOARD, {
      sessionStore: { getSession: () => undefined } as never,
      processManager: { hasActiveSession: () => false } as never,
    });

    const forCard = (cardId: string) => [
      ...h.enqueue.mock.calls.filter(([, params]) => (params as { task: Task }).task.id === cardId),
      ...h.processTransition.mock.calls.filter(([, transition]) => (transition as { cardId: string }).cardId === cardId),
      ...h.triggerAssignedTaskAgent.mock.calls.filter(([params]) => (params as { task?: Task })?.task?.id === cardId),
    ];
    expect(forCard("K")).toHaveLength(0);
    expect(forCard("E")).toHaveLength(1);
    expect(h.killSession).not.toHaveBeenCalled();
  });
});

describe("PATCH columnId ends the old column's sessions (C6, AC2)", () => {
  it("review → done: kills only s-rev, keeps the new Done session, records s-rev completed", async () => {
    await saveCard({
      id: "K",
      columnId: "review",
      laneSessions: [lane("s-dev", "dev", "completed"), lane("s-rev", "review", "running")],
      triggerSessionId: "s-rev",
    });

    const response = await patch("K", { columnId: "done" });

    expect(response.status).toBe(200);
    expect(killedIds()).toEqual(["s-rev"]);
    const stored = await h.system.taskStore.get("K");
    expect(stored?.triggerSessionId).toBe("s-new-done");
    expect(stored?.laneSessions?.find((entry) => entry.sessionId === "s-rev")?.status).toBe("completed");
    expect(stored?.laneSessions?.find((entry) => entry.sessionId === "s-dev")?.status).toBe("completed");
    expect(started.filter((entry) => entry.columnId === "review")).toHaveLength(0);
    expect(started).toEqual([{ cardId: "K", columnId: "done", via: "transition" }]);
  });

  it("a move rejected by the move guard kills nothing and leaves s-rev running", async () => {
    await setupSystem({ doneRequiredArtifacts: ["screenshot"] });
    await saveCard({ id: "K", columnId: "review", laneSessions: [lane("s-rev", "review", "running")], triggerSessionId: "s-rev" });

    const response = await patch("K", { columnId: "done" });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(h.killSession).not.toHaveBeenCalled();
    const stored = await h.system.taskStore.get("K");
    expect(stored?.columnId).toBe("review");
    expect(stored?.laneSessions?.[0]?.status).toBe("running");
  });

  it("F4-2: the card's trigger session is ended", async () => {
    await saveCard({ id: "K", columnId: "review", triggerSessionId: "s-trigger" });
    expect((await patch("K", { columnId: "blocked" })).status).toBe(200);
    expect(killedIds()).toEqual(["s-trigger"]);
  });

  it("F4-3: a running lane record without trigger session is ended on the transition branch", async () => {
    await saveCard({ id: "K", columnId: "review", laneSessions: [lane("s-rev2", "review", "running")] });
    expect((await patch("K", { columnId: "done" })).status).toBe(200);
    expect(h.processTransition).toHaveBeenCalledTimes(1);
    expect(killedIds()).toEqual(["s-rev2"]);
    const stored = await h.system.taskStore.get("K");
    expect(stored?.laneSessions?.find((entry) => entry.sessionId === "s-rev2")?.status).toBe("completed");
  });

  it("F4-4: moving into Dev ends the old session, not the new Dev session", async () => {
    await saveCard({ id: "K", columnId: "todo", laneSessions: [lane("s-todo", "todo", "running")], triggerSessionId: "s-todo" });
    expect((await patch("K", { columnId: "dev" })).status).toBe(200);
    expect(started).toEqual([{ cardId: "K", columnId: "dev", via: "enqueue" }]);
    expect(killedIds()).toEqual(["s-todo"]);
  });

  it("F4-5: moving into Blocked (no automation) ends the old session", async () => {
    await saveCard({ id: "K", columnId: "dev", laneSessions: [lane("s-dev", "dev", "running")], triggerSessionId: "s-dev" });
    expect((await patch("K", { columnId: "blocked" })).status).toBe(200);
    expect(killedIds()).toEqual(["s-dev"]);
    expect(started).toEqual([]);
    expect((await h.system.taskStore.get("K"))?.laneSessions?.[0]?.status).toBe("completed");
  });

  it("other cards' sessions are never ended by a move", async () => {
    await saveCard({ id: "K", columnId: "dev", laneSessions: [lane("s-dev", "dev", "running")], triggerSessionId: "s-dev" });
    await saveCard({ id: "X", columnId: "dev", laneSessions: [lane("s-x", "dev", "running")], triggerSessionId: "s-x" });
    await patch("K", { columnId: "review" });
    expect(killedIds()).toEqual(["s-dev"]);
  });
});

describe("F2 baseline shapes: moves without running sessions kill nothing", () => {
  it.each([
    ["backlog", "todo", [{ cardId: "K", columnId: "backlog", via: "transition" }]],
    ["todo", "backlog", [{ cardId: "K", columnId: "todo", via: "transition" }]],
    ["dev", "todo", [{ cardId: "K", columnId: "dev", via: "enqueue" }]],
    ["review", "dev", [{ cardId: "K", columnId: "review", via: "transition" }]],
    ["done", "review", [{ cardId: "K", columnId: "done", via: "transition" }]],
    ["blocked", "dev", []],
  ])("move to %s starts the same first step and kills 0", async (target, from, expected) => {
    await saveCard({ id: "K", columnId: from as string });
    const response = await patch("K", { columnId: target });
    expect(response.status).toBe(200);
    expect(started).toEqual(expected);
    expect(h.killSession).not.toHaveBeenCalled();
  });

  it.each([
    ["Done with pusher", false, "done-pusher"],
    ["Done with reporter only", true, "done-reporter"],
  ])("%s: entering Done starts its first step and kills 0", async (_label, reporterOnly, firstStep) => {
    await setupSystem({ doneReporterOnly: reporterOnly });
    await saveCard({ id: "K", columnId: "review" });
    expect((await patch("K", { columnId: "done" })).status).toBe(200);
    const board = await h.system.kanbanBoardStore.get(BOARD);
    const done = board?.columns.find((column) => column.id === "done");
    expect(done?.automation?.steps?.[0]?.specialistId).toBe(firstStep);
    expect(started).toEqual([{ cardId: "K", columnId: "done", via: "transition" }]);
    expect(h.killSession).not.toHaveBeenCalled();
  });

  it("PATCH retryTrigger (no column change) re-triggers once and kills 0", async () => {
    await saveCard({ id: "K", columnId: "dev", laneSessions: [lane("s-dev", "dev", "failed")] });
    const response = await patch("K", { retryTrigger: true });
    expect(response.status).toBe(200);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.killSession).not.toHaveBeenCalled();
  });

  it("a PATCH that only edits fields kills 0", async () => {
    await saveCard({ id: "K", columnId: "dev", laneSessions: [lane("s-dev", "dev", "running")], triggerSessionId: "s-dev" });
    expect((await patch("K", { title: "renamed" })).status).toBe(200);
    expect(h.killSession).not.toHaveBeenCalled();
  });

  it("DELETE still strips the deleted id from other cards' dependencies", async () => {
    await saveCard({ id: "K", columnId: "todo" });
    const other = await saveCard({ id: "O", columnId: "todo" });
    other.dependencies = ["K"];
    await h.system.taskStore.save(other);
    const response = await del("K");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.deleted).toBe(true);
    expect((await h.system.taskStore.get("O"))?.dependencies).toEqual([]);
  });
});
