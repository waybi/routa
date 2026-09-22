import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as sqliteSchema from "../sqlite-schema";
import { SqliteKanbanEventStore } from "../sqlite-kanban-event-store";
import {
  InMemoryKanbanEventStore,
  KANBAN_EVENT_REPLAY_LIMIT,
  resolveKanbanEventResourceId,
  type KanbanEventRecord,
  type KanbanEventStore,
} from "@/core/store/kanban-event-store";
import type { KanbanWorkspaceEvent } from "@/core/kanban/kanban-event-broadcaster";

function changed(workspaceId: string, resourceId: string, timestamp: string): KanbanWorkspaceEvent {
  return { type: "kanban:changed", workspaceId, entity: "task", action: "updated", resourceId, source: "agent", timestamp };
}

function record(id: string, workspaceId: string, createdAt: number, payload?: KanbanWorkspaceEvent): KanbanEventRecord {
  const event = payload ?? changed(workspaceId, `res-${id}`, new Date(createdAt).toISOString());
  return { id, workspaceId, type: event.type, resourceId: resolveKanbanEventResourceId(event), payload: event, createdAt };
}

/**
 * One contract, two backends. Whatever the SSE route relies on must hold for
 * both, or desktop (sqlite) and hosted (pg-shaped in-memory stand-in) diverge.
 */
function describeStoreContract(name: string, factory: () => { store: KanbanEventStore; teardown?: () => void }) {
  describe(name, () => {
    let store: KanbanEventStore;
    let teardown: (() => void) | undefined;

    beforeEach(() => {
      const built = factory();
      store = built.store;
      teardown = built.teardown;
    });

    afterEach(() => {
      teardown?.();
    });

    it("returns rows for one workspace in createdAt order", async () => {
      await store.append(record("b", "ws-1", 2000));
      await store.append(record("a", "ws-1", 1000));
      await store.append(record("x", "ws-2", 1500));

      const rows = await store.list("ws-1");
      expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
      expect(rows.every((row) => row.workspaceId === "ws-1")).toBe(true);
    });

    it("round-trips the payload byte-for-byte", async () => {
      const payload: KanbanWorkspaceEvent = {
        type: "kanban:task-lifecycle",
        workspaceId: "ws-1",
        taskId: "t-9",
        taskTitle: "Ship it",
        sessionId: "s-9",
        phase: "completed",
        columnId: "review",
        lastMessagePreview: "done ✅",
        source: "agent",
        timestamp: "2026-09-22T00:00:00.000Z",
      };
      await store.append(record("p", "ws-1", 1000, payload));

      const [row] = await store.list("ws-1");
      expect(row.payload).toEqual(payload);
      expect(row.type).toBe("kanban:task-lifecycle");
      expect(row.resourceId).toBe("t-9");
    });

    it("replays strictly after a known cursor id", async () => {
      for (let index = 1; index <= 5; index += 1) {
        await store.append(record(`e${index}`, "ws-1", index * 1000));
      }

      const rows = await store.list("ws-1", { afterId: "e3" });
      expect(rows.map((row) => row.id)).toEqual(["e4", "e5"]);
    });

    it("returns everything when the cursor id is unknown, so a stale client still converges", async () => {
      await store.append(record("e1", "ws-1", 1000));
      await store.append(record("e2", "ws-1", 2000));

      const rows = await store.list("ws-1", { afterId: "never-existed" });
      expect(rows.map((row) => row.id)).toEqual(["e1", "e2"]);
    });

    it("filters by since (exclusive)", async () => {
      await store.append(record("e1", "ws-1", 1000));
      await store.append(record("e2", "ws-1", 2000));
      await store.append(record("e3", "ws-1", 3000));

      const rows = await store.list("ws-1", { since: 2000 });
      expect(rows.map((row) => row.id)).toEqual(["e3"]);
    });

    it("caps replay at the newest `limit` rows, ascending", async () => {
      for (let index = 1; index <= 10; index += 1) {
        await store.append(record(`e${index}`, "ws-1", index * 1000));
      }

      const rows = await store.list("ws-1", { limit: 3 });
      expect(rows.map((row) => row.id)).toEqual(["e8", "e9", "e10"]);
    });

    it("defaults the limit to KANBAN_EVENT_REPLAY_LIMIT", async () => {
      for (let index = 0; index < KANBAN_EVENT_REPLAY_LIMIT + 5; index += 1) {
        await store.append(record(`e${index}`, "ws-1", 1000 + index));
      }

      const rows = await store.list("ws-1");
      expect(rows).toHaveLength(KANBAN_EVENT_REPLAY_LIMIT);
      expect(rows[0].id).toBe("e5");
    });

    it("prunes rows older than the cutoff and reports the count", async () => {
      await store.append(record("old1", "ws-1", 1000));
      await store.append(record("old2", "ws-2", 2000));
      await store.append(record("new", "ws-1", 5000));

      const removed = await store.pruneOlderThan(3000);
      expect(removed).toBe(2);
      expect((await store.list("ws-1")).map((row) => row.id)).toEqual(["new"]);
      expect(await store.list("ws-2")).toEqual([]);
    });

    it("ignores a duplicate id instead of throwing", async () => {
      await store.append(record("dup", "ws-1", 1000));
      await expect(store.append(record("dup", "ws-1", 9999))).resolves.toBeUndefined();
      const rows = await store.list("ws-1");
      expect(rows).toHaveLength(1);
    });
  });
}

describeStoreContract("InMemoryKanbanEventStore", () => ({ store: new InMemoryKanbanEventStore() }));

describeStoreContract("SqliteKanbanEventStore", () => {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.exec(`
    CREATE TABLE kanban_events (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      type TEXT NOT NULL,
      resource_id TEXT,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_kanban_events_workspace_created ON kanban_events (workspace_id, created_at);
  `);
  const db = drizzle(sqlite, { schema: sqliteSchema });
  return { store: new SqliteKanbanEventStore(db), teardown: () => sqlite.close() };
});

describe("resolveKanbanEventResourceId", () => {
  it("picks the id the board would filter on for each frame type", () => {
    expect(resolveKanbanEventResourceId(changed("ws", "t1", "now"))).toBe("t1");
    expect(resolveKanbanEventResourceId({
      type: "kanban:task-lifecycle", workspaceId: "ws", taskId: "t2", taskTitle: "x", phase: "started", source: "agent", timestamp: "now",
    })).toBe("t2");
    expect(resolveKanbanEventResourceId({
      type: "kanban:session-tail", workspaceId: "ws", sessionId: "s3", tail: "…", updateType: "agent_message", timestamp: "now",
    })).toBe("s3");
    expect(resolveKanbanEventResourceId({
      type: "fitness:changed", workspaceId: "ws", source: "system", timestamp: "now",
    })).toBeNull();
  });
});
