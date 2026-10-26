import { useState, type Dispatch, type SetStateAction, type RefObject } from "react";
import { useTranslation } from "@/i18n";
import type { AcpProviderInfo, AcpTaskAdaptiveHarnessOptions } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { ChatPanel } from "@/client/components/chat-panel";
import { resolveEffectiveTaskAutomation } from "@/core/kanban/effective-task-automation";
import { KanbanCardActivityBar, KanbanCardDetail } from "./kanban-card-detail";
import { buildKanbanHumanReadableReplyPrompt } from "./i18n/kanban-task-agent";
import { KanbanCardActivityPanel, KanbanEmptySessionPane } from "./kanban-card-activity";
import { formatSessionTimestamp } from "./kanban-card-session-utils";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";
import {
  canSelectTaskSessionInAcp,
  getTaskLaneSession,
  isA2ATaskSession,
  resolveKanbanBoardAutoProviderId,
} from "./kanban-tab-helpers";
import type { KanbanBoardInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import { buildKanbanTaskAdaptiveHarnessOptions } from "./kanban-task-adaptive";
import type { KanbanTaskDetailHydration } from "./use-kanban-task-detail-hydration";

export { KanbanBoardSurface, KanbanCreateTaskModal } from "./kanban-board-surface";

interface SessionRestoreTranscriptMessage {
  role?: string;
  content?: string;
  toolName?: string;
  toolStatus?: string;
}

const KANBAN_RESTORE_CONTEXT_MESSAGE_LIMIT = 4;
const KANBAN_RESTORE_CONTEXT_CHAR_LIMIT = 1800;
const KANBAN_RESTORE_MESSAGE_CHAR_LIMIT = 700;

function isRecoverableAcpSessionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") return false;
  return message.includes("embedded ACP processes cannot be resumed on a different instance")
    || message.includes("session/load not supported");
}

function normalizeRestoreContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNoisyRestoreContent(content: string): boolean {
  const lines = content.split("\n");
  if (lines.length > 18) return true;
  if (content.length > 1200) return true;
  return /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+(INFO|WARN|ERROR)\s/.test(content)
    || /\b(test result:|Running tests\/|Doc-tests|SQLite database opened at:)\b/.test(content);
}

function truncateRestoreContent(content: string): string {
  if (content.length <= KANBAN_RESTORE_MESSAGE_CHAR_LIMIT) return content;
  return `${content.slice(0, KANBAN_RESTORE_MESSAGE_CHAR_LIMIT).trimEnd()}\n[truncated]`;
}

function formatRestoreTranscriptLine(message: SessionRestoreTranscriptMessage): string | null {
  if (!["user", "assistant", "plan", "info"].includes(message.role ?? "")) return null;

  const content = normalizeRestoreContent(message.content ?? "");
  if (!content) return null;
  if (isNoisyRestoreContent(content)) return null;

  const excerpt = truncateRestoreContent(content);

  switch (message.role) {
    case "user":
      return `User: ${excerpt}`;
    case "assistant":
      return `Assistant: ${excerpt}`;
    case "plan":
      return `Plan: ${excerpt}`;
    case "info":
      return `Info: ${excerpt}`;
    default:
      return null;
  }
}

/**
 * createSession arguments that rebuild a lost session like the original:
 * same provider (else the board/selected one), model and reasoning effort.
 */
export function buildKanbanSessionReplacementArgs(
  session: SessionInfo,
  fallbackProvider: string | undefined,
  workspaceId: string,
): Parameters<UseAcpActions["createSession"]> {
  return [
    session.cwd, session.provider ?? fallbackProvider, session.modeId, session.role,
    session.workspaceId || workspaceId, session.model, undefined, session.specialistId,
    undefined, undefined, undefined, session.branch,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    session.reasoningEffort || undefined,
  ];
}

