/**
 * Lane records follow the real end of their session (card 6d8365ca, 复盘 L189).
 *
 * A step's lane record must leave "running" when its session ends, on every
 * path: the orchestrator's normal step end, the paths it skips (a card the
 * user ended, the teardown of a finished card, an automation that already
 * ended, a session it does not follow) and the restart sweep. Every path calls
 * the same idempotent functions here; they only touch a record that is still
 * "running" and never start, kill, recover or advance anything.
 *
 * The session's real outcome comes from its history: the last turn end
 * (turn_complete) or error. "Unknown" is never read as success.
 */
import { AgentEventType, type AgentEvent } from "../events/event-bus";
import type { Task, TaskLaneSessionRecoveryReason, TaskLaneSessionStatus } from "../models/task";
import type { TaskStore } from "../store/task-store";
import { isEnvironmentFailureMessage } from "./environment-failure";
import { getTaskLaneSession, markTaskLaneSessionStatus, upsertTaskLaneSession } from "./task-lane-history";

/** One session update as stored in the session history; `createdAt` only when persisted. */
export interface SessionHistoryEntry {
  update?: Record<string, unknown>;
  createdAt?: string;
}

/** Reads a session's persisted history (oldest first). */
export type ReadSessionEndHistory = (sessionId: string) => Promise<SessionHistoryEntry[]>;

export type SessionOutcome =
  | { kind: "completed"; endedAt?: string }
  | { kind: "failed"; reason: TaskLaneSessionRecoveryReason; endedAt?: string }
  | { kind: "unknown" };

/** The in-memory session store, as far as the outcome needs it. */
export interface LiveSessionHistory {
  getHistory(sessionId: string): SessionHistoryEntry[];
  getSessionActivity(sessionId: string): { terminalAt?: string } | undefined;
}

/** Updates that belong to a turn in progress: after the last turn end they mean a new turn started. */
const TURN_ACTIVITY = new Set([
  "user_message",
  "agent_message",
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
  "tool_call_update",
  "plan",
]);

function isProcessExit(update: Record<string, unknown>): boolean {
  const error = update.error as { code?: unknown } | undefined;
  return error?.code === "process_exited";
}

/**
 * Outcome of the session's latest turn. A process exit right after a turn
 * that ended normally is that turn's end (pusher 435fbeed exited with code 0
 * after its turn); an exit inside a turn, an error, or a cancelled turn is a
 * failure; no turn end at all is unknown.
 */
export function resolveSessionOutcome(entries: SessionHistoryEntry[]): SessionOutcome {
  let exit: SessionHistoryEntry | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const update = entry.update ?? {};
    const kind = update.sessionUpdate;
    if (kind === "turn_complete") {
      return update.stopReason === "cancelled"
        ? { kind: "failed", reason: "turn_cancelled", endedAt: entry.createdAt }
        : { kind: "completed", endedAt: entry.createdAt };
    }
    if (kind === "error") {
      if (isProcessExit(update)) {
        exit ??= entry;
        continue;
      }
      return { kind: "failed", reason: "agent_failed", endedAt: entry.createdAt };
    }
    if (typeof kind === "string" && TURN_ACTIVITY.has(kind)) {
      // A turn was still running when the history ends (or when the process exited).
      return exit ? { kind: "failed", reason: "agent_failed", endedAt: exit.createdAt } : { kind: "unknown" };
    }
  }
  return exit ? { kind: "failed", reason: "agent_failed", endedAt: exit.createdAt } : { kind: "unknown" };
}

export function resolveLiveSessionOutcome(sessions: LiveSessionHistory, sessionId: string): SessionOutcome {
  const outcome = resolveSessionOutcome(sessions.getHistory(sessionId));
  if (outcome.kind === "unknown" || outcome.endedAt) return outcome;
  return { ...outcome, endedAt: sessions.getSessionActivity(sessionId)?.terminalAt };
}

