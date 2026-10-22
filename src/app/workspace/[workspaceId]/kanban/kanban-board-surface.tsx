"use client";

/**
 * Board body: droppable columns, empty-column rails, the Done window and the
 * side agent panel, plus the create-card modal wrapper. Split out of
 * kanban-tab-panels.tsx so the card-detail half there can change on its own.
 */

import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMemo, useState, type Dispatch, type SetStateAction, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "@/i18n";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { ChatPanel } from "@/client/components/chat-panel";
import type { RepoSelection } from "@/client/components/repo-picker";
import { KanbanCard, KanbanCardOverlay } from "./kanban-card";
import { KanbanEnhancedFileChangesPanel } from "./components/kanban-enhanced-file-changes-panel";
import type { KanbanTaskAgentCopy } from "./i18n/kanban-task-agent";
import { KanbanCreateModal, type TaskDraft } from "../kanban-create-modal";
import type { RepoSyncState } from "./kanban-repo-sync-status";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";
import {
  formatLaneAutomationCompactLabel,
  formatLaneAutomationSummary,
  resolveKanbanBoardAutoProviderId,
} from "./kanban-tab-helpers";
import type { ColumnAutomationConfig } from "./kanban-settings-modal";
import type { KanbanBoardInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import type { KanbanRepoChanges } from "./kanban-file-changes-types";
import { GitLogPanel, RealGitAdapter, MockGitAdapter } from "./git-log";
import { resolveCardMergeState } from "./kanban-card-status";
import { resolveCardLinkedSession } from "./kanban-session-activity";
import { DONE_COLUMN_ID, useDoneColumnWindow, windowDoneTasks } from "./kanban-done-column-window";
import { KanbanDoneCollapseToggle, KanbanDoneColumnFooter } from "./kanban-done-column-controls";
import { KanbanDoneSegments } from "./kanban-done-segments";
import { EMPTY_COLUMN_RAIL_WIDTH_CLASS, KanbanDoneCollapsedRail, KanbanEmptyColumnRail } from "./kanban-empty-column-rail";
import { HighlightedText, matchTask, normalizeSearchQuery } from "./kanban-board-search";
import { Badge } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}

