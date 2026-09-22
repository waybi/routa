/**
 * Wire types for the kanban SSE stream (`/api/kanban/events`).
 *
 * Kept separate from the broadcaster so the event store can describe what it
 * persists without importing the thing that persists into it: the store
 * needs the event shape, the broadcaster needs the store. Putting the shape
 * in its own module keeps `src/core` acyclic (fitness rule
 * `ts_backend_core_no_cycles`).
 */

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
