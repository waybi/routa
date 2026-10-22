"use client";

import { useMemo, useRef, useState } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { Button } from "@/client/components/ui/button";
import { ErrorState, Skeleton } from "@/client/components/ui/states";
import { Tabs } from "@/client/components/ui/tabs";
import { resolveKanbanTransitionArtifacts } from "@/core/kanban/transition-artifacts";
import { hydrateTaskComments } from "@/core/models/task";
import { useTranslation } from "@/i18n";
import type { KanbanColumnInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import { KanbanCardDetailToolbar } from "./kanban-card-detail-toolbar";
import { getOrderedSessionIds, type KanbanSpecialistOption as SpecialistOption } from "./kanban-card-session-utils";
import { splitCompletionReports } from "./kanban-completion-report";
import { KanbanDetailChangesTab } from "./kanban-detail-changes-tab";
import { KanbanDetailCompletionTab } from "./kanban-detail-completion-tab";
import { KanbanDetailConstructionTab } from "./kanban-detail-construction-tab";
import { KanbanDetailOverviewTab } from "./kanban-detail-overview-tab";
import { KanbanDetailPropertyRail } from "./kanban-detail-property-rail";
import {
  consumeKanbanDetailTabRequest,
  resolveKanbanDetailTab,
  type KanbanDetailTabId,
} from "./kanban-detail-tab-request";
import { useKanbanTaskChangeSignal } from "./kanban-task-change-signal";
import { getKanbanSessionCopy } from "./i18n/kanban-session-copy";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";
export { KanbanCardActivityBar } from "./kanban-card-activity";

/**
 * Card detail shell (redesign card 3/6, design-spec §5/§7/§10): sticky
 * toolbar, editable title, four tabs (Overview / Construction / Changes &
 * Evidence / Completion) and the property rail, which sits to the right on
 * wide screens and moves under the detail below 1024px. Each tab lives in
 * its own kanban-detail-*-tab.tsx file.
 */

export interface KanbanCardDetailLoadState {
  /** True while the full record is being read for the first time. */
  loading: boolean;
  /** Last read failure; the summary stays on screen. */
  error: string | null;
  onRetry: () => void;
}

export interface KanbanCardDetailProps {
  task: TaskInfo;
  refreshSignal?: number;
  boardColumns?: KanbanColumnInfo[];
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  sessionInfo?: SessionInfo | null;
  sessions?: SessionInfo[];
  fullWidth?: boolean;
  selectedProvider?: string | null;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onRunPullRequest?: (taskId: string) => Promise<string | null>;
  onDelete: () => void;
  onRefresh: () => void;
  onProviderChange?: (providerId: string | null) => void;
  onRepositoryChange?: (codebaseIds: string[]) => void;
  onSelectSession?: (sessionId: string) => void;
  jitContextSessionId?: string | null;
  onLoadJitContextIntoSession?: (sessionId: string, prompt: string) => Promise<void>;
  onOpenJitContextHistoryAnalysis?: (prompt: string, targetWindow: Window | null) => Promise<void>;
  isFullscreen?: boolean;
  onToggleFullscreen?: (next: boolean) => void;
  onClose?: () => void;
  canShowSessionPane?: boolean;
  isSessionPaneVisible?: boolean;
  onShowSessionPane?: () => void;
  loadState?: KanbanCardDetailLoadState;
}

/** The tab each card was last left on (per page load), keyed by task id. */
const persistedKanbanDetailTabs = new Map<string, KanbanDetailTabId>();

export function KanbanCardDetail({
  task,
  refreshSignal,
  boardColumns,
  availableProviders,
  specialists,
  specialistLanguage,
  codebases,
  allCodebaseIds,
  worktreeCache,
  sessionInfo,
  sessions,
  fullWidth,
  selectedProvider,
  onPatchTask,
  onRetryTrigger,
  onRunPullRequest,
  onDelete,
  onRefresh,
  onProviderChange,
  onRepositoryChange,
  onSelectSession,
  jitContextSessionId,
  onLoadJitContextIntoSession,
  onOpenJitContextHistoryAnalysis,
  isFullscreen = false,
  onToggleFullscreen,
  onClose,
  canShowSessionPane = false,
  isSessionPaneVisible = false,
  onShowSessionPane,
  loadState,
}: KanbanCardDetailProps) {
  const { t } = useTranslation();
  const detailRefreshSignal = useKanbanTaskChangeSignal(task.id, refreshSignal);
  const { progressNotes, completionReports } = useMemo(
    () => splitCompletionReports(hydrateTaskComments(task.comments, task.comment)),
    [task],
  );
  const sessionCopy = getKanbanSessionCopy(specialistLanguage);
  const [editTitle, setEditTitle] = useState(task.title);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [editPriority, setEditPriority] = useState(task.priority ?? "medium");
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const compactMode = !fullWidth;
  const resolvedWorkspaceId = codebases[0]?.workspaceId ?? "";

  const taskCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds;
  const primaryRepoPath = codebases.find((codebase) => codebase.id === taskCodebaseIds[0])?.repoPath ?? null;
  const worktreePath = task.worktreeId ? worktreeCache[task.worktreeId]?.worktreePath ?? null : null;
  const taskRepoPath = worktreePath ?? primaryRepoPath;
  const historyRepoPath = taskCodebaseIds.length === 0 ? taskRepoPath : (primaryRepoPath ?? taskRepoPath);

  const currentLane = boardColumns?.find((column) => column.id === (task.columnId ?? "backlog"));
  const nextTransitionArtifacts = resolveKanbanTransitionArtifacts(boardColumns ?? [], task.columnId);
  const orderedSessionIds = getOrderedSessionIds(task);
  const activeRunSessionId = task.triggerSessionId ?? orderedSessionIds[orderedSessionIds.length - 1];
  const sessionCwdMismatch = sessionInfo && activeRunSessionId && taskRepoPath
    ? sessionInfo.cwd !== taskRepoPath
    : sessionInfo && activeRunSessionId ? false : undefined;

  const [tabSelection, setTabSelection] = useState<{ taskId: string; tab: KanbanDetailTabId } | null>(null);
  // A notification's one-shot request (toast or bell link) beats the stored choice.
  const requestedTab = consumeKanbanDetailTabRequest(task.id);
  if (requestedTab) {
    persistedKanbanDetailTabs.set(task.id, requestedTab);
    if (tabSelection?.taskId === task.id) setTabSelection({ taskId: task.id, tab: requestedTab });
  }
  const activeTab = tabSelection?.taskId === task.id
    ? tabSelection.tab
    : resolveKanbanDetailTab({
      requested: requestedTab,
      persisted: persistedKanbanDetailTabs.get(task.id),
      hasCompletionReport: Boolean(task.completionReport) || completionReports.length > 0,
    });
  const selectTab = (tab: KanbanDetailTabId) => {
    persistedKanbanDetailTabs.set(task.id, tab);
    setTabSelection({ taskId: task.id, tab });
  };

  const saveTitle = async () => {
    if (editTitle.trim() && editTitle !== task.title) {
      await onPatchTask(task.id, { title: editTitle });
      onRefresh();
    }
    setIsTitleEditing(false);
    titleInputRef.current?.blur();
  };
  const cancelTitle = () => {
    setEditTitle(task.title);
    setIsTitleEditing(false);
    titleInputRef.current?.blur();
  };

  const tabPanel = (id: KanbanDetailTabId) => {
    if (loadState?.loading) {
      return (
        <div className="space-y-3 py-4" data-testid="kanban-detail-loading">
          <Skeleton lines={4} label={t.kanbanDetailRedesign.detailLoading} />
          <p className="m-0 text-xs text-secondary">{t.kanbanDetailRedesign.detailLoading}</p>
        </div>
      );
    }
    switch (id) {
      case "overview":
        return (
          <KanbanDetailOverviewTab
            task={task}
            progressNotes={progressNotes}
            hasCompletionReport={completionReports.length > 0}
            compact={compactMode}
            onPatchTask={onPatchTask}
            onRefresh={onRefresh}
            onOpenCompletion={() => selectTab("completion")}
          />
        );
      case "construction":
        return (
          <KanbanDetailConstructionTab
            task={task}
            lane={currentLane}
            boardColumns={boardColumns ?? []}
            availableProviders={availableProviders}
            specialists={specialists}
            specialistLanguage={specialistLanguage}
            codebases={codebases}
            allCodebaseIds={allCodebaseIds}
            worktreeCache={worktreeCache}
            sessionInfo={sessionInfo}
            sessions={sessions ?? []}
            selectedProvider={selectedProvider}
            activeRunSessionId={activeRunSessionId}
            sessionCwdMismatch={sessionCwdMismatch}
            workspaceId={resolvedWorkspaceId || undefined}
            historyRepoPath={historyRepoPath}
            refreshSignal={detailRefreshSignal}
            compact={compactMode}
            onPatchTask={onPatchTask}
            onRetryTrigger={onRetryTrigger}
            onRefresh={onRefresh}
            onProviderChange={onProviderChange}
            onRepositoryChange={onRepositoryChange}
            onSelectSession={onSelectSession}
            jitContextSessionId={jitContextSessionId}
            onLoadJitContextIntoSession={onLoadJitContextIntoSession}
            onOpenJitContextHistoryAnalysis={onOpenJitContextHistoryAnalysis}
          />
        );
      case "changes":
        return (
          <KanbanDetailChangesTab
            task={task}
            codebases={codebases}
            workspaceId={resolvedWorkspaceId}
            refreshSignal={detailRefreshSignal}
            requiredArtifacts={nextTransitionArtifacts.nextRequiredArtifacts}
            compact={compactMode}
            onRefresh={onRefresh}
            onRunPullRequest={onRunPullRequest}
            onSelectSession={onSelectSession}
          />
        );
      case "completion":
        return (
          <KanbanDetailCompletionTab
            reports={completionReports}
            fallbackSummary={task.completionSummary}
            compact={compactMode}
          />
        );
    }
  };

  const tabs: Array<{ id: KanbanDetailTabId; label: string }> = [
    { id: "overview", label: t.kanbanDetail.overview },
    { id: "construction", label: t.kanbanDetailRedesign.construction },
    { id: "changes", label: t.kanbanDetailRedesign.changesAndEvidence },
    { id: "completion", label: t.kanbanDetail.completionReport },
  ];

  return (
    <div className="flex h-full w-full flex-col bg-canvas text-primary" data-testid="kanban-card-detail">
      <KanbanCardDetailToolbar
        compactMode={compactMode}
        isFullscreen={isFullscreen}
        cardId={task.id}
        onToggleFullscreen={onToggleFullscreen}
        onClose={onClose}
        onRefresh={onRefresh}
        showSessionPaneLabel={canShowSessionPane && !isSessionPaneVisible && onShowSessionPane ? sessionCopy.showSessionPane : undefined}
        onShowSessionPane={onShowSessionPane}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="min-w-0 flex-1 lg:overflow-y-auto" data-testid="kanban-detail-main">
          <div className={`mx-auto max-w-5xl pb-10 ${compactMode ? "px-4 pt-4" : "px-6 pt-5"}`}>
            <textarea
              ref={titleInputRef}
              value={isTitleEditing ? editTitle : task.title}
              readOnly={!isTitleEditing}
              aria-label={t.kanbanDetailRedesign.cardTitle}
              onFocus={() => {
                if (!isTitleEditing) {
                  setEditTitle(task.title);
                  setIsTitleEditing(true);
                }
              }}
              onChange={(event) => setEditTitle(event.target.value)}
              onKeyDown={async (event) => {
                if (event.key === "Escape") {
                  // Only leave title editing; the board's Esc must not close the detail.
                  event.preventDefault();
                  event.stopPropagation();
                  cancelTitle();
                  return;
                }
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  await saveTitle();
                }
              }}
              rows={isTitleEditing ? 2 : 1}
              className={`field-sizing-content w-full resize-none rounded-control border border-transparent bg-transparent px-1 py-0.5 font-semibold leading-tight text-primary outline-none focus-visible:border-accent ${compactMode ? "text-lg" : "text-[22px]"} ${isTitleEditing ? "bg-surface" : "cursor-text hover:bg-hover"}`}
            />
            {isTitleEditing ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Button variant="primary" size="xs" onMouseDown={(event) => event.preventDefault()} onClick={() => void saveTitle()}>
                  {t.common.save}
                </Button>
                <Button variant="secondary" size="xs" onMouseDown={(event) => event.preventDefault()} onClick={cancelTitle}>
                  {t.common.cancel}
                </Button>
              </div>
            ) : null}

            <Tabs
              className="mt-4"
              label={t.kanbanDetail.cardDetail}
              value={activeTab}
              onChange={(id) => selectTab(id as KanbanDetailTabId)}
              panelClassName=""
              items={tabs.map((tab) => ({
                id: tab.id,
                label: <span data-testid={`kanban-detail-tab-${tab.id}`}>{tab.label}</span>,
                content: (
                  <div data-testid={`kanban-detail-panel-${tab.id}`}>
                    {loadState?.error ? (
                      <div className="pt-4">
                        <ErrorState
                          title={t.kanbanDetailRedesign.detailLoadFailed}
                          message={`${t.kanbanDetailRedesign.detailLoadFailedHint} (${loadState.error})`}
                          onRetry={loadState.onRetry}
                          retryLabel={t.kanbanDetailRedesign.retryLoad}
                        />
                      </div>
                    ) : null}
                    {tabPanel(tab.id)}
                  </div>
                ),
              }))}
            />
          </div>
        </div>
        <div className="shrink-0 border-t border-default lg:w-[170px] lg:overflow-y-auto lg:border-l lg:border-t-0 xl:w-[210px]">
          <KanbanDetailPropertyRail
            task={task}
            runCount={orderedSessionIds.length}
            priority={task.priority ?? editPriority}
            onPriorityChange={async (value) => {
              setEditPriority(value);
              await onPatchTask(task.id, { priority: value });
              onRefresh();
            }}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
}
