/**
 * "All projects" overview rules: one row per workspace with three blocks
 * (in progress, needs you, recently done). Pure: `now`, `query` and the
 * dismissed keys are passed in so every rule is testable with a pinned clock.
 *
 * The "needs you" block reuses the single-board attention rules board by
 * board, because `hasMainPusher` is a per-board property.
 */

import type { KanbanBoardInfo, TaskInfo } from "../types";
import {
  ATTENTION_DONE_WINDOW_MS,
  attentionDismissKey,
  boardHasMainPusher,
  collectAttentionItems,
  type KanbanAttentionItem,
} from "./kanban-attention-rules";
import { DONE_LANE_ID, getDoneEnteredAt } from "./kanban-done-time";
import { matchTask, normalizeSearchQuery } from "./kanban-board-search";

export const OVERVIEW_IN_PROGRESS_ORDER: readonly string[] = ["backlog", "todo", "dev", "review"];
export const OVERVIEW_RECENT_DONE_LIMIT = 3;

export interface OverviewWorkspace {
  id: string;
  title: string;
}

export interface OverviewAttentionEntry {
  item: KanbanAttentionItem;
  task: TaskInfo;
  boardId: string;
}

export interface OverviewRecentDone {
  /** Cards in the block before the 3-card cap (all hits while searching). */
  total: number;
  /** The shown cards: first 3 (every hit while searching). */
  items: TaskInfo[];
  /** Every card of the block (7 days, or all hits while searching), newest first. */
  all: TaskInfo[];
}

export interface OverviewRow {
  workspaceId: string;
  title: string;
  totalCount: number;
  inProgress: TaskInfo[];
  attention: OverviewAttentionEntry[];
  recentDone: OverviewRecentDone;
  score: number;
  collapsed: boolean;
  showsNoUnmergedBadge: boolean;
  /** Board used for cards without a (known) boardId. */
  fallbackBoardId: string | null;
  /** Cards waiting in the workspace's boards' session queues (sum of queue.queuedCount). */
  queuedCount: number;
  /** Every card of the workspace (not narrowed by the search). */
  tasks: readonly TaskInfo[];
  /** Needs-you entries not narrowed by the search (status bar). */
  attentionAll: OverviewAttentionEntry[];
}

