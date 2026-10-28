"use client";

/**
 * "All projects" overview: a status bar, then one row per active workspace
 * with three blocks (in progress, needs you, recently done in 7 days) and a
 * cross-workspace search. A card click opens a right-side drawer; the full
 * card page is one button away. Also owns the "This board / All projects"
 * toggle, which lives in the URL as `view=all` so a full reload keeps the
 * overview.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/i18n";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import type { TaskInfo } from "../types";
import { KanbanBoardSearchInput, useKanbanBoardSearch } from "./kanban-board-search";
import {
  buildWorkspaceRow,
  overviewTaskHref,
  sortOverviewRows,
  type OverviewRow,
} from "./kanban-overview-rules";
import { countStatusBar, filterRowByStatus, type OverviewStatus } from "./kanban-overview-status-rules";
import { readAttentionDismissals } from "./use-kanban-attention-dismissals";
import { useKanbanOverviewData, useRememberedOverviewWorkspaces, type OverviewWorkspaceData } from "./use-kanban-overview-data";
import { KanbanOverviewByStatus } from "./kanban-overview-by-status";
import { KanbanOverviewDrawer } from "./kanban-overview-drawer";
import { useOverviewMode, type OverviewMode } from "./kanban-overview-mode";
import { columnName, WorkspaceRow } from "./kanban-overview-row";
import { KanbanOverviewStatusBar } from "./kanban-overview-status-bar";
import { useInboxReasonComments } from "../overview/use-inbox-reason-comments";
import { inboxReason } from "../overview/inbox-rules";

export type KanbanViewMode = "board" | "all";
export const KANBAN_VIEW_QUERY_KEY = "view";
const VIEW_CHANGE_EVENT = "routa:kanban-view-change";

function readViewMode(): KanbanViewMode {
  return new URLSearchParams(window.location.search).get(KANBAN_VIEW_QUERY_KEY) === "all" ? "all" : "board";
}

function subscribeViewMode(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(VIEW_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(VIEW_CHANGE_EVENT, listener);
  };
}

/** Writes `view=all` (or removes it), keeping every other query param. */
export function writeViewMode(mode: KanbanViewMode): void {
  const url = new URL(window.location.href);
  if (mode === "all") url.searchParams.set(KANBAN_VIEW_QUERY_KEY, "all");
  else url.searchParams.delete(KANBAN_VIEW_QUERY_KEY);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(VIEW_CHANGE_EVENT));
}

export function useKanbanViewMode() {
  const view = useSyncExternalStore(subscribeViewMode, readViewMode, () => "board" as KanbanViewMode);
  return { view, setView: writeViewMode };
}

export function KanbanViewToggle({ view, onChange }: { view: KanbanViewMode; onChange: (mode: KanbanViewMode) => void }) {
  const { t } = useTranslation();
  const button = (mode: KanbanViewMode, label: string) => (
    <button
      type="button"
      aria-pressed={view === mode}
      onClick={() => onChange(mode)}
      data-testid={`kanban-view-toggle-${mode}`}
      className={`h-7 rounded px-2.5 text-[12px] font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent ${view === mode
        ? "bg-accent text-on-accent"
        : "text-secondary hover:bg-hover hover:text-primary"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex shrink-0 gap-0.5 rounded-md border border-default bg-surface p-0.5" role="group" data-testid="kanban-view-toggle">
      {button("all", t.kanbanOverview.viewAll)}
      {button("board", t.kanbanOverview.viewBoard)}
    </div>
  );
}

/** "By project / By status" two-part switch; the choice is written to the URL by the caller. */
function OverviewModeToggle({ mode, onChange }: { mode: OverviewMode; onChange: (mode: OverviewMode) => void }) {
  const { t } = useTranslation();
  const button = (value: OverviewMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => onChange(value)}
      data-testid={`kanban-overview-mode-${value}`}
      className={`h-7 rounded px-2.5 text-[12px] font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent ${mode === value
        ? "bg-accent text-on-accent"
        : "text-secondary hover:bg-hover hover:text-primary"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex shrink-0 gap-0.5 rounded-md border border-default bg-surface p-0.5" role="group" aria-label={t.kanbanOverview.modeLabel} data-testid="kanban-overview-mode">
      {button("project", t.kanbanOverview.modeProject)}
      {button("status", t.kanbanOverview.modeStatus)}
    </div>
  );
}

function useMinuteClock(fixed: number | undefined): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [fixed]);
  return fixed ?? now;
}

function currentWorkspaceIdFromPath(): string | null {
  return window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? null;
}

const LOADING: OverviewWorkspaceData = { status: "loading", tasks: [], boards: [] };

