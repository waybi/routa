"use client";

/**
 * "By status" page: project capsules, then four groups on one list
 * (needs you → running → queued → done in 7 days). Group titles stick to the
 * top and fold on click; Done is split by day (today open, earlier days one
 * line). J / K move the selection, Enter opens the drawer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { buttonClassName } from "@/client/components/ui/button";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";
import { getDoneEnteredAt } from "./kanban-done-time";
import { HighlightedText, isEditableTarget } from "./kanban-board-search";
import { formatSpan } from "./kanban-overview-format";
import { KanbanLaneMarker } from "./kanban-lane-marker";
import { PipelineCells } from "./kanban-overview-progress";
import { BlockedReason, columnName } from "./kanban-overview-row";
import type { OverviewRow } from "./kanban-overview-rules";
import {
  buildCapsules,
  buildStatusGroups,
  segmentByDay,
  STATUS_GROUP_ORDER,
  type DaySegment,
  type StatusItem,
} from "./kanban-overview-status-list";
import { laneProgress, startOfLocalDay, type OverviewStatus } from "./kanban-overview-status-rules";
import type { OverviewWorkspaceData } from "./use-kanban-overview-data";

const COLUMNS = "grid grid-cols-[minmax(0,1fr)_7rem_11rem_10rem_8rem] items-center gap-2";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** "HH:mm" for today, "MM-DD HH:mm" earlier. */
function formatDoneTime(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return timestamp >= startOfLocalDay(now) ? time : `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${time}`;
}

export interface ByStatusViewProps {
  rows: readonly OverviewRow[];
  dataByWorkspace: Readonly<Record<string, OverviewWorkspaceData | undefined>>;
  statusFilter: OverviewStatus | null;
  query: string;
  now: number;
  /** A drawer is open: the list keys stop reacting. */
  paused: boolean;
  onOpenTask: (task: TaskInfo, row: OverviewRow, trigger: HTMLElement) => void;
  onRetry: (workspaceId: string) => void;
  commentsOf: (task: TaskInfo) => TaskInfo["comments"];
}

