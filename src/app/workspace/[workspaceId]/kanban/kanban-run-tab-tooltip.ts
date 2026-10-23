/**
 * Hover tooltip for the compact run tabs (lane badge + index) at the top of the
 * card detail session pane. The tab itself stays visually unchanged; the native
 * `title` carries a multi-line explanation: which run, which stage, the result,
 * and when it ran.
 *
 * Pure function: no clock, no global locale. Callers pass `now` and the copy.
 */

export const RUN_TAB_TOOLTIP_LANE_IDS = ["backlog", "todo", "dev", "review", "done", "blocked"] as const;
export type RunTabTooltipLaneId = (typeof RUN_TAB_TOOLTIP_LANE_IDS)[number];

export const RUN_TAB_TOOLTIP_STATUSES = [
  "completed",
  "running",
  "timed_out",
  "failed",
  "transitioned",
  "unknown",
] as const;
export type RunTabTooltipStatus = (typeof RUN_TAB_TOOLTIP_STATUSES)[number];

export interface RunTabTooltipCopy {
  /** e.g. "第 {n} 次" / "Run {n}" */
  runIndex: string;
  /** Joins the run index and the stage, e.g. "{run} · {lane}" */
  runLine: string;
  lanes: Record<RunTabTooltipLaneId, string>;
  statuses: Record<RunTabTooltipStatus, string>;
  /** Finished run, e.g. "{start}–{end}，用时 {duration}" */
  range: string;
  /** Run without an end time, e.g. "{start} 开始，已进行 {duration}" */
  ongoing: string;
  /** e.g. "{count} 分钟" */
  minutes: string;
  /** e.g. "{count} 秒" */
  seconds: string;
}

export interface RunTabTooltipInput {
  /** Zero-based position of the tab; shown as index + 1. */
  index: number;
  columnId?: string;
  columnName?: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  /** Existing step / specialist label of the tab (fullTabLabel). */
  stepLabel?: string;
  now: Date;
  copy: RunTabTooltipCopy;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

function parseTime(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatClock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDuration(ms: number, copy: RunTabTooltipCopy): string {
  const safeMs = Math.max(0, ms);
  if (safeMs < 60_000) {
    return fill(copy.seconds, { count: Math.floor(safeMs / 1000) });
  }
  return fill(copy.minutes, { count: Math.round(safeMs / 60_000) });
}

function isKnownLane(value: string): value is RunTabTooltipLaneId {
  return (RUN_TAB_TOOLTIP_LANE_IDS as readonly string[]).includes(value);
}

function isKnownStatus(value: string): value is RunTabTooltipStatus {
  return (RUN_TAB_TOOLTIP_STATUSES as readonly string[]).includes(value);
}

function buildRunLine(input: RunTabTooltipInput): string {
  const { copy } = input;
  const run = fill(copy.runIndex, { n: input.index + 1 });
  const laneKey = input.columnId?.trim().toLowerCase();
  if (laneKey && isKnownLane(laneKey)) {
    return fill(copy.runLine, { run, lane: copy.lanes[laneKey] });
  }
  const rawLane = input.columnName?.trim() || input.columnId?.trim();
  return rawLane ? fill(copy.runLine, { run, lane: rawLane }) : run;
}

function buildStatusLine(input: RunTabTooltipInput): string | null {
  const status = input.status?.trim();
  if (!status) return null;
  return isKnownStatus(status) ? input.copy.statuses[status] : status;
}

function buildTimeLine(input: RunTabTooltipInput): string | null {
  const started = parseTime(input.startedAt);
  if (!started) return null;
  const completed = parseTime(input.completedAt);
  const start = formatClock(started);
  if (completed) {
    return fill(input.copy.range, {
      start,
      end: formatClock(completed),
      duration: formatDuration(completed.getTime() - started.getTime(), input.copy),
    });
  }
  return fill(input.copy.ongoing, {
    start,
    duration: formatDuration(input.now.getTime() - started.getTime(), input.copy),
  });
}

export function buildRunTabTooltip(input: RunTabTooltipInput): string {
  const stepLabel = input.stepLabel?.trim();
  return [buildRunLine(input), buildStatusLine(input), buildTimeLine(input), stepLabel || null]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
