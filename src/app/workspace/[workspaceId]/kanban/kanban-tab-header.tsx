import { useTranslation } from "@/i18n";
import { Select } from "@/client/components/select";
import { Button } from "@/client/components/ui/button";
import type { KanbanBoardInfo } from "../types";
import { useCallback, useState, type ReactNode } from "react";
import { Download, MessageSquarePlus, Plus, RefreshCw, Settings } from "lucide-react";

interface KanbanTabHeaderProps {
  tasksCount: number;
  board: KanbanBoardInfo | null;
  boardQueue?: KanbanBoardInfo["queue"];
  boards: KanbanBoardInfo[];
  selectedBoardId: string | null;
  onSelectBoard: (boardId: string) => void;
  githubImportVisible?: boolean;
  onOpenGitHubImport: () => void;
  onRefresh: () => void;
  onOpenSettings?: () => void;
  /** Opens the create-card modal ("New card", primary). */
  onCreateCard?: () => void;
  /** Toggles the board-input dispatch bar ("Add request"). */
  onToggleDispatch?: () => void;
  dispatchOpen?: boolean;
  /** Last load failure; rendered by the content layer, unused here. */
  loadError?: string | null;
  /** Toolbar row under the title (view toggle, search, hit count). */
  toolbarSlot?: ReactNode;
  /** Row under the toolbar (board-input dispatch bar). */
  actionSlot?: ReactNode;
}

/**
 * Page header per the redesign (design-spec §2: ~48px header, main actions
 * fixed on the right): title on the left; Board settings · Add request ·
 * New card on the right; the toolbar row and the dispatch row sit underneath.
 */
export function KanbanTabHeader({
  tasksCount,
  board,
  boardQueue: _boardQueue,
  boards,
  selectedBoardId,
  onSelectBoard,
  githubImportVisible = false,
  onOpenGitHubImport,
  onRefresh,
  onOpenSettings,
  onCreateCard,
  onToggleDispatch,
  dispatchOpen = false,
  loadError: _loadError,
  toolbarSlot,
  actionSlot,
}: KanbanTabHeaderProps) {
  const { t } = useTranslation();
  const copy = t.kanbanBoardPage;
  // `onRefresh` is fire-and-forget upstream, so there is nothing to await.
  // Spin for a short beat anyway so the click looks acknowledged.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      onRefresh();
    } finally {
      setTimeout(() => setRefreshing(false), 600);
    }
  }, [onRefresh, refreshing]);

  return (
    <div className="shrink-0 space-y-3 pb-3" data-testid="kanban-page-header">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="m-0 text-[21px] font-[650] leading-tight text-primary">{copy.title}</h1>
          {tasksCount > 0 && (
            <span className="font-mono text-[11px] text-secondary" data-testid="kanban-task-count">
              {tasksCount} {t.kanban.tasksCount}
            </span>
          )}
          {board && (
            <span className="rounded bg-subtle px-1.5 py-0.5 text-[11px] text-secondary">
              {t.kanban.limit} {board.sessionConcurrencyLimit ?? 1}
            </span>
          )}
          {boards.length > 1 && (
            <Select
              value={selectedBoardId ?? ""}
              onChange={(event) => onSelectBoard(event.target.value)}
              className="h-7 min-h-7 max-w-[220px] rounded-control border border-default bg-surface px-2 text-[12px] text-primary"
            >
              {boards.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </Select>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            data-testid="kanban-refresh"
            className="inline-flex h-7 w-7 items-center justify-center rounded-control text-secondary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
            title={t.common.refresh}
            aria-label={t.common.refresh}
          >
            <RefreshCw
              className={`h-3.5 w-3.5${refreshing ? " motion-safe:animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2" data-testid="kanban-header-actions">
          {githubImportVisible ? (
            <Button variant="ghost" size="md" onClick={onOpenGitHubImport} title={t.kanban.importGithubIssues}>
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {t.kanban.importGithubIssues}
            </Button>
          ) : null}
          {onOpenSettings && (
            <Button variant="secondary" size="md" onClick={onOpenSettings} data-testid="kanban-open-settings">
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              {copy.boardSettings}
            </Button>
          )}
          {onToggleDispatch && (
            <Button
              variant="secondary"
              size="md"
              onClick={onToggleDispatch}
              aria-expanded={dispatchOpen}
              data-testid="kanban-open-dispatch"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
              {copy.addRequest}
            </Button>
          )}
          {onCreateCard && (
            <Button variant="primary" size="md" onClick={onCreateCard} data-testid="kanban-new-card">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {copy.newCard}
            </Button>
          )}
        </div>
      </div>
      {toolbarSlot}
      {actionSlot}
    </div>
  );
}
