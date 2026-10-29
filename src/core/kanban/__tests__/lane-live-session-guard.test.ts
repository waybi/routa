// @vitest-environment node
/**
 * Card fd27d00c: a lane never gets a second builder next to a live one.
 * C4 enqueue safety net, C5 adoptLaneRun, C6 manual_rerun record, C7 the
 * new recovery reason is not a failure, F4-5 revive. Real in-memory system,
 * orchestrator singleton and routes; only the agent launch and the process
 * manager are faked.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoutaSystem } from "@/core/routa-system";

vi.stubEnv("ROUTA_DB_DRIVER", "memory");

const h = vi.hoisted(() => ({
  system: undefined as unknown as RoutaSystem,
  trigger: vi.fn(),
  alive: new Set<string>(),
  killSession: vi.fn(async (_sessionId: string) => undefined),
  counter: { value: 0 },
}));

vi.mock("@/core/routa-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/routa-system")>()),
  getRoutaSystem: () => h.system,
}));
vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: h.killSession, hasActiveSession: (id: string) => h.alive.has(id) }),
}));
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("@/core/kanban/agent-trigger", () => ({
  triggerAssignedTaskAgent: h.trigger,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));

import { createKanbanBoard, type KanbanColumn } from "@/core/models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import { createInMemorySystem } from "@/core/routa-system";
import { clearLaneRerunClaims } from "@/core/kanban/lane-rerun-claim";
import { isInterruptedRetrySpent } from "@/core/kanban/attention-to-blocked";
import { countResolverSessions } from "@/core/kanban/auto-resolution-record";
import { getEnvironmentFailureCount, isAwaitingEnvironmentFix } from "@/core/kanban/environment-failure";
import { reviveMissingEntryAutomations } from "@/core/kanban/restart-recovery";
import {
  enqueueKanbanTaskSession,
  getWorkflowOrchestrator,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "@/core/kanban/workflow-orchestrator-singleton";
import { getNonDevAutomationRunCount, hasExceededNonDevAutomationRepeatLimit } from "@/core/kanban/workflow-orchestrator";
import { PATCH as taskPatch } from "@/app/api/tasks/[taskId]/route";

const WS = "ws-live-guard-core";
const BOARD = "board-live-guard-core";

function step(id: string, role = "GATE") {
  return { id, role, providerId: "claude", specialistId: id, specialistName: id };
}

const DEV_STEP = step("dev-crafter", "CRAFTER");
const COLUMNS: KanbanColumn[] = [
  { id: "backlog", name: "Backlog", stage: "backlog", position: 0 },
  { id: "dev", name: "Dev", stage: "dev", position: 1, automation: { enabled: true, transitionType: "entry", steps: [DEV_STEP] } },
  { id: "review", name: "Review", stage: "review", position: 2, automation: { enabled: true, transitionType: "entry", autoAdvanceOnSuccess: false, steps: [step("qa-frontend"), step("review-guard")] } },
  { id: "blocked", name: "Blocked", stage: "blocked", position: 3 },
];

function laneEntry(sessionId: string, columnId: string, status: TaskLaneSession["status"], extra: Partial<TaskLaneSession> = {}): TaskLaneSession {
  return { sessionId, columnId, stepIndex: 0, status, startedAt: "2026-10-29T00:00:00.000Z", ...extra };
}

async function saveCard(id: string, columnId: string, laneSessions: TaskLaneSession[]): Promise<Task> {
  const task: Task = {
    ...createTask({ id, title: `Card ${id}`, objective: "live guard", workspaceId: WS, boardId: BOARD, columnId, status: TaskStatus.IN_PROGRESS }),
    laneSessions,
    sessionIds: laneSessions.map((entry) => entry.sessionId),
  } as Task;
  await h.system.taskStore.save(task);
  return task;
}

const card = async (id: string) => (await h.system.taskStore.get(id))!;

function patch(taskId: string, body: Record<string, unknown>) {
  return taskPatch(new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ taskId }) });
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.alive.clear();
  clearLaneRerunClaims();
  resetWorkflowOrchestrator();
  h.system = createInMemorySystem();
  await h.system.workspaceStore.save(createWorkspace({
    id: WS, title: "Live guard", metadata: { [`kanbanSessionConcurrencyLimit:${BOARD}`]: "10" },
  }));
  await h.system.kanbanBoardStore.save(createKanbanBoard({ id: BOARD, workspaceId: WS, name: "Board", isDefault: true, columns: COLUMNS }));
  startWorkflowOrchestrator(h.system);
  h.trigger.mockImplementation(async (params: { task: { id: string }; stepIndex?: number }) => {
    h.counter.value += 1;
    return { sessionId: `${params.task.id}:n${h.counter.value}`, transport: "acp" };
  });
});

afterEach(() => {
  resetWorkflowOrchestrator();
});

describe("C4: enqueueKanbanTaskSession refuses a second builder in the lane", () => {
  const entries: Array<[string, Record<string, unknown>]> = [
    ["adoptLaneRun", { adoptLaneRun: true, step: DEV_STEP, stepIndex: 0 }],
    ["resumeLane", { resumeLane: true }],
  ];

  it.each(entries)("%s with a live running S1 in the same column creates no session", async (_name, extra) => {
    const task = await saveCard("c4", "dev", [laneEntry("S1", "dev", "running")]);
    task.triggerSessionId = undefined;
    h.alive.add("S1");

    const result = await enqueueKanbanTaskSession(h.system, { task, expectedColumnId: "dev", ...extra });

    expect(result).toEqual({ sessionId: "S1", queued: false });
    expect(h.trigger).not.toHaveBeenCalled();
    expect((await card("c4")).laneSessions).toHaveLength(1);
  });

  it.each(entries)("%s control: the live session belongs to another column, so a session is created once", async (_name, extra) => {
    const task = await saveCard("c4c", "dev", [laneEntry("S1", "review", "running")]);
    h.alive.add("S1");

    const result = await enqueueKanbanTaskSession(h.system, { task, expectedColumnId: "dev", ...extra });

    expect(result.sessionId).toBeTruthy();
    expect(h.trigger).toHaveBeenCalledTimes(1);
  });
});

describe("C5: adoptLaneRun does not overwrite a live running automation", () => {
  async function adopt(sessionId: string) {
    return getWorkflowOrchestrator(h.system).adoptLaneRun({ cardId: "c5", columnId: "dev", stepIndex: 0, sessionId });
  }
  const automations = () => (getWorkflowOrchestrator(h.system) as unknown as {
    activeAutomations: Map<string, { sessionId?: string }>;
  }).activeAutomations;

  beforeEach(async () => {
    await saveCard("c5", "dev", []);
    expect(await adopt("S1")).toBe(true);
  });

  it("(1) S1 alive: returns false and keeps S1", async () => {
    h.alive.add("S1");
    expect(await adopt("S2")).toBe(false);
    expect(automations().get("c5")?.sessionId).toBe("S1");
  });

  it("(2) S1 dead: returns true and S2 replaces it", async () => {
    expect(await adopt("S2")).toBe(true);
    expect(automations().get("c5")?.sessionId).toBe("S2");
  });

  it("(3) the same session again is no conflict", async () => {
    h.alive.add("S1");
    expect(await adopt("S1")).toBe(true);
    expect(automations().get("c5")?.sessionId).toBe("S1");
  });
});

describe("C6: manual rerun record", () => {
  async function newestRecord(id: string) {
    const lane = (await card(id)).laneSessions ?? [];
    return lane[lane.length - 1];
  }

  it("(1) previous record without attempt: manual_rerun, attempt 2", async () => {
    await saveCard("c6a", "dev", [laneEntry("old", "dev", "failed", { recoveryReason: "agent_failed" })]);
    expect((await patch("c6a", { retryTrigger: true })).status).toBe(200);
    expect(await newestRecord("c6a")).toMatchObject({ recoveryReason: "manual_rerun", attempt: 2, status: "running" });
  });

  it("(2) previous attempt 3: attempt 4", async () => {
    await saveCard("c6b", "dev", [laneEntry("old", "dev", "failed", { attempt: 3, recoveryReason: "agent_failed" })]);
    await patch("c6b", { retryTrigger: true });
    expect(await newestRecord("c6b")).toMatchObject({ recoveryReason: "manual_rerun", attempt: 4 });
  });

  it("(3) force path over a live S1 without attempt: manual_rerun, attempt 2", async () => {
    await saveCard("c6c", "dev", [laneEntry("S1", "dev", "running")]);
    h.alive.add("S1");
    expect((await patch("c6c", { retryTrigger: true, force: true })).status).not.toBe(409);
    expect(h.killSession).toHaveBeenCalledWith("S1");
    expect(await newestRecord("c6c")).toMatchObject({ recoveryReason: "manual_rerun", attempt: 2 });
    const first = (await card("c6c")).laneSessions?.find((entry) => entry.sessionId === "S1");
    expect(first?.status).not.toBe("failed");
  });

  it("control: revive is not marked manual_rerun", async () => {
    await saveCard("c6d", "review", [laneEntry("old-qa", "review", "failed", { recoveryReason: "agent_failed" })]);
    await reviveMissingEntryAutomations(h.system, WS, BOARD, {
      sessionStore: { getSession: () => undefined } as never,
      processManager: { hasActiveSession: () => false } as never,
    });
    const record = await newestRecord("c6d");
    expect(record.sessionId).not.toBe("old-qa");
    expect(record.recoveryReason).not.toBe("manual_rerun");
  });
});

describe("C7: manual_rerun is not a failure", () => {
  const records = (reason: TaskLaneSession["recoveryReason"], status: TaskLaneSession["status"]) =>
    [1, 2, 3].map((n) => laneEntry(`r${n}`, "review", status, { recoveryReason: reason }));

  it("manual_rerun x3 trips no budget, fuse, environment or attention rule", async () => {
    const task = { columnId: "review", laneSessions: records("manual_rerun", "completed") } as Task;
    expect(getNonDevAutomationRunCount(task, "review", "review")).toBe(0);
    expect(hasExceededNonDevAutomationRepeatLimit(task, "review", "review")).toBe(false);
    expect(getEnvironmentFailureCount(task, "review")).toBe(0);
    expect(isAwaitingEnvironmentFix(task, "review")).toBe(false);
    expect(isInterruptedRetrySpent(task, Date.now())).toBe(false);
    expect(countResolverSessions(task.laneSessions, "blocked", "x")).toBe(0);
  });

  it("control: three agent_failed runs still trip the repeat limit", () => {
    const task = { columnId: "review", laneSessions: records("agent_failed", "failed") } as Task;
    expect(hasExceededNonDevAutomationRepeatLimit(task, "review", "review")).toBe(true);
    expect(isInterruptedRetrySpent(task, Date.now())).toBe(true);
  });
});

describe("F4-5: revive creates no session while the lane has a live builder", () => {
  it("revive over a live running record starts nothing", async () => {
    await saveCard("f45", "dev", [laneEntry("S1", "dev", "running")]);
    h.alive.add("S1");
    await reviveMissingEntryAutomations(h.system, WS, BOARD, {
      sessionStore: { getSession: () => undefined } as never,
      processManager: { hasActiveSession: (id: string) => h.alive.has(id) } as never,
    });
    expect(h.trigger).not.toHaveBeenCalled();
    expect((await card("f45")).laneSessions).toHaveLength(1);
  });
});
