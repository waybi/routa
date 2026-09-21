/**
 * EventBus → KanbanEventBroadcaster bridge for task lifecycle.
 *
 * The board already received `kanban:changed` ("something changed, refetch"),
 * but nothing ever told the UI that an agent run *finished*. Completion state
 * existed only server-side (AgentEventType.AGENT_COMPLETED and
 * RoutaSessionActivity.terminalState), so the user had to watch the board to
 * notice their work was done.
 *
 * This bridge translates agent-level events into a card-level lifecycle event
 * the frontend can turn into a toast / bell entry / OS notification.
 */

import type { EventBus } from "../events/event-bus";
import { AgentEventType, type AgentEvent } from "../events/event-bus";
import type { TaskStore } from "../store/task-store";
import type { Task } from "../models/task";
import {
  getKanbanEventBroadcaster,
  type KanbanEventBroadcaster,
  type KanbanTaskLifecyclePhase,
} from "./kanban-event-broadcaster";
import { findTaskForSession } from "./session-kanban-context";

const BRIDGE_HANDLER_KEY = "kanban-task-lifecycle-bridge";

/** Agent events that map onto a user-visible card lifecycle phase. */
const PHASE_BY_EVENT_TYPE: Partial<Record<AgentEventType, KanbanTaskLifecyclePhase>> = {
  [AgentEventType.AGENT_CREATED]: "started",
  [AgentEventType.AGENT_COMPLETED]: "completed",
  [AgentEventType.AGENT_FAILED]: "failed",
  [AgentEventType.AGENT_TIMEOUT]: "failed",
  [AgentEventType.AGENT_ERROR]: "failed",
};

/**
 * A card sitting in these columns after a run means the human is on the hook,
 * which deserves a different notification than a plain "completed".
 */
function resolvePhaseForTask(task: Task, basePhase: KanbanTaskLifecyclePhase): KanbanTaskLifecyclePhase {
  if (basePhase !== "completed") return basePhase;
  if (task.columnId === "review") return "needs_review";
  if (task.columnId === "blocked") return "blocked";
  return "completed";
}

function readStringField(data: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export interface TaskLifecycleBridgeDeps {
  eventBus: EventBus;
  taskStore: TaskStore;
  broadcaster?: KanbanEventBroadcaster;
  handlerKey?: string;
}

/**
 * Subscribes to the event bus and re-broadcasts card lifecycle transitions.
 * Returns a disposer so tests (and hot reload) can unsubscribe.
 */
export function setupTaskLifecycleBridge(deps: TaskLifecycleBridgeDeps): () => void {
  const broadcaster = deps.broadcaster ?? getKanbanEventBroadcaster();
  const handlerKey = deps.handlerKey ?? BRIDGE_HANDLER_KEY;

  deps.eventBus.on(handlerKey, (event: AgentEvent) => {
    void handleAgentEvent(event, deps.taskStore, broadcaster);
  });

  return () => deps.eventBus.off(handlerKey);
}

async function handleAgentEvent(
  event: AgentEvent,
  taskStore: TaskStore,
  broadcaster: KanbanEventBroadcaster,
): Promise<void> {
  const basePhase = PHASE_BY_EVENT_TYPE[event.type];
  if (!basePhase || !event.workspaceId) return;

  // `agentId` is the session id for automation-emitted events; fall back to it
  // so A2A and ACP transports both resolve.
  const sessionId = readStringField(event.data, "sessionId") ?? event.agentId;
  if (!sessionId) return;

  try {
    const task = await resolveTask(taskStore, event, sessionId);
    if (!task) return;

    broadcaster.notifyTaskLifecycle({
      workspaceId: event.workspaceId,
      taskId: task.id,
      taskTitle: task.title,
      sessionId,
      phase: resolvePhaseForTask(task, basePhase),
      columnId: task.columnId,
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
