// @vitest-environment node
/**
 * Card 6d8365ca, C6 / F4: every entry that starts a lane session records it in
 * lane_sessions (sessionId, running, stepName, role, columnId, startedAt) and
 * the record ends when the session ends. Before, the dev session b2261ec7 of
 * card fd9722de, started by a manual rerun on 2026-10-23 12:40, never got a
 * finished lane record and the retro reported "dev step never completed".
 *
 * Real in-memory system, real orchestrator singleton, session queue and
 * routes; only the agent launch and the process manager are faked.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoutaSystem } from "@/core/routa-system";

const h = vi.hoisted(() => ({
  system: undefined as unknown as RoutaSystem,
  trigger: vi.fn(),
  killSession: vi.fn(async (_sessionId: string) => undefined),
  noResumeStep: { value: false },
  counter: { value: 0 },
}));

vi.mock("@/core/routa-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/routa-system")>()),
  getRoutaSystem: () => h.system,
}));
vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: h.killSession, hasActiveSession: () => false }),
}));
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("@/core/kanban/agent-trigger", () => ({
  triggerAssignedTaskAgent: h.trigger,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));
vi.mock("@/core/kanban/lane-automation-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/kanban/lane-automation-state")>();
  return {
    ...actual,
    resolveLaneResumeStep: (...args: Parameters<typeof actual.resolveLaneResumeStep>) =>
      (h.noResumeStep.value ? undefined : actual.resolveLaneResumeStep(...args)),
  };
});

import { AgentEventType } from "@/core/events/event-bus";
import { createKanbanBoard, type KanbanColumn } from "@/core/models/kanban";
import { createTask, TaskStatus, VerificationVerdict, type Task, type TaskLaneSession } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import { createInMemorySystem } from "@/core/routa-system";
import { KanbanTools } from "@/core/tools/kanban-tools";
import { reviveMissingEntryAutomations } from "@/core/kanban/restart-recovery";
import {
  getWorkflowOrchestrator,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "@/core/kanban/workflow-orchestrator-singleton";
import { PATCH as taskPatch } from "@/app/api/tasks/[taskId]/route";
import { POST as tasksPost } from "@/app/api/tasks/route";

const WS = "ws-rerun";
const BOARD = "board-rerun";

function step(id: string, role = "GATE") {
  return { id, role, providerId: "claude", specialistId: id, specialistName: id };
}

const COLUMNS: KanbanColumn[] = [
  { id: "backlog", name: "Backlog", stage: "backlog", position: 0 },
  { id: "dev", name: "Dev", stage: "dev", position: 1, automation: { enabled: true, transitionType: "entry", steps: [step("dev-crafter", "CRAFTER")] } },
  {
    id: "review",
    name: "Review",
    stage: "review",
    position: 2,
    automation: { enabled: true, transitionType: "entry", autoAdvanceOnSuccess: false, steps: [step("qa-frontend"), step("review-guard")] },
  },
  { id: "done", name: "Done", stage: "done", position: 3, automation: { enabled: true, transitionType: "entry", steps: [step("main-pusher"), step("done-reporter")] } },
  { id: "blocked", name: "Blocked", stage: "blocked", position: 4 },
];

function laneEntry(sessionId: string, columnId: string, stepIndex: number, status: TaskLaneSession["status"], extra: Partial<TaskLaneSession> = {}): TaskLaneSession {
  return { sessionId, columnId, stepIndex, status, startedAt: "2026-10-23T12:00:00.000Z", ...extra };
}

async function setup() {
  resetWorkflowOrchestrator();
  h.system = createInMemorySystem();
  await h.system.workspaceStore.save(createWorkspace({
    id: WS,
    title: "Rerun",
    metadata: { [`kanbanSessionConcurrencyLimit:${BOARD}`]: "10" },
  }));
  await h.system.kanbanBoardStore.save(createKanbanBoard({ id: BOARD, workspaceId: WS, name: "Board", isDefault: true, columns: COLUMNS }));
  startWorkflowOrchestrator(h.system);
}

async function saveCard(id: string, columnId: string, extra: Partial<Task> = {}): Promise<Task> {
  const task: Task = {
    ...createTask({ id, title: `Card ${id}`, objective: "rerun", workspaceId: WS, boardId: BOARD, columnId, status: TaskStatus.IN_PROGRESS }),
    ...extra,
  } as Task;
  await h.system.taskStore.save(task);
  return task;
}

async function card(id: string): Promise<Task> {
  return (await h.system.taskStore.get(id))!;
}

/** Session ids the faked agent launch returned, in order. */
const launched: string[] = [];

function emitTurnEnd(sessionId: string, type = AgentEventType.AGENT_COMPLETED, data: Record<string, unknown> = { success: true, stopReason: "end_turn" }) {
  h.system.eventBus.emit({ type, agentId: sessionId, workspaceId: WS, data: { sessionId, ...data }, timestamp: new Date() });
}

