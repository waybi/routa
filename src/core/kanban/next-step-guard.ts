/**
 * Guard before a lane starts its next step in the same column (复盘 L395).
 *
 * handleAgentCompletion reads the card once, then awaits several things
 * before startNextAutomationStep opens the next step's session. Meanwhile a
 * reviewer may have moved the card away (e.g. back to dev), or another live
 * session may already be working on the card. Starting the next step anyway
 * re-runs a gate (a high-risk review twice) and leaves extra sessions.
 *
 * The orchestrator calls skipStaleNextStep right before it saves the card and
 * opens the session: it reads the card again from the task store and skips
 * the step when the card left the column or another session is live. A
 * skipped step saves the fresh card (never the copy read earlier, which would
 * put the card back into the old column), keeps the finished step's lane
 * record, writes the reason to lastSyncError and settles the automation.
 * An allowed step returns the fresh card; the orchestrator saves on it with
 * adoptFreshCard (复盘 L401), so a hold, objective or comment written while
 * it awaited is not overwritten by the earlier copy.
 *
 * This only narrows the window between the check and the session start; it
 * takes no lock.
 *
 * The same module notes a lane session that ended within 30 seconds without
 * any agent message or tool call: one sentence on lastSyncError, appended to
 * any reason already there. The note never triggers a rerun.
 */
import type { AgentEvent } from "../events/event-bus";
import type { Task } from "../models/task";
import type { TaskStore } from "../store/task-store";
import { isSessionActivelyRunning } from "./lane-live-session";
import { getTaskLaneSession, upsertTaskLaneSession } from "./task-lane-history";

export const COMPLETED_AUTOMATION_CLEANUP_DELAY_MS = 30_000;
export const QUICK_EXIT_MAX_SECONDS = 30;

/** Session updates that count as output of the agent. */
const OUTPUT_UPDATES = new Set(["agent_message", "agent_message_chunk", "tool_call", "tool_call_update"]);

export type NextStepDecision =
  | { allowed: true }
  | { allowed: false; kind: "left_column" | "live_session"; reason: string; liveSessionId?: string };

/**
 * The single rule: the card (read again) must still be in `columnId`, and no
 * lane record other than `finishedSessionId` may be running on a live process
 * (any column). A running record whose process is dead is a zombie and does
 * not block. A liveness check that throws counts as not live.
 */
export function decideNextStep(params: {
  task: Pick<Task, "columnId" | "laneSessions"> | undefined;
  columnId: string;
  finishedSessionId?: string;
  isActive: (sessionId: string) => boolean;
}): NextStepDecision {
  const { task, columnId, finishedSessionId, isActive } = params;
  if (!task || task.columnId !== columnId) {
    const where = task ? `现在在 ${task.columnId ?? "未知列"}` : "卡已删除";
    return { allowed: false, kind: "left_column", reason: `跳过：卡已离开 ${columnId}（${where}），不再启动本列下一步` };
  }
  for (const entry of task.laneSessions ?? []) {
    if (entry.status !== "running" || !entry.sessionId || entry.sessionId === finishedSessionId) continue;
    if (!safeIsActive(isActive, entry.sessionId)) continue;
    return {
      allowed: false,
      kind: "live_session",
      liveSessionId: entry.sessionId,
      reason: `跳过：已有会话 ${entry.sessionId} 在跑（${entry.columnId ?? "未知列"}），不再启动 ${columnId} 的下一步`,
    };
  }
  return { allowed: true };
}

function safeIsActive(isActive: (sessionId: string) => boolean, sessionId: string): boolean {
  try {
    return isActive(sessionId);
  } catch (error) {
    console.warn(`[NextStepGuard] Liveness check of session ${sessionId} failed; treated as not running:`, error);
    return false;
  }
}

/** The in-memory session store, as far as the quick-exit note needs it. */
export interface QuickExitSessionSource {
  getHistory(sessionId: string): Array<{ update?: Record<string, unknown> }>;
  getSession(sessionId: string): { createdAt?: string } | undefined;
  getSessionActivity(sessionId: string): { terminalAt?: string; terminalReason?: string } | undefined;
}

/** Pure rule: ended in under 30 s with no agent message or tool call. */
export function isQuickEmptyExit(aliveMs: number, updateKinds: Array<unknown>): boolean {
  return Number.isFinite(aliveMs) && aliveMs >= 0 && aliveMs < QUICK_EXIT_MAX_SECONDS * 1000
    && !updateKinds.some((kind) => typeof kind === "string" && OUTPUT_UPDATES.has(kind));
}

