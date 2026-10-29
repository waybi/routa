// @vitest-environment node
/**
 * Card dd65b565 (retro L279): a card copy read before a Done first-step start
 * must not wipe that start's lane record and session id when it is saved later.
 * Contract C2, C3 (memory / sqlite / pg stub), F2 (old shapes unchanged), and the
 * end-handler save path (workflow-orchestrator.ts end handling, real orchestrator).
 * Tests never touch the checkout's routa.db: memory driver + temp sqlite file.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock } = vi.hoisted(() => {
  process.env.ROUTA_DB_DRIVER = "memory";
  return { triggerAssignedTaskAgentMock: vi.fn() };
});

vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));
vi.mock("../../acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: vi.fn(async () => undefined), hasActiveSession: () => false }),
}));

import { closeSqliteDatabase, getSqliteDatabase } from "@/core/db/sqlite";
import { PgTaskStore } from "@/core/db/pg-task-store";
import { SqliteTaskStore, SqliteWorkspaceStore } from "@/core/db/sqlite-stores";
import { createTask, TaskStatus, type Task } from "@/core/models/task";
import { createWorkspace } from "@/core/models/workspace";
import { createKanbanBoard } from "@/core/models/kanban";
import { InMemoryKanbanBoardStore } from "@/core/store/kanban-board-store";
import { InMemoryTaskStore, type TaskStore } from "@/core/store/task-store";
import { KanbanTools } from "@/core/tools/kanban-tools";
import { EventBus } from "@/core/events/event-bus";
import { KanbanWorkflowOrchestrator, type ActiveAutomation } from "../workflow-orchestrator";
import { upsertTaskLaneSession } from "../task-lane-history";
import { resetWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import {
  cleanupSessionCwd,
  createLaneHarness,
  pushTurnComplete,
  runToInterruptedStep,
  settle,
} from "./lane-interrupt-harness";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-lane-stale-"));
afterAll(() => {
  closeSqliteDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  cleanupSessionCwd();
});

// ---- store fixtures ---------------------------------------------------------

/** A Postgres stub that holds one row and records the statements the store issues. */
function pgStub() {
  const ops: string[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  const tx = {
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => chain,
        for: (mode: string) => {
          ops.push(`select-for-${mode}`);
          const row = [...rows.values()][0];
          return Promise.resolve(row ? [{ sessionIds: row.sessionIds, laneSessions: row.laneSessions }] : []);
        },
      };
      return chain;
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (conflict: { set: Record<string, unknown> }) => {
          ops.push("upsert");
          rows.set(String(values.id), rows.has(String(values.id)) ? { ...rows.get(String(values.id)), ...conflict.set } : values);
          return Promise.resolve();
        },
      }),
    }),
  };
  const db = {
    insert: tx.insert, // a store that upserts without a transaction would use this
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => Promise.resolve([...rows.values()].slice(0, 1)),
      };
      return chain;
    },
    transaction: async (callback: (client: typeof tx) => Promise<void>) => {
      ops.push("begin");
      await callback(tx);
      ops.push("commit");
    },
  };
  return { db, ops, rows };
}

type StoreKind = "memory" | "sqlite" | "pg";

async function makeStore(kind: StoreKind): Promise<{
  store: TaskStore;
  lanes: (id: string) => Promise<{ sessionIds: string[]; laneSessions: NonNullable<Task["laneSessions"]> }>;
  ops?: string[];
}> {
  if (kind === "memory") {
    const store = new InMemoryTaskStore();
    return {
      store,
      lanes: async (id) => {
        const task = (await store.get(id))!;
        return { sessionIds: task.sessionIds ?? [], laneSessions: task.laneSessions ?? [] };
      },
    };
  }
  if (kind === "sqlite") {
    const db = getSqliteDatabase(path.join(tmpDir, `stale-${Math.random().toString(36).slice(2)}.db`));
    await new SqliteWorkspaceStore(db).save(createWorkspace({ id: "ws", title: "ws" }));
    const store = new SqliteTaskStore(db);
    return {
      store,
      lanes: async (id) => {
        const task = (await store.get(id))!;
        return { sessionIds: task.sessionIds ?? [], laneSessions: task.laneSessions ?? [] };
      },
    };
  }
  const stub = pgStub();
  const store = new PgTaskStore(stub.db as never);
  return {
    store,
    ops: stub.ops,
    lanes: async (id) => {
      const row = stub.rows.get(id)!;
      return {
        sessionIds: row.sessionIds as string[],
        laneSessions: row.laneSessions as NonNullable<Task["laneSessions"]>,
      };
    },
  };
}

