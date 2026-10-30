/**
 * When a card enters Done, wake the Blocked resolver of every older Blocked
 * card that waits for it: attentionResolution.category superseded/waiting and
 * attentionResolution.ref pointing at the Done card (full id or 8-char prefix).
 *
 * This module only queues one more resolver round through the existing
 * enqueue path (which applies the resolver guard); the resolver decides what
 * happens to the old card. The wake is an advisory signal: lost events are not
 * rescanned, and the dedupe set lives in memory (after a restart the same pair
 * may wake once more; the resolver's rounds gate bounds that on purpose).
 */

import { AgentEventType, type AgentEvent } from "../events/event-bus";
import type { KanbanAutomationStep, KanbanBoard } from "../models/kanban";
import type { Task } from "../models/task";
import type { KanbanBoardStore } from "../store/kanban-board-store";
import type { TaskStore } from "../store/task-store";
import { BLOCKED_RESOLVER_SPECIALIST_ID } from "./auto-resolution-record";
import { blockedColumnOf } from "./attention-to-blocked";
import type { ColumnTransitionData } from "./column-transition";

const WAKE_CATEGORIES: ReadonlySet<string> = new Set(["superseded", "waiting"]);
const DEDUPE_KEY = "__routaSupersededWakeSeen__";

export interface EnqueueResolverParams {
  task: Task;
  expectedColumnId: string;
  step: KanbanAutomationStep;
  stepIndex: number;
  adoptLaneRun: true;
  ignoreExistingTrigger: true;
}

export interface SupersededWakeDeps {
  taskStore: Pick<TaskStore, "listByWorkspace">;
  kanbanBoardStore: Pick<KanbanBoardStore, "get">;
  enqueue: (params: EnqueueResolverParams) => Promise<{ sessionId?: string; queued: boolean; error?: string }>;
}

function seenSet(): Set<string> {
  const g = globalThis as Record<string, unknown>;
  return (g[DEDUPE_KEY] ??= new Set<string>()) as Set<string>;
}

/** Clear the dedupe set (tests; simulates a restart). */
export function resetSupersededWakeForTests(): void {
  seenSet().clear();
}

function doneColumnOf(board: Pick<KanbanBoard, "columns">): string | undefined {
  return board.columns.find((column) => column.stage === "done")?.id
    ?? board.columns.find((column) => column.id === "done")?.id;
}

function refMatches(ref: unknown, cardId: string): boolean {
  if (typeof ref !== "string") return false;
  const value = ref.trim();
  return value.length > 0 && (value === cardId || value === cardId.slice(0, 8));
}

export async function wakeSupersededBlockedCards(
  deps: SupersededWakeDeps,
  data: Partial<ColumnTransitionData> | undefined,
): Promise<void> {
  try {
    if (!data?.boardId || !data.cardId || !data.toColumnId || !data.workspaceId) return;
    if (data.fromColumnId === data.toColumnId) return;
    const board = await deps.kanbanBoardStore.get(data.boardId);
    if (!board) return;
    const doneId = doneColumnOf(board);
    if (!doneId || data.toColumnId !== doneId) return;
    const blockedId = blockedColumnOf(board);
    if (!blockedId) return;

    const tasks = await deps.taskStore.listByWorkspace(data.workspaceId);
    const hits = tasks.filter((task) =>
      task.id !== data.cardId
      && task.columnId === blockedId
      && WAKE_CATEGORIES.has(String(task.attentionResolution?.category))
      && refMatches(task.attentionResolution?.ref, data.cardId as string));
    if (hits.length === 0) return;

    const blockedColumn = board.columns.find((column) => column.id === blockedId);
    const steps = blockedColumn?.automation?.steps ?? [];
    const stepIndex = steps.findIndex((step) => step.specialistId === BLOCKED_RESOLVER_SPECIALIST_ID);
    const step = stepIndex >= 0 ? steps[stepIndex] : undefined;
    if (!step) {
      console.warn(`[SupersededWake] Blocked column of board ${board.id} has no ${BLOCKED_RESOLVER_SPECIALIST_ID} step; skip`);
      return;
    }

    const seen = seenSet();
    for (const task of hits) {
      const key = `${task.id}:${data.cardId}`;
      // Claim before the first await: concurrent deliveries of one transition must not both pass.
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const result = await deps.enqueue({
          task,
          expectedColumnId: blockedId,
          step,
          stepIndex,
          adoptLaneRun: true,
          ignoreExistingTrigger: true,
        });
        if (result.error?.startsWith("blocked-resolver-guard:")) {
          console.info(`[SupersededWake] ${task.id} not woken for ${data.cardId}: ${result.error}`);
        } else if (result.error) {
          seen.delete(key);
          console.warn(`[SupersededWake] wake of ${task.id} for ${data.cardId} failed: ${result.error}`);
        }
      } catch (error) {
        seen.delete(key);
        console.warn(`[SupersededWake] wake of ${task.id} for ${data.cardId} threw:`, error);
      }
    }
  } catch (error) {
    console.warn("[SupersededWake] failed:", error);
  }
}

/** The eventBus subscriber body: only COLUMN_TRANSITION events matter. */
export function handleSupersededWakeEvent(deps: SupersededWakeDeps, event: AgentEvent): void {
  if (event.type !== AgentEventType.COLUMN_TRANSITION) return;
  void wakeSupersededBlockedCards(deps, event.data as unknown as ColumnTransitionData);
}
