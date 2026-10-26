/**
 * Route cards that need attention to the Blocked lane (card 64f2e31c).
 *
 * Runs only after a lane step ended (the orchestrator's lane-end hook), never
 * on a read path. The judgement is collectTaskAttentionItems (the same rule
 * the inbox shows); this module only decides which of its kinds go to
 * Blocked and moves the card through the regular move_card entry, so the
 * column-transition event and gates are the same as any other move.
 *
 * - doneFailed / noReport / unmerged → Blocked.
 * - interrupted → Blocked only once the existing retry is spent: two failed
 *   runs in a row in the column, or an environment failure (never retried).
 *   A rate-limited run with a pending retryAfterAt waits for its rerun.
 * - The same reason already handled for MAX_AUTO_RESOLUTION_ROUNDS rounds →
 *   not moved; the card is marked needs_owner instead (no resolver restart).
 */

import type { KanbanBoard } from "../models/kanban";
import type { Task } from "../models/task";
import { hydrateTaskComments } from "../models/task";
import type { TaskAttentionResolution } from "../models/task-attention-resolution";
import {
  boardHasMainPusher,
  collectTaskAttentionItems,
  type AttentionTask,
  type KanbanAttentionKind,
} from "./attention-rules";
import { MAX_AUTO_RESOLUTION_ROUNDS, shouldEscalateToOwner } from "./auto-resolution-record";
import { summarizeTaskCompletionReport } from "./completion-report";

export const ATTENTION_SYNC_ERROR_PREFIX = "attention:";
export const BLOCKED_ROUTED_KINDS: readonly KanbanAttentionKind[] = ["doneFailed", "noReport", "unmerged", "interrupted"];

export type AttentionLanding = { landedOnBase: boolean | null; commitsSinceBase: number };

export type AttentionRoutingDecision =
  | { action: "none" }
  | { action: "block"; kind: KanbanAttentionKind; reason: string; blockedColumnId: string }
  | { action: "escalate"; kind: KanbanAttentionKind; reason: string };

function toIso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** Server Task → the shape the shared attention rules read. */
export function toAttentionTask(task: Task, landing?: AttentionLanding): AttentionTask {
  const comments = hydrateTaskComments(task.comments, task.comment);
  return {
    id: task.id,
    columnId: task.columnId,
    triggerSessionId: task.triggerSessionId,
    laneSessions: task.laneSessions ?? [],
    createdAt: toIso(task.createdAt),
    updatedAt: toIso(task.updatedAt),
    completionReport: summarizeTaskCompletionReport(comments),
    completionSummary: task.completionSummary,
    deliveryLanding: landing,
    attentionResolution: task.attentionResolution ?? null,
  };
}

/** True when the column's automatic retry is spent (or never applies). */
export function isInterruptedRetrySpent(task: Pick<Task, "columnId" | "laneSessions">, now: number): boolean {
  const sessions = task.laneSessions ?? [];
  const trailing = [];
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    if (sessions[index]?.columnId !== task.columnId) break;
    trailing.unshift(sessions[index]);
  }
  const latest = trailing[trailing.length - 1];
  if (!latest) return false;
  if (latest.recoveryReason === "rate_limited" && latest.retryAfterAt && Date.parse(latest.retryAfterAt) > now) {
    return false;
  }
  if (latest.recoveryReason === "environment_failure") return true;
  return trailing.filter((session) => session.status === "failed" || session.status === "timed_out").length >= 2;
}

function blockedColumnOf(board: Pick<KanbanBoard, "columns">): string | undefined {
  return board.columns.find((column) => column.stage === "blocked")?.id
    ?? board.columns.find((column) => column.id === "blocked")?.id;
}

export function attentionReason(kind: KanbanAttentionKind): string {
  return `${ATTENTION_SYNC_ERROR_PREFIX}${kind}`;
}

/** Pure decision for one card after a lane step ended. */
export function decideAttentionRouting(
  task: Task,
  board: Pick<KanbanBoard, "columns">,
  options: { now: number; landing?: AttentionLanding },
): AttentionRoutingDecision {
  const blockedColumnId = blockedColumnOf(board);
  if (!blockedColumnId || task.columnId === blockedColumnId) return { action: "none" };
  if (task.attentionResolution?.category === "needs_owner") return { action: "none" };
  const items = collectTaskAttentionItems(toAttentionTask(task, options.landing), {
    hasMainPusher: boardHasMainPusher(board),
    now: options.now,
  });
  const item = items.find((entry) => BLOCKED_ROUTED_KINDS.includes(entry.kind));
  if (!item) return { action: "none" };
  if (item.kind === "interrupted" && !isInterruptedRetrySpent(task, options.now)) return { action: "none" };
  const reason = attentionReason(item.kind);
  if (shouldEscalateToOwner(hydrateTaskComments(task.comments, task.comment), reason)) {
    return { action: "escalate", kind: item.kind, reason };
  }
  return { action: "block", kind: item.kind, reason, blockedColumnId };
}

export interface AttentionRoutingDeps {
  taskStore: { get(id: string): Promise<Task | undefined>; save(task: Task): Promise<void> };
  kanbanBoardStore: { get(id: string): Promise<KanbanBoard | undefined> };
  /** The regular move entry (KanbanTools.moveCard): emits the transition, runs the gates. */
  moveCard(params: { cardId: string; targetColumnId: string }): Promise<{ success: boolean; error?: string }>;
  probeLanding?(task: Task): Promise<AttentionLanding | undefined>;
  now?(): number;
}

/**
 * The lane-end hook: route one card. Never throws; returns what it did.
 * Writes `attention:<kind>` into lastSyncError before the move, and restores
 * the previous value when the move is rejected.
 */
export async function routeAttentionToBlocked(
  deps: AttentionRoutingDeps,
  cardId: string,
): Promise<AttentionRoutingDecision> {
  try {
    const task = await deps.taskStore.get(cardId);
    if (!task?.boardId) return { action: "none" };
    const board = await deps.kanbanBoardStore.get(task.boardId);
    if (!board) return { action: "none" };
    const now = deps.now?.() ?? Date.now();
    const landing = task.columnId === "done" ? await deps.probeLanding?.(task) : undefined;
    const decision = decideAttentionRouting(task, board, { now, landing });
    if (decision.action === "none") return decision;

    if (decision.action === "escalate") {
      const resolution: TaskAttentionResolution = {
        category: "needs_owner",
        conclusion: `${decision.reason} 已自动处理 ${MAX_AUTO_RESOLUTION_ROUNDS} 轮仍未解决，转老板处理`,
        resolvedAt: new Date(now).toISOString(),
      };
      task.attentionResolution = resolution;
      task.updatedAt = new Date(now);
      await deps.taskStore.save(task);
      return decision;
    }

    const previousError = task.lastSyncError;
    task.lastSyncError = previousError?.trim()
      ? `${decision.reason} — ${previousError.replace(/^attention:[A-Za-z]+ — /u, "")}`
      : decision.reason;
    await deps.taskStore.save(task);
    const moved = await deps.moveCard({ cardId, targetColumnId: decision.blockedColumnId });
    if (!moved.success) {
      const latest = await deps.taskStore.get(cardId);
      if (latest) {
        latest.lastSyncError = previousError;
        await deps.taskStore.save(latest);
      }
      console.warn(`[AttentionRouting] Could not move card ${cardId} to Blocked: ${moved.error ?? "unknown error"}`);
      return { action: "none" };
    }
    return decision;
  } catch (error) {
    console.warn(`[AttentionRouting] Failed to route card ${cardId}:`, error);
    return { action: "none" };
  }
}