function reviewCard(id: string): Task {
  return {
    ...createTask({ id, title: id, objective: id, workspaceId: "ws", columnId: "review", status: TaskStatus.PENDING }),
    sessionIds: ["review-guard-1"],
    laneSessions: [
      { sessionId: "review-guard-1", columnId: "review", stepIndex: 1, status: "completed", startedAt: "2026-10-29T01:00:00.000Z" },
    ],
  } as Task;
}

/** The Done first-step start write (workflow-orchestrator-singleton.ts start: sessionIds push + lane record + save). */
async function startDoneFirstStep(store: TaskStore, id: string): Promise<void> {
  const fresh = (await store.get(id))!;
  fresh.columnId = "done";
  fresh.sessionIds = [...(fresh.sessionIds ?? []), "pusher-1"];
  fresh.triggerSessionId = "pusher-1";
  upsertTaskLaneSession(fresh, {
    sessionId: "pusher-1",
    columnId: "done",
    stepIndex: 0,
    stepId: "main-pusher",
    specialistId: "kanban-main-pusher",
    status: "running",
  });
  await store.save(fresh);
}

describe.each(["memory", "sqlite", "pg"] as StoreKind[])("stale card copy saved after a Done start (%s store)", (kind) => {
  it("keeps the Done session's lane record and session id (C2/C3)", async () => {
    const { store, lanes } = await makeStore(kind);
    await store.save(reviewCard("c1"));
    const stale = structuredClone((await store.get("c1"))!);
    await startDoneFirstStep(store, "c1");

    stale.comment = "review finished"; // an unrelated edit by the stale holder
    await store.save(stale);

    const { sessionIds, laneSessions } = await lanes("c1");
    expect(sessionIds).toContain("pusher-1");
    expect(laneSessions.find((entry) => entry.sessionId === "pusher-1")).toMatchObject({
      columnId: "done",
      stepIndex: 0,
      specialistId: "kanban-main-pusher",
      status: "running",
    });
    expect(laneSessions.find((entry) => entry.sessionId === "review-guard-1")?.status).toBe("completed");
  });

  it("first save of a new card is stored as given; empty lane arrays stay empty (F2)", async () => {
    const { store, lanes } = await makeStore(kind);
    const card = createTask({ id: "c2", title: "c2", objective: "c2", workspaceId: "ws" });
    await store.save(card);
    expect(await lanes("c2")).toEqual({ sessionIds: [], laneSessions: [] });
    const full = reviewCard("c3");
    await store.save(full);
    expect(await lanes("c3")).toEqual({ sessionIds: full.sessionIds, laneSessions: full.laneSessions });
  });

  it("sequential saves with the latest copy: a running record turns completed as written (F2)", async () => {
    const { store, lanes } = await makeStore(kind);
    await store.save(reviewCard("c4"));
    await startDoneFirstStep(store, "c4");
    const latest = (await store.get("c4"))!;
    latest.laneSessions!.find((entry) => entry.sessionId === "pusher-1")!.status = "completed";
    await store.save(latest);
    const { laneSessions } = await lanes("c4");
    expect(laneSessions.find((entry) => entry.sessionId === "pusher-1")?.status).toBe("completed");
  });

  it("other fields stay last-writer-wins: the stale copy writes its column and comment back (F2)", async () => {
    const { store } = await makeStore(kind);
    await store.save(reviewCard("c5"));
    const stale = structuredClone((await store.get("c5"))!);
    await startDoneFirstStep(store, "c5");
    stale.comment = "stale comment";
    await store.save(stale);
    const after = (await store.get("c5"))!;
    expect(after.columnId).toBe("review");
    expect(after.comment).toBe("stale comment");
  });
});

describe("pg save statement order (C3, C10)", () => {
  it("reads the stored row inside one transaction before the single upsert", async () => {
    const { store, ops } = await makeStore("pg");
    await store.save(reviewCard("c6"));
    await store.save(reviewCard("c6"));
    expect(ops).toEqual([
      "begin", "select-for-update", "upsert", "commit",
      "begin", "select-for-update", "upsert", "commit",
    ]);
  });
});

