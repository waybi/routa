/**
 * Rerun for interrupted cards on the "Needs you" page. Pure apart from the
 * injected `request`: builds the same PATCH /api/tasks/<id> retryTrigger body
 * as the board's retryTaskTrigger, classifies the reply, and runs a batch one
 * card at a time (GET the fresh card → recheck with isTaskInterrupted →
 * PATCH), so a batch never starts two agents for one card or runs in parallel.
 */

import { resolveEffectiveTaskAutomation } from "@/core/kanban/effective-task-automation";
import type { KanbanBoardInfo, TaskInfo } from "../types";
import { isTaskInterrupted } from "../kanban/kanban-attention-rules";
import { resolveKanbanBoardAutoProviderId } from "../kanban/kanban-tab-helpers";

export interface RetryTriggerBody {
  retryTrigger: true;
  retryProviderId?: string;
}

export type RetryBoard = Pick<KanbanBoardInfo, "columns" | "autoProviderId">;

/**
 * Same rule as kanban-tab.tsx retryTaskTrigger: send the board's
 * autoProviderId only when the card runs on lane automation (not a card
 * override, not a2a) whose provider came from the board's auto provider.
 * The overview has no ACP selection, so only board.autoProviderId counts.
 */
export function buildRetryTriggerBody(task: TaskInfo, board: RetryBoard | null | undefined): RetryTriggerBody {
  const autoProviderId = resolveKanbanBoardAutoProviderId(board, undefined);
  const effective = resolveEffectiveTaskAutomation(task, board?.columns ?? [], undefined, { autoProviderId });
  const retryProviderId = effective.source !== "card"
    && effective.transport !== "a2a"
    && effective.providerSource === "auto"
    && autoProviderId
    ? autoProviderId
    : undefined;
  return retryProviderId ? { retryTrigger: true, retryProviderId } : { retryTrigger: true };
}

export type RetryRowState =
  | { phase: "starting" }
  | { phase: "started" }
  | { phase: "queued" }
  | { phase: "skipped" }
  | { phase: "failed"; error: string };

function errorText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Reply of PATCH retryTrigger (route.ts): a started run sets
 * task.triggerSessionId; a queued one clears both it and lastSyncError; a
 * start error is written to task.lastSyncError.
 */
export function classifyRetryResponse(ok: boolean, json: unknown, status?: number): RetryRowState {
  const body = (json ?? {}) as { error?: unknown; task?: Partial<TaskInfo> };
  if (!ok) return { phase: "failed", error: errorText(body.error) ?? `HTTP ${status ?? "error"}` };
  if (errorText(body.task?.triggerSessionId)) return { phase: "started" };
  const lastSyncError = errorText(body.task?.lastSyncError);
  if (lastSyncError) return { phase: "failed", error: lastSyncError };
  return { phase: "queued" };
}

export interface RetryTarget {
  taskId: string;
  board: RetryBoard | undefined;
}

export interface RetrySummary {
  started: number;
  queued: number;
  skipped: number;
  failed: number;
}

export interface SerialRetryDeps {
  /** Path is "/tasks/<id>" (no /api prefix); the caller resolves it. */
  request: (path: string, init?: RequestInit) => Promise<Response>;
  onRowState: (taskId: string, state: RetryRowState) => void;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function retryOne(target: RetryTarget, deps: SerialRetryDeps): Promise<RetryRowState> {
  const path = `/tasks/${encodeURIComponent(target.taskId)}`;
  const fresh = await deps.request(path, { cache: "no-store" });
  const freshJson = (await readJson(fresh)) as { error?: unknown; task?: TaskInfo };
  if (!fresh.ok) return { phase: "failed", error: errorText(freshJson.error) ?? `HTTP ${fresh.status}` };
  const task = freshJson.task;
  // Recheck on the card as it is now, not as the page loaded it.
  if (!task || !isTaskInterrupted(task)) return { phase: "skipped" };
  const response = await deps.request(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildRetryTriggerBody(task, target.board)),
  });
  return classifyRetryResponse(response.ok, await readJson(response), response.status);
}

/** One card after another; a failed card never stops the rest. */
export async function runSerialRetries(targets: readonly RetryTarget[], deps: SerialRetryDeps): Promise<RetrySummary> {
  const summary: RetrySummary = { started: 0, queued: 0, skipped: 0, failed: 0 };
  for (const target of targets) {
    deps.onRowState(target.taskId, { phase: "starting" });
    let state: RetryRowState;
    try {
      state = await retryOne(target, deps);
    } catch (error) {
      state = { phase: "failed", error: error instanceof Error ? error.message : String(error) };
    }
    if (state.phase !== "starting") summary[state.phase] += 1;
    deps.onRowState(target.taskId, state);
  }
  return summary;
}
