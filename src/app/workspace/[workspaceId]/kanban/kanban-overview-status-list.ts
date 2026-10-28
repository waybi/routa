/**
 * "By status" view model of the all-projects overview: the four groups
 * (needs you → running → queued → done in 7 days), the project capsules and the
 * per-day split of the Done group. Pure: `now` comes from the caller.
 */

import type { TaskInfo } from "../types";
import type { KanbanAttentionKind } from "./kanban-attention-rules";
import { DONE_LANE_ID, getDoneEnteredAt } from "./kanban-done-time";
import { computeCardDuration } from "./kanban-overview-duration";
import type { OverviewRow } from "./kanban-overview-rules";
import { classifyOverviewTask, startOfLocalDay, withinDoneWindow, type OverviewStatus } from "./kanban-overview-status-rules";

export interface StatusItem {
  task: TaskInfo;
  row: OverviewRow;
  /** Attention items only. */
  kind?: KanbanAttentionKind;
  ahead?: number;
}

export interface StatusGroups {
  attention: StatusItem[];
  running: StatusItem[];
  queued: StatusItem[];
  done: StatusItem[];
}

export const STATUS_GROUP_ORDER: readonly OverviewStatus[] = ["attention", "running", "queued", "done"];

/**
 * Groups the cards of every ready row. Cards of one project stay next to each
 * other because rows are walked in order. `project` keeps one workspace;
 * `only` keeps one group (the status-bar toggle); `stuckOnly` narrows Done.
 */
export function buildStatusGroups(
  rows: readonly OverviewRow[],
  project: string | null,
  only: OverviewStatus | null,
  /** Keep only Done cards that had a timed_out run (the rhythm column's "stuck" toggle). */
  stuckOnly = false,
  now = 0,
): StatusGroups {
  const groups: StatusGroups = { attention: [], running: [], queued: [], done: [] };
  for (const row of rows) {
    if (project && row.workspaceId !== project) continue;
    const attentionIds = new Set(row.attentionAll.map((entry) => entry.task.id));
    for (const entry of row.attention) {
      groups.attention.push({ task: entry.task, row, kind: entry.item.kind, ahead: entry.item.ahead });
    }
    for (const task of row.inProgress) {
      const status = classifyOverviewTask(task, attentionIds);
      if (status === "running") groups.running.push({ task, row });
      else if (status === "queued") groups.queued.push({ task, row });
    }
    for (const task of row.recentDone.all) {
      if (stuckOnly && computeCardDuration(task, now).stuckCount === 0) continue;
      groups.done.push({ task, row });
    }
  }
  groups.done.sort((a, b) => getDoneEnteredAt(b.task) - getDoneEnteredAt(a.task));
  if (only) {
    for (const key of STATUS_GROUP_ORDER) if (key !== only) groups[key] = [];
  }
  return groups;
}

export interface ProjectCapsule {
  workspaceId: string;
  title: string;
  /** Cards not in Done (Blocked included). */
  unfinished: number;
  /** Cards that entered Done in the last 7 days. */
  doneWeek: number;
}

export function buildCapsules(rows: readonly OverviewRow[], now: number): ProjectCapsule[] {
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    title: row.title,
    unfinished: row.tasks.filter((task) => task.columnId !== DONE_LANE_ID).length,
    doneWeek: row.tasks.filter((task) => withinDoneWindow(task, now)).length,
  }));
}

export interface DaySegment {
  /** Local-midnight epoch ms of the day. */
  dayStart: number;
  /** "today" | "yesterday" | "earlier" */
  kind: "today" | "yesterday" | "earlier";
  items: StatusItem[];
}

/** Splits (newest-first) Done items by local calendar day. */
export function segmentByDay(items: readonly StatusItem[], now: number): DaySegment[] {
  const today = startOfLocalDay(now);
  const yesterday = startOfLocalDay(now, 1);
  const segments: DaySegment[] = [];
  for (const item of items) {
    const entered = getDoneEnteredAt(item.task);
    const dayStart = startOfLocalDay(entered);
    const last = segments[segments.length - 1];
    if (last && last.dayStart === dayStart) {
      last.items.push(item);
      continue;
    }
    segments.push({ dayStart, kind: dayStart >= today ? "today" : dayStart === yesterday ? "yesterday" : "earlier", items: [item] });
  }
  return segments;
}