function describeStop(history: Array<{ update?: Record<string, unknown> }>, event?: AgentEvent, terminalReason?: string): string {
  if (typeof event?.data?.stopReason === "string") return `stopReason=${event.data.stopReason}`;
  const error = typeof event?.data?.error === "string" ? event.data.error : "";
  const exitCode = /code=(-?\d+)/.exec(error)?.[1];
  if (exitCode !== undefined) return `退出码=${exitCode}`;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const update = history[index].update;
    if (update?.sessionUpdate === "turn_complete" && typeof update.stopReason === "string") return `stopReason=${update.stopReason}`;
  }
  if (terminalReason) return `结束原因=${terminalReason}`;
  if (error) return `错误=${error.slice(0, 120)}`;
  return event ? `事件=${event.type}` : "stopReason=未知";
}

/** The note for `sessionId`, or undefined when it is not a quick empty exit (or its data cannot be read). */
export function buildQuickExitNote(
  task: Pick<Task, "laneSessions">,
  sessionId: string,
  sessions: QuickExitSessionSource,
  options: { event?: AgentEvent; now?: Date } = {},
): string | undefined {
  try {
    // A session the store does not know (e.g. after a restart) cannot be judged: no note.
    const session = sessions.getSession(sessionId);
    if (!session) return undefined;
    const record = getTaskLaneSession(task as Task, sessionId);
    const activity = sessions.getSessionActivity(sessionId);
    const startedAt = record?.startedAt ?? session.createdAt;
    const endedAt = record?.completedAt ?? activity?.terminalAt ?? (options.now ?? new Date()).toISOString();
    if (!startedAt) return undefined;
    const aliveMs = Date.parse(endedAt) - Date.parse(startedAt);
    const history = sessions.getHistory(sessionId);
    if (!isQuickEmptyExit(aliveMs, history.map((entry) => entry.update?.sessionUpdate))) return undefined;
    const seconds = Math.floor(aliveMs / 1000);
    return `会话 ${sessionId} 存活 ${seconds} 秒无输出即结束（${describeStop(history, options.event, activity?.terminalReason)}）`;
  } catch (error) {
    console.warn(`[NextStepGuard] Could not read session ${sessionId} for the quick-exit note:`, error);
    return undefined;
  }
}

/** Append the quick-exit note to lastSyncError, keeping any reason already there; once per session. */
export function appendQuickExitNote(
  task: Task,
  sessionId: string | undefined,
  sessions: QuickExitSessionSource,
  options: { event?: AgentEvent; now?: Date } = {},
): void {
  if (!sessionId) return;
  const note = buildQuickExitNote(task, sessionId, sessions, options);
  if (!note) return;
  const existing = task.lastSyncError?.trim();
  if (existing?.includes(`会话 ${sessionId} 存活`)) return;
  task.lastSyncError = existing ? `${existing}；${note}` : note;
}

/** Drop a finished automation from the active map after a delay, unless a newer one replaced it. */
export function scheduleAutomationCleanup<T>(automations: Map<string, T>, cardId: string, automation: T): void {
  setTimeout(() => {
    if (automations.get(cardId) === automation) automations.delete(cardId);
  }, COMPLETED_AUTOMATION_CLEANUP_DELAY_MS);
}

interface GuardedAutomation {
  columnId: string;
  sessionId?: string;
  status: string;
}

/**
 * Keep the finished step's end (written on the earlier copy `stale`) on the
 * fresh card: its lane record, its id in sessionIds, and a triggerSessionId
 * that still points at it is cleared.
 */
export function carryFinishedStepEnd(fresh: Task, stale: Task, finishedSessionId: string | undefined): void {
  if (!finishedSessionId) return;
  const finishedRecord = getTaskLaneSession(stale, finishedSessionId);
  if (finishedRecord) upsertTaskLaneSession(fresh, { ...finishedRecord });
  const sessionIds = fresh.sessionIds ?? [];
  if (!sessionIds.includes(finishedSessionId)) fresh.sessionIds = [...sessionIds, finishedSessionId];
  if (fresh.triggerSessionId === finishedSessionId) fresh.triggerSessionId = undefined;
}

