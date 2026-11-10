// @vitest-environment node
/**
 * Card a00fb67b (L400; C4, F4): the tasks API with a "hold:<role>" label.
 * retryTrigger is judged on the role of the step it resumes (409 names the
 * role); a PATCH move into Done and POST revive stop only the pusher (the
 * update_task APPROVED convergence is in kanban-role-hold-gate.test.ts); the route's own role-held start keeps its reason.
 * Real in-memory system and orchestrator; only the agent launch is faked.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerMock, current } = vi.hoisted(() => ({
  triggerMock: vi.fn(),
  current: { system: undefined as unknown },
}));

vi.mock("@/core/kanban/agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerMock,
  getInternalApiOrigin: () => "http://localhost",
}));
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: vi.fn(), hasActiveSession: () => false }),
}));
vi.mock("@/core/kanban/github-issues", () => ({
  updateGitHubIssue: vi.fn(),
  createGitHubIssue: vi.fn(),
  buildTaskGitHubIssueBody: (objective: string) => objective,
  resolveGitHubRepo: () => undefined,
}));
vi.mock("@/core/routa-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/routa-system")>()),
  getRoutaSystem: () => current.system,
}));

import { createKanbanBoard, type KanbanAutomationStep, type KanbanColumn } from "@/core/models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import { createInMemorySystem, type RoutaSystem } from "@/core/routa-system";
import { clearLaneRerunClaims } from "@/core/kanban/lane-rerun-claim";
import { formatRoleHoldSyncError } from "@/core/kanban/task-hold";
import { resetWorkflowOrchestrator, startWorkflowOrchestrator } from "@/core/kanban/workflow-orchestrator-singleton";
import { PATCH } from "../route";
import { POST as reviveRoute } from "@/app/api/kanban/boards/[boardId]/revive/route";

const WS = "ws-role-hold";
const BOARD_ID = "board-role-hold";
const PUSHER = "kanban-main-pusher";
const REPORTER = "kanban-done-reporter";
const GUARD = "kanban-review-guard";
const CRAFTER = "kanban-dev-crafter";
const ROLE_HOLD = `hold:${PUSHER}`;
const step = (specialistId: string): KanbanAutomationStep => ({ id: specialistId, providerId: "claude", role: "GATE", specialistId });
const lane = (id: string, stage: KanbanColumn["stage"], position: number, steps?: KanbanAutomationStep[]): KanbanColumn => ({
  id, name: id, position, stage, automation: steps ? { enabled: true, transitionType: "entry", steps } : undefined,
});

let system: RoutaSystem;
let seq = 0;
let clock = Date.now() - 3_600_000;
const run = (columnId: string, stepIndex: number, extra: Partial<TaskLaneSession> = {}): TaskLaneSession => ({
  sessionId: `old-${columnId}-${stepIndex}-${clock += 60_000}`, columnId, stepIndex, status: "completed", startedAt: new Date(clock).toISOString(), ...extra,
});

async function setup(): Promise<void> {
  system = createInMemorySystem();
  current.system = system;
  await system.workspaceStore.save(createWorkspace({ id: WS, title: "Hold", metadata: { [`kanbanSessionConcurrencyLimit:${BOARD_ID}`]: "5" } }));
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: BOARD_ID, workspaceId: WS, name: "Board", isDefault: true,
    columns: [
      lane("todo", "todo", 0),
      lane("dev", "dev", 1, [step(CRAFTER)]),
      lane("review", "review", 2, [step(GUARD)]),
      lane("done", "done", 3, [step(PUSHER), step(REPORTER)]),
      lane("blocked", "blocked", 4),
    ],
  }));
  startWorkflowOrchestrator(system);
}

async function seed(extra: Partial<Task>): Promise<Task> {
  const task: Task = {
    ...createTask({ id: "card-1", title: "t", objective: "o", workspaceId: WS, boardId: BOARD_ID, columnId: "done", status: TaskStatus.PENDING }),
    ...extra,
  };
  await system.taskStore.save(task);
  return task;
}

async function patch(body: Record<string, unknown>) {
  const response = await PATCH(new NextRequest("http://localhost/api/tasks/card-1", {
    method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ taskId: "card-1" }) });
  return { status: response.status, data: await response.json() };
}

const stored = async () => (await system.taskStore.get("card-1"))!;
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
const startedRoles = () => triggerMock.mock.calls.map((call) => (call[0] as { step?: { specialistId?: string } }).step?.specialistId);

beforeEach(async () => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetWorkflowOrchestrator();
  clearLaneRerunClaims();
  triggerMock.mockReset();
  triggerMock.mockImplementation(async (params: { task: { id: string } }) => ({ sessionId: `${params.task.id}:s${seq += 1}`, transport: "acp" }));
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  await setup();
});

afterEach(() => {
  resetWorkflowOrchestrator();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Not started, reason written, nothing failed, not Blocked. */