function parseTime(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function laneRank(columnId: string | undefined): number {
  const index = OVERVIEW_IN_PROGRESS_ORDER.indexOf(columnId ?? "");
  return index === -1 ? OVERVIEW_IN_PROGRESS_ORDER.length : index;
}

/**
 * Non-Done, non-Blocked cards: backlog → todo → dev → review → others; newest
 * first per lane. Blocked cards are shown only in "needs you" (card f8fcc22b).
 */
export function sortInProgress(tasks: readonly TaskInfo[]): TaskInfo[] {
  return tasks
    .filter((task) => task.columnId !== DONE_LANE_ID && task.columnId !== "blocked")
    .map((task, index) => ({ task, index }))
    .sort((a, b) => laneRank(a.task.columnId) - laneRank(b.task.columnId)
      || parseTime(b.task.updatedAt) - parseTime(a.task.updatedAt)
      || a.index - b.index)
    .map(({ task }) => task);
}

/** The default board, else the first board, else null. */
export function pickFallbackBoard(boards: readonly KanbanBoardInfo[]): KanbanBoardInfo | null {
  return boards.find((board) => board.isDefault) ?? boards[0] ?? null;
}

/** Cards per board id; cards without a known boardId go to the fallback board. */
export function groupTasksByBoard(
  tasks: readonly TaskInfo[],
  boards: readonly KanbanBoardInfo[],
): Map<string, TaskInfo[]> {
  const groups = new Map<string, TaskInfo[]>(boards.map((board) => [board.id, []]));
  const fallback = pickFallbackBoard(boards);
  for (const task of tasks) {
    const target = task.boardId && groups.has(task.boardId) ? task.boardId : fallback?.id;
    if (target) groups.get(target)?.push(task);
  }
  return groups;
}

/** collectAttentionItems board by board, minus the keys dismissed on that board. */
export function collectWorkspaceAttention(
  tasks: readonly TaskInfo[],
  boards: readonly KanbanBoardInfo[],
  now: number,
  dismissedByBoard: (boardId: string) => readonly string[],
): OverviewAttentionEntry[] {
  const groups = groupTasksByBoard(tasks, boards);
  const entries: OverviewAttentionEntry[] = [];
  for (const board of boards) {
    const boardTasks = groups.get(board.id) ?? [];
    const byId = new Map(boardTasks.map((task) => [task.id, task]));
    const dismissed = dismissedByBoard(board.id);
    for (const item of collectAttentionItems(boardTasks, board, now)) {
      const task = byId.get(item.taskId);
      if (!task || dismissed.includes(attentionDismissKey(item))) continue;
      entries.push({ item, task, boardId: board.id });
    }
  }
  return entries;
}

/**
 * Without a query: Done cards that entered Done within 7 days, newest first,
 * capped at 3. With a query: every matching Done card, no window, no cap.
 */
export function collectRecentDone(tasks: readonly TaskInfo[], now: number, query: string): OverviewRecentDone {
  const searching = normalizeSearchQuery(query).length > 0;
  const done = tasks
    .filter((task) => task.columnId === DONE_LANE_ID)
    .filter((task) => (searching
      ? matchTask(task, query)
      : now - getDoneEnteredAt(task) <= ATTENTION_DONE_WINDOW_MS))
    .sort((a, b) => getDoneEnteredAt(b) - getDoneEnteredAt(a));
  return { total: done.length, items: searching ? done : done.slice(0, OVERVIEW_RECENT_DONE_LIMIT), all: done };
}

export function overviewRowScore(row: Pick<OverviewRow, "inProgress" | "attention" | "recentDone">): number {
  return row.inProgress.length * 3 + row.attention.length * 2 + (row.recentDone.total > 0 ? 1 : 0);
}

export function buildWorkspaceRow(
  workspace: OverviewWorkspace,
  tasks: readonly TaskInfo[],
  boards: readonly KanbanBoardInfo[],
  now: number,
  query: string,
  dismissedByBoard: (boardId: string) => readonly string[],
): OverviewRow {
  const fallback = pickFallbackBoard(boards);
  const inProgress = sortInProgress(tasks).filter((task) => matchTask(task, query));
  const attentionAll = collectWorkspaceAttention(tasks, boards, now, dismissedByBoard);
  const attention = attentionAll.filter((entry) => matchTask(entry.task, query));
  const recentDone = collectRecentDone(tasks, now, query);
  return {
    workspaceId: workspace.id,
    title: workspace.title,
    totalCount: tasks.length,
    inProgress,
    attention,
    recentDone,
    score: overviewRowScore({ inProgress, attention, recentDone }),
    collapsed: inProgress.length === 0 && attention.length === 0 && recentDone.total === 0,
    showsNoUnmergedBadge: fallback ? !boardHasMainPusher(fallback) : false,
    fallbackBoardId: fallback?.id ?? null,
    queuedCount: boards.reduce((sum, board) => sum + (board.queue?.queuedCount ?? 0), 0),
    tasks,
    attentionAll,
  };
}

/**
 * Rows with "needs you" cards first, then expanded rows by score desc (ties by
 * title), then collapsed rows by title.
 */
export function sortOverviewRows<T extends Pick<OverviewRow, "score" | "collapsed" | "title"> & { attention?: readonly unknown[] }>(rows: readonly T[]): T[] {
  const needsYou = (row: T) => (!row.collapsed && (row.attention?.length ?? 0) > 0 ? 0 : 1);
  return [...rows].sort((a, b) => needsYou(a) - needsYou(b)
    || Number(a.collapsed) - Number(b.collapsed)
    || (a.collapsed ? 0 : b.score - a.score)
    || a.title.localeCompare(b.title));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local "M-D HH:mm". */
export function formatDoneShort(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}-${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function shortSha(commit: string | null | undefined): string | null {
  return commit ? commit.slice(0, 7) : null;
}

/** Card-detail URL in the card's own workspace; never carries `view`. */
export function overviewTaskHref(task: Pick<TaskInfo, "id" | "boardId">, workspaceId: string, fallbackBoardId: string | null): string {
  const params = new URLSearchParams();
  const boardId = task.boardId ?? fallbackBoardId;
  if (boardId) params.set("boardId", boardId);
  params.set("taskId", task.id);
  return `/workspace/${encodeURIComponent(workspaceId)}/kanban?${params.toString()}`;
}
