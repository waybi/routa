"use client";

/**
 * "All projects" overview: one row per active workspace with three blocks
 * (in progress, needs you, recently done in 7 days) and a cross-workspace
 * search. Also owns the "This board / All projects" toggle, which lives in
 * the URL as `view=all` so a full reload keeps the overview.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/i18n";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import type { KanbanBoardInfo, TaskInfo } from "../types";
import type { KanbanAttentionKind } from "./kanban-attention-rules";
import { getDoneEnteredAt } from "./kanban-done-time";
import { HighlightedText, KanbanBoardSearchInput, normalizeSearchQuery, useKanbanBoardSearch } from "./kanban-board-search";
import {
  buildWorkspaceRow,
  formatDoneShort,
  overviewTaskHref,
  shortSha,
  sortOverviewRows,
  type OverviewRow,
} from "./kanban-overview-rules";
import { readAttentionDismissals } from "./use-kanban-attention-dismissals";
import { useKanbanOverviewData, type OverviewWorkspaceData } from "./use-kanban-overview-data";

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
      className={`h-6 px-2 text-[11px] font-medium transition-colors ${view === mode
        ? "bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-950"
        : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#1f232f]"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-slate-200 dark:border-slate-700" role="group">
      {button("board", t.kanbanOverview.viewBoard)}
      {button("all", t.kanbanOverview.viewAll)}
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

function columnName(task: TaskInfo, boards: readonly KanbanBoardInfo[]): string {
  const board = boards.find((item) => item.id === task.boardId) ?? boards.find((item) => item.isDefault) ?? boards[0];
  return board?.columns.find((column) => column.id === task.columnId)?.name ?? task.columnId ?? "";
}

const cardClass = "flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[11px] text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#1f232f]";
const chipClass = "shrink-0 rounded-full bg-slate-100 px-1.5 text-[9px] text-slate-500 dark:bg-[#191c28] dark:text-slate-400";

interface BlockProps {
  title: string;
  count: string;
  testId: string;
  children: React.ReactNode;
}

function Block({ title, count, testId, children }: BlockProps) {
  return (
    <section className="min-w-0 flex-1 rounded-lg border border-slate-200/70 p-1.5 dark:border-[#1c1f2e]" data-testid={testId}>
      <header className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200" data-testid={`${testId}-header`}>
        {title}
        <span className="font-normal text-slate-400">{count}</span>
      </header>
      <div className="max-h-40 space-y-0.5 overflow-y-auto">{children}</div>
    </section>
  );
}

function WorkspaceRow({
  row,
  data,
  query,
  onOpenTask,
  onRetry,
}: {
  row: OverviewRow;
  data: OverviewWorkspaceData;
  query: string;
  onOpenTask: (task: TaskInfo, row: OverviewRow) => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const count = (n: number) => t.kanbanOverview.blockCount.replace("{count}", String(n));
  const kindLabel = (kind: KanbanAttentionKind, ahead: number) => (kind === "unmerged"
    ? t.kanbanAttention.unmerged.replace("{count}", String(ahead))
    : t.kanbanAttention[kind]);
  const searching = normalizeSearchQuery(query).length > 0;
  const openButton = (task: TaskInfo, body: React.ReactNode) => (
    <button key={task.id} type="button" className={cardClass} title={task.title} onClick={() => onOpenTask(task, row)} data-testid="kanban-overview-card" data-task-id={task.id}>
      {body}
    </button>
  );

  const head = (
    <div className="w-44 shrink-0">
      <div className="truncate text-[12px] font-semibold text-slate-900 dark:text-slate-100">{row.title}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.kanbanOverview.cardCount.replace("{count}", String(row.totalCount))}</div>
      {row.showsNoUnmergedBadge && data.status === "ready" && (
        <span className="mt-0.5 inline-block rounded-full bg-slate-100 px-1.5 text-[9px] text-slate-500 dark:bg-[#191c28] dark:text-slate-400" title={t.kanbanOverview.noUnmergedHint} data-testid="kanban-overview-no-unmerged">
          {t.kanbanOverview.noUnmergedBadge}
        </span>
      )}
    </div>
  );

  let body: React.ReactNode;
  if (data.status === "error") {
    body = (
      <div className="flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400" data-testid="kanban-overview-error">
        {t.kanbanOverview.loadFailed}
        <button type="button" onClick={onRetry} className="rounded border border-slate-200 px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300" data-testid="kanban-overview-retry">
          {t.kanbanOverview.retry}
        </button>
      </div>
    );
  } else if (data.status === "loading") {
    body = <div className="text-[11px] text-slate-400">{t.kanbanOverview.loading}</div>;
  } else if (row.collapsed) {
    body = <div className="text-[11px] text-slate-400">{t.kanbanOverview.emptyRow}</div>;
  } else {
    body = (
      <div className="flex min-w-0 flex-1 gap-2">
        <Block title={t.kanbanOverview.inProgress} count={count(row.inProgress.length)} testId="kanban-overview-in-progress">
          {row.inProgress.map((task) => openButton(task, (
            <>
              <span className={chipClass}>{columnName(task, data.boards)}</span>
              <span className="truncate"><HighlightedText text={task.title} query={query} /></span>
            </>
          )))}
        </Block>
        <Block title={t.kanbanOverview.needsYou} count={count(row.attention.length)} testId="kanban-overview-attention">
          {row.attention.map((entry) => (
            <span key={`${entry.task.id}|${entry.item.kind}`} className="block" data-kind={entry.item.kind}>
              {openButton(entry.task, (
                <>
                  <span className="shrink-0 rounded-full bg-red-100 px-1.5 text-[9px] text-red-600 dark:bg-red-900/20 dark:text-red-400">{kindLabel(entry.item.kind, entry.item.ahead)}</span>
                  <span className="truncate"><HighlightedText text={entry.task.title} query={query} /></span>
                </>
              ))}
            </span>
          ))}
        </Block>
        <Block
          title={searching ? t.kanbanOverview.recentDoneMatches.replace("{count}", String(row.recentDone.total)) : t.kanbanOverview.recentDone7d}
          count={searching ? "" : count(row.recentDone.total)}
          testId="kanban-overview-recent-done"
        >
          {row.recentDone.items.map((task) => {
            const sha = shortSha(task.completionReport?.commit);
            return openButton(task, (
              <>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">{formatDoneShort(getDoneEnteredAt(task))}</span>
                <span className="truncate"><HighlightedText text={task.completionReport?.excerpt || task.title} query={query} /></span>
                {sha && <span className="shrink-0 font-mono text-[10px] text-slate-400"><HighlightedText text={sha} query={query} /></span>}
              </>
            ));
          })}
        </Block>
      </div>
    );
  }

  return (
    <div
      className={`flex items-start gap-3 border-b border-slate-200/70 px-4 ${row.collapsed && data.status === "ready" ? "py-1.5" : "py-2"} dark:border-[#1c1f2e]`}
      data-testid="kanban-overview-row"
      data-workspace-id={row.workspaceId}
      data-collapsed={row.collapsed && data.status === "ready" ? "true" : "false"}
    >
      {head}
      {body}
    </div>
  );
}

const LOADING: OverviewWorkspaceData = { status: "loading", tasks: [], boards: [] };

export function KanbanOverview({ onShowBoard, now }: { onShowBoard: () => void; now?: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { workspaces } = useWorkspaces();
  const { data, retry } = useKanbanOverviewData(workspaces);
  const search = useKanbanBoardSearch();
  const at = useMinuteClock(now);

  // Read dismissals on every render: the single-board bar may have changed them.
  const rows = sortOverviewRows(workspaces.map((workspace) => {
    const entry = data[workspace.id] ?? LOADING;
    const row = buildWorkspaceRow(workspace, entry.tasks, entry.boards, at, search.query, readAttentionDismissals);
    // Keep loading / failed rows above the collapsed ones.
    return entry.status === "ready" ? row : { ...row, collapsed: false, score: -1 };
  }));

  const openTask = useCallback((task: TaskInfo, row: OverviewRow) => {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="kanban-overview">
      <div className="flex items-center gap-2 px-4 py-1.5">
        <KanbanBoardSearchInput
          query={search.query}
          onQueryChange={search.setQuery}
          onClear={search.clear}
          inputRef={search.inputRef}
          placeholder={t.kanbanOverview.searchPlaceholder}
        />
      </div>
      {workspaces.length === 0 && <div className="px-4 py-2 text-[12px] text-slate-500">{t.kanbanOverview.noWorkspaces}</div>}
      {rows.map((row) => (
        <WorkspaceRow
          key={row.workspaceId}
          row={row}
          data={data[row.workspaceId] ?? LOADING}
          query={search.query}
          onOpenTask={openTask}
          onRetry={() => retry(row.workspaceId)}
        />
      ))}
    </div>
  );
}
