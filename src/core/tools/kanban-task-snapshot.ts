/**
 * Read-only projection of one Kanban card for the MCP `get_task` tool.
 *
 * Pure functions, no IO. The Rust MCP projection in
 * `crates/routa-server/src/api/mcp_routes/tool_executor/get_task.rs` mirrors
 * the key sets, ordering, truncation, and byte budget implemented here.
 *
 * Size control: comments are append-only and a card can carry hundreds of KB of
 * review history (see the 76 KB echo lesson on `taskToUpdateAck`). Every long
 * text is capped by code points, then the final pretty-printed JSON (the exact
 * text the MCP tool returns) is measured in UTF-8 bytes and the oldest comments
 * are dropped until it fits.
 */
import type { Task, TaskCommentEntry, TaskLaneSession } from "../models/task";

/** Byte budget of the default reply (UTF-8 bytes of the pretty-printed JSON). */
export const TASK_SNAPSHOT_DEFAULT_MAX_BYTES = 32_768;
/** Hard byte cap when the caller explicitly asks for more text. */
export const TASK_SNAPSHOT_HARD_MAX_BYTES = 262_144;
export const TASK_SNAPSHOT_DEFAULT_COMMENT_LIMIT = 20;
export const TASK_SNAPSHOT_DEFAULT_MAX_COMMENT_CHARS = 1_500;
export const TASK_SNAPSHOT_DEFAULT_MAX_OBJECTIVE_CHARS = 1_500;
export const TASK_SNAPSHOT_DEFAULT_MAX_REPORT_CHARS = 3_000;
const MIN_FALLBACK_TEXT_CHARS = 200;

export interface TaskSnapshotOptions {
  /** Keep at most this many of the newest comments. */
  commentLimit?: number;
  /** Code-point cap per comment; when given it also lifts the objective/report caps. */
  maxCommentChars?: number;
}

export interface TaskSnapshotComment {
  id: string;
  body: string;
  createdAt: string;
  source: string | null;
  agentId: string | null;
  sessionId: string | null;
  truncated?: true;
}

export interface TaskSnapshotLaneSession {
  sessionId: string;
  stepName: string | null;
  role: string | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  columnId: string | null;
}

export interface TaskSnapshot {
  id: string;
  title: string;
  objective: string;
  columnId: string | null;
  status: string;
  comments: TaskSnapshotComment[];
  commentsTotal: number;
  verificationVerdict: string | null;
  verificationReport: string | null;
  acceptanceCriteria: string[];
  verificationCommands: string[];
  labels: string[];
  laneSessions: TaskSnapshotLaneSession[];
  lastSyncError: string | null;
  triggerSessionId: string | null;
  updatedAt: string;
  truncated: { objective: boolean; verificationReport: boolean };
}

/** Truncate to `maxChars` Unicode code points (never splits a surrogate pair). */
export function truncateCodePoints(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  let index = 0;
  for (let count = 0; index < text.length && count < maxChars; count += 1) {
    const code = text.charCodeAt(index);
    const next = text.charCodeAt(index + 1);
    index += code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 2 : 1;
  }
  return index >= text.length ? { text, truncated: false } : { text: text.slice(0, index), truncated: true };
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.floor(value) : undefined;
}

function toIso(value: Date | string | undefined): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return value ?? "";
}

