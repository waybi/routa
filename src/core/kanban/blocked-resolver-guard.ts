/**
 * Hard gate before a Blocked resolver session starts (card 59f5b059).
 *
 * Every way a resolver session starts (column transition, manual move_card,
 * PATCH retryTrigger, revive, interrupted-lane resume) goes through
 * enqueueKanbanTaskSession, which calls this gate. Two gates, checked before
 * the session is created:
 *
 * - patch-chain: the card is a patch card and it is in Blocked because the
 *   main pusher hit a rebase conflict → straight to the owner (no second
 *   patch card). Not enough evidence → not triggered; the rounds gate stays.
 * - rounds: the same reason already used MAX_AUTO_RESOLUTION_ROUNDS rounds,
 *   counted as the larger of the record comments and the resolver sessions.
 *
 * A hit writes needs_owner and starts nothing; the card stays in Blocked.
 */

import type { KanbanBoard } from "../models/kanban";
import type { Task, TaskLaneSession } from "../models/task";
import { hydrateTaskComments } from "../models/task";
import { isAttentionResolutionInEffect } from "../models/task-attention-resolution";
import { blockedColumnOf, roundsGateConclusion } from "./attention-to-blocked";
import {
  BLOCKED_RESOLVER_SPECIALIST_ID,
  DEFAULT_ATTENTION_REASON,
  MAX_AUTO_RESOLUTION_ROUNDS,
  countResolverSessions,
  isPatchCard,
  resolutionRoundsOf,
} from "./auto-resolution-record";

export const MAIN_PUSHER_SPECIALIST_ID = "kanban-main-pusher";

export type BlockedResolverGate = "rounds" | "patch-chain";

export type BlockedResolverGuardDecision =
  | { gate: "none" }
  | { gate: BlockedResolverGate; reason: string; rounds: number; conclusion: string };

type GuardTask = Pick<Task, "id" | "columnId">
  & Partial<Pick<Task, "title" | "objective" | "lastSyncError" | "laneSessions" | "comments" | "comment">>;

/**
 * The attention reason of the card's Blocked stay: the `attention:<reason>`
 * prefix of lastSyncError. A started run clears that prefix and so does
 * retryTrigger, so without one the latest Blocked run's recorded reason
 * carries on; with neither, `attention:blocked`.
 */
export function resolveBlockedAttentionReason(
  task: Partial<Pick<Task, "lastSyncError" | "laneSessions">>,
  blockedColumnId: string,
): string {
  const prefixed = /^attention:[A-Za-z_]+/u.exec((task.lastSyncError ?? "").trim())?.[0];
  if (prefixed) return prefixed;
  const inherited = [...(task.laneSessions ?? [])]
    .reverse()
    .find((session) => session.columnId === blockedColumnId && session.attentionReason);
  return inherited?.attentionReason ?? DEFAULT_ATTENTION_REASON;
}

function doneColumnOf(board: Pick<KanbanBoard, "columns">): string | undefined {
  return board.columns.find((column) => column.stage === "done")?.id
    ?? board.columns.find((column) => column.id === "done")?.id;
}

/**
 * The main pusher hit a rebase conflict right before the card entered
 * Blocked: the latest non-Blocked run is the Done column's main pusher, and
 * it failed / timed out, or a comment of that run (or written since it
 * started) mentions a conflict.
 */
export function hasPushConflictEvidence(
  task: Partial<Pick<Task, "laneSessions" | "comments" | "comment">>,
  board: Pick<KanbanBoard, "columns">,
  blockedColumnId: string,
): boolean {
  const doneColumnId = doneColumnOf(board);
  const sessions = task.laneSessions ?? [];
  let pusher: TaskLaneSession | undefined;
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    if (sessions[index]?.columnId === blockedColumnId) continue;
    pusher = sessions[index];
    break;
  }
  if (!pusher || !doneColumnId || pusher.columnId !== doneColumnId) return false;
  if (pusher.specialistId !== MAIN_PUSHER_SPECIALIST_ID) return false;
  if (pusher.status === "failed" || pusher.status === "timed_out") return true;
  const pusherStartedAt = Date.parse(pusher.startedAt);
  return hydrateTaskComments(task.comments, task.comment).some((comment) =>
    (comment.sessionId === pusher.sessionId
      || (Number.isFinite(pusherStartedAt) && Date.parse(comment.createdAt) >= pusherStartedAt))
    && /冲突|conflict/iu.test(comment.body ?? ""));
}

/** Pure: should this start of `specialistId` in the card's column be stopped? */
export function evaluateBlockedResolverGuard(params: {
  task: GuardTask;
  board: Pick<KanbanBoard, "columns">;
  specialistId?: string;
}): BlockedResolverGuardDecision {
  const { task, board } = params;
  const blockedColumnId = blockedColumnOf(board);
  if (!blockedColumnId || task.columnId !== blockedColumnId) return { gate: "none" };
  if (params.specialistId !== BLOCKED_RESOLVER_SPECIALIST_ID) return { gate: "none" };
  const reason = resolveBlockedAttentionReason(task, blockedColumnId);
  const sessionCount = countResolverSessions(task.laneSessions, blockedColumnId, reason);
  const rounds = resolutionRoundsOf(hydrateTaskComments(task.comments, task.comment), reason, sessionCount);
  if (isPatchCard(task) && hasPushConflictEvidence(task, board, blockedColumnId)) {
    return {
      gate: "patch-chain",
      reason,
      rounds,
      conclusion: `补丁链闸：补丁卡推送再遇变基冲突（${reason}，已处理 ${rounds} 轮），不再建补丁卡，转老板处理`,
    };
  }
  if (rounds >= MAX_AUTO_RESOLUTION_ROUNDS) {
    return { gate: "rounds", reason, rounds, conclusion: roundsGateConclusion(reason, rounds) };
  }
  return { gate: "none" };
}

/**
 * Record a gate hit: needs_owner on the card (an in-effect needs_owner keeps
 * its conclusion), nothing else changed; one log line with card id and gate.
 */
export async function applyBlockedResolverGuard(
  taskStore: { save(task: Task): Promise<void> },
  task: Task,
  decision: Exclude<BlockedResolverGuardDecision, { gate: "none" }>,
  now: number = Date.now(),
): Promise<void> {
  const keep = task.attentionResolution?.category === "needs_owner"
    && isAttentionResolutionInEffect(task.attentionResolution, task);
  if (!keep) {
    task.attentionResolution = {
      category: "needs_owner",
      conclusion: decision.conclusion,
      resolvedAt: new Date(now).toISOString(),
    };
    task.updatedAt = new Date(now);
    await taskStore.save(task);
  }
  console.warn(
    `[BlockedResolverGuard] card ${task.id} blocked by ${decision.gate} (${decision.reason}, ${decision.rounds} rounds); no resolver session started`,
  );
}
