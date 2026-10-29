// @vitest-environment node
/**
 * Card 2d21984e (C2, C3, C4, C8, AC3, AC4): the startup sweep on a temporary
 * SQLite file (under os.tmpdir(), never the repo's routa.db). Every call
 * writes exactly one `kanban:server-restart` row, whether the sweep worked or not.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoutaSystem } from "@/core/routa-system";

const h = vi.hoisted(() => ({
  system: undefined as unknown as RoutaSystem,
  getRoutaSystem: vi.fn(),
  sweepError: undefined as Error | undefined,
  resume: vi.fn(async () => ({ resumed: [] as string[], waiting: [] as string[] })),
}));

vi.mock("@/core/routa-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/routa-system")>()),
  getRoutaSystem: h.getRoutaSystem,
}));
vi.mock("@/core/db/index", () => ({ getDatabaseDriver: () => "sqlite" }));
vi.mock("@/core/acp/execution-backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/acp/execution-backend")>()),
  getAcpRunnerUrl: () => undefined,
}));
vi.mock("@/core/acp/http-session-store", () => ({
  getHttpSessionStore: () => ({
    getSession: (id: string) => (id.startsWith("dead-") ? { ownerInstanceId: "old-process", leaseExpiresAt: "2999-01-01T00:00:00.000Z" } : undefined),
    hydrateFromDb: vi.fn(async () => undefined),
  }),
}));
vi.mock("@/core/acp/processer", () => ({ getAcpProcessManager: () => ({ hasActiveSession: () => false }) }));
vi.mock("../interrupted-lane-resume", () => ({ resumeInterruptedLaneSteps: h.resume }));
vi.mock("../restart-recovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../restart-recovery")>();
  return {
    ...actual,
    endStaleRunningLaneSessions: (...args: Parameters<typeof actual.endStaleRunningLaneSessions>) => {
      if (h.sweepError) return Promise.reject(h.sweepError);
      return actual.endStaleRunningLaneSessions(...args);
    },
  };
});

import { closeSqliteDatabase, getSqliteDatabase } from "@/core/db/sqlite";
import { SqliteKanbanEventStore } from "@/core/db/sqlite-kanban-event-store";
import { SqliteTaskStore } from "@/core/db/sqlite-task-store";
import { SqliteWorkspaceStore } from "@/core/db/sqlite-workspace-store";
import { KANBAN_EVENT_RETENTION_MS } from "@/core/store/kanban-event-store";
import { createKanbanBoard } from "@/core/models/kanban";
import { createTask, TaskStatus } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import { createInMemorySystem } from "@/core/routa-system";
import { endStaleRunningLaneSessionsOnStartup, getStartupLaneResume } from "../startup-lane-sweep";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-startup-sweep-"));
let dbCounter = 0;

afterAll(() => {
  closeSqliteDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** A fresh SQLite file per test, wired into an otherwise in-memory system. */
async function sqliteSystem() {
  closeSqliteDatabase();
  const dbPath = path.join(tmpDir, `sweep-${dbCounter++}.db`);
  const db = getSqliteDatabase(dbPath);
  const system: RoutaSystem = {
    ...createInMemorySystem(),
    workspaceStore: new SqliteWorkspaceStore(db),
    taskStore: new SqliteTaskStore(db),
    kanbanEventStore: new SqliteKanbanEventStore(db),
  };
  await system.workspaceStore.save(createWorkspace({ id: "ws-s", title: "S" }));
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: "board-s",
    workspaceId: "ws-s",
    name: "Board",
    isDefault: true,
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "review", name: "Review", position: 1, stage: "review" },
    ],
  }));
  return { system, dbPath };
}

async function addRunning(system: RoutaSystem, cardId: string, sessionId: string, extra: Record<string, unknown> = {}) {
  await system.taskStore.save({
    ...createTask({ id: cardId, title: cardId, objective: cardId, workspaceId: "ws-s", boardId: "board-s", columnId: "dev", status: TaskStatus.IN_PROGRESS }),
    triggerSessionId: sessionId,
    laneSessions: [{ sessionId, columnId: "dev", stepIndex: 0, status: "running", startedAt: "2026-10-26T20:00:00.000Z" }],
    ...extra,
  });
}

async function restartRows(system: RoutaSystem) {
  const rows = await system.kanbanEventStore.list("*");
  return rows.filter((row) => row.type === ("kanban:server-restart" as never));
}

async function runStartup() {
  await endStaleRunningLaneSessionsOnStartup();
  await getStartupLaneResume();
}

beforeEach(() => {
  h.sweepError = undefined;
  h.resume.mockClear();
  h.getRoutaSystem.mockReset();
  vi.restoreAllMocks();
});

