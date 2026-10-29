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
 *
 * Emitted today: `completed` (entered Done), `blocked` (entered Blocked),
 * `rejected` (sent back from Review), `failed` (agent run failed).
 * `started` and `needs_review` are no longer emitted but stay in the type
 * because persisted frames from older builds are still replayed.
 */
export type KanbanTaskLifecyclePhase =
  | "started"
  | "completed"
  | "failed"
  | "blocked"
  | "rejected"
  | "needs_review";

export type KanbanTaskLifecycleEvent = {
  type: "kanban:task-lifecycle";
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  sessionId?: string;
  phase: KanbanTaskLifecyclePhase;
  columnId?: string;
  /** Board holding the card, so a notification can deep-link to it. */
  boardId?: string;
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

/**
 * Heartbeat of a live session, so a card can say "working / quiet for 4 min /
 * errored" without the user opening it.
 *
 * The board's session list is fetched once and only refetched on
 * `kanban:changed`, so a card used to keep the `connecting` snapshot from
 * session creation ("starting" forever) and never learned when the agent last
 * did anything. This event carries the live process status plus the last
 * activity time; the client ages it locally, so the server only sends it when
 * something happens (throttled per session).
 *
 * Ephemeral: never persisted or replayed. A reconnecting client refetches
 * `/api/sessions`, which carries the same fields.
 */
export type KanbanSessionActivityEvent = {
  type: "kanban:session-activity";
  workspaceId: string;
  sessionId: string;
  acpStatus?: "connecting" | "ready" | "error";
  acpError?: string;
  lastActivityAt?: string;
  lastEventType?: string;
  /** Tool currently or most recently invoked, e.g. "Bash". */
  lastToolName?: string;
  lastToolStatus?: string;
  terminalState?: "completed" | "failed" | "timed_out";
  terminalReason?: string;
  timestamp: string;
};

/**
 * One row per server start, written by the startup lane sweep (card 2d21984e).
 *
 * Not a board frame: it is never sent over SSE and has no workspace, so it is
 * stored under the workspace id `"*"`. A replay asks for one real workspace
 * id, so these rows are never replayed to a client. They exist so a review can
 * compute downtime from routa.db instead of from pm2 logs.
 */
export const KANBAN_SERVER_RESTART_WORKSPACE_ID = "*";

export type KanbanServerRestartEvent = {
  type: "kanban:server-restart";
  workspaceId: typeof KANBAN_SERVER_RESTART_WORKSPACE_ID;
  /** ISO time the sweep started (process start side). */
  bootAt: string;
  pid: number;
  /** Lane sessions the sweep ended; present when the sweep succeeded. */
  endedSessionIds?: string[];
  /** Cards those sessions belonged to; present when the sweep succeeded. */
  cards?: number;
  /** Error text; present when the sweep threw. */
  error?: string;
  timestamp: string;
};

export type KanbanWorkspaceEvent =
  | KanbanWorkspaceChangedEvent
  | KanbanFitnessChangedEvent
  | KanbanTaskLifecycleEvent
  | KanbanSessionTailEvent
  | KanbanSessionActivityEvent
  | KanbanServerRestartEvent;
