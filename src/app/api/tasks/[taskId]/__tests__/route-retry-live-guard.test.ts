// @vitest-environment node
/**
 * PATCH retryTrigger must not start a second builder in a lane that already
 * has a live one (card fd27d00c; incident: two builders in one Dev lane).
 * Real in-memory system, real lane-rerun-claim and orchestrator singleton;
 * only the process manager and the start of new lane steps are replaced.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createKanbanBoard, type KanbanColumn } from "@/core/models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import type { RoutaSystem } from "@/core/routa-system";

vi.stubEnv("ROUTA_DB_DRIVER", "memory");

const h = vi.hoisted(() => ({
  system: undefined as unknown as RoutaSystem,
  alive: new Set<string>(),
  order: [] as string[],
  endImpl: undefined as undefined | ((ids: string[]) => Promise<void>),
  killSession: vi.fn(async (_id: string) => undefined),
  enqueue: vi.fn(),
}));

vi.mock("@/core/routa-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/routa-system")>()),
  getRoutaSystem: () => h.system,
}));

vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({
    killSession: h.killSession,
    hasActiveSession: (id: string) => h.alive.has(id),
  }),
}));

vi.mock("@/core/kanban/agent-trigger", () => ({
  triggerAssignedTaskAgent: vi.fn(),
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));

vi.mock("@/core/kanban/workflow-orchestrator-singleton", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/kanban/workflow-orchestrator-singleton")>();
  return {
    ...actual,
    enqueueKanbanTaskSession: (...args: unknown[]) => h.enqueue(...args),
    forgetKanbanCard: (...args: Parameters<typeof actual.forgetKanbanCard>) => {
      h.order.push("forget");
      return actual.forgetKanbanCard(...args);
    },
    endKanbanTaskSessions: async (system: RoutaSystem, ids: string[], label: string) => {
      h.order.push(`end:${ids.join(",")}`);
      if (h.endImpl) return h.endImpl(ids);
      return actual.endKanbanTaskSessions(system, ids, label);
    },
  };
});

import { createInMemorySystem } from "@/core/routa-system";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { clearLaneRerunClaims } from "@/core/kanban/lane-rerun-claim";
import { getWorkflowOrchestrator, resetWorkflowOrchestrator } from "@/core/kanban/workflow-orchestrator-singleton";
import { PATCH } from "../route";

const WS = "ws-live-guard";
const BOARD = "board-live-guard";

function step(id: string) {
  return { id, role: "CRAFTER", providerId: "codex", specialistId: id, specialistName: id };
}

const COLUMNS: KanbanColumn[] = [
  { id: "todo", name: "Todo", stage: "todo", position: 0 },
  { id: "dev", name: "Dev", stage: "dev", position: 1, automation: { enabled: true, steps: [step("dev-crafter")] } },
  { id: "review", name: "Review", stage: "review", position: 2, automation: { enabled: true, steps: [step("review-guard")] } },
];

type AcpStatus = "ready" | "connecting" | "error" | undefined;

function lane(sessionId: string, columnId: string, status: TaskLaneSession["status"], startedAt = "2026-10-29T00:00:00.000Z") {
  return { sessionId, columnId, stepIndex: 0, status, startedAt } as TaskLaneSession;
}

async function saveCard(id: string, laneSessions: TaskLaneSession[] | undefined, columnId = "dev") {
  const task = createTask({
    id,
    title: `Card ${id}`,
    objective: "live guard",
    workspaceId: WS,
    boardId: BOARD,
    columnId,
    status: TaskStatus.IN_PROGRESS,
    triggerSessionId: laneSessions?.find((e) => e.status === "running")?.sessionId,
  });
  task.laneSessions = laneSessions as Task["laneSessions"];
  task.sessionIds = (laneSessions ?? []).map((e) => e.sessionId);
  await h.system.taskStore.save(task);
  return task;
}

/** Makes the process of `sessionId` alive (process manager) and/or sets its acpStatus. */
function setLiveness(sessionId: string, process: boolean, acpStatus: AcpStatus) {
  if (process) h.alive.add(sessionId); else h.alive.delete(sessionId);
  const store = getHttpSessionStore();
  store.deleteSession(sessionId);
  if (acpStatus) {
    store.upsertSession({ sessionId, cwd: "/tmp", workspaceId: WS, createdAt: new Date().toISOString(), acpStatus });
  }
}

