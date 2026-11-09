/**
 * Delivery gate for the orchestrator's auto-advance (card 29482e39).
 *
 * Manual PATCH moves and the agent `move_card` tool both check the target
 * column's `deliveryRules` before a card enters it. The orchestrator's
 * auto-advance used to skip that check, so a card whose Review lane finished
 * could slip into Done with no commits (Coder board card c53dc6c1, 11-09).
 *
 * This gate runs the same check (same readiness probe, same rule evaluation,
 * same `attentionResolutionAfterMove` helper as `move_card`). When it fails
 * the card stays where it is: `lastSyncError` and a card comment record why.
 */
import type { KanbanColumn } from "../models/kanban";
import type { Task } from "../models/task";
import { attentionResolutionAfterMove } from "../models/task-attention-resolution";
import type { TaskStore } from "../store/task-store";
import { appendTaskComment, appendTaskCommentEntry } from "./task-comment-log";
import {
  buildTaskDeliveryReadiness,
  buildTaskDeliveryTransitionErrorFromRules,
  hasDeliveryRules,
} from "./task-delivery-readiness";

/** Prefix of every auto-advance block note (lastSyncError and the card comment). */
export const AUTO_ADVANCE_BLOCKED_PREFIX = "自动推进被拦：";

/** Returns true when the move was blocked (the card must stay in `fromColumn`). */
export type AutoAdvanceGate = (
  task: Task,
  fromColumn: KanbanColumn,
  nextColumn: KanbanColumn,
) => Promise<boolean>;

type DeliverySystem = Parameters<typeof buildTaskDeliveryReadiness>[1];

export interface AutoAdvanceDeliveryGateDeps {
  system: DeliverySystem;
  taskStore: Pick<TaskStore, "save">;
  /** Tells the board the card changed (optional). */
  notify?: (task: Task) => void;
}

/** The rule error for moving `task` into `nextColumn`, or null when the move may proceed. */
async function resolveAutoAdvanceDeliveryError(
  task: Task,
  fromColumn: KanbanColumn,
  nextColumn: KanbanColumn,
  system: DeliverySystem,
): Promise<string | null> {
  const rules = nextColumn.automation?.deliveryRules;
  if (!hasDeliveryRules(rules)) return null;
  const resolutionAfterMove = attentionResolutionAfterMove(task.attentionResolution, fromColumn.id, nextColumn.id);
  try {
    const readiness = await buildTaskDeliveryReadiness(
      { ...task, attentionResolution: resolutionAfterMove },
      system,
    );
    return buildTaskDeliveryTransitionErrorFromRules(readiness, nextColumn.name, rules, nextColumn.stage);
  } catch (error) {
    // Fail closed: the orchestrator swallows errors, so an unhandled throw
    // would leave the card stuck with no reason on it.
    const message = error instanceof Error ? error.message : String(error);
    return `检查出错：${message}`;
  }
}

export function createAutoAdvanceDeliveryGate(deps: AutoAdvanceDeliveryGateDeps): AutoAdvanceGate {
  return async (task, fromColumn, nextColumn) => {
    const error = await resolveAutoAdvanceDeliveryError(task, fromColumn, nextColumn, deps.system);
    if (!error) return false;

    const note = `${AUTO_ADVANCE_BLOCKED_PREFIX}${error}`;
    task.lastSyncError = note;
    // Same dedupe as move_card's block comment: a repeated trigger
    // (restart sweep, revive) does not add the same note again.
    const lastComment = task.comments?.[task.comments.length - 1]?.body?.trim();
    if (lastComment !== note) {
      task.comment = appendTaskComment(task.comment, note);
      task.comments = appendTaskCommentEntry(task.comments, note, { source: undefined });
    }
    task.updatedAt = new Date();
    await deps.taskStore.save(task);
    deps.notify?.(task);
    return true;
  };
}