/** The new run is recorded with the fields the board, retro and inbox read. */
async function expectRegistered(cardId: string, sessionId: string, columnId: string, stepName: string) {
  const record = (await card(cardId)).laneSessions?.find((entry) => entry.sessionId === sessionId);
  expect(record).toMatchObject({
    sessionId,
    status: "running",
    columnId,
    stepName,
    role: expect.any(String),
    startedAt: expect.any(String),
  });
}

async function expectCompletedAfterTurnEnd(cardId: string, sessionId: string) {
  emitTurnEnd(sessionId);
  await vi.waitFor(async () => {
    const record = (await card(cardId)).laneSessions?.find((entry) => entry.sessionId === sessionId);
    expect(record?.status).toBe("completed");
    expect(record?.completedAt).toEqual(expect.any(String));
  });
}

function patch(taskId: string, body: Record<string, unknown>) {
  return taskPatch(new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ taskId }) });
}

function revive() {
  return reviveMissingEntryAutomations(h.system, WS, BOARD, {
    sessionStore: { getSession: () => undefined } as never,
    processManager: { hasActiveSession: () => false } as never,
  });
}

beforeEach(async () => {
  h.trigger.mockReset();
  h.killSession.mockClear();
  h.noResumeStep.value = false;
  launched.length = 0;
  h.trigger.mockImplementation(async (params: { task: { id: string }; stepIndex?: number }) => {
    h.counter.value += 1;
    const sessionId = `${params.task.id}:s${params.stepIndex ?? "x"}:${h.counter.value}`;
    launched.push(sessionId);
    return { sessionId, transport: "acp" };
  });
  await setup();
});

afterEach(() => {
  resetWorkflowOrchestrator();
});

describe("C6: PATCH /api/tasks/{id} retryTrigger (kanban-tab「重新运行」, inbox-retry)", () => {
  it("S12 resumes the failed step: new running record, completed at its turn end", async () => {
    await saveCard("s12", "review", {
      laneSessions: [laneEntry("old-qa", "review", 0, "completed"), laneEntry("old-guard", "review", 1, "failed", { recoveryReason: "agent_failed" })],
    });

    const response = await patch("s12", { retryTrigger: true });
    expect(response.status).toBe(200);

    const sessionId = launched.at(-1)!;
    expect(sessionId).toMatch(/^s12:s1:/);
    await expectRegistered("s12", sessionId, "review", "review-guard");
    await expectCompletedAfterTurnEnd("s12", sessionId);
  });

  it("S12 a late end of the previous run, after the new record was written, keeps both records", async () => {
    await saveCard("s12late", "review", {
      laneSessions: [laneEntry("old-qa", "review", 0, "completed"), laneEntry("old-guard", "review", 1, "running")],
    });

    await patch("s12late", { retryTrigger: true });
    const sessionId = launched.at(-1)!;
    await expectRegistered("s12late", sessionId, "review", "review-guard");

    emitTurnEnd("old-guard", AgentEventType.AGENT_FAILED, { success: false, error: "late usage_limit_reached" });
    await vi.waitFor(async () => {
      const old = (await card("s12late")).laneSessions?.find((entry) => entry.sessionId === "old-guard");
      expect(old?.status).toBe("failed");
    });
    const lane = (await card("s12late")).laneSessions ?? [];
    expect(lane).toHaveLength(3);
    expect(lane.find((entry) => entry.sessionId === sessionId)?.status).toBe("running");
    expect(lane.find((entry) => entry.sessionId === "old-guard")?.recoveryReason).toBeTruthy();
  });

  it("S13 card-level agent override (no lane step to resume): registered and completed", async () => {
    await saveCard("s13card", "dev", {
      assignedProvider: "claude",
      assignedRole: "CRAFTER",
      assignedSpecialistId: "custom-crafter",
      assignedSpecialistName: "Custom Crafter",
      laneSessions: [laneEntry("old-dev", "dev", 0, "failed", { recoveryReason: "agent_failed" })],
    });

    await patch("s13card", { retryTrigger: true });
    const sessionId = launched.at(-1)!;
    expect(sessionId).toBeTruthy();
    await expectRegistered("s13card", sessionId, "dev", "Custom Crafter");
    await expectCompletedAfterTurnEnd("s13card", sessionId);
  });

  it("S13 resolveLaneResumeStep finds no step: registered and completed", async () => {
    await saveCard("s13empty", "review", {
      laneSessions: [laneEntry("old-qa", "review", 0, "failed", { recoveryReason: "agent_failed" })],
    });
    h.noResumeStep.value = true;

    await patch("s13empty", { retryTrigger: true });
    const sessionId = launched.at(-1)!;
    expect(sessionId).toBeTruthy();
    await expectRegistered("s13empty", sessionId, "review", "qa-frontend");
    await expectCompletedAfterTurnEnd("s13empty", sessionId);
  });

  it("S13 the orchestrator refuses to adopt the run (adoptLaneRun → false): the record still ends", async () => {
    await saveCard("s13refused", "review", {
      laneSessions: [laneEntry("old-qa", "review", 0, "failed", { recoveryReason: "agent_failed" })],
    });
    h.noResumeStep.value = true;
    vi.spyOn(getWorkflowOrchestrator(h.system), "adoptLaneRun").mockResolvedValue(false);

    await patch("s13refused", { retryTrigger: true });
    const sessionId = launched.at(-1)!;
    await expectRegistered("s13refused", sessionId, "review", "qa-frontend");
    await expectCompletedAfterTurnEnd("s13refused", sessionId);
  });
});

