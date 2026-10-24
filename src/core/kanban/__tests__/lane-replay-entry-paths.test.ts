// @vitest-environment node
/**
 * Card f2b2621a (replay of 6d8365ca onto 79804de2), contract C7 and F4:
 *
 * - C7: GET /api/kanban/boards stays a pure read with the merged revive and
 *   sweep code: two reads start nothing and leave the card untouched; one
 *   POST /api/kanban/boards/{id}/revive starts the card's step once.
 * - F4: update_task writing APPROVED moves the card through review-lane
 *   convergence; the Guard's record and both Done steps all end terminal.
 *
 * Real in-memory system, orchestrator singleton and routes; only the agent
 * launch, the process manager and the session DB hydration are faked.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoutaSystem } from "@/core/routa-system";

const h = vi.hoisted(() => ({
  system: undefined as unknown as RoutaSystem,
  trigger: vi.fn(),
  counter: { value: 0 },
}));

vi.mock("@/core/routa-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/routa-system")>()),
  getRoutaSystem: () => h.system,
}));
vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: vi.fn(async () => undefined), hasActiveSession: () => false }),
}));
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("@/core/kanban/agent-trigger", () => ({
  triggerAssignedTaskAgent: h.trigger,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));

import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { AgentEventType } from "@/core/events/event-bus";
import { createKanbanBoard, type KanbanColumn } from "@/core/models/kanban";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import { createInMemorySystem } from "@/core/routa-system";
import { InMemoryAgentStore } from "@/core/store/agent-store";
import { InMemoryConversationStore } from "@/core/store/conversation-store";
import { AgentTools } from "@/core/tools/agent-tools";
import { resetWorkflowOrchestrator, startWorkflowOrchestrator } from "@/core/kanban/workflow-orchestrator-singleton";
import { GET as boardsGet } from "@/app/api/kanban/boards/route";
import { POST as revivePost } from "@/app/api/kanban/boards/[boardId]/revive/route";

const WS = "ws-replay";
const BOARD = "board-replay";

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
];

const launched: string[] = [];

beforeEach(async () => {
  resetWorkflowOrchestrator();
  launched.length = 0;
  h.trigger.mockReset();
  h.trigger.mockImplementation(async (params: { task: { id: string }; stepIndex?: number }) => {
    h.counter.value += 1;
    const sessionId = `${params.task.id}:s${params.stepIndex ?? "x"}:${h.counter.value}`;
    launched.push(sessionId);
    return { sessionId, transport: "acp" };
  });
  h.system = createInMemorySystem();
  await h.system.workspaceStore.save(createWorkspace({ id: WS, title: "Replay", metadata: { [`kanbanSessionConcurrencyLimit:${BOARD}`]: "10" } }));
  await h.system.kanbanBoardStore.save(createKanbanBoard({ id: BOARD, workspaceId: WS, name: "Board", isDefault: true, columns: COLUMNS }));
  startWorkflowOrchestrator(h.system);
  vi.spyOn(getHttpSessionStore(), "hydrateFromDb").mockResolvedValue(undefined as never);
});

afterEach(() => {
  resetWorkflowOrchestrator();
  vi.restoreAllMocks();
});

async function saveCard(id: string, columnId: string, extra: Partial<Task> = {}): Promise<void> {
  await h.system.taskStore.save({
    ...createTask({ id, title: id, objective: id, workspaceId: WS, boardId: BOARD, columnId, status: TaskStatus.IN_PROGRESS }),
    ...extra,
  } as Task);
}

async function card(id: string): Promise<Task> {
  return (await h.system.taskStore.get(id))!;
}

function endTurn(sessionId: string): void {
  h.system.eventBus.emit({
    type: AgentEventType.AGENT_COMPLETED,
    agentId: sessionId,
    workspaceId: WS,
    data: { sessionId, success: true, stopReason: "end_turn" },
    timestamp: new Date(),
  });
}

async function recordOf(cardId: string, sessionId: string): Promise<TaskLaneSession | undefined> {
  return (await card(cardId)).laneSessions?.find((entry) => entry.sessionId === sessionId);
}

describe("f2b2621a C7: GET /api/kanban/boards reads only; POST revive starts once", () => {
  it("two GETs: 0 starts, lane_sessions and updatedAt unchanged; then POST revive: 1 start", async () => {
    const laneSessions: TaskLaneSession[] = [{
      sessionId: "old-dev",
      columnId: "dev",
      stepIndex: 0,
      status: "timed_out",
      recoveryReason: "restart_interrupted",
      startedAt: "2026-10-24T00:00:00.000Z",
      completedAt: "2026-10-24T00:10:00.000Z",
    }];
    await saveCard("idle", "dev", { laneSessions, updatedAt: new Date("2026-10-24T00:10:00.000Z") });
    const before = await card("idle");

    for (let read = 0; read < 2; read += 1) {
      const response = await boardsGet(new NextRequest(`http://localhost/api/kanban/boards?workspaceId=${WS}`));
      expect(response.status).toBe(200);
    }
    const afterReads = await card("idle");
    expect(h.trigger).toHaveBeenCalledTimes(0);
    expect(afterReads.laneSessions).toEqual(before.laneSessions);
    expect(afterReads.updatedAt).toEqual(before.updatedAt);

    const response = await revivePost(
      new NextRequest(`http://localhost/api/kanban/boards/${BOARD}/revive`, { method: "POST" }),
      { params: Promise.resolve({ boardId: BOARD }) },
    );
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(h.trigger).toHaveBeenCalledTimes(1));
    expect((h.trigger.mock.calls[0][0] as { step?: { specialistId?: string } }).step?.specialistId).toBe("dev-crafter");
  });
});

describe("f2b2621a F4: update_task APPROVED auto-move ends every lane record", () => {
  it("Guard record ends when update_task approves; pusher and reporter are recorded and end completed", async () => {
    await saveCard("approve", "review", {
      triggerSessionId: "guard-1",
      assignedSpecialistId: "review-guard",
      sessionIds: ["qa-1", "guard-1"],
      laneSessions: [
        { sessionId: "qa-1", columnId: "review", stepIndex: 0, role: "GATE", status: "completed", startedAt: "2026-10-24T00:00:00.000Z" },
        { sessionId: "guard-1", columnId: "review", stepIndex: 1, role: "GATE", status: "running", startedAt: "2026-10-24T00:05:00.000Z" },
      ],
    });
    const tools = new AgentTools(new InMemoryAgentStore(), new InMemoryConversationStore(), h.system.taskStore, h.system.eventBus);
    tools.setKanbanBoardStore(h.system.kanbanBoardStore);

    const result = await tools.updateTask({
      taskId: "approve",
      updates: { verificationVerdict: "APPROVED", verificationReport: "All AC verified" },
      agentId: "guard-1",
    });
    expect(result.success).toBe(true);
    expect((await card("approve")).columnId).toBe("done");

    await vi.waitFor(async () => expect((await recordOf("approve", "guard-1"))?.status).not.toBe("running"));
    await vi.waitFor(() => expect(launched).toHaveLength(1));
    expect(await recordOf("approve", launched[0])).toMatchObject({ status: "running", columnId: "done", stepName: "main-pusher" });
    endTurn(launched[0]);
    await vi.waitFor(async () => expect((await recordOf("approve", launched[0]))?.status).toBe("completed"));
    await vi.waitFor(() => expect(launched).toHaveLength(2));
    expect(await recordOf("approve", launched[1])).toMatchObject({ status: "running", columnId: "done", stepName: "done-reporter" });
    endTurn(launched[1]);
    await vi.waitFor(async () => expect((await recordOf("approve", launched[1]))?.status).toBe("completed"));
    expect(((await card("approve")).laneSessions ?? []).filter((entry) => entry.status === "running")).toEqual([]);
  });
});
