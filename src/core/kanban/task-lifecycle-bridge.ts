/**
 * EventBus → KanbanEventBroadcaster bridge for task lifecycle.
 *
 * The board already received `kanban:changed` ("something changed, refetch"),
 * but nothing ever told the UI that a card reached a state the human must act
 * on. This bridge turns those moments into a card-level lifecycle event the
 * frontend can surface as a toast / bell entry / OS notification.
 *
 * Only four moments notify:
 * - the card enters a `done` column → `completed`
 * - the card enters a `blocked` column → `blocked`
 * - the card is sent back from `review` to backlog / todo / dev → `rejected`
 * - the agent run fails (AGENT_FAILED / AGENT_TIMEOUT / AGENT_ERROR) → `failed`
 *
 * AGENT_COMPLETED fires after every agent turn, so it must not notify: it used
 * to stack one bell entry per turn for a card that was not finished yet.
 */

import type { EventBus } from "../events/event-bus";
import { AgentEventType, type AgentEvent } from "../events/event-bus";
import type { TaskStore } from "../store/task-store";
import type { KanbanBoardStore } from "../store/kanban-board-store";
import type { Task } from "../models/task";
import type { KanbanColumnStage } from "../models/kanban";
import {
  getKanbanEventBroadcaster,
  type KanbanEventBroadcaster,
  type KanbanTaskLifecyclePhase,
} from "./kanban-event-broadcaster";
import { findTaskForSession } from "./session-kanban-context";

const BRIDGE_HANDLER_KEY = "kanban-task-lifecycle-bridge";

/** Agent run outcomes that always deserve a notification. */
const FAILURE_EVENT_TYPES: ReadonlySet<AgentEventType> = new Set([
  AgentEventType.AGENT_FAILED,
  AgentEventType.AGENT_TIMEOUT,
  AgentEventType.AGENT_ERROR,
]);

const KNOWN_STAGES: ReadonlySet<string> = new Set<KanbanColumnStage>([
  "backlog",
  "todo",
  "dev",
  "review",
  "blocked",
  "done",
]);

const REJECT_TARGET_STAGES: ReadonlySet<string> = new Set<KanbanColumnStage>(["backlog", "todo", "dev"]);

/** Upper bound on cards remembered for dedupe; oldest entries are dropped. */
const MAX_TRACKED_TASKS = 500;

