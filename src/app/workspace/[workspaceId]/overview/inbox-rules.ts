/**
 * "Needs you" rules (design-spec §4) for the home page and
 * /workspace/:workspaceId/overview. Pure: `now` and the dismissed keys are
 * passed in so every rule is testable with a pinned clock.
 *
 * The attention set itself is NOT re-implemented here: it comes from
 * collectWorkspaceAttention (the same function the board strip and the
 * all-projects overview use), so the three places always show the same
 * items. This module only adds severity, authoritative event time,
 * de-duplication and ordering on top.
 */

import type { KanbanBoardInfo, TaskInfo } from "../types";
import {
  attentionDismissKey,
  findInterruptedLaneSession,
  type KanbanAttentionItem,
  type TaskLaneSessionInfo,
} from "../kanban/kanban-attention-rules";
import { DONE_LANE_ID, getDoneEnteredAt, getTrailingDoneSessions } from "../kanban/kanban-done-time";
import { KANBAN_DETAIL_TAB_QUERY_KEY } from "../kanban/kanban-detail-tab-request";
import {
  isAttentionResolved,
  type TaskAttentionResolutionCategory,
} from "@/core/models/task-attention-resolution";
import {
  collectWorkspaceAttention,
  overviewTaskHref,
  pickFallbackBoard,
  sortInProgress,
  type OverviewWorkspace,
} from "../kanban/kanban-overview-rules";

export type InboxSeverity = 1 | 2 | 3;

/** Reason a row is shown; finer than the attention kind (blocked splits in two). */
export type InboxReason = "doneFailed" | "blockedError" | "noReport" | "unmerged" | "blockedUnknown" | "interrupted";

export interface InboxRow {
  /** Aggregation key: workspace + card + attention kind. */
  key: string;
  workspaceId: string;
  workspaceTitle: string;
  boardId: string;
  fallbackBoardId: string | null;
  task: TaskInfo;
  item: KanbanAttentionItem;
  severity: InboxSeverity;
  reason: InboxReason;
  /** Authoritative event time (epoch ms), or null when nothing was recorded. */
  eventAt: number | null;
  /** Same key the board's "Got it" writes (card + kind + commits ahead). */
  dismissKey: string;
  /** interrupted only: the failed / timed-out run and the lane's display name. */
  interruptedRun?: TaskLaneSessionInfo;
  columnName?: string;
  /** The Blocked resolver handed this card to the owner (card 64f2e31c); sorted first. */
  needsOwner?: boolean;
}

export interface InboxRows {
  active: InboxRow[];
  dismissed: InboxRow[];
}

export interface InboxWorkspaceInput {
  tasks: readonly TaskInfo[];
  boards: readonly KanbanBoardInfo[];
}

export type DismissedByBoard = (boardId: string) => readonly string[];