async function expectPusherHeld(): Promise<void> {
  const saved = await stored();
  expect(startedRoles()).not.toContain(PUSHER);
  expect(saved.columnId).toBe("done");
  expect(saved.triggerSessionId).toBeUndefined();
  expect(saved.lastSyncError).toBe(formatRoleHoldSyncError(PUSHER));
  expect((saved.laneSessions ?? []).filter((entry) => entry.columnId === "done")).toEqual([]);
}

describe("F4 retryTrigger (judged on this request's labels and the resumed step)", () => {
  it("Done, pusher not run: 409 naming the role, nothing started, card unchanged", async () => {
    const before = await seed({ labels: [ROLE_HOLD], lastSyncError: "keep" });
    const { status, data } = await patch({ retryTrigger: true });
    expect(status).toBe(409);
    expect(data.error).toContain(ROLE_HOLD);
    await settle();
    expect(triggerMock).not.toHaveBeenCalled();
    expect((await stored()).lastSyncError).toBe("keep");
    expect((await stored()).updatedAt).toEqual(before.updatedAt);
  });

  it("the same request drops the label: not 409, the pusher starts", async () => {
    await seed({ labels: [ROLE_HOLD, "req:x"] });
    const { status } = await patch({ labels: ["req:x"], retryTrigger: true });
    expect(status).toBe(200);
    await vi.waitFor(() => expect(startedRoles()).toEqual([PUSHER]));
  });

  it("pusher completed, rerun resumes the reporter: 200, the reporter starts", async () => {
    await seed({ labels: [ROLE_HOLD], laneSessions: [run("done", 0)] });
    const { status } = await patch({ retryTrigger: true });
    expect(status).toBe(200);
    await vi.waitFor(() => expect(startedRoles()).toEqual([REPORTER]));
  });

  it("Review card with hold:pusher: the guard reruns", async () => {
    await seed({ columnId: "review", labels: [ROLE_HOLD] });
    const { status } = await patch({ retryTrigger: true });
    expect(status).toBe(200);
    await vi.waitFor(() => expect(startedRoles()).toEqual([GUARD]));
  });

  it("F2: whole-card hold is still the old 409 message", async () => {
    await seed({ columnId: "review", labels: ["hold"] });
    const { status, data } = await patch({ retryTrigger: true });
    expect(status).toBe(409);
    expect(data.error).toBe("卡片带 hold 标签（暂不派），去掉标签后再重跑");
  });
});

describe("F4 moves into Done", () => {
  it("PATCH columnId review → done: the pusher is held, non-5xx, not Blocked", async () => {
    await seed({ columnId: "review", labels: [ROLE_HOLD], laneSessions: [run("review", 0)] });
    const { status } = await patch({ columnId: "done" });
    expect(status).toBeLessThan(500);
    await vi.waitFor(async () => expect((await stored()).lastSyncError).toBe(formatRoleHoldSyncError(PUSHER)));
    await settle();
    await expectPusherHeld();
  });

  it("POST revive on a Done card stopped at the pusher: held, reason written", async () => {
    await seed({ labels: [ROLE_HOLD] });
    const response = await reviveRoute(new NextRequest(`http://localhost/api/kanban/boards/${BOARD_ID}/revive`, { method: "POST" }), {
      params: Promise.resolve({ boardId: BOARD_ID }),
    });
    expect(response.status).toBe(200);
    await settle();
    await expectPusherHeld();
  });
});

describe("C4: the route's own start answered on_hold by a role hold", () => {
  it("PATCH into Dev with hold:kanban-dev-crafter: 200, the reason stays on the card", async () => {
    await seed({ columnId: "todo", labels: [`hold:${CRAFTER}`], lastSyncError: "旧的失败" });
    const { status, data } = await patch({ columnId: "dev" });
    expect(status).toBe(200);
    // The route's own start answered on_hold: its response keeps the reason instead of clearing it.
    expect(data.task.lastSyncError).toBe(formatRoleHoldSyncError(CRAFTER));
    await settle();
    const saved = await stored();
    expect(saved.columnId).toBe("dev");
    expect(saved.lastSyncError).toBe(formatRoleHoldSyncError(CRAFTER));
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("control: PATCH into Dev with hold:pusher starts the crafter", async () => {
    await seed({ columnId: "todo", labels: [ROLE_HOLD] });
    await patch({ columnId: "dev" });
    await vi.waitFor(() => expect(startedRoles()).toEqual([CRAFTER]));
  });
});