function patch(taskId: string, body: Record<string, unknown>) {
  return PATCH(new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ taskId }) });
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.alive.clear();
  h.order.length = 0;
  h.endImpl = undefined;
  clearLaneRerunClaims();
  resetWorkflowOrchestrator();
  h.system = createInMemorySystem();
  await h.system.workspaceStore.save(createWorkspace({ id: WS, title: "Live guard" }));
  await h.system.kanbanBoardStore.save(createKanbanBoard({
    id: BOARD, workspaceId: WS, name: "Board", isDefault: true, columns: COLUMNS,
  }));
  h.enqueue.mockImplementation(async (_system: unknown, params: { task: Task }) => {
    h.order.push("enqueue");
    const task = (await h.system.taskStore.get(params.task.id))!;
    task.triggerSessionId = "S-new";
    task.laneSessions = [...(task.laneSessions ?? []), lane("S-new", "dev", "running")];
    await h.system.taskStore.save(task);
    return { sessionId: "S-new", queued: false };
  });
});

afterEach(() => {
  resetWorkflowOrchestrator();
});

describe("PATCH retryTrigger with a live builder in the lane (C1, AC1)", () => {
  it.each([
    ["process alive, zombie lane started 30 minutes ago", true, undefined, new Date(Date.now() - 30 * 60_000).toISOString()],
    ["process gone, acpStatus ready", false, "ready", undefined],
    ["process gone, acpStatus connecting", false, "connecting", undefined],
  ] as const)("returns 409 step_running: %s", async (_label, process, acpStatus, startedAt) => {
    await saveCard("C1", [lane("S1", "dev", "running", startedAt)]);
    setLiveness("S1", process, acpStatus as AcpStatus);

    const response = await patch("C1", { retryTrigger: true });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.retrySkipped).toBe(true);
    expect(body.reason).toBe("step_running");
    expect(body.sessionId).toBe("S1");
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(h.killSession).not.toHaveBeenCalled();
    expect(h.order).toEqual([]);
    expect((await h.system.taskStore.get("C1"))?.triggerSessionId).toBe("S1");
  });
});

describe("PATCH retryTrigger force (C2, AC2)", () => {
  it("forgets the card, ends S1, marks its lane record completed, then enqueues once", async () => {
    await saveCard("C2", [lane("S1", "dev", "running")]);
    setLiveness("S1", true, undefined);
    const orchestrator = getWorkflowOrchestrator(h.system);
    expect(await orchestrator.adoptLaneRun({ cardId: "C2", columnId: "dev", stepIndex: 0, sessionId: "S1" })).toBe(true);

    const response = await patch("C2", { retryTrigger: true, force: true });

    expect(response.status).not.toBe(409);
    expect(h.order).toEqual(["forget", "end:S1", "enqueue"]);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(h.enqueue.mock.calls[0][1]).toMatchObject({ manualRerun: true, resumeLane: true });
    const stored = await h.system.taskStore.get("C2");
    const s1 = stored?.laneSessions?.find((e) => e.sessionId === "S1");
    expect(s1?.status).toBe("completed");
    expect(s1?.recoveryReason).toBeUndefined();
    const automations = (orchestrator as unknown as { activeAutomations: Map<string, { sessionId?: string }> }).activeAutomations;
    expect(automations.get("C2")?.sessionId).not.toBe("S1");
  });
});