describe("C6: POST revive branches (reviveMissingEntryAutomations)", () => {
  it("S14 the lane's latest run failed at stepIndex>0: that step reruns, registered and completed", async () => {
    await saveCard("s14", "review", {
      laneSessions: [laneEntry("old-qa", "review", 0, "completed"), laneEntry("old-guard", "review", 1, "failed", { recoveryReason: "agent_failed" })],
    });

    await revive();
    const sessionId = launched.at(-1)!;
    expect(sessionId).toMatch(/^s14:s1:/);
    await expectRegistered("s14", sessionId, "review", "review-guard");
    await expectCompletedAfterTurnEnd("s14", sessionId);
  });

  it("S15 the lane's step completed: the next step runs, registered and completed", async () => {
    await saveCard("s15", "review", {
      laneSessions: [laneEntry("old-qa", "review", 0, "completed")],
    });

    await revive();
    const sessionId = launched.at(-1)!;
    expect(sessionId).toMatch(/^s15:s1:/);
    await expectRegistered("s15", sessionId, "review", "review-guard");
    await expectCompletedAfterTurnEnd("s15", sessionId);
  });

  it("S16 no run in the lane yet: the lane is entered from its first step, registered and completed", async () => {
    await saveCard("s16", "review", { laneSessions: [laneEntry("old-dev", "dev", 0, "completed")] });

    await revive();
    const sessionId = launched.at(-1)!;
    expect(sessionId).toMatch(/^s16:s0:/);
    await expectRegistered("s16", sessionId, "review", "qa-frontend");
    await expectCompletedAfterTurnEnd("s16", sessionId);
  });
});

describe("C6: card creation entries", () => {
  it("S17 kanban-tools create_card into an automated column: registered and completed", async () => {
    const tools = new KanbanTools(h.system.kanbanBoardStore, h.system.taskStore);
    tools.setEventBus(h.system.eventBus);
    tools.setAutomationSystem(h.system);

    const result = await tools.createCard({ workspaceId: WS, boardId: BOARD, columnId: "review", title: "Created by MCP" });
    expect(result.success).toBe(true);
    const cardId = (result.data as { id: string }).id;
    await vi.waitFor(() => expect(launched.length).toBeGreaterThan(0));
    const sessionId = launched[0];
    await expectRegistered(cardId, sessionId, "review", "qa-frontend");
    await vi.waitFor(() => expect(getWorkflowOrchestrator(h.system).getAutomationForCard(cardId)?.sessionId).toBe(sessionId));
    await expectCompletedAfterTurnEnd(cardId, sessionId);
    expect(launched).toHaveLength(2);
  });

  it("S18 POST /api/tasks into an automated column: registered and completed", async () => {
    const response = await tasksPost(new NextRequest("http://localhost/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Created by POST", objective: "x", workspaceId: WS, boardId: BOARD, columnId: "review" }),
      headers: { "Content-Type": "application/json" },
    }));
    expect(response.status).toBe(201);
    const cardId = ((await response.json()) as { task: { id: string } }).task.id;
    const sessionId = launched[0];
    await expectRegistered(cardId, sessionId, "review", "qa-frontend");
    await expectCompletedAfterTurnEnd(cardId, sessionId);
  });
});

describe("F4: column moves start a recorded step that ends completed", () => {
  it("drag (PATCH columnId) into Review", async () => {
    await saveCard("drag", "backlog");

    const response = await patch("drag", { columnId: "review" });
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(launched.length).toBeGreaterThan(0));
    const sessionId = launched[0];
    await expectRegistered("drag", sessionId, "review", "qa-frontend");
    await expectCompletedAfterTurnEnd("drag", sessionId);
  });

  it("MCP move_card into Done (Review approved): pusher then reporter both completed", async () => {
    await saveCard("mcp", "review", {
      verificationVerdict: VerificationVerdict.APPROVED,
      laneSessions: [laneEntry("old-qa", "review", 0, "completed"), laneEntry("old-guard", "review", 1, "completed")],
    });
    const tools = new KanbanTools(h.system.kanbanBoardStore, h.system.taskStore);
    tools.setEventBus(h.system.eventBus);
    tools.setAutomationSystem(h.system);

    const result = await tools.moveCard({ cardId: "mcp", targetColumnId: "done" });
    expect(result.success).toBe(true);
    await vi.waitFor(() => expect(launched.length).toBeGreaterThan(0));
    const pusher = launched[0];
    await expectRegistered("mcp", pusher, "done", "main-pusher");
    await expectCompletedAfterTurnEnd("mcp", pusher);
    await vi.waitFor(() => expect(launched.length).toBe(2));
    await expectRegistered("mcp", launched[1], "done", "done-reporter");
    await expectCompletedAfterTurnEnd("mcp", launched[1]);
    expect(((await card("mcp")).laneSessions ?? []).filter((entry) => entry.status === "running")).toEqual([]);
  });
});