/** Make `target` hold exactly the fields of `source` (keys missing on source are deleted). */
export function replaceTaskContents(target: Task, source: Task): void {
  if (target === source) return;
  const record = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(key in source)) delete record[key];
  }
  Object.assign(target, source);
}

/**
 * 复盘 L401: the card an orchestrator path saves after awaits. Every field is
 * taken from `fresh` (labels such as hold, objective, comments, columnId ...)
 * except the finished step's end (see carryFinishedStepEnd), lastSyncError and
 * updatedAt. `task` (the copy read earlier, still used by the caller) is
 * replaced in place, so later saves of it do not write the old fields back.
 */
export function adoptFreshCard(
  task: Task,
  fresh: Task,
  finishedSessionId: string | undefined,
  lastSyncError: string | undefined,
  now: Date = new Date(),
): void {
  carryFinishedStepEnd(fresh, task, finishedSessionId);
  fresh.lastSyncError = lastSyncError;
  fresh.updatedAt = now;
  replaceTaskContents(task, fresh);
}

/**
 * Read the card again right before saving the copy read when the step ended,
 * and save on that (see adoptFreshCard); the copy's lastSyncError is kept. A
 * failed read (or a deleted card) leaves the copy as it is.
 */
export async function adoptFreshCardBeforeSave(
  taskStore: TaskStore,
  cardId: string,
  task: Task,
  finishedSessionId: string | undefined,
): Promise<void> {
  let fresh: Task | undefined;
  try {
    fresh = await taskStore.get(cardId);
  } catch (error) {
    console.warn(`[NextStepGuard] Could not read card ${cardId} again before saving; saving the earlier copy:`, error);
  }
  if (fresh) adoptFreshCard(task, fresh, finishedSessionId, task.lastSyncError);
  else task.updatedAt = new Date();
}

/** skip: the step must not start. fresh: the card read again (undefined when that read threw). */
export type NextStepGuardResult = { skip: true } | { skip: false; fresh?: Task };

/**
 * Read the card again and decide; on skip, settle and return { skip: true }
 * (the caller returns "skipped" and must not start the step). On allow, the
 * quick-exit note of the finished session is only logged and the fresh card is
 * returned for the caller to save on.
 */
export async function skipStaleNextStep<T extends GuardedAutomation>(params: {
  taskStore: TaskStore;
  task: Task;
  cardId: string;
  automation: T;
  automations: Map<string, T>;
  sessions: QuickExitSessionSource;
  isActive?: (sessionId: string) => boolean;
}): Promise<NextStepGuardResult> {
  const { taskStore, task, cardId, automation, automations, sessions } = params;
  const finishedSessionId = automation.sessionId;
  let fresh: Task | undefined;
  try {
    fresh = await taskStore.get(cardId);
  } catch (error) {
    console.warn(`[NextStepGuard] Could not read card ${cardId} again; starting the next step as before:`, error);
    return { skip: false };
  }
  const decision = decideNextStep({
    task: fresh,
    columnId: automation.columnId,
    finishedSessionId,
    isActive: params.isActive ?? ((sessionId) => isSessionActivelyRunning(sessionId)),
  });
  if (decision.allowed) {
    // The next session's start clears lastSyncError, and a note left there
    // would hide that step's own failure message: log it only.
    const note = finishedSessionId ? buildQuickExitNote(task, finishedSessionId, sessions) : undefined;
    if (note) console.info(`[NextStepGuard] Card ${cardId}: ${note}`);
    return { skip: false, fresh };
  }

  console.info(`[NextStepGuard] Card ${cardId}: ${decision.reason}`);
  automation.status = "completed";
  scheduleAutomationCleanup(automations, cardId, automation);
  if (!fresh) return { skip: true };
  // Keep the finished step's end (written on the earlier copy) on the fresh card.
  carryFinishedStepEnd(fresh, task, finishedSessionId);
  // Keep a reason already on the card (e.g. written by the lane it moved to).
  const existing = fresh.lastSyncError?.trim();
  fresh.lastSyncError = !existing ? decision.reason
    : existing.includes(decision.reason) ? existing : `${existing}；${decision.reason}`;
  appendQuickExitNote(fresh, finishedSessionId, sessions);
  fresh.updatedAt = new Date();
  try {
    await taskStore.save(fresh);
  } catch (error) {
    console.warn(`[NextStepGuard] Could not save the skip reason on card ${cardId}:`, error);
  }
  return { skip: true };
}