export function KanbanOverview({ onShowBoard, now }: { onShowBoard: () => void; now?: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { workspaces: fetchedWorkspaces, loading: workspacesLoading } = useWorkspaces();
  const workspaces = useRememberedOverviewWorkspaces(fetchedWorkspaces, workspacesLoading);
  const { data, retry } = useKanbanOverviewData(workspaces);
  const search = useKanbanBoardSearch();
  const { mode, setMode } = useOverviewMode();
  const at = useMinuteClock(now);
  const [statusFilter, setStatusFilter] = useState<OverviewStatus | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<{ taskId: string; workspaceId: string } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Read dismissals on every render: the single-board bar may have changed them.
  const allRows = workspaces.map((workspace) => {
    const entry = data[workspace.id] ?? LOADING;
    const row = buildWorkspaceRow(workspace, entry.tasks, entry.boards, at, search.query, readAttentionDismissals);
    // Keep loading / failed rows above the collapsed ones.
    return entry.status === "ready" ? row : { ...row, collapsed: false, score: -1 };
  });
  const counts = countStatusBar(allRows, at);
  const sortedRows = sortOverviewRows(allRows);
  const rows = sortOverviewRows(allRows
    .map((row) => (data[row.workspaceId]?.status === "ready" ? filterRowByStatus(row, statusFilter, at) : row))
    .filter((row) => !statusFilter || row.collapsed === false));

  // Blocked rows without lastSyncError read their card once for the reason text.
  const blockedRows = allRows.flatMap((row) => row.attentionAll
    .filter((entry) => entry.item.kind === "blocked")
    .map((entry) => ({ task: entry.task, reason: inboxReason(entry.item, entry.task) })));
  const commentsOf = useInboxReasonComments(blockedRows);

  const openFullTask = useCallback((task: TaskInfo, row: OverviewRow) => {
    const href = overviewTaskHref(task, row.workspaceId, row.fallbackBoardId);
    if (currentWorkspaceIdFromPath() === encodeURIComponent(row.workspaceId)) {
      // Same workspace: kanban-tab listens for popstate and opens the card.
      window.history.pushState(window.history.state, "", href);
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      onShowBoard();
      return;
    }
    router.push(href);
  }, [onShowBoard, router]);

  const selectedRow = selected ? allRows.find((row) => row.workspaceId === selected.workspaceId) : undefined;
  const selectedTask = selected ? selectedRow?.tasks.find((task) => task.id === selected.taskId) : undefined;

  const closeDrawer = useCallback(() => {
    const id = selected?.taskId;
    setSelected(null);
    // Back to the card row that opened the drawer (it may have been re-rendered since).
    window.setTimeout(() => {
      const trigger = triggerRef.current?.isConnected
        ? triggerRef.current
        : document.querySelector<HTMLElement>(`[data-testid="kanban-overview-card"][data-task-id="${id}"]`);
      trigger?.focus();
    }, 0);
  }, [selected?.taskId]);

  const openFromList = useCallback((task: TaskInfo, row: OverviewRow, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setSelected({ taskId: task.id, workspaceId: row.workspaceId });
  }, []);

  const toggleExpanded = useCallback((workspaceId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(workspaceId)) next.add(workspaceId);
      return next;
    });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="kanban-overview">
      <KanbanOverviewStatusBar counts={counts} active={statusFilter} onToggle={(status) => setStatusFilter((current) => (current === status ? null : status))} />
      <div className="flex items-center gap-2 px-1 pb-2">
        <OverviewModeToggle mode={mode} onChange={setMode} />
        <KanbanBoardSearchInput
          query={search.query}
          onQueryChange={search.setQuery}
          onClear={search.clear}
          inputRef={search.inputRef}
          placeholder={t.kanbanOverview.searchPlaceholder}
        />
      </div>
      {workspaces.length === 0 && <div className="px-1 py-2 text-[12px] text-secondary">{t.kanbanOverview.noWorkspaces}</div>}
      {mode === "status" ? (
        <div className="flex min-w-0 items-start gap-3">
          <KanbanOverviewByStatus
            rows={sortedRows}
            dataByWorkspace={data}
            statusFilter={statusFilter}
            query={search.query}
            now={at}
            paused={selected !== null}
            onOpenTask={openFromList}
            onRetry={retry}
            commentsOf={commentsOf}
          />
        </div>
      ) : rows.map((row) => (
        <WorkspaceRow
          key={row.workspaceId}
          row={row}
          data={data[row.workspaceId] ?? LOADING}
          query={search.query}
          now={at}
          expanded={expanded.has(row.workspaceId)}
          onToggleExpand={() => toggleExpanded(row.workspaceId)}
          onOpenTask={openFromList}
          onRetry={() => retry(row.workspaceId)}
          commentsOf={commentsOf}
        />
      ))}
      {selectedTask && selectedRow && (
        <KanbanOverviewDrawer
          key={selectedTask.id}
          task={selectedTask}
          projectTitle={selectedRow.title}
          columnLabel={columnName(selectedTask, data[selectedRow.workspaceId]?.boards ?? [])}
          onClose={closeDrawer}
          onOpenInBoard={() => {
            setSelected(null);
            openFullTask(selectedTask, selectedRow);
          }}
        />
      )}
    </div>
  );
}
