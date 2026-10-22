"use client";

/**
 * Done column body: cards grouped into today / yesterday / this week / older
 * by the time they entered Done, each rendered as a compact two-line card
 * (title + time, then report excerpt + commit + leftover). Segment collapse
 * state lives in component memory only; a reload returns to the default.
 */

import { useState } from "react";
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
import { HighlightedText, normalizeSearchQuery } from "./kanban-board-search";
import { resolveCardMergeState } from "./kanban-card-status";
import { Badge } from "@/client/components/ui/badge";


export function isDoneReportPending(task: TaskInfo): boolean {
  if (task.completionReport) return false;
  const trailing = getTrailingDoneSessions(task);
  return trailing.length > 0 && trailing[trailing.length - 1].status === "running";
}

export function KanbanDoneCard({
  task,
  segment,
  onOpenDetail,
  searchQuery = "",
}: {
  task: TaskInfo;
  segment: DoneSegmentKey;
  onOpenDetail: () => void;
  /** Board search query; hits are wrapped in <mark>. */
  searchQuery?: string;
}) {
  const { t } = useTranslation();
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({
    id: task.id,
    data: { taskId: task.id, columnId: task.columnId },
  });
  const report = task.completionReport ?? null;
  const needle = normalizeSearchQuery(searchQuery);
  // Older cards are one line, except while searching so the hit is visible.
  const showSecondLine = segment !== "older" || needle !== "";
  const pending = showSecondLine && isDoneReportPending(task);
  const commit = report?.commit?.trim() ? report.commit.trim() : null;
  // Unknown never renders (design-spec §11): only an explicit landedOnBase=false with commits.
  const unmerged = resolveCardMergeState(task) === "unmerged";
  const renderText = (text: string) => (needle ? <HighlightedText text={text} query={searchQuery} /> : text);
  // Show the full hash when the search hit falls outside the 7-char prefix.
  const commitLabel = commit && needle && commit.toLowerCase().includes(needle) && !commit.slice(0, 7).toLowerCase().includes(needle)
    ? commit
    : commit?.slice(0, 7);

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
      className={`group relative flex flex-col gap-1 rounded-md border border-default bg-surface pl-7 pr-2 transition-colors duration-150 motion-reduce:transition-none hover:bg-hover focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${showSecondLine ? "py-2" : "py-1.5"}`}
      data-testid="kanban-card"
      data-card-id={task.id}
      data-column-id={task.columnId}
      data-variant="done"
      data-segment={segment}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClickCapture={(event) => event.stopPropagation()}
        className="absolute left-1.5 top-1.5 rounded p-0.5 text-secondary transition hover:bg-hover hover:text-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`${t.kanban.dragCard} ${task.title}`}
        title={t.kanban.dragCard}
        style={{ touchAction: "none" }}
        data-testid="kanban-card-drag-handle"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-[550] leading-[1.4] text-primary" title={task.title}>
          {renderText(task.title)}
        </span>
        {unmerged && (
          <span className="shrink-0" data-testid="kanban-done-card-unmerged">
            <Badge tone="attention">{t.kanbanDetail.unmerged}</Badge>
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px] text-secondary" data-testid="kanban-done-card-time">
          {formatDoneEnteredAt(getDoneEnteredAt(task), segment)}
        </span>
      </div>
      {showSecondLine && (report || pending) && (
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-[1.4] text-secondary" data-testid="kanban-done-card-line2">
          {report ? (
            <>
              <span className="min-w-0 flex-1 truncate" title={report.excerpt ?? undefined}>
                {report.excerpt ? renderText(report.excerpt) : null}
              </span>
              {commit && (
                <span className="shrink-0 font-mono text-[11px] text-primary" title={commit} data-testid="kanban-done-card-commit">
                  {renderText(commitLabel ?? "")}
                </span>
              )}
              {report.hasLeftover && (
                <span className="shrink-0" data-testid="kanban-done-card-leftover">
                  <Badge tone="attention">{t.kanbanDoneSegments.leftover}</Badge>
                </span>
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-success" data-testid="kanban-done-card-report-pending">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
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
  searchQuery,
}: {
  /** Done cards to show, already sorted newest first. */
  tasks: readonly TaskInfo[];
  now: Date;
  onOpenTask: (task: TaskInfo) => void;
  /** Search mode: every non-empty segment starts expanded. */
  expandAll?: boolean;
  searchQuery?: string;
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
              className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-secondary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-accent"
              data-testid={`kanban-done-segment-toggle-${key}`}
            >
              <Chevron className="h-3 w-3" />
              <span>{t.kanbanDoneSegments[key]}</span>
              <span className="ml-auto font-mono text-[10px] font-normal text-secondary">{items.length}</span>
            </button>
            {expanded && items.map((task) => (
              <KanbanDoneCard
                key={task.id}
                task={task}
                segment={key}
                onOpenDetail={() => onOpenTask(task)}
                searchQuery={searchQuery}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
