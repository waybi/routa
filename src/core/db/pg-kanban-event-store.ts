import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { Database } from "./index";
import { kanbanEvents } from "./schema";
import type { KanbanWorkspaceEvent } from "../kanban/kanban-event-broadcaster";
import {
  KANBAN_EVENT_REPLAY_LIMIT,
  type KanbanEventRecord,
  type KanbanEventStore,
  type ListKanbanEventsOptions,
} from "../store/kanban-event-store";

export class PgKanbanEventStore implements KanbanEventStore {
  constructor(private db: Database) {}

  async append(record: KanbanEventRecord): Promise<void> {
    await this.db
      .insert(kanbanEvents)
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
    const conditions = [eq(kanbanEvents.workspaceId, workspaceId)];

    if (options.afterId) {
      // Resolve the cursor row's timestamp; unknown cursor → no filter, so a
      // client with a stale id still converges instead of getting nothing.
      const cursor = await this.db
        .select({ createdAt: kanbanEvents.createdAt })
        .from(kanbanEvents)
        .where(eq(kanbanEvents.id, options.afterId))
        .limit(1);
      if (cursor[0]) {
        conditions.push(gt(kanbanEvents.createdAt, cursor[0].createdAt));
      }
    }
    if (options.since !== undefined) {
      conditions.push(gt(kanbanEvents.createdAt, new Date(options.since)));
    }

    // Newest `limit` rows, then re-sort ascending so replay lands at the present.
    const rows = await this.db
      .select()
      .from(kanbanEvents)
      .where(and(...conditions))
      .orderBy(sql`${kanbanEvents.createdAt} DESC`)
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
      .delete(kanbanEvents)
      .where(lt(kanbanEvents.createdAt, new Date(cutoffEpochMs)))
      .returning({ id: kanbanEvents.id });
    return deleted.length;
  }
}