/** Persisted outcome for the restart sweep; a read error counts as unknown. */
export async function resolvePersistedSessionOutcome(
  sessionId: string,
  read: ReadSessionEndHistory | undefined,
): Promise<SessionOutcome> {
  if (!read) return { kind: "unknown" };
  try {
    return resolveSessionOutcome(await read(sessionId));
  } catch (error) {
    console.warn(`[LaneSettlement] Could not read the history of session ${sessionId}:`, error);
    return { kind: "unknown" };
  }
}

/**
 * End a record that is still "running"; a record that already ended is kept
 * as it is (a session raises several end events). Returns whether it changed.
 */
export function endRunningLaneRecord(
  task: Task,
  sessionId: string,
  status: Exclude<TaskLaneSessionStatus, "running">,
  options: { completedAt?: string; recoveryReason?: TaskLaneSessionRecoveryReason } = {},
): boolean {
  if (getTaskLaneSession(task, sessionId)?.status !== "running") return false;
  markTaskLaneSessionStatus(task, sessionId, status, options.completedAt);
  if (options.recoveryReason) {
    upsertTaskLaneSession(task, { sessionId, recoveryReason: options.recoveryReason });
  }
  return true;
}

/** Record an ended session by its persisted outcome; false when the outcome is unknown. */
export function endLaneRecordByOutcome(task: Task, sessionId: string, outcome: SessionOutcome): boolean {
  if (outcome.kind === "completed") {
    return endRunningLaneRecord(task, sessionId, "completed", { completedAt: outcome.endedAt });
  }
  if (outcome.kind === "failed") {
    return endRunningLaneRecord(task, sessionId, "failed", { completedAt: outcome.endedAt, recoveryReason: outcome.reason });
  }
  return false;
}

function isEndFailure(event: AgentEvent): boolean {
  return event.type === AgentEventType.AGENT_FAILED || event.data?.success === false;
}

/**
 * An exit (AGENT_FAILED) of a session whose turn already ended normally is
 * that turn's end; the orchestrator then treats the step as completed.
 */
export function reconcileExitAfterTurnEnd(event: AgentEvent, sessions: LiveSessionHistory): AgentEvent {
  const sessionId = event.data?.sessionId;
  if (event.type !== AgentEventType.AGENT_FAILED || typeof sessionId !== "string") return event;
  if (resolveSessionOutcome(sessions.getHistory(sessionId)).kind !== "completed") return event;
  return {
    ...event,
    type: AgentEventType.AGENT_COMPLETED,
    data: { ...event.data, success: true, stopReason: "end_turn", reconciledFrom: "process_exit" },
  };
}

function endForEvent(
  event: AgentEvent,
  outcome: SessionOutcome,
): { status: Exclude<TaskLaneSessionStatus, "running">; recoveryReason?: TaskLaneSessionRecoveryReason } {
  if (event.type === AgentEventType.AGENT_TIMEOUT) {
    return { status: "timed_out", recoveryReason: "watchdog_inactivity" };
  }
  if (event.type === AgentEventType.AGENT_COMPLETED && event.data?.stopReason === "cancelled") {
    return { status: "failed", recoveryReason: "turn_cancelled" };
  }
  if (!isEndFailure(event) || outcome.kind === "completed") {
    return { status: "completed" };
  }
  const error = event.data?.error;
  return { status: "failed", recoveryReason: isEnvironmentFailureMessage(error) ? "environment_failure" : "agent_failed" };
}

async function findCardWithRunningRecord(
  taskStore: TaskStore,
  workspaceId: string | undefined,
  sessionId: string,
): Promise<string | undefined> {
  if (!workspaceId) return undefined;
  const tasks = await taskStore.listByWorkspace(workspaceId);
  return tasks.find((task) => getTaskLaneSession(task, sessionId)?.status === "running")?.id;
}

