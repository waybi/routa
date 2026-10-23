"use client";

import { useState, type ComponentProps } from "react";
import { ArrowRight, Loader2, X } from "lucide-react";
import { Button, buttonClassName } from "@/client/components/ui/button";
import { EmptyState, ErrorState } from "@/client/components/ui/states";
import { useTranslation } from "@/i18n";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import type { KanbanAgentPromptHandler, KanbanBoardInfo } from "../types";
import { KanbanTabHeader } from "./kanban-tab-header";
import { KanbanStatusBar } from "./kanban-status-bar";
import { KanbanGitHubImportModal } from "./kanban-github-import-modal";
import { KanbanBoardSurface, KanbanCreateTaskModal } from "./kanban-board-surface";
import { KanbanTaskDetailOverlay } from "./kanban-tab-panels";
import { matchTask, normalizeSearchQuery } from "./kanban-board-search";
import { useKanbanBoardKeyboard } from "./use-kanban-board-keyboard";
import { KanbanSettingsModal } from "./kanban-settings-modal";
import { KanbanFitnessWorkbenchModal } from "./kanban-fitness-workbench-modal";
import {
  KanbanCodebaseModal,
  KanbanDeleteCodebaseModal,
  KanbanDeleteTaskModal,
  KanbanMoveBlockedModal,
  KanbanReplaceAllReposModal,
  KanbanWorktreeCleanupModal,
} from "./kanban-tab-modals";
import type { KanbanCodebaseModalProps } from "./kanban-tab-modals";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { KanbanTaskAgentCopy } from "./i18n/kanban-task-agent";
import { KanbanBoardSearchInput, useKanbanBoardSearch } from "./kanban-board-search";
import { KanbanAttentionBar } from "./kanban-attention-bar";
import { KanbanOverview, KanbanViewToggle, useKanbanViewMode } from "./kanban-overview";
import { emptyColumnRailWidth } from "./kanban-empty-column-rail";
import { useRailMode } from "./kanban-rail-mode";

type KanbanTabHeaderProps = Omit<ComponentProps<typeof KanbanTabHeader>, "actionSlot" | "toolbarSlot" | "onToggleDispatch" | "dispatchOpen">;
type BoardSurfaceProps = ComponentProps<typeof KanbanBoardSurface>;
type CreateTaskModalProps = ComponentProps<typeof KanbanCreateTaskModal>;
type GitHubImportModalProps = ComponentProps<typeof KanbanGitHubImportModal>;
type TaskDetailOverlayProps = ComponentProps<typeof KanbanTaskDetailOverlay>;
type SettingsModalProps = ComponentProps<typeof KanbanSettingsModal>;
type DeleteCodebaseModalProps = ComponentProps<typeof KanbanDeleteCodebaseModal> & { show: boolean };
type ReplaceAllReposModalProps = ComponentProps<typeof KanbanReplaceAllReposModal> & { show: boolean };
type DeleteTaskModalProps = ComponentProps<typeof KanbanDeleteTaskModal>;
type WorktreeCleanupModalProps = ComponentProps<typeof KanbanWorktreeCleanupModal>;
type MoveBlockedModalProps = ComponentProps<typeof KanbanMoveBlockedModal>;
type StatusBarProps = ComponentProps<typeof KanbanStatusBar>;
type FitnessWorkbenchModalProps = ComponentProps<typeof KanbanFitnessWorkbenchModal>;

export interface KanbanTabHeaderActionProps {
  board: KanbanBoardInfo | null;
  onAgentPrompt?: KanbanAgentPromptHandler;
  availableProviders: AcpProviderInfo[];
  selectedProviderId: string;
  onBoardProviderChange: (providerId: string) => void;
  disableBoardProvider: boolean;
  kanbanTaskAgentCopy: KanbanTaskAgentCopy;
  agentInput: string;
  onAgentInputChange: (value: string) => void;
  onAgentSubmit: () => void;
  showCreateTaskModal: () => void;
  agentLoading: boolean;
  /** Inline failure of the last dispatch; the typed text is kept. */
  agentError?: string | null;
  agentSessionId: string | null;
  openAgentPanel: (sessionId: string) => void;
}