function parseTime(value: string | undefined | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Newest authoritative event of a card: every lane run's completedAt /
 * lastActivityAt / startedAt (which includes the Done entry, the first run
 * of the trailing Done segment) and createdAt. `updatedAt` is used only when
 * none of those exist, because a board page load can refresh it.
 */
export function taskAuthoritativeAt(task: Pick<TaskInfo, "laneSessions" | "createdAt" | "updatedAt">): number {
  let best = parseTime(task.createdAt);
  for (const session of task.laneSessions ?? []) {
    best = Math.max(best, parseTime(session.completedAt), parseTime(session.lastActivityAt), parseTime(session.startedAt));
  }
  return best || parseTime(task.updatedAt);
}

export function inboxReason(item: KanbanAttentionItem, task: Pick<TaskInfo, "lastSyncError">): InboxReason {
  if (item.kind === "blocked") return task.lastSyncError?.trim() ? "blockedError" : "blockedUnknown";
  return item.kind;
}

const SEVERITY: Record<InboxReason, InboxSeverity> = {
  doneFailed: 1,
  blockedError: 1,
  noReport: 2,
  unmerged: 3,
  blockedUnknown: 3,
  interrupted: 1,
};

export function inboxSeverity(reason: InboxReason): InboxSeverity {
  return SEVERITY[reason];
}

/**
 * Event time per kind: blocked → updatedAt; doneFailed / noReport → the last
 * Done-lane run's completedAt, else its startedAt; unmerged → the Done entry
 * (first run of the trailing Done segment); interrupted → the failed run's
 * completedAt, else lastActivityAt, else startedAt. Never a page-refresh time.
 */
export function inboxEventAt(item: KanbanAttentionItem, task: TaskInfo): number | null {
  if (item.kind === "blocked") return parseTime(task.updatedAt) || null;
  if (item.kind === "interrupted") {
    const run = findInterruptedLaneSession(task);
    return parseTime(run?.completedAt) || parseTime(run?.lastActivityAt) || parseTime(run?.startedAt) || null;
  }
  const trailing = getTrailingDoneSessions(task);
  if (item.kind === "unmerged") return parseTime(trailing[0]?.startedAt) || null;
  const last = trailing[trailing.length - 1];
  return parseTime(last?.completedAt) || parseTime(last?.startedAt) || null;
}

/** Status of the last Done-lane run, for the doneFailed source line. */
export function lastDoneRunStatus(task: TaskInfo): "failed" | "timed_out" | null {
  const trailing = getTrailingDoneSessions(task);
  const status = trailing[trailing.length - 1]?.status;
  return status === "failed" || status === "timed_out" ? status : null;
}

/** Lane name for a card: board column name → run's columnName → column id. */
export function inboxColumnName(
  task: Pick<TaskInfo, "columnId">,
  board: Pick<KanbanBoardInfo, "columns"> | undefined,
  run: Pick<TaskLaneSessionInfo, "columnName"> | null | undefined,
): string {
  const fromBoard = board?.columns.find((column) => column.id === task.columnId)?.name?.trim();
  return fromBoard || run?.columnName?.trim() || task.columnId || "";
}

/** Needs-the-owner first, then P1 → P3, then newest event first (unknown times last), then title. */
export function compareInboxRows(a: InboxRow, b: InboxRow): number {
  return Number(Boolean(b.needsOwner)) - Number(Boolean(a.needsOwner))
    || a.severity - b.severity
    || (b.eventAt ?? -1) - (a.eventAt ?? -1)
    || a.task.title.localeCompare(b.task.title);
}

/** Active and locally dismissed rows for one workspace, sorted. */
export function buildWorkspaceInbox(
  workspace: OverviewWorkspace,
  tasks: readonly TaskInfo[],
  boards: readonly KanbanBoardInfo[],
  now: number,
  dismissedByBoard: DismissedByBoard,
): InboxRows {
  const fallbackBoardId = pickFallbackBoard(boards)?.id ?? null;
  const seen = new Set<string>();
  const active: InboxRow[] = [];
  const dismissed: InboxRow[] = [];
  for (const entry of collectWorkspaceAttention(tasks, boards, now, () => [])) {
    const key = `${workspace.id}|${entry.task.id}|${entry.item.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reason = inboxReason(entry.item, entry.task);
    const dismissKey = attentionDismissKey(entry.item);
    const row: InboxRow = {
      key,
      workspaceId: workspace.id,
      workspaceTitle: workspace.title,
      boardId: entry.boardId,
      fallbackBoardId,
      task: entry.task,
      item: entry.item,
      severity: inboxSeverity(reason),
      reason,
      eventAt: inboxEventAt(entry.item, entry.task),
      dismissKey,
    };
    if (entry.task.attentionResolution?.category === "needs_owner") row.needsOwner = true;
    if (entry.item.kind === "interrupted") {
      const interruptedRun = findInterruptedLaneSession(entry.task) ?? undefined;
      row.interruptedRun = interruptedRun;
      row.columnName = inboxColumnName(entry.task, boards.find((board) => board.id === entry.boardId), interruptedRun);
    }
    (dismissedByBoard(entry.boardId).includes(dismissKey) ? dismissed : active).push(row);
  }
  return { active: active.sort(compareInboxRows), dismissed: dismissed.sort(compareInboxRows) };
}

/** Rows across several workspaces, merged and sorted. */
export function buildInboxRows(
  workspaces: readonly OverviewWorkspace[],
  dataByWorkspace: Readonly<Record<string, InboxWorkspaceInput | undefined>>,
  now: number,
  dismissedByBoard: DismissedByBoard,
): InboxRows {
  const active: InboxRow[] = [];
  const dismissed: InboxRow[] = [];
  for (const workspace of workspaces) {
    const data = dataByWorkspace[workspace.id];
    if (!data) continue;
    const rows = buildWorkspaceInbox(workspace, data.tasks, data.boards, now, dismissedByBoard);
    active.push(...rows.active);
    dismissed.push(...rows.dismissed);
  }
  return { active: active.sort(compareInboxRows), dismissed: dismissed.sort(compareInboxRows) };
}

/** Card-detail URL; failed / unreported cards open on the completion tab. */
export function inboxRowHref(row: Pick<InboxRow, "task" | "workspaceId" | "fallbackBoardId" | "reason">): string {
  const href = overviewTaskHref(row.task, row.workspaceId, row.fallbackBoardId);
  return row.reason === "doneFailed" || row.reason === "noReport"
    ? `${href}&${KANBAN_DETAIL_TAB_QUERY_KEY}=completion`
    : href;
}

export interface WorkspaceSummary {
  inProgress: number;
  needsYou: number;
  recent: { task: TaskInfo; at: number } | null;
}

/** Home-card numbers: same in-progress rule as the all-projects overview. */
export function summarizeWorkspace(
  workspace: OverviewWorkspace,
  tasks: readonly TaskInfo[],
  boards: readonly KanbanBoardInfo[],
  now: number,
  dismissedByBoard: DismissedByBoard,
): WorkspaceSummary {
  let recent: WorkspaceSummary["recent"] = null;
  for (const task of tasks) {
    const at = taskAuthoritativeAt(task);
    if (at > 0 && (!recent || at > recent.at)) recent = { task, at };
  }
  return {
    inProgress: sortInProgress(tasks).length,
    needsYou: buildWorkspaceInbox(workspace, tasks, boards, now, dismissedByBoard).active.length,
    recent,
  };
}

export interface LatestResult {
  task: TaskInfo;
  workspaceId: string;
  fallbackBoardId: string | null;
  summary: string;
  at: number;
}

/** Newest completion report (notes report or completion_summary) across workspaces. */
export function latestCompletionResult(
  workspaces: readonly OverviewWorkspace[],
  dataByWorkspace: Readonly<Record<string, InboxWorkspaceInput | undefined>>,
): LatestResult | null {
  let best: LatestResult | null = null;
  for (const workspace of workspaces) {
    const data = dataByWorkspace[workspace.id];
    if (!data) continue;
    const fallbackBoardId = pickFallbackBoard(data.boards)?.id ?? null;
    for (const task of data.tasks) {
      if (task.columnId !== DONE_LANE_ID) continue;
      const summary = task.completionReport?.excerpt?.trim() || task.completionSummary?.trim() || "";
      if (!task.completionReport && !summary) continue;
      const at = parseTime(task.completionReport?.createdAt) || getDoneEnteredAt(task);
      if (!best || at > best.at) best = { task, workspaceId: workspace.id, fallbackBoardId, summary, at };
    }
  }
  return best;
}

export function completionReportHref(result: Pick<LatestResult, "task" | "workspaceId" | "fallbackBoardId">): string {
  return `${overviewTaskHref(result.task, result.workspaceId, result.fallbackBoardId)}&${KANBAN_DETAIL_TAB_QUERY_KEY}=completion`;
}

/** "Handled by AI" rows are kept this long after the resolver's conclusion. */
export const RESOLVED_ROWS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface InboxResolvedRow {
  key: string;
  workspaceId: string;
  fallbackBoardId: string | null;
  task: TaskInfo;
  category: TaskAttentionResolutionCategory;
  conclusion: string;
  ref?: string;
  resolvedAt: number;
  /** Newest "## 自动处理记录" text, null when the card has none. */
  record: string | null;
}

/**
 * Cards the Blocked resolver concluded as landed / superseded / handed off /
 * waiting in the last 7 days, newest first. These cards are not in the
 * attention list (collectTaskAttentionItems skips them).
 */
export function buildResolvedRows(
  workspaces: readonly OverviewWorkspace[],
  dataByWorkspace: Readonly<Record<string, InboxWorkspaceInput | undefined>>,
  now: number,
): InboxResolvedRow[] {
  const rows: InboxResolvedRow[] = [];
  for (const workspace of workspaces) {
    const data = dataByWorkspace[workspace.id];
    if (!data) continue;
    const fallbackBoardId = pickFallbackBoard(data.boards)?.id ?? null;
    for (const task of data.tasks) {
      const resolution = task.attentionResolution;
      if (!resolution || !isAttentionResolved(resolution)) continue;
      const resolvedAt = parseTime(resolution.resolvedAt);
      if (resolvedAt > 0 && now - resolvedAt > RESOLVED_ROWS_WINDOW_MS) continue;
      rows.push({
        key: `${workspace.id}|${task.id}|resolved`,
        workspaceId: workspace.id,
        fallbackBoardId,
        task,
        category: resolution.category,
        conclusion: resolution.conclusion,
        ref: resolution.ref,
        resolvedAt,
        record: task.autoResolutionRecord ?? null,
      });
    }
  }
  return rows.sort((a, b) => b.resolvedAt - a.resolvedAt || a.task.title.localeCompare(b.task.title));
}