/**
 * Settle the lane record of a session the orchestrator does not handle as a
 * step end. `teardown` (a card the user ended, a finished card's teardown):
 * completed when the turn really ended, else transitioned, never failed, so
 * revive cannot re-run a finished card's step (3054a54f). `event`: by the
 * event (completed, failed + reason, timed_out). Only the record changes.
 */
export async function settleEndedLaneSession(params: {
  taskStore: TaskStore;
  sessions: LiveSessionHistory;
  event: AgentEvent;
  mode: "teardown" | "event";
  cardId?: string;
}): Promise<boolean> {
  const { taskStore, sessions, event, mode } = params;
  const sessionId = typeof event.data?.sessionId === "string" ? event.data.sessionId : undefined;
  if (!sessionId) return false;
  const cardId = params.cardId ?? await findCardWithRunningRecord(taskStore, event.workspaceId, sessionId);
  // Read the card again right before writing: an older copy would erase newer lane records.
  const task = cardId ? await taskStore.get(cardId) : undefined;
  if (!task || getTaskLaneSession(task, sessionId)?.status !== "running") return false;

  const outcome = resolveLiveSessionOutcome(sessions, sessionId);
  const end = mode === "teardown"
    ? { status: outcome.kind === "completed" ? "completed" as const : "transitioned" as const }
    : endForEvent(event, outcome);
  const completedAt = end.status === "completed" && outcome.kind === "completed" ? outcome.endedAt : undefined;
  endRunningLaneRecord(task, sessionId, end.status, { completedAt, recoveryReason: "recoveryReason" in end ? end.recoveryReason : undefined });
  task.updatedAt = new Date();
  await taskStore.save(task);
  return true;
}

/**
 * The orchestrator's call for an end it does not handle as a step end (a card
 * the user ended, a queued run, no running automation): records only, never
 * starts, kills, recovers or advances anything, and never throws.
 */
export async function settleUnhandledLaneEnd(
  taskStore: TaskStore,
  sessions: LiveSessionHistory,
  event: AgentEvent,
  mode: "teardown" | "event",
  cardId?: string,
): Promise<void> {
  try {
    await settleEndedLaneSession({ taskStore, sessions, event, mode, cardId });
  } catch (error) {
    console.warn("[WorkflowOrchestrator] Failed to settle the lane record of an ended session:", error);
  }
}

function toIso(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  return undefined;
}

/**
 * Default reader for the restart sweep and revive: the session's persisted
 * messages with their write time. The in-memory store is not hydrated yet
 * at startup, so only the database knows how the session ended.
 */
export async function readPersistedSessionEndHistory(sessionId: string): Promise<SessionHistoryEntry[]> {
  const { getDatabaseDriver } = await import("../db/index");
  const driver = getDatabaseDriver();
  let rows: Array<{ payload: unknown; createdAt: unknown }> = [];
  if (driver === "sqlite") {
    const { getSqliteDatabase } = await import("../db/sqlite");
    const { sessionMessages } = await import("../db/sqlite-schema");
    const { asc, eq } = await import("drizzle-orm");
    rows = await getSqliteDatabase()
      .select({ payload: sessionMessages.payload, createdAt: sessionMessages.createdAt })
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(asc(sessionMessages.messageIndex));
  } else if (driver === "postgres") {
    const { getPostgresDatabase } = await import("../db/index");
    const { sessionMessages } = await import("../db/schema");
    const { asc, eq } = await import("drizzle-orm");
    rows = await getPostgresDatabase()
      .select({ payload: sessionMessages.payload, createdAt: sessionMessages.createdAt })
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, sessionId))
      .orderBy(asc(sessionMessages.messageIndex));
  }
  if (rows.length > 0) {
    return rows.map((row) => ({
      update: (row.payload as { update?: Record<string, unknown> } | null)?.update,
      createdAt: toIso(row.createdAt),
    }));
  }
  const { loadHistoryFromDb } = await import("../acp/session-db-persister");
  return (await loadHistoryFromDb(sessionId)).map((notification) => ({ update: notification.update }));
}