describe("claim release (C3)", () => {
  it("(a) a 409 does not eat the next rerun once S1 is dead", async () => {
    await saveCard("C3A", [lane("S1", "dev", "running")]);
    setLiveness("S1", true, undefined);
    expect((await patch("C3A", { retryTrigger: true })).status).toBe(409);

    setLiveness("S1", false, "error");
    const second = await patch("C3A", { retryTrigger: true });
    const body = await second.json();

    expect(second.status).not.toBe(409);
    expect(body.retrySkipped).toBeUndefined();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });

  it("(b) a failing end during force is logged, the rerun still starts, and the next rerun works", async () => {
    await saveCard("C3B", [lane("S1", "dev", "running")]);
    setLiveness("S1", true, undefined);
    h.endImpl = async () => { throw new Error("kill failed"); };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const forced = await patch("C3B", { retryTrigger: true, force: true });
    expect(forced.status).not.toBe(409);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();

    h.enqueue.mockClear();
    setLiveness("S1", false, "error");
    setLiveness("S-new", false, "error");
    const next = await patch("C3B", { retryTrigger: true });
    expect(next.status).not.toBe(409);
    expect((await next.json()).retrySkipped).toBeUndefined();
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("old shapes keep working (F2)", () => {
  it("(1) completed lane with a still-alive process (DSH does not exit) reruns", async () => {
    await saveCard("F2A", [lane("S1", "dev", "completed")]);
    setLiveness("S1", true, "ready");
    const response = await patch("F2A", { retryTrigger: true });
    expect(response.status).not.toBe(409);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });

  it("(2) running lane whose session is dead reruns without force (AC3)", async () => {
    await saveCard("F2B", [lane("S1", "dev", "running")]);
    setLiveness("S1", false, "error");
    const response = await patch("F2B", { retryTrigger: true });
    expect(response.status).not.toBe(409);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });

  it.each([[[]], [undefined]])("(3) empty laneSessions %j reruns", async (laneSessions) => {
    await saveCard("F2C", laneSessions as TaskLaneSession[] | undefined);
    const response = await patch("F2C", { retryTrigger: true });
    expect(response.status).not.toBe(409);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
  });

  it("(4) two concurrent reruns still enqueue once and the loser is not step_running", async () => {
    await saveCard("F2D", []);
    const [a, b] = await Promise.all([patch("F2D", { retryTrigger: true }), patch("F2D", { retryTrigger: true })]);
    const bodies = [await a.json(), await b.json()];
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    const skipped = bodies.filter((entry) => entry.retrySkipped);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBeUndefined();
  });
});

describe("full enumeration against an independent oracle (F3, 160 cases)", () => {
  const laneStatuses = ["running", "completed", "failed", "timed_out", "none"] as const;
  const columns = ["dev", "review"] as const;
  const acpStatuses: AcpStatus[] = ["ready", "connecting", "error", undefined];
  // Plant a deliberate mistake to prove the enumeration notices (never set in CI).
  const planted = process.env.F3_PLANT_BUG === "1";

  /** From the requirement: 409 iff a running record in THIS column, a live session, and no force. */
  function expects409(status: string, column: string, process: boolean, acp: AcpStatus, force: boolean) {
    const columnMatches = planted ? true : column === "dev";
    return status === "running" && columnMatches && (process || acp === "ready" || acp === "connecting") && !force;
  }

  let n = 0;
  for (const status of laneStatuses) {
    for (const column of columns) {
      for (const process of [true, false]) {
        for (const acp of acpStatuses) {
          for (const force of [false, true]) {
            const id = `F3-${n += 1}`;
            it(`${id}: lane=${status} col=${column} proc=${process} acp=${acp} force=${force}`, async () => {
              await saveCard(id, status === "none" ? [] : [lane("S1", column, status)]);
              setLiveness("S1", process, acp);
              const response = await patch(id, { retryTrigger: true, force });
              if (expects409(status, column, process, acp, force)) {
                expect(response.status).toBe(409);
                expect(h.enqueue).not.toHaveBeenCalled();
              } else {
                expect(response.status).not.toBe(409);
                expect(h.enqueue).toHaveBeenCalledTimes(1);
              }
            });
          }
        }
      }
    }
  }
});