// ---- end-handler save path with the real orchestrator --------------------------

describe("end-handler save with a card copy read before the Done start (workflow-orchestrator.ts end handling)", () => {
  beforeEach(() => {
    resetWorkflowOrchestrator();
    triggerAssignedTaskAgentMock.mockReset();
  });

  it("the Done session recorded between the end handler's read and its save survives", async () => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    const lastStep = await runToInterruptedStep(h); // Review step 1 (the last) running
    const realSave = h.system.taskStore.save.bind(h.system.taskStore);
    let injected = false;
    h.system.taskStore.save = async (task: Task) => {
      if (!injected) {
        injected = true;
        // A Done first-step start lands after the handler read its copy, before it saves.
        const fresh = (await h.system.taskStore.get(h.cardId))!;
        fresh.sessionIds = [...(fresh.sessionIds ?? []), "pusher-1"];
        upsertTaskLaneSession(fresh, {
          sessionId: "pusher-1",
          columnId: "done",
          stepIndex: 0,
          specialistId: "kanban-main-pusher",
          status: "running",
        });
        await realSave(fresh);
      }
      return realSave(task);
    };

    pushTurnComplete(h.system, lastStep, "end_turn");
    await settle(300);

    const card = await h.card();
    expect(card.sessionIds).toContain("pusher-1");
    expect(card.laneSessions?.find((entry) => entry.sessionId === "pusher-1")).toMatchObject({
      columnId: "done",
      stepIndex: 0,
      status: "running",
    });
  });
});

// ---- F4: entry paths that load a card, then save it after a Done start ---------

const boardColumns = [
  { id: "review", name: "Review", stage: "review" as const, position: 0 },
  { id: "done", name: "Done", stage: "done" as const, position: 1 },
];

/** The card was read (by the entry) before the Done start; the store holds the start. */
async function withStaleRead(kind: StoreKind, cardId: string) {
  const made = await makeStore(kind);
  const boardStore = new InMemoryKanbanBoardStore();
  await boardStore.save(createKanbanBoard({ id: "board-1", workspaceId: "ws", name: "Main", columns: boardColumns }));
  await made.store.save({ ...reviewCard(cardId), boardId: "board-1" } as Task);
  const snapshot = structuredClone((await made.store.get(cardId))!);
  await startDoneFirstStep(made.store, cardId);
  const realGet = made.store.get.bind(made.store);
  let served = false;
  made.store.get = async (id: string) => {
    if (!served && id === cardId) {
      served = true;
      return structuredClone(snapshot);
    }
    return realGet(id);
  };
  return { ...made, boardStore };
}

function expectDoneStartKept(lanes: { sessionIds: string[]; laneSessions: NonNullable<Task["laneSessions"]> }) {
  expect(lanes.sessionIds).toContain("pusher-1");
  expect(lanes.laneSessions.find((entry) => entry.sessionId === "pusher-1")).toMatchObject({
    columnId: "done",
    stepIndex: 0,
    status: "running",
  });
}

describe.each(["memory", "sqlite", "pg"] as StoreKind[])("F4 entry paths (%s store)", (kind) => {
  it("autoAdvanceCard (workflow-orchestrator.ts autoAdvanceCard)", async () => {
    const { store, lanes, boardStore } = await withStaleRead(kind, "f4a");
    const orchestrator = new KanbanWorkflowOrchestrator(new EventBus(), boardStore, store);
    await (orchestrator as unknown as {
      autoAdvanceCard(cardId: string, automation: Partial<ActiveAutomation>): Promise<void>;
    }).autoAdvanceCard("f4a", { cardId: "f4a", boardId: "board-1", columnId: "review" });
    expect((await store.get("f4a"))?.columnId).toBe("done"); // the advance itself happened
    expectDoneStartKept(await lanes("f4a"));
  });

  it("MCP move_card (kanban-tools.ts moveCard)", async () => {
    const { store, lanes, boardStore } = await withStaleRead(kind, "f4b");
    const result = await new KanbanTools(boardStore, store).moveCard({ cardId: "f4b", targetColumnId: "done" });
    expect(result.success).toBe(true);
    expectDoneStartKept(await lanes("f4b"));
  });
});
