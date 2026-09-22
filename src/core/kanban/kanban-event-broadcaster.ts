import type { RuntimeFitnessEventStatus } from "@/core/fitness/runtime-status-types";
import type { KanbanEventStore } from "@/core/store/kanban-event-store";
import { resolveKanbanEventResourceId } from "@/core/store/kanban-event-store";

export type KanbanWorkspaceChangedEvent = {
  type: "kanban:changed";
  workspaceId: string;
  entity: "task" | "board" | "column" | "queue";
  action: "created" | "updated" | "deleted" | "moved" | "refreshed";
  resourceId?: string;
  source: "agent" | "user" | "system";
  timestamp: string;
};

export type KanbanFitnessChangedEvent = {
  type: "fitness:changed";
  workspaceId: string;
  source: "agent" | "user" | "system";
  timestamp: string;
  codebaseId?: string;
  repoPath?: string;
  status?: RuntimeFitnessEventStatus;
};

/**
 * Lifecycle phase of the agent run attached to a card.
 *
 * `kanban:changed` only says "something changed, refetch"; it cannot tell the
 * UI that a run finished, which is why completion never reached the user.
 * This event carries that semantics explicitly.
 */
export type KanbanTaskLifecyclePhase =
  | "started"
  | "completed"
  | "failed"
  | "blocked"
  | "needs_review";

export type KanbanTaskLifecycleEvent = {
  type: "kanban:task-lifecycle";
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  sessionId?: string;
  phase: KanbanTaskLifecyclePhase;
  columnId?: string;
  /** Short preview of the agent's last message, so cards can drop the 1 MB history poll. */
  lastMessagePreview?: string;
  source: "agent" | "user" | "system";
  timestamp: string;
};

/**
 * Newest line an agent said, pushed when it changes.
 *
 * Replaces the board's 10 s poll of `GET /api/sessions/:id/tail`. Keyed by
 * session rather than card because the board already tracks live tails per
 * session id, and one session can move between cards on lane handoff.
 */
export type KanbanSessionTailEvent = {
  type: "kanban:session-tail";
  workspaceId: string;
  sessionId: string;
  tail: string;
  updateType: string;
  timestamp: string;
};

export type KanbanWorkspaceEvent =
  | KanbanWorkspaceChangedEvent
  | KanbanFitnessChangedEvent
  | KanbanTaskLifecycleEvent
  | KanbanSessionTailEvent;

/** Keeps `lastMessagePreview` small enough to stay a notification, not a transcript. */
export const KANBAN_LIFECYCLE_PREVIEW_MAX_CHARS = 120;

export function truncateLifecyclePreview(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > KANBAN_LIFECYCLE_PREVIEW_MAX_CHARS
    ? `${normalized.slice(0, KANBAN_LIFECYCLE_PREVIEW_MAX_CHARS - 1)}…`
    : normalized;
}

type SSEController = ReadableStreamDefaultController<Uint8Array>;

export class KanbanEventBroadcaster {
  private controllers = new Map<string, { controller: SSEController; workspaceId: string }>();
  private connectionCounter = 0;
  /**
   * Optional durable log. When set, every frame except `connected` is
   * appended after fan-out so a reconnecting client can replay via
   * `Last-Event-ID`. Persistence failures are logged, never thrown: a dead
   * disk must not take the live channel down with it.
   */
  private eventStore: KanbanEventStore | null = null;

  setEventStore(store: KanbanEventStore | null): void {
    this.eventStore = store;
  }

  get hasEventStore(): boolean {
    return this.eventStore !== null;
  }

  attach(workspaceId: string, controller: SSEController): string {
    const connId = `kanban-sse-${++this.connectionCounter}`;
    this.controllers.set(connId, { controller, workspaceId });

    this.writeSse(controller, {
      type: "connected",
      connectionId: connId,
      workspaceId,
      timestamp: new Date().toISOString(),
    });

    return connId;
  }

  detach(connId: string): void {
    this.controllers.delete(connId);
  }

  broadcast(event: KanbanWorkspaceEvent): void {
    // The id is minted here, before fan-out, so the SSE `id:` line and the
    // persisted row agree. A client that reconnects with this id gets
    // everything after it.
    const id = crypto.randomUUID();

    for (const [connId, { controller, workspaceId }] of this.controllers) {
      if (workspaceId !== event.workspaceId && workspaceId !== "*") continue;
      try {
        this.writeSse(controller, event, id);
      } catch {
        this.controllers.delete(connId);
      }
    }

    if (this.eventStore) {
      const createdAt = Date.parse(event.timestamp);
      void this.eventStore
        .append({
          id,
          workspaceId: event.workspaceId,
          type: event.type,
          resourceId: resolveKanbanEventResourceId(event),
          payload: event,
          createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
        })
        .catch((error) => {
          console.error("[kanban-events] failed to persist frame:", error);
        });
    }
  }

  /**
   * Replays stored frames to one controller. Used by the SSE route right
   * after `attach()` when the client presents a cursor. Frames carry their
   * stored id so a second disconnect resumes from the right place.
   */
  async replay(
    controller: SSEController,
    workspaceId: string,
    options: { afterId?: string; since?: number; limit?: number },
  ): Promise<number> {
    if (!this.eventStore) return 0;
    const rows = await this.eventStore.list(workspaceId, options);
    for (const row of rows) {
      this.writeSse(controller, row.payload, row.id);
    }
    return rows.length;
  }

  notify(event: Omit<KanbanWorkspaceChangedEvent, "type" | "timestamp">): void {
    this.broadcast({
      ...event,
      type: "kanban:changed",
      timestamp: new Date().toISOString(),
    });
  }

  notifyFitness(event: Omit<KanbanFitnessChangedEvent, "type" | "timestamp">): void {
    this.broadcast({
      ...event,
      type: "fitness:changed",
      timestamp: new Date().toISOString(),
    });
  }

  notifyTaskLifecycle(event: Omit<KanbanTaskLifecycleEvent, "type" | "timestamp">): void {
    this.broadcast({
      ...event,
      lastMessagePreview: truncateLifecyclePreview(event.lastMessagePreview),
      type: "kanban:task-lifecycle",
      timestamp: new Date().toISOString(),
    });
  }

  notifySessionTail(event: Omit<KanbanSessionTailEvent, "type" | "timestamp">): void {
    this.broadcast({
      ...event,
      type: "kanban:session-tail",
      timestamp: new Date().toISOString(),
    });
  }

  get connectionCount(): number {
    return this.controllers.size;
  }

  private writeSse(controller: SSEController, payload: unknown, id?: string): void {
    const encoder = new TextEncoder();
    const idLine = id ? `id: ${id}\n` : "";
    controller.enqueue(encoder.encode(`${idLine}data: ${JSON.stringify(payload)}\n\n`));
  }
}

const GLOBAL_KEY = "__kanban_event_broadcaster__";

export function getKanbanEventBroadcaster(): KanbanEventBroadcaster {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new KanbanEventBroadcaster();
  }
  return g[GLOBAL_KEY] as KanbanEventBroadcaster;
}