describe("endStaleRunningLaneSessionsOnStartup", () => {
  // C2 / AC3
  it("ends a running lane as timed_out + restart_interrupted in a temp SQLite file", async () => {
    const { system, dbPath } = await sqliteSystem();
    h.getRoutaSystem.mockReturnValue(system);
    await addRunning(system, "card-1", "dead-1");
    expect(path.resolve(dbPath).startsWith(path.resolve(process.cwd()) + path.sep)).toBe(false);

    await runStartup();

    const lane = (await system.taskStore.get("card-1"))?.laneSessions?.[0];
    expect(lane).toMatchObject({ status: "timed_out", recoveryReason: "restart_interrupted" });
  });

  // F2d: a card that already carries a conclusion still records its current-column step as interrupted... and a
  // step in a column the card has left is "transitioned", exactly as before the change.
  it("keeps the old settlement rule: a step in a column the card has left is transitioned", async () => {
    const { system } = await sqliteSystem();
    h.getRoutaSystem.mockReturnValue(system);
    await addRunning(system, "card-left", "dead-left", { columnId: "review", completionSummary: "done" });

    await runStartup();

    const lane = (await system.taskStore.get("card-left"))?.laneSessions?.[0];
    expect(lane?.status).toBe("transitioned");
    expect(lane?.recoveryReason).toBeUndefined();
  });

  // C3 / AC4: success path, 0 and 2 stale sessions.
  it.each([
    { label: "no running lane", ids: [] as string[] },
    { label: "two cards, one running lane each", ids: ["dead-a", "dead-b"] },
  ])("writes exactly one kanban:server-restart row on success ($label)", async ({ ids }) => {
    const { system } = await sqliteSystem();
    h.getRoutaSystem.mockReturnValue(system);
    for (const [index, id] of ids.entries()) await addRunning(system, `card-${index}`, id);

    const before = (await restartRows(system)).length;
    await runStartup();
    const finishedAt = Date.now();
    const rows = await restartRows(system);

    expect(rows.length - before).toBe(1);
    const payload = rows[0].payload as unknown as Record<string, unknown>;
    expect(payload.type).toBe("kanban:server-restart");
    expect(Number.isFinite(Date.parse(payload.bootAt as string))).toBe(true);
    expect(Date.parse(payload.bootAt as string)).toBeLessThanOrEqual(finishedAt);
    expect(payload.pid).toBe(process.pid);
    expect([...(payload.endedSessionIds as string[])].sort()).toEqual([...ids].sort());
    expect(payload.cards).toBe(ids.length);
    expect(payload.error).toBeUndefined();
    expect(rows[0].workspaceId).toBe("*");
    expect(rows[0].resourceId).toBeNull();
  });

  // C4a
  it("writes exactly one row with the error text when the sweep throws", async () => {
    const { system } = await sqliteSystem();
    h.getRoutaSystem.mockReturnValue(system);
    h.sweepError = new Error("boom");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await runStartup();

    const rows = await restartRows(system);
    expect(rows).toHaveLength(1);
    const payload = rows[0].payload as unknown as Record<string, unknown>;
    expect(payload.error).toContain("boom");
    expect(payload.pid).toBe(process.pid);
    expect(Number.isFinite(Date.parse(payload.bootAt as string))).toBe(true);
    expect(payload.endedSessionIds).toBeUndefined();
    expect(h.resume).toHaveBeenCalledTimes(1);
  });

  // C4b
  it("does not throw and still schedules the resume when the event store fails", async () => {
    const { system } = await sqliteSystem();
    h.getRoutaSystem.mockReturnValue(system);
    vi.spyOn(system.kanbanEventStore, "append").mockRejectedValue(new Error("disk full"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(endStaleRunningLaneSessionsOnStartup()).resolves.toBeUndefined();
    await getStartupLaneResume();

    expect(h.resume).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  // C4c
  it("does not throw, writes nothing and warns when getRoutaSystem itself throws", async () => {
    const { system } = await sqliteSystem();
    h.getRoutaSystem.mockImplementation(() => { throw new TypeError("startWorkflowOrchestrator is not a function"); });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(endStaleRunningLaneSessionsOnStartup()).resolves.toBeUndefined();
    await getStartupLaneResume();

    expect(await restartRows(system)).toHaveLength(0);
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  // C8: the row has no workspace, so no workspace replay returns it, and the retention sweep keeps it for 7 days.
  it("the row is never returned to a workspace replay and survives the retention sweep", async () => {
    const { system } = await sqliteSystem();
    h.getRoutaSystem.mockReturnValue(system);
    await runStartup();

    expect(await system.kanbanEventStore.list("ws-s")).toEqual([]);
    const removed = await system.kanbanEventStore.pruneOlderThan(Date.now() - KANBAN_EVENT_RETENTION_MS);
    expect(removed).toBe(0);
    expect(await restartRows(system)).toHaveLength(1);
  });
});
