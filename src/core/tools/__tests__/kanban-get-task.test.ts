/**
 * @vitest-environment node
 *
 * get_task read-only snapshot + taskToCard.verificationVerdict (card ed9adb91, retro L296).
 */
import fs from "fs";
import os from "os";
import path from "path";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventBus } from "../../events/event-bus";
import { getKanbanEventBroadcaster } from "../../kanban/kanban-event-broadcaster";
import { createKanbanBoard } from "../../models/kanban";
import type { Task } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { executeGetTaskTool } from "../../mcp/get-task-tool";
import { KanbanTools } from "../kanban-tools";
import { buildTaskSnapshot, truncateCodePoints } from "../kanban-task-snapshot";
import {
  buildBigCard, buildFixedCard, bytes, GET_TASK_LANE_KEYS, GET_TASK_TOP_KEYS, MAX_BYTES,
} from "./get-task-fixtures";

async function setup(tasks: Task[] = [buildFixedCard()]) {
  const boardStore = new InMemoryKanbanBoardStore();
  await boardStore.save(createKanbanBoard({ id: "board-1", workspaceId: "default", name: "Board", isDefault: true }));
  const taskStore = new InMemoryTaskStore();
  for (const task of tasks) await taskStore.save(task);
  const kanbanTools = new KanbanTools(boardStore, taskStore);
  return { boardStore, taskStore, kanbanTools };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KanbanTools.getTask (C2)", () => {
  it("returns every AC2 field, comments oldest first, the verdict, and a lane summary without side effects", async () => {
    const { taskStore, kanbanTools } = await setup();
    const eventBus = new EventBus();
    kanbanTools.setEventBus(eventBus);
    let automationTouches = 0;
    kanbanTools.setAutomationSystem(new Proxy({}, { get: () => { automationTouches += 1; return undefined; } }) as never);
    const saveSpy = vi.spyOn(taskStore, "save");
    const notifySpy = vi.spyOn(getKanbanEventBroadcaster(), "notify");
    const emitSpy = vi.spyOn(eventBus, "emit");
    const before = await taskStore.get("task-fixed");

    const result = await kanbanTools.getTask({ taskId: "task-fixed", workspaceId: "default" });

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown> & { comments: Array<Record<string, unknown>>; laneSessions: Array<Record<string, unknown>> };
    expect(Object.keys(data).sort()).toEqual(GET_TASK_TOP_KEYS);
    expect(data).toMatchObject({
      id: "task-fixed",
      title: "Fixed card",
      objective: "Ship get_task",
      columnId: "review",
      commentsTotal: 3,
      verificationVerdict: "NOT_APPROVED",
      verificationReport: "Missing tests for AC4",
      acceptanceCriteria: ["AC1 works"],
      verificationCommands: ["npx vitest run src/core/tools"],
      labels: ["req:l296"],
      lastSyncError: "Push rejected",
      triggerSessionId: "s-trigger",
      updatedAt: "2026-10-03T12:00:00.000Z",
      truncated: { objective: false, verificationReport: false },
    });
    expect(data.comments.map((comment) => comment.id)).toEqual(["c1", "c2", "c3"]);
    expect(data.comments.map((comment) => comment.body)).toEqual(["first note", "second note", "third note"]);
    expect(data.comments.some((comment) => "truncated" in comment)).toBe(false);
    expect(data.laneSessions).toHaveLength(2);
    for (const lane of data.laneSessions) {
      expect(Object.keys(lane).sort()).toEqual(GET_TASK_LANE_KEYS);
      expect(lane).not.toHaveProperty("objective");
      expect(lane).not.toHaveProperty("cwd");
      expect(lane).not.toHaveProperty("model");
    }
    expect(data.laneSessions[0]).toEqual({
      sessionId: "s-dev", stepName: "Dev Crafter", role: "CRAFTER", status: "completed",
      startedAt: "2026-10-01T00:00:00.000Z", completedAt: "2026-10-01T01:00:00.000Z", columnId: "dev",
    });

    const after = await taskStore.get("task-fixed");
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    expect(after?.laneSessions).toHaveLength(before!.laneSessions.length);
    expect(saveSpy).toHaveBeenCalledTimes(0);
    expect(notifySpy).toHaveBeenCalledTimes(0);
    expect(emitSpy).toHaveBeenCalledTimes(0);
    expect(automationTouches).toBe(0);
  });
});