export function KanbanOverviewByStatus({ rows, dataByWorkspace, statusFilter, query, now, paused, onOpenTask, onRetry, commentsOf }: ByStatusViewProps) {
  const { t } = useTranslation();
  const copy = t.kanbanOverview;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<OverviewStatus>>(() => new Set());
  const [toggledDays, setToggledDays] = useState<ReadonlySet<number>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const readyRows = rows.filter((row) => dataByWorkspace[row.workspaceId]?.status === "ready");
  const capsules = useMemo(() => buildCapsules(readyRows, now), [readyRows, now]);
  const groups = useMemo(() => buildStatusGroups(readyRows, project, statusFilter), [readyRows, project, statusFilter]);
  const days = useMemo(() => segmentByDay(groups.done, now), [groups.done, now]);
  const isDayOpen = (day: DaySegment) => (day.kind === "today") !== toggledDays.has(day.dayStart);

  const visible = useMemo(() => {
    const list: StatusItem[] = [];
    if (!folded.has("attention")) list.push(...groups.attention);
    if (!folded.has("running")) list.push(...groups.running);
    if (!folded.has("queued")) list.push(...groups.queued);
    if (!folded.has("done")) {
      for (const day of days) if ((day.kind === "today") !== toggledDays.has(day.dayStart)) list.push(...day.items);
    }
    return list;
  }, [groups, days, folded, toggledDays]);

  const cardElement = useCallback((id: string) => rootRef.current?.querySelector<HTMLElement>(`[data-testid="kanban-overview-card"][data-task-id="${id}"]`) ?? null, []);

  useEffect(() => {
    if (!selectedId) return;
    cardElement(selectedId)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId, cardElement]);

  useEffect(() => {
    if (paused) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const index = visible.findIndex((item) => item.task.id === selectedId);
      if (key === "j" || key === "k") {
        if (visible.length === 0) return;
        event.preventDefault();
        const next = key === "j" ? Math.min(visible.length - 1, index + 1) : Math.max(0, index === -1 ? 0 : index - 1);
        setSelectedId(visible[next].task.id);
      } else if (key === "enter" && index !== -1) {
        const item = visible[index];
        const element = cardElement(item.task.id);
        if (!element) return;
        event.preventDefault();
        onOpenTask(item.task, item.row, element);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [paused, visible, selectedId, cardElement, onOpenTask]);

  const toggleFold = (status: OverviewStatus) => setFolded((current) => {
    const next = new Set(current);
    if (!next.delete(status)) next.add(status);
    return next;
  });
  const toggleDay = (dayStart: number) => setToggledDays((current) => {
    const next = new Set(current);
    if (!next.delete(dayStart)) next.add(dayStart);
    return next;
  });

  const titles: Record<OverviewStatus, { text: string; stage: "blocked" | "dev" | "todo" | "done" }> = {
    attention: { text: copy.statusNeedsYou, stage: "blocked" },
    running: { text: copy.statusRunning, stage: "dev" },
    queued: { text: copy.groupQueued, stage: "todo" },
    done: { text: copy.groupDone7d, stage: "done" },
  };
  const total = (status: OverviewStatus) => (status === "done" ? groups.done.length : groups[status].length);
  const failedRows = rows.filter((row) => dataByWorkspace[row.workspaceId]?.status === "error");
  const loading = rows.some((row) => (dataByWorkspace[row.workspaceId]?.status ?? "loading") === "loading");

  const labelOf = (item: StatusItem) => columnName(item.task, dataByWorkspace[item.row.workspaceId]?.boards ?? []);

  const renderRow = (item: StatusItem, done: boolean) => {
    const { task } = item;
    const progress = laneProgress(task, now);
    const label = copy.laneStepLabel.replace("{lane}", labelOf(item)).replace("{step}", String(progress.step));
    const selected = selectedId === task.id;
    const attention = item.kind !== undefined;
    return (
      <div
        key={`${task.id}|${item.kind ?? ""}`}
        className={`scroll-mt-9 border-b border-default last:border-b-0 ${selected ? "bg-accent-subtle" : attention ? "bg-danger-subtle" : "hover:bg-hover"}`}
        data-selected={selected ? "true" : "false"}
        data-testid="kanban-overview-status-row"
      >
        <button
          type="button"
          className={`${COLUMNS} w-full px-2 py-1.5 text-left text-[12px] text-primary`}
          title={done ? (task.completionReport?.excerpt || task.title) : task.title}
          onClick={(event) => {
            setSelectedId(task.id);
            onOpenTask(task, item.row, event.currentTarget);
          }}
          data-testid="kanban-overview-card"
          data-task-id={task.id}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {item.kind && <span className="shrink-0 rounded bg-danger-subtle px-1.5 text-[10px] text-danger">{item.kind === "unmerged" ? t.kanbanAttention.unmerged.replace("{count}", String(item.ahead ?? 0)) : t.kanbanAttention[item.kind]}</span>}
            <span className="truncate"><HighlightedText text={task.title} query={query} /></span>
          </span>
          <span className="truncate text-[11px] text-secondary">{item.row.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
            <PipelineCells step={progress.step} failed={progress.failed} />
            <span className={`shrink-0 font-semibold ${progress.failed ? "text-danger" : "text-primary"}`}>{label}</span>
          </span>
          <span className="truncate text-[11px] text-secondary">
            {progress.specialistName}
            {progress.stepNumber !== null && ` · ${copy.stepNumber.replace("{step}", String(progress.stepNumber))}`}
          </span>
          <span className="truncate text-right font-mono text-[11px] text-secondary">
            {done
              ? formatDoneTime(getDoneEnteredAt(task), now)
              : progress.runningMs !== null ? copy.ranFor.replace("{time}", formatSpan(progress.runningMs, copy)) : ""}
          </span>
        </button>
        {item.kind === "blocked" && (
          <div className="px-2 pb-1"><BlockedReason entry={{ task, boardId: task.boardId ?? "", item: { taskId: task.id, kind: "blocked", ahead: 0 } }} commentsOf={commentsOf} /></div>
        )}
      </div>
    );
  };

  const renderDone = () => days.map((day) => {
    const open = isDayOpen(day);
    const label = day.kind === "today" ? copy.dayToday : day.kind === "yesterday" ? copy.dayYesterday : `${pad2(new Date(day.dayStart).getMonth() + 1)}-${pad2(new Date(day.dayStart).getDate())}`;
    const Chevron = open ? ChevronDown : ChevronRight;
    return (
      <div key={day.dayStart} data-testid="kanban-overview-day" data-open={open ? "true" : "false"}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => toggleDay(day.dayStart)}
          className="flex w-full min-w-0 items-center gap-1.5 border-b border-default px-2 py-1 text-left text-[11px] font-medium text-secondary hover:bg-hover"
          data-testid="kanban-overview-day-toggle"
        >
          <Chevron className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="shrink-0 text-primary">{label}</span>
          <span className="shrink-0 font-mono text-[10px]">{copy.dayCount.replace("{count}", String(day.items.length))}</span>
          {!open && <span className="truncate font-normal" data-testid="kanban-overview-day-preview">{day.items.slice(0, 2).map((item) => item.task.title).join(" · ")}</span>}
        </button>
        {open && day.items.map((item) => renderRow(item, true))}
      </div>
    );
  });

  const allEmpty = STATUS_GROUP_ORDER.every((status) => total(status) === 0);
  const capsuleClass = (active: boolean) => `${buttonClassName("secondary", "xs")} ${active ? "border-accent bg-accent-subtle text-accent" : ""}`;
  const sumUnfinished = capsules.reduce((sum, capsule) => sum + capsule.unfinished, 0);
  const sumDone = capsules.reduce((sum, capsule) => sum + capsule.doneWeek, 0);

  return (
    <div ref={rootRef} className="min-w-0 flex-1 px-1" data-testid="kanban-overview-by-status">
      <div className="flex flex-wrap gap-1.5 pb-1" data-testid="kanban-overview-capsules">
        <button type="button" aria-pressed={project === null} className={capsuleClass(project === null)} onClick={() => setProject(null)} data-testid="kanban-overview-capsule-all">
          {copy.capsuleAll} <span className="font-mono">{sumUnfinished}</span> · <span className="font-mono">{sumDone}</span>
        </button>
        {capsules.map((capsule) => (
          <button
            key={capsule.workspaceId}
            type="button"
            aria-pressed={project === capsule.workspaceId}
            className={capsuleClass(project === capsule.workspaceId)}
            title={copy.capsuleTitle.replace("{unfinished}", String(capsule.unfinished)).replace("{done}", String(capsule.doneWeek))}
            onClick={() => setProject((current) => (current === capsule.workspaceId ? null : capsule.workspaceId))}
            data-testid="kanban-overview-capsule"
            data-workspace-id={capsule.workspaceId}
          >
            {capsule.title} <span className="font-mono">{capsule.unfinished}</span> · <span className="font-mono">{capsule.doneWeek}</span>
          </button>
        ))}
      </div>
      <p className="m-0 pb-2 text-[10px] text-secondary">{copy.capsuleLegend}</p>
      {failedRows.map((row) => (
        <div key={row.workspaceId} className="flex items-center gap-2 pb-1 text-[11px] text-danger" data-testid="kanban-overview-error">
          {row.title}: {copy.loadFailed}
          <button type="button" onClick={() => onRetry(row.workspaceId)} className={buttonClassName("secondary", "xs")} data-testid="kanban-overview-retry">{copy.retry}</button>
        </div>
      ))}
      {loading && <div className="pb-1 text-[11px] text-secondary">{copy.loading}</div>}
      <div className="rounded-md border border-default bg-surface">
        <div className={`${COLUMNS} border-b border-default px-2 py-1 text-[11px] text-secondary`}>
          <span>{copy.colTitle}</span><span>{copy.colProject}</span><span>{copy.colPipeline}</span><span>{copy.colSpecialist}</span><span className="text-right">{copy.colTime}</span>
        </div>
        {STATUS_GROUP_ORDER.map((status) => {
          if (total(status) === 0) return null;
          const isFolded = folded.has(status);
          const Chevron = isFolded ? ChevronRight : ChevronDown;
          return (
            <section key={status} data-testid={`kanban-overview-group-${status}`} data-folded={isFolded ? "true" : "false"}>
              <button
                type="button"
                aria-expanded={!isFolded}
                onClick={() => toggleFold(status)}
                className="sticky top-0 z-10 flex w-full items-center gap-1.5 border-b border-default bg-surface px-2 py-1.5 text-left text-[12px] font-semibold text-primary"
                data-testid={`kanban-overview-group-${status}-title`}
              >
                <Chevron className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <KanbanLaneMarker stage={titles[status].stage} />
                {titles[status].text}
                <span className="font-normal text-secondary">{total(status)}</span>
              </button>
              {!isFolded && (status === "done" ? renderDone() : groups[status].map((item) => renderRow(item, false)))}
            </section>
          );
        })}
        {allEmpty && !loading && <div className="px-2 py-3 text-[12px] text-secondary">{copy.noMatches}</div>}
      </div>
      <p className="m-0 pt-1.5 text-[11px] text-secondary">{copy.keysHint}</p>
    </div>
  );
}
