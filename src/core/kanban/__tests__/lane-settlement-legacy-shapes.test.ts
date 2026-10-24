// @vitest-environment node
/**
 * Card 6d8365ca, F2: shapes the change must leave as they were. The common
 * lanes, moves, revive branches and teardown cases are locked by the existing
 * suites (lane-step-interrupted*, restart-recovery*, route-session-teardown,
 * workflow-orchestrator-done-teardown); this file adds the rest: a Done lane
 * with only a reporter, the Blocked lane, GET /api/kanban/boards, and the
 * SQLite task store round trip of a settled record.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { RoutaSystem } from "@/core/routa-system";

const h = vi.hoisted(() => ({ system: undefined as unknown as RoutaSystem }));

vi.mock("@/core/routa-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/routa-system")>()),
  getRoutaSystem: () => h.system,
}));
vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));

import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { AgentEventType, type AgentEvent } from "@/core/events/event-bus";
import { createKanbanBoard } from "@/core/models/kanban";
import { createTask, TaskStatus, VerificationVerdict, type Task } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import { createInMemorySystem } from "@/core/routa-system";
import { getSqliteDatabase, closeSqliteDatabase } from "@/core/db/sqlite";
import { SqliteTaskStore } from "@/core/db/sqlite-stores";
import { settleEndedLaneSession } from "../lane-session-settlement";
import { upsertTaskLaneSession } from "../task-lane-history";
import { KanbanWorkflowOrchestrator } from "../workflow-orchestrator";
import { GET as boardsGet } from "@/app/api/kanban/boards/route";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-lane-legacy-"));

afterAll(() => {
  closeSqliteDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function end(sessionId: string, data: Record<string, unknown> = { success: true, stopReason: "end_turn" }): AgentEvent {
  return { type: AgentEventType.AGENT_COMPLETED, agentId: sessionId, workspaceId: "ws-l", data: { sessionId, ...data }, timestamp: new Date() };
}

async function system(columns: Parameters<typeof createKanbanBoard>[0]["columns"]) {
  const sys = createInMemorySystem();
  await sys.workspaceStore.save(createWorkspace({ id: "ws-l", title: "L" }));
  await sys.kanbanBoardStore.save(createKanbanBoard({ id: "board-l", workspaceId: "ws-l", name: "L", isDefault: true, columns }));
  return sys;
}

function orchestratorFor(sys: RoutaSystem) {
  const starts: Array<{ specialistId?: string; stepIndex: number }> = [];
  const createSession = vi.fn(async (params: { cardId: string; columnId: string; stepIndex: number; step: { specialistId?: string } }) => {
    starts.push({ specialistId: params.step.specialistId, stepIndex: params.stepIndex });
    const sessionId = `${params.cardId}:${params.columnId}:${params.stepIndex}`;
    const task = (await sys.taskStore.get(params.cardId))!;
    task.triggerSessionId = sessionId;
    upsertTaskLaneSession(task, { sessionId, columnId: params.columnId, stepIndex: params.stepIndex, status: "running" });
    await sys.taskStore.save(task);
    return sessionId;
  });
  const orchestrator = new KanbanWorkflowOrchestrator(sys.eventBus, sys.kanbanBoardStore, sys.taskStore, createSession, vi.fn(async () => undefined));
  return { orchestrator, starts, createSession };
}

describe("F2: shapes that stay as they were", () => {
  it("a Done lane with only a reporter: reporter completed, no pusher started", async () => {
    const sys = await system([
      { id: "review", name: "Review", position: 0, stage: "review" },
      { id: "done", name: "Done", position: 1, stage: "done", automation: { enabled: true, transitionType: "entry", steps: [{ id: "reporter", providerId: "dsh", role: "GATE", specialistId: "kanban-done-reporter" }] } },
    ]);
    await sys.taskStore.save({
      ...createTask({ id: "rep", title: "rep", objective: "rep", workspaceId: "ws-l", boardId: "board-l", columnId: "done", status: TaskStatus.COMPLETED }),
      verificationVerdict: VerificationVerdict.APPROVED,
    } as Task);
    const { orchestrator, starts } = orchestratorFor(sys);
    await orchestrator.processColumnTransition({ cardId: "rep", cardTitle: "rep", boardId: "board-l", workspaceId: "ws-l", fromColumnId: "review", toColumnId: "done" });

    await (orchestrator as unknown as { handleAgentCompletion(e: AgentEvent): Promise<void> }).handleAgentCompletion(end("rep:done:0"));

    expect(starts).toEqual([{ specialistId: "kanban-done-reporter", stepIndex: 0 }]);
    const lane = (await sys.taskStore.get("rep"))!.laneSessions!;
    expect(lane).toEqual([expect.objectContaining({ sessionId: "rep:done:0", status: "completed", completedAt: expect.any(String) })]);
  });

  it("entering Blocked starts nothing and leaves the lane records as they were", async () => {
    const sys = await system([
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
    ]);
    const card = { ...createTask({ id: "blk", title: "blk", objective: "blk", workspaceId: "ws-l", boardId: "board-l", columnId: "blocked" }), laneSessions: [{ sessionId: "old", columnId: "dev", stepIndex: 0, status: "completed" as const, startedAt: "2026-10-23T00:00:00.000Z", completedAt: "2026-10-23T00:10:00.000Z" }] } as Task;
    await sys.taskStore.save(card);
    const { orchestrator, createSession } = orchestratorFor(sys);

    await orchestrator.processColumnTransition({ cardId: "blk", cardTitle: "blk", boardId: "board-l", workspaceId: "ws-l", fromColumnId: "dev", toColumnId: "blocked" });

    expect(createSession).not.toHaveBeenCalled();
    expect((await sys.taskStore.get("blk"))!.laneSessions).toEqual(card.laneSessions);
  });

  it("GET /api/kanban/boards twice starts nothing and does not touch a stale running record", async () => {
    h.system = await system([{ id: "review", name: "Review", position: 0, stage: "review", automation: { enabled: true, transitionType: "entry", steps: [{ id: "qa", providerId: "dsh", role: "GATE", specialistId: "qa" }] } }]);
    const updatedAt = new Date("2026-10-23T12:00:00.000Z");
    await h.system.taskStore.save({
      ...createTask({ id: "get", title: "get", objective: "get", workspaceId: "ws-l", boardId: "board-l", columnId: "review" }),
      updatedAt,
      laneSessions: [{ sessionId: "ended-session", columnId: "review", stepIndex: 0, status: "running", startedAt: "2026-10-23T11:00:00.000Z" }],
    } as Task);
    const store = getHttpSessionStore();
    store.upsertSession({ sessionId: "ended-session", cwd: tmpDir, workspaceId: "ws-l", provider: "dsh", createdAt: new Date().toISOString() });
    store.pushNotificationToHistory("ended-session", { sessionId: "ended-session", update: { sessionUpdate: "turn_complete", stopReason: "end_turn" } });
    const before = JSON.stringify(await h.system.taskStore.get("get"));

    for (let index = 0; index < 2; index += 1) {
      const response = await boardsGet(new NextRequest("http://localhost/api/kanban/boards?workspaceId=ws-l"));
      expect(response.status).toBe(200);
    }

    expect(JSON.stringify(await h.system.taskStore.get("get"))).toBe(before);
  });

  it("SQLite task store keeps a settled record's status, completedAt and recoveryReason", async () => {
    const db = getSqliteDatabase(path.join(tmpDir, "routa-test.db"));
    const sys = await system([{ id: "review", name: "Review", position: 0, stage: "review" }]);
    const taskStore = new SqliteTaskStore(db);
    await sys.workspaceStore.save(createWorkspace({ id: "ws-l", title: "L" }));
    const { SqliteWorkspaceStore } = await import("@/core/db/sqlite-stores");
    await new SqliteWorkspaceStore(db).save(createWorkspace({ id: "ws-l", title: "L" }));
    await taskStore.save({
      ...createTask({ id: "sql", title: "sql", objective: "sql", workspaceId: "ws-l", columnId: "review" }),
      laneSessions: [{ sessionId: "sql-session", columnId: "review", stepIndex: 0, status: "running", startedAt: "2026-10-23T11:00:00.000Z" }],
    } as Task);
    const store = getHttpSessionStore();
    store.upsertSession({ sessionId: "sql-session", cwd: tmpDir, workspaceId: "ws-l", provider: "dsh", createdAt: new Date().toISOString() });

    const settled = await settleEndedLaneSession({
      taskStore,
      sessions: store,
      event: { type: AgentEventType.AGENT_FAILED, agentId: "sql-session", workspaceId: "ws-l", data: { sessionId: "sql-session", success: false, error: "turn failed" }, timestamp: new Date() },
      mode: "event",
    });

    expect(settled).toBe(true);
    const reread = (await new SqliteTaskStore(db).get("sql"))!.laneSessions![0];
    expect(reread).toMatchObject({ status: "failed", recoveryReason: "agent_failed", completedAt: expect.any(String) });
    expect(Number.isFinite(Date.parse(reread.completedAt!))).toBe(true);
  });
});