describe("get_task card lookup (C3, AC4)", () => {
  const at = (iso: string) => new Date(iso);
  async function lookupSetup() {
    const cardA = buildFixedCard({ id: "A", triggerSessionId: "s-a", laneSessions: [], updatedAt: at("2026-10-01T00:00:00Z") });
    const cardB = buildFixedCard({ id: "B", triggerSessionId: undefined, updatedAt: at("2026-10-01T00:00:00Z"),
      laneSessions: [{ sessionId: "s-b", status: "running", startedAt: "2026-10-01T00:00:00Z" }] });
    const cardC = buildFixedCard({ id: "C", triggerSessionId: undefined, updatedAt: at("2026-10-05T00:00:00Z"),
      laneSessions: [{ sessionId: "s-a", status: "completed", startedAt: "2026-10-01T00:00:00Z" }] });
    const cardD = buildFixedCard({ id: "D", triggerSessionId: undefined, updatedAt: at("2026-10-02T00:00:00Z"),
      laneSessions: [{ sessionId: "s-e", status: "completed", startedAt: "2026-10-01T00:00:00Z" }] });
    const cardE = buildFixedCard({ id: "E", triggerSessionId: undefined, updatedAt: at("2026-10-04T00:00:00Z"),
      laneSessions: [{ sessionId: "s-e", status: "running", startedAt: "2026-10-03T00:00:00Z" }] });
    const cardA2 = buildFixedCard({ id: "A2", triggerSessionId: "s-a2", laneSessions: [] });
    const cardW = buildFixedCard({ id: "W1", workspaceId: "ws-w", triggerSessionId: "s-w", laneSessions: [] });
    return setup([cardA, cardA2, cardB, cardC, cardD, cardE, cardW]);
  }

  type Entry = (tools: KanbanTools, args: { taskId?: string; sessionId?: string; workspaceId: string }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  const entries: Array<[string, Entry]> = [
    ["KanbanTools.getTask", (tools, args) => tools.getTask(args)],
    ["executeGetTaskTool", (tools, args) => executeGetTaskTool(tools, args, args.workspaceId)],
  ];
  const cases: Array<[string, { taskId?: string; sessionId?: string; workspaceId: string }, { id?: string; error?: string }]> = [
    ["(a) existing taskId", { taskId: "B", workspaceId: "default" }, { id: "B" }],
    ["(b) session = trigger of A2", { sessionId: "s-a2", workspaceId: "default" }, { id: "A2" }],
    ["(c) session only in B lanes", { sessionId: "s-b", workspaceId: "default" }, { id: "B" }],
    ["(d) trigger of A beats newer lane of C", { sessionId: "s-a", workspaceId: "default" }, { id: "A" }],
    ["(e) two lane matches -> newest updatedAt", { sessionId: "s-e", workspaceId: "default" }, { id: "E" }],
    ["(f) session bound to no card", { sessionId: "s-none", workspaceId: "default" }, { error: "s-none" }],
    ["(g) no taskId and no session", { workspaceId: "default" }, { error: "needs a taskId" }],
    ["(h) unknown taskId", { taskId: "no-such-id", workspaceId: "default" }, { error: "no-such-id" }],
    ["(i) non-default workspace", { sessionId: "s-w", workspaceId: "ws-w" }, { id: "W1" }],
  ];

  describe.each(entries)("%s", (_entryName, call) => {
    it.each(cases)("%s", async (_name, args, expected) => {
      const { kanbanTools } = await lookupSetup();
      const resultPromise = call(kanbanTools, args);
      await expect(resultPromise).resolves.toBeDefined();
      const result = await resultPromise;
      if (expected.id) {
        expect(result.success).toBe(true);
        expect((result.data as { id: string }).id).toBe(expected.id);
      } else {
        expect(result.success).toBe(false);
        expect(result.error).toContain(expected.error);
      }
    });
  });
});

describe("get_task size control (C4, AC5)", () => {
  it.each([["Chinese", "汉"], ["ASCII", "a"]])("%s 50 x 5000-char comments stay under 32 KB", async (_label, char) => {
    const big = buildBigCard(char);
    const { kanbanTools } = await setup([big]);
    const result = await kanbanTools.getTask({ taskId: "task-big", workspaceId: "default" });
    expect(result.success).toBe(true);
    const data = result.data as {
      comments: Array<{ id: string; body: string; truncated?: boolean }>;
      commentsTotal: number;
      objective: string;
      verificationReport: string;
      truncated: { objective: boolean; verificationReport: boolean };
    };
    expect(bytes(data)).toBeLessThanOrEqual(MAX_BYTES);
    expect(bytes(data, true)).toBeLessThanOrEqual(MAX_BYTES);
    expect(data.commentsTotal).toBe(50);
    expect(data.comments.length).toBeGreaterThan(0);
    const allIdsAscending = [...big.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((c) => c.id);
    const returnedIds = data.comments.map((comment) => comment.id);
    expect(returnedIds).toEqual(allIdsAscending.slice(allIdsAscending.length - returnedIds.length));
    expect(returnedIds.at(-1)).toBe("c-49");
    const originals = new Map(big.comments.map((comment) => [comment.id, comment.body]));
    for (const comment of data.comments) {
      expect(comment.truncated).toBe(true);
      expect(originals.get(comment.id)!.startsWith(comment.body)).toBe(true);
      expect(comment.body.length).toBeLessThan(originals.get(comment.id)!.length);
    }
    expect(data.truncated).toEqual({ objective: true, verificationReport: true });
    expect(big.objective.startsWith(data.objective)).toBe(true);
    expect(big.verificationReport!.startsWith(data.verificationReport)).toBe(true);
  });

  it("leaves a small card untouched (control)", async () => {
    const card = buildFixedCard({ comments: [
      { id: "k1", body: "short one", createdAt: "2026-10-01T00:00:00.000Z" },
      { id: "k2", body: "short two", createdAt: "2026-10-02T00:00:00.000Z" },
    ] });
    const { kanbanTools } = await setup([card]);
    const result = await kanbanTools.getTask({ taskId: "task-fixed", workspaceId: "default" });
    const data = result.data as { comments: Array<Record<string, unknown>>; truncated: Record<string, boolean>; objective: string };
    expect(data.truncated).toEqual({ objective: false, verificationReport: false });
    expect(data.comments.map((comment) => comment.body)).toEqual(["short one", "short two"]);
    expect(data.comments.some((comment) => "truncated" in comment)).toBe(false);
    expect(data.objective).toBe("Ship get_task");
  });

  it("C13: explicit commentLimit/maxCommentChars may exceed 32 KB but stays under the 256 KB hard cap", () => {
    const snapshot = buildTaskSnapshot(buildBigCard("汉"), { commentLimit: 1000, maxCommentChars: 1_000_000 });
    expect(bytes(snapshot, true)).toBeGreaterThan(MAX_BYTES);
    expect(bytes(snapshot, true)).toBeLessThanOrEqual(262144);
    expect(snapshot.comments.at(-1)?.id).toBe("c-49");
  });

  it("C14: truncation never splits an emoji surrogate pair or a CJK character", () => {
    const text = "汉😀".repeat(100);
    for (const max of [1, 2, 3, 7, 50]) {
      const { text: cut, truncated } = truncateCodePoints(text, max);
      expect(truncated).toBe(true);
      expect(Buffer.from(cut, "utf8").toString("utf8")).toBe(cut);
      expect(JSON.parse(JSON.stringify(cut))).toBe(cut);
      expect(Array.from(cut)).toHaveLength(max);
      expect(text.startsWith(cut)).toBe(true);
    }
    const card = buildFixedCard({ comments: [{ id: "e1", body: "😀".repeat(3000), createdAt: "2026-10-01T00:00:00Z" }] });
    const body = buildTaskSnapshot(card).comments[0]!.body;
    expect(Buffer.from(body, "utf8").toString("utf8")).toBe(body);
  });
});

describe("cross-workspace taskId (C18)", () => {
  it("reads a card from another workspace by id like update_card does, without throwing", async () => {
    const { kanbanTools } = await setup([buildFixedCard({ id: "other", workspaceId: "ws-other" })]);
    const result = await kanbanTools.getTask({ taskId: "other", workspaceId: "default" });
    expect(result.success).toBe(true);
    expect((result.data as { id: string }).id).toBe("other");
  });
});

describe("SQLite task store round trip (C7)", () => {
  it("returns the same comments, verdict, report and lane summary after hydrate, and does not touch the row", async () => {
    const dbPath = path.join(os.tmpdir(), `routa-get-task-${process.pid}-${Date.now()}.db`);
    const { closeSqliteDatabase, ensureSqliteDefaultWorkspace, getSqliteDatabase } = await import("../../db/sqlite");
    const { SqliteTaskStore } = await import("../../db/sqlite-task-store");
    closeSqliteDatabase();
    try {
      const db = getSqliteDatabase(dbPath);
      ensureSqliteDefaultWorkspace();
      const fixed = buildFixedCard();
      await new SqliteTaskStore(db).save(fixed);
      const readRow = () => {
        const raw = new BetterSqlite3(dbPath, { readonly: true });
        try {
          return raw.prepare("SELECT updated_at, lane_sessions FROM tasks WHERE id = ?").get("task-fixed");
        } finally {
          raw.close();
        }
      };
      const rowBefore = readRow();

      const kanbanTools = new KanbanTools(new InMemoryKanbanBoardStore(), new SqliteTaskStore(db));
      const result = await kanbanTools.getTask({ taskId: "task-fixed", workspaceId: "default" });

      expect(result.success).toBe(true);
      const data = result.data as ReturnType<typeof buildTaskSnapshot>;
      const expected = buildTaskSnapshot(fixed);
      expect(data.comments).toEqual(expected.comments);
      expect(data.commentsTotal).toBe(3);
      expect(data.verificationVerdict).toBe("NOT_APPROVED");
      expect(data.verificationReport).toBe("Missing tests for AC4");
      expect(data.laneSessions).toEqual(expected.laneSessions);
      expect(readRow()).toEqual(rowBefore);
    } finally {
      closeSqliteDatabase();
      for (const suffix of ["", "-wal", "-shm"]) {
        if (fs.existsSync(dbPath + suffix)) fs.unlinkSync(dbPath + suffix);
      }
    }
  });
});
