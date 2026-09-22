import { and, eq, gt, lt, desc } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as sqliteSchema from "./sqlite-schema";
import type { KanbanWorkspaceEvent } from "../kanban/kanban-event-broadcaster";
import {
  KANBAN_EVENT_REPLAY_LIMIT,
  type KanbanEventRecord,
  type KanbanEventStore,
  type ListKanbanEventsOptions,
} from "../store/kanban-event-store";

type SqliteDb = BetterSQLite3Database<typeof sqliteSchema>;

export class SqliteKanbanEventStore implements KanbanEventStore {
  constructor(private db: SqliteDb) {}

  async append(record: KanbanEventRecord): Promise<void> {
    await this.db
      .insert(sqliteSchema.kanbanEvents)
      .values({
        id: record.id,
        workspaceId: record.workspaceId,
        type: record.type,
        resourceId: record.resourceId,
        payload: record.payload as unknown as Record<string, unknown>,
        createdAt: new Date(record.createdAt),
      })
      .onConflictDoNothing();
  }

  async list(workspaceId: string, options: ListKanbanEventsOptions = {}): Promise<KanbanEventRecord[]> {
    const limit = options.limit ?? KANBAN_EVENT_REPLAY_LIMIT;
    const conditions = [eq(sqliteSchema.kanbanEvents.workspaceId, workspaceId)];

    if (options.afterId) {
      const cursor = await this.db
        .select({ createdAt: sqliteSchema.kanbanEvents.createdAt })
        .from(sqliteSchema.kanbanEvents)
        .where(eq(sqliteSchema.kanbanEvents.id, options.afterId))
        .limit(1);
      if (cursor[0]) {
        conditions.push(gt(sqliteSchema.kanbanEvents.createdAt, cursor[0].createdAt));
      }
    }
    if (options.since !== undefined) {
      conditions.push(gt(sqliteSchema.kanbanEvents.createdAt, new Date(options.since)));
    }

    const rows = await this.db
      .select()
      .from(sqliteSchema.kanbanEvents)
      .where(and(...conditions))
      .orderBy(desc(sqliteSchema.kanbanEvents.createdAt))
      .limit(limit);

    return rows
      .map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        type: row.type as KanbanWorkspaceEvent["type"],
        resourceId: row.resourceId,
        payload: row.payload as unknown as KanbanWorkspaceEvent,
        createdAt: row.createdAt.getTime(),
      }))
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  async pruneOlderThan(cutoffEpochMs: number): Promise<number> {
    const deleted = await this.db
      .delete(sqliteSchema.kanbanEvents)
      .where(lt(sqliteSchema.kanbanEvents.createdAt, new Date(cutoffEpochMs)))
      .returning({ id: sqliteSchema.kanbanEvents.id });
    return deleted.length;
  }
}