function commentTime(entry: TaskCommentEntry): number {
  const parsed = Date.parse(entry.createdAt);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** Comments oldest-first; unparseable timestamps sort first, ties keep storage order. */
export function sortCommentsAscending(comments: TaskCommentEntry[]): TaskCommentEntry[] {
  return comments
    .map((entry, index) => ({ entry, index, time: commentTime(entry) }))
    .sort((a, b) => (a.time === b.time ? a.index - b.index : a.time < b.time ? -1 : 1))
    .map(({ entry }) => entry);
}

export function summarizeLaneSession(session: TaskLaneSession): TaskSnapshotLaneSession {
  return {
    sessionId: session.sessionId,
    stepName: session.stepName ?? null,
    role: session.role ?? null,
    status: session.status,
    startedAt: session.startedAt,
    completedAt: session.completedAt ?? null,
    columnId: session.columnId ?? null,
  };
}

function snapshotBytes(snapshot: TaskSnapshot): number {
  return Buffer.byteLength(JSON.stringify(snapshot, null, 2), "utf8");
}

/**
 * Pick the card a session is bound to: a `triggerSessionId` match wins over a
 * `laneSessions[].sessionId` match; within a group the newest `updatedAt` wins.
 */
export function findTaskBoundToSession<T extends Pick<Task, "triggerSessionId" | "laneSessions" | "updatedAt">>(
  tasks: T[],
  sessionId: string,
): T | undefined {
  const newest = (candidates: T[]) => candidates.reduce<T | undefined>((best, task) => (
    !best || new Date(task.updatedAt).getTime() > new Date(best.updatedAt).getTime() ? task : best
  ), undefined);
  return newest(tasks.filter((task) => task.triggerSessionId === sessionId))
    ?? newest(tasks.filter((task) => (task.laneSessions ?? []).some((lane) => lane.sessionId === sessionId)));
}

export function buildTaskSnapshot(task: Task, options: TaskSnapshotOptions = {}): TaskSnapshot {
  const explicitChars = positiveInt(options.maxCommentChars);
  const explicitLimit = positiveInt(options.commentLimit);
  const maxBytes = explicitChars || explicitLimit ? TASK_SNAPSHOT_HARD_MAX_BYTES : TASK_SNAPSHOT_DEFAULT_MAX_BYTES;
  const commentChars = explicitChars ?? TASK_SNAPSHOT_DEFAULT_MAX_COMMENT_CHARS;
  const commentLimit = explicitLimit ?? TASK_SNAPSHOT_DEFAULT_COMMENT_LIMIT;

  const sorted = sortCommentsAscending(task.comments ?? []);
  const comments = sorted.slice(Math.max(0, sorted.length - commentLimit)).map((entry) => {
    const body = truncateCodePoints(entry.body ?? "", commentChars);
    const comment: TaskSnapshotComment = {
      id: entry.id,
      body: body.text,
      createdAt: entry.createdAt ?? "",
      source: entry.source ?? null,
      agentId: entry.agentId ?? null,
      sessionId: entry.sessionId ?? null,
    };
    if (body.truncated) comment.truncated = true;
    return comment;
  });

  const build = (objectiveChars: number, reportChars: number): TaskSnapshot => {
    const objective = truncateCodePoints(task.objective ?? "", objectiveChars);
    const report = task.verificationReport === undefined || task.verificationReport === null
      ? undefined
      : truncateCodePoints(task.verificationReport, reportChars);
    return {
      id: task.id,
      title: task.title,
      objective: objective.text,
      columnId: task.columnId ?? null,
      status: task.status,
      comments: [...comments],
      commentsTotal: sorted.length,
      verificationVerdict: task.verificationVerdict ?? null,
      verificationReport: report ? report.text : null,
      acceptanceCriteria: task.acceptanceCriteria ?? [],
      verificationCommands: task.verificationCommands ?? [],
      labels: task.labels ?? [],
      laneSessions: (task.laneSessions ?? []).map(summarizeLaneSession),
      lastSyncError: task.lastSyncError ? truncateCodePoints(task.lastSyncError, reportChars).text : null,
      triggerSessionId: task.triggerSessionId ?? null,
      updatedAt: toIso(task.updatedAt),
      truncated: { objective: objective.truncated, verificationReport: report?.truncated ?? false },
    };
  };

  let objectiveChars = explicitChars ?? TASK_SNAPSHOT_DEFAULT_MAX_OBJECTIVE_CHARS;
  let reportChars = explicitChars ?? TASK_SNAPSHOT_DEFAULT_MAX_REPORT_CHARS;
  let snapshot = build(objectiveChars, reportChars);
  // Drop oldest comments first; keep shrinking long texts only once no comment is left.
  for (let bytes = snapshotBytes(snapshot); bytes > maxBytes; bytes = snapshotBytes(snapshot)) {
    if (snapshot.comments.length > 0) {
      // Batch-drop comments that clearly do not cover the excess, then re-measure exactly.
      let excess = bytes - maxBytes;
      do {
        excess -= Buffer.byteLength(JSON.stringify(snapshot.comments[0], null, 2), "utf8");
        comments.shift();
        snapshot.comments.shift();
      } while (snapshot.comments.length > 0
        && Buffer.byteLength(JSON.stringify(snapshot.comments[0], null, 2), "utf8") < excess);
      continue;
    }
    if (objectiveChars <= MIN_FALLBACK_TEXT_CHARS && reportChars <= MIN_FALLBACK_TEXT_CHARS) break;
    objectiveChars = Math.max(MIN_FALLBACK_TEXT_CHARS, Math.floor(objectiveChars / 2));
    reportChars = Math.max(MIN_FALLBACK_TEXT_CHARS, Math.floor(reportChars / 2));
    snapshot = build(objectiveChars, reportChars);
  }
  return snapshot;
}