export function buildKanbanSessionRestorePrompt(
  task: TaskInfo | null,
  session: SessionInfo,
  messages: SessionRestoreTranscriptMessage[],
): string {
  const recent = messages
    .filter((message) => message.role !== "thought")
    .map(formatRestoreTranscriptLine)
    .filter((value): value is string => Boolean(value))
    .slice(-KANBAN_RESTORE_CONTEXT_MESSAGE_LIMIT);

  let transcript = recent.join("\n\n");
  if (transcript.length > KANBAN_RESTORE_CONTEXT_CHAR_LIMIT) {
    transcript = transcript.slice(transcript.length - KANBAN_RESTORE_CONTEXT_CHAR_LIMIT).trimStart();
  }

  const taskContext = task
    ? [
        `- Card: ${task.title}`,
        task.objective ? `- Objective: ${task.objective}` : null,
        task.columnId ? `- Column: ${task.columnId}` : null,
        task.status ? `- Status: ${task.status}` : null,
      ].filter(Boolean).join("\n")
    : "- Card: unknown";

  return [
    "Continue the previous Routa Kanban card session. Do not summarize the transcript; continue the card work directly.",
    "",
    "Card context:",
    taskContext,
    "",
    "Session context:",
    `- Previous session: ${session.sessionId}`,
    session.cwd ? `- Working directory: ${session.cwd}` : null,
    session.branch ? `- Branch: ${session.branch}` : null,
    transcript ? "" : null,
    transcript ? "Recent clean conversation:" : null,
    transcript || null,
    "",
    "Next: inspect the repo if needed, then proceed with the smallest next action for this card.",
  ].filter(Boolean).join("\n");
}

function buildKanbanHistoryAnalysisSessionName(
  task: TaskInfo,
  specialistLanguage: KanbanSpecialistLanguage,
): string {
  return specialistLanguage === "zh-CN"
    ? `历史分析 · ${task.title}`
    : `History Analysis · ${task.title}`;
}

function buildKanbanHistoryAnalysisCreationError(
  payload: { error?: { message?: string } } | null,
  fallbackMessage: string,
): string {
  return payload?.error?.message || fallbackMessage;
}

function buildKanbanHistoryAnalysisSessionUrl(workspaceId: string, sessionId: string): string {
  return `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`;
}

async function startKanbanHistoryAnalysisSession(params: {
  workspaceId: string;
  task: TaskInfo;
  repoPath?: string;
  branch?: string;
  provider?: string;
  specialistLanguage: KanbanSpecialistLanguage;
  taskAdaptiveHarness: AcpTaskAdaptiveHarnessOptions;
  prompt: string;
  targetWindow: Window | null;
  fallbackErrorMessage: string;
}): Promise<string> {
  if (!params.targetWindow) {
    throw new Error(params.fallbackErrorMessage);
  }

  const response = await desktopAwareFetch("/api/acp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `kanban-history-analysis:${Date.now()}`,
      method: "session/new",
      params: {
        workspaceId: params.workspaceId,
        cwd: params.repoPath,
        branch: params.branch,
        role: "ROUTA",
        name: buildKanbanHistoryAnalysisSessionName(params.task, params.specialistLanguage),
        provider: params.provider,
        specialistId: "history-summary-analyst",
        specialistLocale: params.specialistLanguage,
        toolMode: "full",
        mcpProfile: "kanban-planning",
        allowedNativeTools: ["Skill", "Read", "Glob", "Grep"],
        taskAdaptiveHarness: params.taskAdaptiveHarness,
      },
    }),
  });

  const payload = await response.json().catch(() => null) as {
    result?: { sessionId?: string };
    error?: { message?: string };
  } | null;

  if (!response.ok) {
    throw new Error(buildKanbanHistoryAnalysisCreationError(payload, params.fallbackErrorMessage));
  }
  if (payload?.error?.message) {
    throw new Error(payload.error.message);
  }

  const sessionId = payload?.result?.sessionId;
  if (!sessionId) {
    throw new Error(params.fallbackErrorMessage);
  }

  params.targetWindow.location.href = buildKanbanHistoryAnalysisSessionUrl(params.workspaceId, sessionId);

  const promptResponse = await desktopAwareFetch("/api/acp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `kanban-history-analysis-prompt:${Date.now()}`,
      method: "session/prompt",
      params: {
        sessionId,
        prompt: [{ type: "text", text: params.prompt }],
      },
    }),
  });

  const promptPayload = await promptResponse.json().catch(() => null) as {
    error?: { message?: string };
  } | null;
  if (!promptResponse.ok) {
    throw new Error(buildKanbanHistoryAnalysisCreationError(promptPayload, params.fallbackErrorMessage));
  }
  if (promptPayload?.error?.message) {
    throw new Error(promptPayload.error.message);
  }

  return sessionId;
}