function readStringField(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Maps a column move onto a lifecycle phase. Returns undefined for moves the
 * human does not need to hear about (backlog→todo, dev→review, blocked→dev…).
 */
export function resolveTransitionPhase(
  fromStage: string | undefined,
  toStage: string | undefined,
): KanbanTaskLifecyclePhase | undefined {
  if (toStage === "done") return "completed";
  if (toStage === "blocked") return "blocked";
  if (fromStage === "review" && toStage && REJECT_TARGET_STAGES.has(toStage)) return "rejected";
  return undefined;
}

export interface TaskLifecycleBridgeDeps {
  eventBus: EventBus;
  taskStore: TaskStore;
  /** Resolves custom column ids to their stage; without it the column id is treated as the stage. */
  kanbanBoardStore?: KanbanBoardStore;
  broadcaster?: KanbanEventBroadcaster;
  handlerKey?: string;
}

/**
 * Remembers what was already announced per card, so the same move emitted by
 * several entry points (move_card, auto-advance, API) or the same failure
 * reported twice only notifies once. A card leaving the column clears its
 * record, so entering Done a second time notifies again.
 */
class LifecycleDedupe {
  private readonly notified = new Map<string, Set<string>>();

  /** Records `key` for the task; returns false when it was already announced. */
  claim(taskId: string, key: string, options: { resetOthers: boolean }): boolean {
    const existing = this.notified.get(taskId);
    if (existing?.has(key)) return false;
    const next = options.resetOthers || !existing ? new Set<string>() : existing;
    next.add(key);
    this.notified.delete(taskId);
    this.notified.set(taskId, next);
    this.evictOverflow();
    return true;
  }

  forget(taskId: string): void {
    this.notified.delete(taskId);
  }

  private evictOverflow(): void {
    while (this.notified.size > MAX_TRACKED_TASKS) {
      const oldest = this.notified.keys().next().value;
      if (oldest === undefined) return;
      this.notified.delete(oldest);
    }
  }
}

/**
 * Subscribes to the event bus and re-broadcasts card lifecycle transitions.
 * Returns a disposer so tests (and hot reload) can unsubscribe.
 */
export function setupTaskLifecycleBridge(deps: TaskLifecycleBridgeDeps): () => void {
  const broadcaster = deps.broadcaster ?? getKanbanEventBroadcaster();
  const handlerKey = deps.handlerKey ?? BRIDGE_HANDLER_KEY;
  const dedupe = new LifecycleDedupe();

  deps.eventBus.on(handlerKey, (event: AgentEvent) => {
    if (event.type === AgentEventType.COLUMN_TRANSITION) {
      void handleColumnTransition(event, deps, broadcaster, dedupe);
      return;
    }
    if (FAILURE_EVENT_TYPES.has(event.type)) {
      void handleAgentFailure(event, deps.taskStore, broadcaster, dedupe);
    }
  });

  return () => deps.eventBus.off(handlerKey);
}

async function resolveColumnStages(
  kanbanBoardStore: KanbanBoardStore | undefined,
  boardId: string | undefined,
  fromColumnId: string | undefined,
  toColumnId: string,
): Promise<{ fromStage?: string; toStage?: string }> {
  const fallback = (columnId: string | undefined) =>
    columnId && KNOWN_STAGES.has(columnId) ? columnId : undefined;

  const board = kanbanBoardStore && boardId ? await kanbanBoardStore.get(boardId) : undefined;
  if (!board) {
    return { fromStage: fallback(fromColumnId), toStage: fallback(toColumnId) };
  }
  const stageOf = (columnId: string | undefined) =>
    board.columns.find((column) => column.id === columnId)?.stage ?? fallback(columnId);
  return { fromStage: stageOf(fromColumnId), toStage: stageOf(toColumnId) };
}

async function handleColumnTransition(
  event: AgentEvent,
  deps: TaskLifecycleBridgeDeps,
  broadcaster: KanbanEventBroadcaster,
  dedupe: LifecycleDedupe,
): Promise<void> {
  const data = event.data;
  const taskId = readStringField(data, "cardId");
  const toColumnId = readStringField(data, "toColumnId");
  const workspaceId = event.workspaceId || readStringField(data, "workspaceId");
  if (!taskId || !toColumnId || !workspaceId) return;
  const fromColumnId = readStringField(data, "fromColumnId");
  const boardId = readStringField(data, "boardId");

  try {
    const { fromStage, toStage } = await resolveColumnStages(
      deps.kanbanBoardStore,
      boardId,
      fromColumnId,
      toColumnId,
    );
    const phase = resolveTransitionPhase(fromStage, toStage);
    if (!phase) {
      dedupe.forget(taskId);
      return;
    }
    if (!dedupe.claim(taskId, `${phase}:${toColumnId}`, { resetOthers: true })) return;

    let taskTitle = readStringField(data, "cardTitle");
    let sessionId: string | undefined;
    if (!taskTitle) {
      const task = await deps.taskStore.get(taskId);
      taskTitle = task?.title;
      sessionId = task?.triggerSessionId;
    }

    broadcaster.notifyTaskLifecycle({
      workspaceId,
      taskId,
      taskTitle: taskTitle ?? taskId,
      sessionId,
      phase,
      columnId: toColumnId,
      boardId,
      source: "system",
    });
  } catch (error) {
    // A notification failure must never take down the move that triggered it.
    console.error("[kanban] task lifecycle bridge failed:", error);
  }
}

async function handleAgentFailure(
  event: AgentEvent,
  taskStore: TaskStore,
  broadcaster: KanbanEventBroadcaster,
  dedupe: LifecycleDedupe,
): Promise<void> {
  if (!event.workspaceId) return;

  // `agentId` is the session id for automation-emitted events; fall back to it
  // so A2A and ACP transports both resolve.
  const sessionId = readStringField(event.data, "sessionId") ?? event.agentId;
  if (!sessionId) return;

  try {
    const task = await resolveTask(taskStore, event, sessionId);
    if (!task) return;
    if (!dedupe.claim(task.id, `failed:${sessionId}`, { resetOthers: false })) return;

    broadcaster.notifyTaskLifecycle({
      workspaceId: event.workspaceId,
      taskId: task.id,
      taskTitle: task.title,
      sessionId,
      phase: "failed",
      columnId: task.columnId,
      boardId: task.boardId,
      lastMessagePreview: readStringField(event.data, "lastMessagePreview")
        ?? readStringField(event.data, "error"),
      source: "agent",
    });
  } catch (error) {
    // A notification failure must never take down the run that triggered it.
    console.error("[kanban] task lifecycle bridge failed:", error);
  }
}

async function resolveTask(
  taskStore: TaskStore,
  event: AgentEvent,
  sessionId: string,
): Promise<Task | undefined> {
  const directTaskId = readStringField(event.data, "taskId") ?? readStringField(event.data, "cardId");
  if (directTaskId) {
    const task = await taskStore.get(directTaskId);
    if (task) return task;
  }

  const tasks = await taskStore.listByWorkspace(event.workspaceId);
  return findTaskForSession(tasks, sessionId);
}
