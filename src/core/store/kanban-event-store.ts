/**
 * Durable log of Kanban SSE frames.
 *
 * Why this exists: every board event (`kanban:changed`, `kanban:task-lifecycle`,
 * `kanban:session-tail`, `fitness:changed`) lived only on the in-process
 * EventBus. A page reload, a dropped SSE connection, or a server restart lost
 * them all; a reconnecting client could not catch up; the notification bell
 * rebuilt from localStorage, which is per-browser.
 *
 * Contract (frozen for the Rust port — see
 * docs/exec-plans/active/kanban-debt-triage-2026-09.md, Item 3):
 *   `payload` is the exact JSON object that went over the wire, unmodified.
 *   `id` is the SSE `id:` line, so `Last-Event-ID` can address a row.
 */

import type { KanbanWorkspaceEvent } from "../kanban/kanban-event-types";

export interface KanbanEventRecord {
  id: string;
  workspaceId: string;
  type: KanbanWorkspaceEvent["type"];
  /** taskId / sessionId / boardId when the frame carries one. */
  resourceId: string | null;
  payload: KanbanWorkspaceEvent;
  /** Epoch milliseconds. */
  createdAt: number;
}

export interface ListKanbanEventsOptions {
  /** Return rows strictly after this row id (SSE Last-Event-ID). */
  afterId?: string;
  /** Return rows with createdAt strictly greater than this (epoch ms). */
  since?: number;
  /** Hard cap; the SSE route uses 500. */
  limit?: number;
}

export interface KanbanEventStore {
  append(record: KanbanEventRecord): Promise<void>;
  list(workspaceId: string, options?: ListKanbanEventsOptions): Promise<KanbanEventRecord[]>;
  /** Deletes rows older than the cutoff. Returns the number removed. */
  pruneOlderThan(cutoffEpochMs: number): Promise<number>;
}

/** Default retention. Long enough to survive a weekend, short enough to stay small. */
export const KANBAN_EVENT_RETENTION_DAYS = 7;
export const KANBAN_EVENT_RETENTION_MS = KANBAN_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Replay cap so a long-dead client does not receive a day of frames on reconnect. */
export const KANBAN_EVENT_REPLAY_LIMIT = 500;

/**
 * Pulls the id the UI would want to filter on out of a frame.
 * Kept here so both backends and the in-memory store agree.
 */
export function resolveKanbanEventResourceId(event: KanbanWorkspaceEvent): string | null {
  switch (event.type) {
    case "kanban:changed":
      return event.resourceId ?? null;
    case "kanban:task-lifecycle":
      return event.taskId;
    case "kanban:session-tail":
      return event.sessionId;
    case "fitness:changed":
      return event.codebaseId ?? null;
    default:
      return null;
  }
}

export class InMemoryKanbanEventStore implements KanbanEventStore {
  private records: KanbanEventRecord[] = [];

  async append(record: KanbanEventRecord): Promise<void> {
    // Mirrors the SQL stores' ON CONFLICT DO NOTHING on the primary key.
    if (this.records.some((row) => row.id === record.id)) return;
    this.records.push({ ...record, payload: structuredClone(record.payload) });
  }

  async list(workspaceId: string, options: ListKanbanEventsOptions = {}): Promise<KanbanEventRecord[]> {
    let rows = this.records.filter((row) => row.workspaceId === workspaceId);

    if (options.afterId) {
      const index = rows.findIndex((row) => row.id === options.afterId);
      // Unknown cursor: return everything rather than nothing, so a client
      // with a stale id still converges.
      rows = index >= 0 ? rows.slice(index + 1) : rows;
    }
    if (options.since !== undefined) {
      rows = rows.filter((row) => row.createdAt > options.since!);
    }

    rows.sort((left, right) => left.createdAt - right.createdAt);
    const limit = options.limit ?? KANBAN_EVENT_REPLAY_LIMIT;
    // Keep the newest `limit` rows so the client lands at the present.
    return rows.length > limit ? rows.slice(rows.length - limit) : rows;
  }

  async pruneOlderThan(cutoffEpochMs: number): Promise<number> {
    const before = this.records.length;
    this.records = this.records.filter((row) => row.createdAt >= cutoffEpochMs);
    return before - this.records.length;
  }
}