function KanbanDropColumn({
  children,
  columnId,
  hasActiveDrag,
  widthClass,
  rail = false,
}: {
  children: ReactNode;
  columnId: string;
  hasActiveDrag: boolean;
  widthClass: string;
  /** Empty column: a narrow rail that is still a drop target. */
  rail?: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `column:${columnId}`,
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex h-full min-h-26.25 shrink-0 flex-col rounded-md bg-subtle transition-colors duration-150 motion-reduce:transition-none ${rail ? "py-3" : "p-2.5"} ${widthClass} ${isOver
        ? "outline-2 outline-offset-[-2px] outline-accent"
        : hasActiveDrag
          ? "outline-1 outline-offset-[-1px] outline-default outline-dashed"
          : ""
        }`}
      data-testid="kanban-column"
      data-column-id={columnId}
      data-drop-over={isOver ? "true" : undefined}
    >
      {children}
    </div>
  );
}

export function KanbanBoardSurface({
  moveError,
  onDismissMoveError,
  codebases,
  workspaceId,
  defaultCodebase,
  repoSync: _repoSync,
  onRefresh,
  repoChanges,
  repoChangesLoading,
  availableProviders,
  acp,
  boardAutoProviderId,
  kanbanTaskAgentCopy,
  agentSessionId,
  openAgentPanel,
  agentPanelOpen,
  board,
  visibleColumns,
  boardTasks,
  columnAutomation,
  providers,
  specialists,
  specialistLanguage,
  sessionMap,
  liveSessionTails,
  allCodebaseIds,
  worktreeCache,
  queuedPositions,
  moveTask,
  confirmDeleteTask,
  patchTask,
  retryTaskTrigger,
  runTaskPullRequest, // eslint-disable-line @typescript-eslint/no-unused-vars -- used in KanbanTaskCard props
  openTaskDetail,
  agentSession,
  onCloseAgentPanel,
  ensureKanbanAgentSession,
  kanbanRepoSelection,
  fileChangesOpen,
  setFileChangesOpen,
  gitLogOpen,
  setGitLogOpen,
  searchQuery = "",
}: {
  moveError: string | null;
  onDismissMoveError: () => void;
  codebases: CodebaseData[];
  workspaceId: string;
  defaultCodebase: CodebaseData | null;
  repoSync?: RepoSyncState;
  onRefresh: () => void;
  repoChanges: KanbanRepoChanges[];
  repoChangesLoading: boolean;
  availableProviders: AcpProviderInfo[];
  acp?: UseAcpState & UseAcpActions;
  boardAutoProviderId?: string;
  kanbanTaskAgentCopy: KanbanTaskAgentCopy;
  agentSessionId: string | null;
  openAgentPanel: (sessionId: string) => void;
  agentPanelOpen: boolean;
  board: KanbanBoardInfo;
  visibleColumns: string[];
  boardTasks: TaskInfo[];
  columnAutomation: Record<string, ColumnAutomationConfig>;
  providers: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  sessionMap: Map<string, SessionInfo>;
  liveSessionTails: Record<string, string>;
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  queuedPositions: Record<string, number | undefined>;
  moveTask: (taskId: string, targetColumnId: string) => Promise<void>;
  confirmDeleteTask: (task: TaskInfo) => void;
  patchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  retryTaskTrigger: (taskId: string) => Promise<void>;
  runTaskPullRequest: (taskId: string) => Promise<string | null>;
  openTaskDetail: (task: TaskInfo) => Promise<void>;
  agentSession?: SessionInfo;
  onCloseAgentPanel: () => void;
  ensureKanbanAgentSession: (
    cwd?: string,
    provider?: string,
    modeId?: string,
    model?: string,
  ) => Promise<string | null>;
  kanbanRepoSelection: RepoSelection | null;
  fileChangesOpen?: boolean;
  setFileChangesOpen?: Dispatch<SetStateAction<boolean>>;
  gitLogOpen?: boolean;
  setGitLogOpen?: Dispatch<SetStateAction<boolean>>;
  /** Board search query; empty = no filtering. */
  searchQuery?: string;
}) {
  const { t } = useTranslation();
  const searching = normalizeSearchQuery(searchQuery) !== "";
  const renderHighlighted = searching ? (text: string) => <HighlightedText text={text} query={searchQuery} /> : undefined;
  const [localFileChangesOpen, setLocalFileChangesOpen] = useState(false);
  const [localGitLogOpen, setLocalGitLogOpen] = useState(false);
  const [gitLogRepoPath, setGitLogRepoPath] = useState<string | null>(null);
  const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);
  const [activeDragCardWidth, setActiveDragCardWidth] = useState<number | null>(null);
  const doneColumn = useDoneColumnWindow(board.id);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 3 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 },
    }),
  );

  // Use external state if provided, otherwise use local state
  const fileChangesOpenValue = fileChangesOpen ?? localFileChangesOpen;
  const setFileChangesOpenValue = setFileChangesOpen ?? setLocalFileChangesOpen;
  const gitLogOpenValue = gitLogOpen ?? localGitLogOpen;
  const _setGitLogOpenValue = setGitLogOpen ?? setLocalGitLogOpen;

  // Use RealGitAdapter when a real repo is available; fall back to MockGitAdapter for demo
  const gitAdapter = useMemo(() => {
    const hasRealRepo = codebases.length > 0;
    return hasRealRepo ? new RealGitAdapter() : new MockGitAdapter();
  }, [codebases.length]);

  const activeGitLogRepoPath = useMemo(() => {
    if (gitLogRepoPath && codebases.some((codebase) => codebase.repoPath === gitLogRepoPath)) {
      return gitLogRepoPath;
    }
    return defaultCodebase?.repoPath ?? codebases[0]?.repoPath ?? null;
  }, [codebases, defaultCodebase?.repoPath, gitLogRepoPath]);
  const activeDragTask = useMemo(
    () => activeDragTaskId ? boardTasks.find((task) => task.id === activeDragTaskId) ?? null : null,
    [activeDragTaskId, boardTasks],
  );

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveDragTaskId(String(active.id));
    setActiveDragCardWidth(active.rect.current.initial?.width ?? null);
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveDragTaskId(null);
    setActiveDragCardWidth(null);
    if (!over) return;

    const targetId = String(over.id);
    if (!targetId.startsWith("column:")) return;

    const taskId = String(active.id);
    const sourceColumnId = active.data.current?.columnId;
    const targetColumnId = targetId.slice("column:".length);
    if (!targetColumnId) return;
    if (sourceColumnId === targetColumnId) return;
    await moveTask(taskId, targetColumnId);
  };

  const handleDragCancel = () => {
    setActiveDragTaskId(null);
    setActiveDragCardWidth(null);
  };

  return (
    <>
      {moveError && (
        <div role="alert" className="mb-2 shrink-0 rounded-md border border-danger bg-danger-subtle px-4 py-3 text-[13px] text-danger">
          <div className="flex items-start justify-between gap-3">
            <div className="leading-6">{moveError}</div>
            <button
              type="button"
              onClick={onDismissMoveError}
              className={buttonClassName("danger", "sm")}
            >
              {t.common.dismiss}
            </button>
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <KanbanEnhancedFileChangesPanel
            workspaceId={workspaceId}
            repos={repoChanges}
            loading={repoChangesLoading}
            open={fileChangesOpenValue}
            onClose={() => setFileChangesOpenValue(false)}
            onRefresh={onRefresh}
          />
          {gitLogOpenValue && (
            <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-default shadow-xl" style={{ height: "340px" }}>
              <GitLogPanel
                adapter={gitAdapter}
                repoPath={activeGitLogRepoPath ?? "/mock/repo"}
                codebases={codebases}
                onSelectRepoPath={setGitLogRepoPath}
                title={t.gitLog.title}
              />
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-auto pb-2" data-testid="kanban-board-content">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={(event) => {
                void handleDragEnd(event);
              }}
              onDragCancel={handleDragCancel}
            >
              <div className="flex h-full min-w-max items-stretch gap-3 pr-4">
                {board.columns
                  .slice()
                  .sort((left, right) => left.position - right.position)
                  .filter((column) => visibleColumns.includes(column.id))
                  .map((column) => {
                    const columnTasks = boardTasks.filter((task) => (task.columnId ?? "backlog") === column.id);
                    const unmergedCount = column.id === "done"
                      ? columnTasks.filter((task) => resolveCardMergeState(task) === "unmerged").length
                      : 0;
                    const isDoneColumn = column.id === DONE_COLUMN_ID;
                    const shownTasks = searching ? columnTasks.filter((task) => matchTask(task, searchQuery)) : columnTasks;
                    // Search shows every Done match: no 20-card window, no lane collapse.
                    const doneWindow = isDoneColumn
                      ? windowDoneTasks(shownTasks, { visibleCount: doneColumn.visibleCount, unlimited: searching })
                      : null;
                    const doneCollapsed = doneColumn.collapsed && !searching;
                    const renderedTasks = doneWindow ? [] : shownTasks;
                    const laneAutomation = columnAutomation[column.id] ?? column.automation;
                    const isEmptyColumn = columnTasks.length === 0;
                    const doneRail = isDoneColumn && doneCollapsed && !isEmptyColumn;
                    const widthClass = isEmptyColumn || doneRail
                      ? EMPTY_COLUMN_RAIL_WIDTH_CLASS
                      : column.width === "compact" ? "w-[14rem] min-w-[210px]" : column.width === "wide" || (isDoneColumn && !column.width) ? "w-[24rem]" : "w-[18rem] min-w-[210px]";

                    return (
                      <KanbanDropColumn
                        key={column.id}
                        columnId={column.id}
                        hasActiveDrag={activeDragTaskId !== null}
                        widthClass={widthClass}
                        rail={isEmptyColumn || doneRail}
                      >
                        {isEmptyColumn ? <KanbanEmptyColumnRail columnId={column.id} name={column.name} /> : doneRail ? (
                          <KanbanDoneCollapsedRail
                            columnId={column.id}
                            name={column.name}
                            total={columnTasks.length}
                            unmergedCount={unmergedCount}
                            onExpand={doneColumn.toggleCollapsed}
                          />
                        ) : <>
                        <div className="mb-2.5 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate text-[12px] font-semibold text-primary" data-testid={`kanban-column-name-${column.id}`}>{column.name}</div>
                            <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-secondary">
                              {unmergedCount > 0 && (
                                <span data-testid="kanban-done-unmerged-count" className="inline-flex">
                                  <Badge tone="attention">
                                    {t.kanbanDetail.unmergedCount.replace("{count}", String(unmergedCount))}
                                  </Badge>
                                </span>
                              )}
                              <span className="font-mono" data-testid={`kanban-column-count-${column.id}`}>
                                {searching
                                  ? t.kanbanSearch.matchCount.replace("{hits}", String(shownTasks.length)).replace("{total}", String(columnTasks.length))
                                  : `${columnTasks.length} ${t.kanbanBoard.cards}`}
                              </span>
                              {isDoneColumn && !searching && (
                                <KanbanDoneCollapseToggle collapsed={doneColumn.collapsed} onToggle={doneColumn.toggleCollapsed} />
                              )}
                            </div>
                          </div>
                          <div
                            className="truncate text-[11px] leading-4 text-secondary"
                            data-testid={`kanban-column-automation-${column.id}`}
                            title={laneAutomation?.enabled ? formatLaneAutomationSummary(laneAutomation, providers, specialists, {
                              autoProviderId: boardAutoProviderId,
                              autoLabel: t.common.auto,
                            }) : column.stage === "blocked" ? t.kanbanBoard.manualLaneOnly : t.kanbanBoard.manualLane}
                          >
                            {laneAutomation?.enabled
                              ? formatLaneAutomationCompactLabel(laneAutomation, providers, specialists, {
                                autoProviderId: boardAutoProviderId,
                                autoLabel: t.common.auto,
                              })
                              : column.stage === "blocked"
                                ? t.kanbanBoard.manualLaneOnly
                                : t.kanbanBoard.manualLane}
                          </div>
                        </div>

                        <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-0.5" data-testid={`kanban-column-body-${column.id}`}>
                          {doneWindow && !doneCollapsed && (
                            <KanbanDoneSegments
                              tasks={doneWindow.visible}
                              now={new Date()}
                              onOpenTask={(task) => void openTaskDetail(task)}
                              expandAll={searching}
                              searchQuery={searchQuery}
                            />
                          )}
                          {renderedTasks.map((task) => (
                            <KanbanCard
                              key={task.id}
                              task={task}
                              boardColumns={board.columns}
                              linkedSession={resolveCardLinkedSession(task, sessionMap)}
                              liveMessageTail={task.triggerSessionId ? liveSessionTails[task.triggerSessionId] : undefined}
                              availableProviders={availableProviders}
                              specialists={specialists}
                              specialistLanguage={specialistLanguage}
                              codebases={codebases}
                              allCodebaseIds={allCodebaseIds}
                              worktreeCache={worktreeCache}
                              autoProviderId={resolveKanbanBoardAutoProviderId(board, boardAutoProviderId)}
                              queuePosition={queuedPositions[task.id]}
                              onOpenDetail={() => openTaskDetail(task)}
                              onDelete={() => confirmDeleteTask(task)}
                              onPatchTask={patchTask}
                              onRetryTrigger={retryTaskTrigger}
                              onRefresh={onRefresh}
                              renderTitle={renderHighlighted}
                            />
                          ))}
                          {doneWindow && !doneCollapsed && !searching && (
                            <KanbanDoneColumnFooter
                              doneWindow={doneWindow}
                              onShowMore={doneColumn.showMore}
                              onShowLess={doneColumn.showLess}
                            />
                          )}
                        </div>
                        </>}
                      </KanbanDropColumn>
                    );
                  })}
              </div>
              {activeDragTask && typeof document !== "undefined" && createPortal(
                <DragOverlay adjustScale={false} dropAnimation={null} zIndex={80}>
                  <div style={activeDragCardWidth ? { width: activeDragCardWidth } : undefined}>
                    <KanbanCardOverlay
                      task={activeDragTask}
                      boardColumns={board.columns}
                      linkedSession={resolveCardLinkedSession(activeDragTask, sessionMap)}
                      liveMessageTail={activeDragTask.triggerSessionId ? liveSessionTails[activeDragTask.triggerSessionId] : undefined}
                      availableProviders={availableProviders}
                      specialists={specialists}
                      specialistLanguage={specialistLanguage}
                      codebases={codebases}
                      allCodebaseIds={allCodebaseIds}
                      worktreeCache={worktreeCache}
                      autoProviderId={resolveKanbanBoardAutoProviderId(board, boardAutoProviderId)}
                      queuePosition={queuedPositions[activeDragTask.id]}
                      onOpenDetail={() => {}}
                      onDelete={() => {}}
                      onPatchTask={patchTask}
                      onRetryTrigger={retryTaskTrigger}
                      onRefresh={onRefresh}
                    />
                  </div>
                </DragOverlay>,
                document.body,
              )}
            </DndContext>
          </div>
        </div>

        {agentPanelOpen && agentSessionId && acp && (
          <aside
            className="flex h-full w-lg min-w-md flex-col overflow-hidden rounded-md border border-default bg-surface"
            data-testid="kanban-agent-panel"
          >
            <div className="flex items-center justify-between border-b border-default px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-primary">{kanbanTaskAgentCopy.panelTitle}</div>
                <div
                  className="overflow-x-auto whitespace-nowrap text-[11px] text-secondary"
                  title={agentSessionId}
                >
                  {agentSession?.provider ?? boardAutoProviderId ?? acp.selectedProvider} · {agentSessionId}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/workspace/${workspaceId}/sessions/${agentSessionId}`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClassName("secondary", "sm")}
                >
                  {kanbanTaskAgentCopy.open}
                </a>
                <button
                  onClick={onCloseAgentPanel}
                  className={buttonClassName("secondary", "sm")}
                >
                  {kanbanTaskAgentCopy.close}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ChatPanel
                acp={acp}
                activeSessionId={agentSessionId}
                onEnsureSession={ensureKanbanAgentSession}
                onSelectSession={async (sessionId) => {
                  openAgentPanel(sessionId);
                }}
                repoSelection={kanbanRepoSelection}
                onRepoChange={() => {}}
                codebases={codebases}
                activeWorkspaceId={workspaceId}
                agentRole="DEVELOPER"
              />
            </div>
          </aside>
        )}
      </div>
    </>
  );
}

export function KanbanCreateTaskModal({
  showCreateModal,
  draft,
  setDraft,
  onClose,
  onCreate,
  creating = false,
  createError = null,
  githubAvailable,
  codebases,
  allCodebaseIds,
}: {
  showCreateModal: boolean;
  draft: TaskDraft;
  setDraft: Dispatch<SetStateAction<TaskDraft>>;
  onClose: () => void;
  onCreate: () => void;
  creating?: boolean;
  createError?: string | null;
  githubAvailable: boolean;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
}) {
  if (!showCreateModal) return null;

  return (
    <KanbanCreateModal
      draft={draft}
      setDraft={setDraft}
      onClose={onClose}
      onCreate={onCreate}
      creating={creating}
      createError={createError}
      githubAvailable={githubAvailable}
      codebases={codebases}
      allCodebaseIds={allCodebaseIds}
    />
  );
}