export interface KanbanTabContentProps {
  headerProps: KanbanTabHeaderProps;
  headerActionProps: KanbanTabHeaderActionProps;
  boardSurfaceProps?: BoardSurfaceProps;
  createTaskModalProps: CreateTaskModalProps;
  githubImportModalProps: GitHubImportModalProps;
  taskDetailOverlayProps?: TaskDetailOverlayProps;
  showSettingsModal?: boolean;
  settingsModalProps?: SettingsModalProps;
  codebaseModalProps: KanbanCodebaseModalProps;
  deleteCodebaseModalProps: DeleteCodebaseModalProps;
  replaceAllReposModalProps: ReplaceAllReposModalProps;
  deleteTaskModalProps: DeleteTaskModalProps;
  worktreeCleanupModalProps: WorktreeCleanupModalProps;
  moveBlockedModalProps: MoveBlockedModalProps;
  statusBarProps: StatusBarProps;
  fitnessWorkbenchModalProps: FitnessWorkbenchModalProps;
}

/**
 * Placeholder columns for the window between mount and the boards fetch
 * settling. Keeps the board area occupied so the layout does not jump, and
 * makes it obvious that data is still on the way.
 */
export function KanbanBoardSkeleton({ label }: { label: string }) {
  // Same rhythm as the real board: two rails, two lanes, a wide Done lane.
  const lanes = ["rail", "rail", "lane", "lane", "done"] as const;
  // Same narrow column decision as the board, so the rails keep their width on load.
  const [railMode, railModeRef] = useRailMode<HTMLDivElement>({ railCount: 2, laneWidthsPx: [288, 288, 384] });
  return (
    <div
      ref={railModeRef}
      className="flex min-h-0 flex-1 gap-3 overflow-hidden"
      data-rail-mode={railMode}
      data-testid="kanban-board-skeleton"
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={label}
    >
      <span className="sr-only">{label}</span>
      {lanes.map((kind, column) => (
        <div
          key={column}
          aria-hidden="true"
          data-testid="kanban-board-skeleton-column"
          className={`flex shrink-0 flex-col gap-2 rounded-md bg-subtle p-2.5 ${kind === "rail" ? emptyColumnRailWidth(railMode) : kind === "done" ? "w-[24rem]" : "w-[18rem] min-w-[210px]"}`}
        >
          {kind !== "rail" && (
            <>
              <div className="h-3 w-20 rounded bg-hover motion-safe:animate-pulse" />
              {[0, 1, 2].map((card) => (
                <div key={card} className="space-y-2 rounded-md border border-default bg-surface p-3">
                  <div className="h-3 w-full rounded bg-hover motion-safe:animate-pulse" />
                  <div className="h-3 w-2/3 rounded bg-hover motion-safe:animate-pulse" />
                </div>
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function KanbanTabHeaderActionSlot({
  board,
  onAgentPrompt,
  availableProviders,
  selectedProviderId,
  onBoardProviderChange,
  disableBoardProvider,
  kanbanTaskAgentCopy,
  agentInput,
  onAgentInputChange,
  onAgentSubmit,
  showCreateTaskModal,
  agentLoading,
  agentError = null,
  agentSessionId,
  openAgentPanel,
  onClose,
}: KanbanTabHeaderActionProps & { onClose?: () => void }) {
  const { t } = useTranslation();

  if (!board) {
    return null;
  }

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1 rounded-control border border-default bg-surface p-1 transition-colors focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent"
      data-testid="kanban-dispatch-bar"
    >
      {onAgentPrompt && (
        <>
          <div className="shrink-0 border-r border-default pr-1">
            <AcpProviderDropdown
              providers={availableProviders}
              selectedProvider={selectedProviderId}
              onProviderChange={onBoardProviderChange}
              disabled={disableBoardProvider}
              ariaLabel={kanbanTaskAgentCopy.providerAriaLabel}
              dataTestId="kanban-agent-provider"
              buttonClassName="flex h-7 items-center gap-1.5 rounded bg-transparent px-2 text-[12px] font-medium text-primary transition-colors hover:bg-hover disabled:opacity-50"
              labelClassName="max-w-[110px] truncate"
            />
          </div>
          <input
            type="text"
            value={agentInput}
            onChange={(event) => onAgentInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onAgentSubmit();
              }
            }}
            placeholder={disableBoardProvider ? kanbanTaskAgentCopy.connectingPlaceholder : kanbanTaskAgentCopy.placeholder}
            disabled={agentLoading || disableBoardProvider}
            className="h-7 min-w-[12rem] flex-1 bg-transparent px-2 text-[12px] text-primary placeholder:text-secondary outline-none disabled:opacity-50"
            data-testid="kanban-agent-input"
          />
          <Button
            size="sm"
            onClick={onAgentSubmit}
            disabled={!agentInput.trim() || agentLoading || disableBoardProvider}
            data-testid="kanban-agent-submit"
          >
            {agentLoading ? (
              // Creating an ACP session takes seconds; say what is happening
              // instead of showing a bare "...".
              <>
                <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />
                <span>{t.feedback.agentSessionCreating}</span>
              </>
            ) : (
              <>
                <span>{kanbanTaskAgentCopy.send}</span>
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </>
            )}
          </Button>
        </>
      )}
      <Button variant="ghost" size="sm" onClick={showCreateTaskModal}>
        {kanbanTaskAgentCopy.manual}
      </Button>
      {agentSessionId && (
        <button
          type="button"
          onClick={() => openAgentPanel(agentSessionId)}
          className="shrink-0 px-1 text-[12px] text-accent hover:underline"
          title={kanbanTaskAgentCopy.openPanelTitle}
        >
          {kanbanTaskAgentCopy.view}
        </button>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-secondary hover:bg-hover hover:text-primary"
          aria-label={t.kanbanBoardPage.closeDispatch}
          title={t.kanbanBoardPage.closeDispatch}
          data-testid="kanban-dispatch-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {agentError && (
        <p role="alert" className="m-0 w-full px-2 pb-1 text-[12px] text-danger" data-testid="kanban-agent-error">
          {agentError}
        </p>
      )}
    </div>
  );
}

export function KanbanTabContent({
  headerProps,
  headerActionProps,
  boardSurfaceProps,
  createTaskModalProps,
  githubImportModalProps,
  taskDetailOverlayProps,
  showSettingsModal = false,
  settingsModalProps,
  codebaseModalProps,
  deleteCodebaseModalProps,
  replaceAllReposModalProps,
  deleteTaskModalProps,
  worktreeCleanupModalProps,
  moveBlockedModalProps,
  statusBarProps,
  fitnessWorkbenchModalProps,
}: KanbanTabContentProps) {
  const { t } = useTranslation();
  const copy = t.kanbanBoardPage;
  const search = useKanbanBoardSearch();
  const { view, setView } = useKanbanViewMode();
  // The dispatch bar starts open while a planning run is in flight or has
  // unsent text, so a failure never hides the typed request.
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const dispatchVisible = dispatchOpen
    || headerActionProps.agentLoading
    || Boolean(headerActionProps.agentError)
    || (headerActionProps.agentInput ?? "").trim().length > 0;
  const overview = view === "all" ? <KanbanOverview onShowBoard={() => setView("board")}/> : null;
  const { key: codebaseModalKey, ...codebaseModalRestProps } = codebaseModalProps as KanbanCodebaseModalProps & {
    key?: string;
  };
  const boardTasks = boardSurfaceProps?.boardTasks ?? [];
  const searching = normalizeSearchQuery(search.query) !== "";
  const hits = searching ? boardTasks.filter((task) => matchTask(task, search.query)).length : boardTasks.length;
  const { onKeyDown: onBoardKeyDown } = useKanbanBoardKeyboard({
    enabled: Boolean(boardSurfaceProps) && view === "board",
    onNewCard: headerProps.onCreateCard,
  });

  const toolbar = (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="kanban-toolbar">
      <KanbanViewToggle view={view} onChange={setView}/>
      {headerProps.board && view === "board" && (
        <>
          <KanbanBoardSearchInput
            query={search.query}
            onQueryChange={search.setQuery}
            onClear={search.clear}
            inputRef={search.inputRef}
          />
          <span className="shrink-0 font-mono text-[12px] text-secondary" data-testid="kanban-toolbar-hit-count">
            {copy.hitCount.replace("{hits}", String(hits)).replace("{total}", String(boardTasks.length))}
          </span>
        </>
      )}
    </div>
  );

  const dispatchBar = dispatchVisible ? (
    <KanbanTabHeaderActionSlot
      board={headerProps.board}
      onAgentPrompt={headerActionProps.onAgentPrompt}
      availableProviders={headerActionProps.availableProviders}
      selectedProviderId={headerActionProps.selectedProviderId}
      onBoardProviderChange={headerActionProps.onBoardProviderChange}
      disableBoardProvider={headerActionProps.disableBoardProvider}
      kanbanTaskAgentCopy={headerActionProps.kanbanTaskAgentCopy}
      agentInput={headerActionProps.agentInput}
      onAgentInputChange={headerActionProps.onAgentInputChange}
      onAgentSubmit={headerActionProps.onAgentSubmit}
      showCreateTaskModal={headerActionProps.showCreateTaskModal}
      agentLoading={headerActionProps.agentLoading}
      agentError={headerActionProps.agentError}
      agentSessionId={headerActionProps.agentSessionId}
      openAgentPanel={headerActionProps.openAgentPanel}
      onClose={() => setDispatchOpen(false)}
    />
  ) : null;

  const header = (
    <KanbanTabHeader
      {...headerProps}
      onToggleDispatch={headerProps.board ? () => setDispatchOpen((open) => !open) : undefined}
      dispatchOpen={dispatchVisible}
      toolbarSlot={toolbar}
      actionSlot={dispatchBar}
    />
  );

  const loadErrorBanner = headerProps.loadError ? (
    <ErrorState
      className="mb-3 shrink-0"
      title={copy.loadFailedTitle}
      message={`${copy.loadFailedHint} (${headerProps.loadError})`}
      onRetry={headerProps.onRefresh}
      retryLabel={copy.reload}
    />
  ) : null;

  if (!headerProps.board || !boardSurfaceProps || !taskDetailOverlayProps) {
    // Boards arrive asynchronously. Claiming "no board" during that window is
    // wrong and alarming, so show a skeleton until the fetch settles and only
    // then state the empty case.
    const boardsSettled = headerProps.boards.length > 0;
    return (
      <div className="flex h-full flex-col px-1 pt-1" data-testid="kanban-board-page">
        {header}
        {loadErrorBanner}
        {overview ?? (boardsSettled ? (
          <EmptyState title={t.kanban.noBoardAvailable} />
        ) : headerProps.loadError ? null : (
          <KanbanBoardSkeleton label={t.common.loading} />
        ))}
      </div>
    );
  }

  const boardEmpty = boardSurfaceProps.boardTasks.length === 0;

  return (
    <div className="flex h-full flex-col px-1 pt-1" data-testid="kanban-board-page">
      {header}
      {loadErrorBanner}
      {overview ?? (
        <>
          <KanbanAttentionBar
            board={boardSurfaceProps.board}
            tasks={boardSurfaceProps.boardTasks}
            onOpenTask={(task) => void boardSurfaceProps.openTaskDetail(task)}
          />
          {boardEmpty && !headerProps.loadError ? (
            <EmptyState
              className="mb-3"
              title={copy.emptyTitle}
              description={copy.emptyHint}
              action={headerProps.onCreateCard ? (
                <button type="button" className={buttonClassName("primary", "md")} onClick={headerProps.onCreateCard} data-testid="kanban-empty-new-card">
                  {copy.newCard}
                </button>
              ) : null}
            />
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onBoardKeyDown} data-testid="kanban-board-keyboard-scope">
            <KanbanBoardSurface {...boardSurfaceProps} searchQuery={search.query}/>
          </div>
        </>
      )}
      <KanbanCreateTaskModal {...createTaskModalProps}/>
      <KanbanGitHubImportModal {...githubImportModalProps}/>
      <KanbanTaskDetailOverlay {...taskDetailOverlayProps}/>

      {/* Settings Modal */}
      {showSettingsModal && settingsModalProps && (
        <KanbanSettingsModal {...settingsModalProps} />
      )}
      <KanbanCodebaseModal key={codebaseModalKey} {...codebaseModalRestProps}/>
      {deleteCodebaseModalProps.show && (
        <KanbanDeleteCodebaseModal {...deleteCodebaseModalProps}/>
      )}
      {replaceAllReposModalProps.show && replaceAllReposModalProps.codebasesCount > 0 && (
        <KanbanReplaceAllReposModal {...replaceAllReposModalProps}/>
      )}
      <KanbanDeleteTaskModal {...deleteTaskModalProps}/>
      <KanbanWorktreeCleanupModal {...worktreeCleanupModalProps}/>
      <KanbanMoveBlockedModal {...moveBlockedModalProps}/>
      <KanbanStatusBar {...statusBarProps}/>
      <KanbanFitnessWorkbenchModal {...fitnessWorkbenchModalProps}/>
    </div>
  );
}
