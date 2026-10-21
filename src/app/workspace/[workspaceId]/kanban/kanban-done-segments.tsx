"use client";

/**
 * Done column body: cards grouped into today / yesterday / this week / older
 * by the time they entered Done, each rendered as a compact two-line card
 * (title + time, then report excerpt + commit + leftover). Segment collapse
 * state lives in component memory only; a reload returns to the default.
 */

import { useState, type ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";
import {
  DONE_SEGMENT_ORDER,
  defaultExpandedSegments,
  formatDoneEnteredAt,
  getDoneEnteredAt,
  getTrailingDoneSessions,
  segmentDoneTasks,
  type DoneSegmentKey,
} from "./kanban-done-time";

const PILL_BASE = "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium";
const PILL_SLATE = `${PILL_BASE} bg-slate-100 font-mono text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-[#181c28] dark:text-slate-300 dark:ring-white/5`;
const PILL_AMBER = `${PILL_BASE} bg-amber-100/80 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-900/40`;
const PILL_RUNNING = `${PILL_BASE} gap-1 bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-900/40`;

/** Renders text, optionally wrapping search hits in <mark>. */
export type DoneTextRenderer = (text: string) => ReactNode;

const plainText: DoneTextRenderer = (text) => text;

export function isDoneReportPending(task: TaskInfo): boolean {
  if (task.completionReport) return false;
  const trailing = getTrailingDoneSessions(task);
  return trailing.length > 0 && trailing[trailing.length - 1].status === "running";
}

export function KanbanDoneCard({
  task,
  segment,
  onOpenDetail,
  renderText = plainText,
}: {
  task: TaskInfo;
  segment: DoneSegmentKey;
  onOpenDetail: () => void;
  renderText?: DoneTextRenderer;
}) {
  const { t } = useTranslation();
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: task.id,
    data: { taskId: task.id, columnId: task.columnId },
  });
  const report = task.completionReport ?? null;
  const showSecondLine = segment !== "older";
  const pending = showSecondLine && isDoneReportPending(task);
  const commit = report?.commit?.trim() ? report.commit.trim() : null;

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail();
        }
      }}
      aria-label={`${t.kanban.openCard} ${task.title}`}
      style={isDragging ? { opacity: 0.16 } : undefined}
      className="group relative flex flex-col gap-1 border border-slate-200/80 bg-white/90 py-1.5 pl-7 pr-2 transition-[background-color,border-color] duration-150 hover:border-slate-300 hover:bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/50 dark:border-[#262938] dark:bg-[#0d1018] dark:hover:border-[#34384a]"
      data-testid="kanban-card"
      data-variant="done"
      data-segment={segment}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClickCapture={(event) => event.stopPropagation()}
        className="absolute left-1.5 top-1.5 rounded-lg p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-400/50 dark:text-slate-500 dark:hover:bg-[#191c28] dark:hover:text-slate-300"
        aria-label={`${t.kanban.dragCard} ${task.title}`}
        title={t.kanban.dragCard}
        style={{ touchAction: "none" }}
        data-testid="kanban-card-drag-handle"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-[1.3] text-slate-900 dark:text-slate-100" title={task.title}>
          {renderText(task.title)}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-slate-400 dark:text-slate-500" data-testid="kanban-done-card-time">
          {formatDoneEnteredAt(getDoneEnteredAt(task), segment)}
        </span>
      </div>
      {showSecondLine && (report || pending) && (
        <div className="flex min-w-0 items-center gap-1 text-[10px] leading-[1.3] text-slate-600 dark:text-slate-400" data-testid="kanban-done-card-line2">
          {report ? (
            <>
              <span className="min-w-0 flex-1 truncate" title={report.excerpt ?? undefined}>
                {report.excerpt ? renderText(report.excerpt) : null}
              </span>
              {commit && (
                <span className={PILL_SLATE} title={commit} data-testid="kanban-done-card-commit">
                  {renderText(commit.slice(0, 7))}
                </span>
              )}
              {report.hasLeftover && (
                <span className={PILL_AMBER} data-testid="kanban-done-card-leftover">
                  {t.kanbanDoneSegments.leftover}
                </span>
              )}
            </>
          ) : (
            <span className={PILL_RUNNING} data-testid="kanban-done-card-report-pending">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              {t.kanbanDoneSegments.reportPending}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function KanbanDoneSegments({
  tasks,
  now,
  onOpenTask,
  expandAll = false,
  renderText,
}: {
  /** Done cards to show, already sorted newest first. */
  tasks: readonly TaskInfo[];
  now: Date;
  onOpenTask: (task: TaskInfo) => void;
  /** Search mode: every non-empty segment starts expanded. */
  expandAll?: boolean;
  renderText?: DoneTextRenderer;
}) {
  const { t } = useTranslation();
  // Overrides relative to the default; keyed by mode so leaving search resets them.
  const mode = expandAll ? "all" : "default";
  const [overrides, setOverrides] = useState<{ mode: string; values: Partial<Record<DoneSegmentKey, boolean>> }>({
    mode,
    values: {},
  });
  const activeOverrides = overrides.mode === mode ? overrides.values : {};
  const segments = segmentDoneTasks(tasks, now);
  const defaults = expandAll
    ? DONE_SEGMENT_ORDER.filter((key) => segments[key].length > 0)
    : defaultExpandedSegments(segments);

  return (
    <>
      {DONE_SEGMENT_ORDER.map((key) => {
        const items = segments[key];
        if (items.length === 0) return null;
        const expanded = activeOverrides[key] ?? defaults.includes(key);
        const Chevron = expanded ? ChevronDown : ChevronRight;
        return (
          <div key={key} className="space-y-1.5" data-testid={`kanban-done-segment-${key}`}>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOverrides({ mode, values: { ...activeOverrides, [key]: !expanded } })}
              className="flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-[10px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              data-testid={`kanban-done-segment-toggle-${key}`}
            >
              <Chevron className="h-3 w-3" />
              <span>{t.kanbanDoneSegments[key]}</span>
              <span className="font-normal text-slate-400 dark:text-slate-500">{items.length}</span>
            </button>
            {expanded && items.map((task) => (
              <KanbanDoneCard
                key={task.id}
                task={task}
                segment={key}
                onOpenDetail={() => onOpenTask(task)}
                renderText={renderText}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
