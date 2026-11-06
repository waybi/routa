// @vitest-environment node
/**
 * Card beb29624 (AC1, AC3, AC5, C6, F2/F4): the tasks API on a card with the
 * "hold" label. The routes run against a real in-memory system with the real
 * orchestrator singleton and session queue; only the agent launch and the
 * process manager are faked.
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

import { createKanbanBoard, type KanbanColumn } from "@/core/models/kanban";
import { createTask, TaskStatus, type Task } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import { createInMemorySystem, type RoutaSystem } from "@/core/routa-system";
import { clearLaneRerunClaims } from "@/core/kanban/lane-rerun-claim";
import { getKanbanSessionQueue, resetWorkflowOrchestrator, startWorkflowOrchestrator } from "@/core/kanban/workflow-orchestrator-singleton";
import { PATCH } from "../route";
import { POST as createTaskRoute } from "../../route";

const WS = "ws-hold";
const BOARD_ID = "board-hold";
const MESSAGE = "卡片带 hold 标签（暂不派），去掉标签后再重跑";
const lane = (id: string, stage: KanbanColumn["stage"], position: number): KanbanColumn => ({
  id, name: id, position, stage,
  automation: { enabled: true, transitionType: "entry", steps: [{ id: `${id}-step`, providerId: "claude", role: "GATE", specialistId: `${id}-step` }] },
});

let system: RoutaSystem;
let seq = 0;

async function setup(): Promise<void> {
  system = createInMemorySystem();
  current.system = system;
  await system.workspaceStore.save(createWorkspace({ id: WS, title: "Hold", metadata: { [`kanbanSessionConcurrencyLimit:${BOARD_ID}`]: "5" } }));
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: BOARD_ID, workspaceId: WS, name: "Board", isDefault: true,
    columns: [lane("backlog", "backlog", 0), lane("todo", "todo", 1), lane("review", "review", 2), { id: "done", name: "done", position: 3, stage: "done" }],
  }));
  startWorkflowOrchestrator(system);
}

async function seed(extra: Partial<Task>): Promise<Task> {
  const task: Task = {
    ...createTask({ id: "card-1", title: "track", objective: "track", workspaceId: WS, boardId: BOARD_ID, columnId: "todo", status: TaskStatus.PENDING }),
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

const stored = async (id = "card-1") => (await system.taskStore.get(id))!;
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

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

describe("AC1 / C6①: POST /api/tasks with a hold label", () => {
  it.each([["hold"], ["HOLD"], ["Hold"]])("labels [%s] into Backlog: no session, no lane record, no slot taken", async (label) => {
    const response = await createTaskRoute(new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "追踪项", objective: "只追踪", workspaceId: WS, boardId: BOARD_ID, labels: [label] }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(response.status).toBe(201);
    const { task } = await response.json() as { task: Task };
    await settle();
    const saved = await stored(task.id);
    expect(saved.columnId).toBe("backlog");
    expect(saved.laneSessions ?? []).toEqual([]);
    expect(saved.triggerSessionId).toBeUndefined();
    expect(saved.lastSyncError).toBeUndefined();
    expect(triggerMock).not.toHaveBeenCalled();
    expect((await getKanbanSessionQueue(system).getBoardSnapshot(BOARD_ID)).runningCount).toBe(0);
  });

  it("F2 control: the same POST without hold starts the Backlog step once", async () => {
    const response = await createTaskRoute(new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "work", objective: "work", workspaceId: WS, boardId: BOARD_ID, labels: ["req:x"] }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(response.status).toBe(201);
    await vi.waitFor(() => expect(triggerMock).toHaveBeenCalledTimes(1));
  });
});

describe("C6②: PATCH columnId moves a held card", () => {
  it("into an automated lane: no session, non-5xx, old lastSyncError cleared, not Blocked", async () => {
    await seed({ labels: ["hold"], lastSyncError: "旧的失败" });
    const { status } = await patch({ columnId: "review" });
    expect(status).toBeLessThan(500);
    await settle();
    const saved = await stored();
    expect(saved.columnId).toBe("review");
    expect(saved.lastSyncError).toBeUndefined();
    expect(saved.triggerSessionId).toBeUndefined();
    expect(saved.laneSessions ?? []).toEqual([]);
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("into Dev (the route's own enqueue): on_hold is not written as lastSyncError", async () => {
    await system.kanbanBoardStore.save({
      ...(await system.kanbanBoardStore.get(BOARD_ID))!,
      columns: [...(await system.kanbanBoardStore.get(BOARD_ID))!.columns, lane("dev", "dev", 4)],
    });
    await seed({ labels: ["hold"], lastSyncError: "旧的失败" });
    const { status } = await patch({ columnId: "dev" });
    expect(status).toBe(200);
    await settle();
    const saved = await stored();
    expect(saved.columnId).toBe("dev");
    expect(saved.lastSyncError).toBeUndefined();
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("F2 control: the same move without hold starts the Review step", async () => {
    await seed({ labels: ["req:x", "deploy:host"] });
    await patch({ columnId: "review" });
    await vi.waitFor(() => expect(triggerMock).toHaveBeenCalledTimes(1));
  });
});

describe("AC3 / C6③④: PATCH retryTrigger", () => {
  it("held card: 409 with the hold message; nothing started, card unchanged", async () => {
    const before = await seed({ labels: ["Hold"], lastSyncError: "keep" });
    const { status, data } = await patch({ retryTrigger: true });
    expect(status).toBe(409);
    expect(data.error).toContain(MESSAGE);
    await settle();
    expect(triggerMock).not.toHaveBeenCalled();
    const saved = await stored();
    expect(saved.lastSyncError).toBe("keep");
    expect(saved.updatedAt).toEqual(before.updatedAt);
  });

  it("held card with force=true: still 409 (no forced end of anything)", async () => {
    await seed({ labels: ["hold"] });
    const { status } = await patch({ retryTrigger: true, force: true });
    expect(status).toBe(409);
  });

  it("one request that drops hold and reruns: not 409, judged on the merged labels, a session starts", async () => {
    await seed({ labels: ["hold", "req:x"] });
    const { status, data } = await patch({ labels: ["req:x"], retryTrigger: true });
    expect(status).toBe(200);
    expect(data.task.labels).toEqual(["req:x"]);
    await vi.waitFor(async () => expect((await stored()).triggerSessionId).toBeTruthy());
    expect(triggerMock).toHaveBeenCalledTimes(1);
  });

  it("one request that adds hold and reruns: 409", async () => {
    await seed({ labels: [] });
    const { status } = await patch({ labels: ["hold"], retryTrigger: true });
    expect(status).toBe(409);
    expect(triggerMock).not.toHaveBeenCalled();
  });
});

describe("AC5 / C6⑤: drop hold, then rerun", () => {
  it("PATCH labels alone starts nothing; a later retryTrigger starts the lane's step", async () => {
    await seed({ labels: ["hold"] });
    const first = await patch({ labels: [] });
    expect(first.status).toBe(200);
    await settle();
    expect(triggerMock).not.toHaveBeenCalled();
    expect((await stored()).triggerSessionId).toBeUndefined();

    const rerun = await patch({ retryTrigger: true });
    expect(rerun.status).toBe(200);
    await vi.waitFor(async () => expect((await stored()).triggerSessionId).toBeTruthy());
    expect(triggerMock).toHaveBeenCalledTimes(1);
    expect(triggerMock.mock.calls[0]?.[0]?.step?.specialistId).toBe("todo-step");
  });
});
