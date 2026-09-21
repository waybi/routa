import type { RuntimeFitnessEventStatus } from "@/core/fitness/runtime-status-types";

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

export type KanbanWorkspaceEvent =
  | KanbanWorkspaceChangedEvent
  | KanbanFitnessChangedEvent
  | KanbanTaskLifecycleEvent;

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
    for (const [connId, { controller, workspaceId }] of this.controllers) {
      if (workspaceId !== event.workspaceId && workspaceId !== "*") continue;
      try {
        this.writeSse(controller, event);
      } catch {
        this.controllers.delete(connId);
      }
    }
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

  get connectionCount(): number {
    return this.controllers.size;
  }

  private writeSse(controller: SSEController, payload: unknown): void {
    const encoder = new TextEncoder();
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
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