async function fetchSessionTranscriptForRestore(sessionId: string): Promise<SessionRestoreTranscriptMessage[]> {
  const response = await desktopAwareFetch(`/api/sessions/${encodeURIComponent(sessionId)}/transcript`, { cache: "no-store" });
  if (!response.ok) return [];
  const data = await response.json().catch(() => null) as { messages?: unknown } | null;
  return Array.isArray(data?.messages) ? data.messages as SessionRestoreTranscriptMessage[] : [];
}

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}


function A2ASessionPane({
  task,
  laneSession,
  sessions,
  specialists,
  specialistLanguage,
  refreshSignal,
  currentSessionId,
  onSelectSession,
  onCloseSession,
}: {
  task: TaskInfo;
  laneSession?: NonNullable<TaskInfo["laneSessions"]>[number];
  sessions: SessionInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  refreshSignal?: number;
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: () => void;
}) {
  const metadata = [
    { label: "Transport", value: (laneSession?.transport ?? "a2a").toUpperCase() },
    { label: "Status", value: laneSession?.status ?? "running" },
    { label: "Lane", value: laneSession?.columnName ?? laneSession?.columnId ?? task.columnId ?? "Unknown lane" },
    { label: "Role", value: laneSession?.role ?? task.assignedRole ?? "Unknown role" },
    { label: "Specialist", value: laneSession?.specialistName ?? laneSession?.specialistId ?? task.assignedSpecialistName ?? task.assignedSpecialistId ?? "Unknown specialist" },
    { label: "Remote task", value: laneSession?.externalTaskId ?? "Unavailable" },
    { label: "Context", value: laneSession?.contextId ?? "Unavailable" },
    { label: "Started", value: formatSessionTimestamp(laneSession?.startedAt ?? task.createdAt) },
    { label: "Completed", value: formatSessionTimestamp(laneSession?.completedAt) },
  ];

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-default bg-canvas py-1 pl-1 pr-2" data-testid="kanban-session-pane-top-row">
        <KanbanCardActivityBar
          task={task}
          sessions={sessions}
          specialistLanguage={specialistLanguage}
          currentSessionId={currentSessionId}
          onSelectSession={onSelectSession}
          onCloseSession={onCloseSession}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas p-4">
        <div className="grid gap-4">
          <section className="rounded-lg border border-default bg-surface p-4">
            <div className="text-xs font-semibold text-information">A2A Run</div>
            <div className="mt-2 break-all text-base font-semibold text-primary">
              {laneSession?.externalTaskId ?? laneSession?.contextId ?? currentSessionId ?? "A2A task"}
            </div>
            <p className="mt-3 text-sm leading-6 text-secondary">
              This lane run completed through A2A transport. ACP chat and trace are not available for synthetic A2A sessions, so this pane shows the recorded task metadata instead.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {metadata.map((entry) => (
                <div
                  key={entry.label}
                  className="border-b border-default px-3 py-2.5"
                >
                  <div className="text-[11px] text-secondary">
                    {entry.label}
                  </div>
                  <div className="mt-1 break-all text-sm font-medium text-primary">
                    {entry.value}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <KanbanCardActivityPanel
            task={task}
            refreshSignal={refreshSignal}
            sessions={sessions}
            specialists={specialists}
            specialistLanguage={specialistLanguage}
            currentSessionId={currentSessionId}
            onSelectSession={onSelectSession}
            compact
          />
        </div>
      </div>
    </div>
  );
}

export function KanbanTaskDetailOverlay({
  activeSessionId,
  activeTaskId,
  activeTask,
  detailHydration,
  board,
  resolveSpecialist,
  acp,
  boardAutoProviderId,
  onBoardProviderChange,
  detailSplitContainerRef,
  detailSplitRatio,
  setIsDraggingDetailSplit,
  refreshSignal,
  availableProviders,
  specialists,
  specialistLanguage,
  codebases,
  allCodebaseIds,
  worktreeCache,
  combinedSessions,
  patchTask,
  retryTaskTrigger,
  runTaskPullRequest,
  confirmDeleteTask,
  onRefresh,
  setActiveSessionId,
  pinSessionId,
  sessionMap,
  workspaceId,
  isTaskDetailFullscreen,
  onToggleTaskDetailFullscreen,
  closeTaskDetail,
}: {
  activeSessionId: string | null;
  activeTaskId: string | null;
  activeTask: TaskInfo | null;
  detailHydration?: KanbanTaskDetailHydration;
  board: KanbanBoardInfo | null;
  resolveSpecialist: ReturnType<typeof import("./kanban-card-session-utils").createKanbanSpecialistResolver>;
  acp?: UseAcpState & UseAcpActions;
  boardAutoProviderId?: string;
  onBoardProviderChange: (providerId: string) => void;
  detailSplitContainerRef: RefObject<HTMLDivElement | null>;
  detailSplitRatio: number;
  setIsDraggingDetailSplit: Dispatch<SetStateAction<boolean>>;
  refreshSignal?: number;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  combinedSessions: SessionInfo[];
  patchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  retryTaskTrigger: (taskId: string) => Promise<void>;
  runTaskPullRequest: (taskId: string) => Promise<string | null>;
  confirmDeleteTask: (task: TaskInfo) => void;
  onRefresh: () => void;
  setActiveSessionId: Dispatch<SetStateAction<string | null>>;
  /** Marks a session the panel switched to on purpose so the board's reconcile does not bounce off it. */
  pinSessionId?: (sessionId: string) => void;
  sessionMap: Map<string, SessionInfo>;
  workspaceId: string;
  isTaskDetailFullscreen?: boolean;
  onToggleTaskDetailFullscreen?: (nextFullscreen: boolean) => void;
  closeTaskDetail: () => void;
}) {
  const { t } = useTranslation();
  const isOverlayOpen = Boolean(activeSessionId || activeTaskId);
  const showEmptySessionPane = Boolean(
    activeTask &&
    !activeSessionId &&
    resolveEffectiveTaskAutomation(activeTask, board?.columns ?? [], resolveSpecialist, {
      autoProviderId: resolveKanbanBoardAutoProviderId(board, boardAutoProviderId),
    }).canRun &&
    activeTask.columnId !== "done",
  );
  const selectedLaneSession = getTaskLaneSession(activeTask, activeSessionId);
  const isA2ASessionPane = Boolean(activeTask && isA2ATaskSession(activeTask, activeSessionId));
  const canShowSessionPane = Boolean(showEmptySessionPane || isA2ASessionPane || (activeSessionId && acp));
  const [hiddenSessionPaneTaskId, setHiddenSessionPaneTaskId] = useState<string | null>(null);
  const [sessionRecoveryInputPrefill, setSessionRecoveryInputPrefill] = useState<string | null>(null);
  // The chat panel's session info row; the run bar renders the selected
  // run's status chips into it, so the pane header stays at two lines.
  const [sessionInfoSlot, setSessionInfoSlot] = useState<HTMLSpanElement | null>(null);
  const isSessionPaneVisible = activeTaskId ? hiddenSessionPaneTaskId !== activeTaskId : true;
  const hasSessionPane = canShowSessionPane && isSessionPaneVisible;
  const selectTaskSession = (task: TaskInfo, sessionId: string) => {
    setActiveSessionId(sessionId);
    setSessionRecoveryInputPrefill(null);
    setHiddenSessionPaneTaskId(null);
    if (acp && canSelectTaskSessionInAcp(task, sessionId, sessionMap)) {
      acp.selectSession(sessionId);
    }
  };

  const recoverActiveAcpSession = async (options?: { willAutoResend: boolean }) => {
    if (!acp || !activeSessionId) return;
    const targetSessionInfo = sessionMap.get(activeSessionId);
    if (!targetSessionInfo?.cwd) return;

    try {
      const resumed = await acp.resumeSession(activeSessionId, targetSessionInfo.cwd, { throwOnError: true });
      if (resumed?.sessionId) {
        pinSessionId?.(resumed.sessionId);
        setActiveSessionId(resumed.sessionId);
        setSessionRecoveryInputPrefill(null);
        onRefresh();
      }
      return;
    } catch (error) {
      if (!isRecoverableAcpSessionError(error)) {
        throw error;
      }
    }

    const transcript = await fetchSessionTranscriptForRestore(activeSessionId);
    const replacement = await acp.createSession(
      ...buildKanbanSessionReplacementArgs(targetSessionInfo, boardAutoProviderId ?? acp.selectedProvider, workspaceId),
    );

    if (!replacement?.sessionId) return;

    if (activeTask) {
      const nextSessionIds = [
        ...(activeTask.sessionIds ?? []),
        activeSessionId,
        replacement.sessionId,
      ].filter((sessionId, index, values) => sessionId && values.indexOf(sessionId) === index);
      await patchTask(activeTask.id, { sessionIds: nextSessionIds });
    }

    pinSessionId?.(replacement.sessionId);
    setActiveSessionId(replacement.sessionId);
    acp.selectSession(replacement.sessionId);
    // When the panel is about to re-send the user's own failed message, a
    // canned "continue the previous session" draft would only sit in the
    // input as clutter. Seed it only for a bare Resume.
    setSessionRecoveryInputPrefill(
      options?.willAutoResend
        ? null
        : buildKanbanSessionRestorePrompt(activeTask, targetSessionInfo, transcript),
    );
    setHiddenSessionPaneTaskId(null);
    onRefresh();
  };

  if (!isOverlayOpen) return null;

  // Session column: the dragged share of the width, but never under 260px
  // (design-spec §7, 768px) nor over 60% of the overlay.
  const sessionPaneStyle = { width: `${((1 - detailSplitRatio) * 100).toFixed(2)}%` };
  const sessionPaneClamp = "min-w-[260px] max-w-[60%]";

  return (
    <div
      className={`fixed inset-0 z-50 flex bg-canvas/70 animate-in fade-in duration-150 ${
        isTaskDetailFullscreen ? "items-stretch justify-stretch px-0 py-0" : "items-center justify-center px-4 py-6"
      }`}
    >
      <div
        className={`relative w-full overflow-hidden border border-default bg-canvas shadow-overlay animate-in zoom-in-95 duration-150 ${
          isTaskDetailFullscreen ? "h-screen max-w-none border-0" : "h-[88vh] max-w-7xl"
        }`}
      >
        <div ref={detailSplitContainerRef} className="flex h-full min-w-0">
          {activeTaskId && (() => {
            const task = activeTask;
            if (!task) return null;
            const sessionInfo = activeSessionId ? sessionMap.get(activeSessionId) ?? null : null;
            return (
              <div className="h-full min-w-0 flex-1">
                <KanbanCardDetail
                  key={task.id}
                  task={task}
                  refreshSignal={refreshSignal}
                  boardColumns={board?.columns ?? []}
                  availableProviders={availableProviders}
                  specialists={specialists}
                  specialistLanguage={specialistLanguage}
                  codebases={codebases}
                  allCodebaseIds={allCodebaseIds}
                  worktreeCache={worktreeCache}
                  sessionInfo={sessionInfo}
                  sessions={combinedSessions}
                  fullWidth={!hasSessionPane}
                  selectedProvider={resolveKanbanBoardAutoProviderId(board, boardAutoProviderId) ?? null}
                  onPatchTask={patchTask}
                  onRetryTrigger={retryTaskTrigger}
                  onRunPullRequest={runTaskPullRequest}
                  onDelete={() => confirmDeleteTask(task)}
                  onRefresh={onRefresh}
                  onProviderChange={(providerId) => {
                    if (providerId) {
                      onBoardProviderChange(providerId);
                    }
                  }}
                  onRepositoryChange={(codebaseIds) => {
                    void codebaseIds;
                  }}
                  onSelectSession={(sessionId) => {
                    selectTaskSession(task, sessionId);
                  }}
                  jitContextSessionId={activeSessionId}
                  onLoadJitContextIntoSession={acp && activeSessionId
                    ? async (sessionId, prompt) => {
                      setHiddenSessionPaneTaskId(null);
                      setActiveSessionId(sessionId);
                      acp.selectSession(sessionId);
                      await acp.promptSession(sessionId, prompt);
                    }
                    : undefined}
                  onOpenJitContextHistoryAnalysis={acp
                    ? async (prompt, targetWindow) => {
                      const taskCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0
                        ? task.codebaseIds
                        : allCodebaseIds;
                      const primaryCodebase = taskCodebaseIds.length > 0
                        ? codebases.find((codebase) => codebase.id === taskCodebaseIds[0])
                        : null;
                      const taskWorktree = task.worktreeId
                        ? worktreeCache[task.worktreeId] ?? null
                        : null;
                      const taskRepoPath = primaryCodebase?.repoPath
                        ?? taskWorktree?.worktreePath
                        ?? sessionInfo?.cwd;
                      const taskBranch = sessionInfo?.branch
                        ?? taskWorktree?.branch
                        ?? primaryCodebase?.branch
                        ?? undefined;
                      const taskAdaptiveHarness = buildKanbanTaskAdaptiveHarnessOptions(task.title, {
                        locale: specialistLanguage,
                        role: task.assignedRole,
                        task,
                      });
                      if (!taskAdaptiveHarness) {
                        throw new Error(t.kanbanDetail.jitContextNeedsRefinement);
                      }

                      await startKanbanHistoryAnalysisSession({
                        workspaceId,
                        task,
                        repoPath: taskRepoPath ?? undefined,
                        branch: taskBranch,
                        provider: sessionInfo?.provider ?? resolveKanbanBoardAutoProviderId(board, boardAutoProviderId) ?? acp.selectedProvider,
                        specialistLanguage,
                        taskAdaptiveHarness,
                        prompt,
                        targetWindow,
                        fallbackErrorMessage: t.kanbanDetail.jitContextHistoryAnalysisFailed,
                      });
                    }
                    : undefined}
                  isFullscreen={isTaskDetailFullscreen}
                  onToggleFullscreen={onToggleTaskDetailFullscreen}
                  onClose={closeTaskDetail}
                  canShowSessionPane={canShowSessionPane}
                  isSessionPaneVisible={hasSessionPane}
                  onShowSessionPane={() => setHiddenSessionPaneTaskId(null)}
                  loadState={detailHydration ? {
                    loading: detailHydration.loading,
                    error: detailHydration.error,
                    onRetry: detailHydration.retry,
                  } : undefined}
                />
              </div>
            );
          })()}
          {activeTaskId && hasSessionPane && (
            <div
              role="separator"
              aria-orientation="vertical"
              className="group flex h-full w-1.5 shrink-0 cursor-col-resize items-center justify-center border-l border-default bg-canvas hover:bg-accent-subtle"
              onMouseDown={() => setIsDraggingDetailSplit(true)}
              data-testid="kanban-detail-split-handle"
            >
              <div className="h-12 w-0.5 rounded-full bg-default transition-colors group-hover:bg-accent" />
            </div>
          )}
          {hasSessionPane ? (() => {
            const taskCodebaseIds = activeTask?.codebaseIds && activeTask.codebaseIds.length > 0
              ? activeTask.codebaseIds
              : allCodebaseIds;
            const primaryCodebase = taskCodebaseIds.length > 0
              ? codebases.find((codebase) => codebase.id === taskCodebaseIds[0])
              : null;
            const activeSessionInfo = activeSessionId
              ? sessionMap.get(activeSessionId) ?? null
              : null;
            const activeWorktree = activeTask?.worktreeId
              ? worktreeCache[activeTask.worktreeId] ?? null
              : null;
            const repoSelection = primaryCodebase
              ? {
                  path: activeSessionInfo?.cwd ?? activeWorktree?.worktreePath ?? primaryCodebase.repoPath,
                  branch: activeSessionInfo?.branch ?? activeWorktree?.branch ?? primaryCodebase.branch ?? "",
                  name: primaryCodebase.label ?? primaryCodebase.repoPath.split("/").pop() ?? "",
                }
              : null;
            const taskAgentRole = activeSessionInfo?.role
              ?? selectedLaneSession?.role
              ?? undefined;

            if (showEmptySessionPane && activeTask) {
              return (
                <div
                    className={`flex h-full shrink-0 flex-col overflow-hidden bg-canvas ${sessionPaneClamp}`}
                  style={activeTaskId ? sessionPaneStyle : undefined}
                >
                  <KanbanEmptySessionPane
                    task={activeTask}
                    boardColumns={board?.columns ?? []}
                    availableProviders={availableProviders}
                    specialists={specialists}
                    specialistLanguage={specialistLanguage}
                    autoProviderId={resolveKanbanBoardAutoProviderId(board, boardAutoProviderId)}
                    onCloseSession={() => setHiddenSessionPaneTaskId(activeTask.id)}
                  />
                </div>
              );
            }

            return (
              <div
                className={`flex h-full flex-col overflow-hidden bg-canvas ${activeTaskId ? `shrink-0 ${sessionPaneClamp}` : "min-w-0 flex-1"}`}
                style={activeTaskId ? sessionPaneStyle : undefined}
              >
                {activeTask && !isA2ASessionPane && (
                  <div className="shrink-0 border-b border-default bg-canvas py-1 pl-1 pr-2" data-testid="kanban-session-pane-top-row">
                    <KanbanCardActivityBar
                      task={activeTask}
                      sessions={combinedSessions}
                      specialistLanguage={specialistLanguage}
                      currentSessionId={activeSessionId ?? undefined}
                      onSelectSession={(sessionId) => selectTaskSession(activeTask, sessionId)}
                      onCloseSession={() => setHiddenSessionPaneTaskId(activeTask.id)}
                      statusSlot={acp ? sessionInfoSlot : null}
                    />
                  </div>
                )}
                {isA2ASessionPane && activeTask ? (
                  <A2ASessionPane
                    task={activeTask}
                    laneSession={selectedLaneSession}
                    sessions={combinedSessions}
                    specialists={specialists}
                    specialistLanguage={specialistLanguage}
                    refreshSignal={refreshSignal}
                    currentSessionId={activeSessionId ?? undefined}
                    onSelectSession={(sessionId) => selectTaskSession(activeTask, sessionId)}
                    onCloseSession={() => setHiddenSessionPaneTaskId(activeTask.id)}
                  />
                ) : acp && (
                  <div className="min-h-0 flex-1">
                    <ChatPanel
                      acp={acp}
                      activeSessionId={activeSessionId}
                      onEnsureSession={async () => activeSessionId}
                      onSelectSession={async (sessionId) => {
                        setActiveSessionId(sessionId);
                        acp.selectSession(sessionId);
                      }}
                      repoSelection={repoSelection}
                      onRepoChange={() => {}}
                      codebases={codebases}
                      activeWorkspaceId={workspaceId}
                      agentRole={taskAgentRole}
                      inputPrefill={sessionRecoveryInputPrefill}
                      onInputPrefillConsumed={() => setSessionRecoveryInputPrefill(null)}
                      onResumeActiveSession={recoverActiveAcpSession}
                      sessionFinished={selectedLaneSession?.status === "completed" || selectedLaneSession?.status === "transitioned"}
                      compactSessionHeader
                      sessionInfoLeadingRef={setSessionInfoSlot}
                      // A person asking a follow-up here wants an answer they
                      // can read, not the agent's work log. Wrap the typed
                      // message with reply-writing rules; the card's own
                      // system prompt is untouched.
                      onDecoratePrompt={(text) => buildKanbanHumanReadableReplyPrompt({
                        request: text,
                        language: specialistLanguage,
                      })}
                    />
                  </div>
                )}
              </div>
            );
          })() : null}
        </div>
      </div>
    </div>
  );
}
