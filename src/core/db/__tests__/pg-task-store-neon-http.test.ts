// @vitest-environment node
/**
 * Card dd65b565 rework: PgTaskStore.save must work on the real drizzle neon-http
 * driver, whose transaction() throws "No transactions support in neon-http driver".
 * The driver is a real drizzle-orm/neon-http instance over a fake client function
 * (no network); the fake records every statement.
 */
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/neon-http";
import { PgTaskStore } from "../pg-task-store";
import * as schema from "../schema";
import { createTask, type Task } from "../../models/task";

const storedLane = {
  sessionId: "pusher-1",
  columnId: "done",
  stepIndex: 0,
  specialistId: "pusher",
  status: "running",
  startedAt: "2026-10-29T10:00:00.000Z",
};

function makeFakeNeon() {
  const statements: { sql: string; params: unknown[] }[] = [];
  const client = async (sql: string, params: unknown[]) => {
    statements.push({ sql, params });
    if (/^\s*select/i.test(sql)) {
      // arrayMode rows: [session_ids, lane_sessions] in selected-column order
      return { rows: [[["review-guard-1", "pusher-1"], [storedLane]]], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };
  const db = drizzle(client as never, { schema });
  return { db, statements };
}

function jsonParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (typeof p !== "string") return p;
    try {
      return JSON.parse(p);
    } catch {
      return p;
    }
  });
}

describe("PgTaskStore.save on neon-http", () => {
  it("does not throw 'No transactions support' and keeps the stored Done lane record", async () => {
    const { db, statements } = makeFakeNeon();
    const store = new PgTaskStore(db as never);
    const stale: Task = {
      ...createTask({ id: "t1", title: "t", objective: "o", workspaceId: "ws" }),
      sessionIds: ["review-guard-1"],
      laneSessions: [
        { sessionId: "review-guard-1", columnId: "review", status: "completed", startedAt: "2026-10-29T09:00:00.000Z" },
      ] as Task["laneSessions"],
    };

    await expect(store.save(stale)).resolves.toBeUndefined();

    const kinds = statements.map((s) => s.sql.trim().split(/\s+/)[0].toLowerCase());
    expect(kinds).toEqual(["select", "insert"]);
    expect(statements[0].sql).not.toMatch(/for update/i);

    const parsed = jsonParams(statements[1].params);
    const laneParam = parsed.find(
      (p) => Array.isArray(p) && p.some((e) => (e as { sessionId?: string })?.sessionId === "review-guard-1"),
    ) as Array<{ sessionId: string; columnId?: string; status: string }>;
    expect(laneParam.map((e) => e.sessionId).sort()).toEqual(["pusher-1", "review-guard-1"]);
    expect(laneParam.find((e) => e.sessionId === "pusher-1")).toMatchObject({ columnId: "done", status: "running" });
    const idsParam = parsed.find((p) => Array.isArray(p) && p.every((e) => typeof e === "string") && p.includes("pusher-1"));
    expect(idsParam).toEqual(["review-guard-1", "pusher-1"]);
  });

  it("remembers that transactions are unsupported and skips the failing attempt next time", async () => {
    const { db, statements } = makeFakeNeon();
    const store = new PgTaskStore(db as never);
    const task = createTask({ id: "t2", title: "t", objective: "o", workspaceId: "ws" });
    await store.save(task);
    await store.save(task);
    expect(statements.length).toBe(4);
  });
});
