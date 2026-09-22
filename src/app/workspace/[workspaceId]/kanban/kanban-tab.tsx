"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { UseAcpState, UseAcpActions } from "@/client/hooks/use-acp";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveEffectiveTaskAutomation } from "@/core/kanban/effective-task-automation";
import type {
  GitHubIssueListItemInfo,
  GitHubPRListItemInfo,
  KanbanAgentPromptHandler,
  KanbanBoardInfo,
  KanbanDevSessionSupervisionInfo,
  KanbanHistoryMemoryPolicyInfo,
  SessionInfo,
  TaskInfo,
} from "../types";
import { EMPTY_DRAFT, type TaskDraft } from "../kanban-create-modal";
import { type ColumnAutomationConfig, type KanbanSettingsModalProps } from "./kanban-settings-modal";
import { scheduleKanbanRefreshBurst } from "./kanban-agent-input";
import { type KanbanSpecialistLanguage } from "./kanban-specialist-language";
import { getKanbanTaskAgentCopy } from "./i18n/kanban-task-agent";
import { createKanbanSpecialistResolver } from "./kanban-card-session-utils";
import { useTranslation } from "@/i18n";
import { normalizeKanbanAutomation } from "@/core/models/kanban";
import type { RepoSelection } from "@/client/components/repo-picker";
import type { RepoSyncState } from "./kanban-repo-sync-status";
import type { KanbanRepoChanges } from "./kanban-file-changes-types";
import {
  canSelectTaskSessionInAcp,
  getPreferredTaskSessionId,
  isA2ATaskSession,
  resolveKanbanBoardAutoProviderId,
  taskOwnsSession,
} from "./kanban-tab-helpers";
import { importGitHubItems } from "./kanban-github-import";
import { getKanbanFileChangesSummary } from "./kanban-file-changes-panel";
import { KanbanTabContent } from "./kanban-tab-content";
import { useRuntimeFitnessStatus } from "./use-runtime-fitness-status";
import { toast } from "@/client/components/toast";
import { useKanbanCodebaseModal } from "./use-kanban-codebase-modal";
import { TaskPatchError, useKanbanCardMove } from "./use-kanban-card-move";
import { useKanbanLiveTails } from "./use-kanban-live-tails";
import { useKanbanWorktreeCache } from "./use-kanban-worktree-cache";
import { useKanbanAgentInput } from "./use-kanban-agent-input";
import { useKanbanDetailSplit } from "./use-kanban-detail-split";

interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}

interface KanbanTabProps {
  workspaceId: string;
  refreshSignal?: number;
  boards: KanbanBoardInfo[];
  tasks: TaskInfo[];
  sessions: SessionInfo[];
  providers: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage?: KanbanSpecialistLanguage;
  onSpecialistLanguageChange?: (language: KanbanSpecialistLanguage) => void;
  codebases: CodebaseData[];
  onRefresh: () => void;
  repoSync?: RepoSyncState;
  repoChanges?: KanbanRepoChanges[];
  repoChangesLoading?: boolean;
  /** sessionId -> newest agent line, pushed over SSE (see use-kanban-live-tails). */
  pushedSessionTails?: Record<string, string>;
  acp?: UseAcpState & UseAcpActions;
  onAgentPrompt?: KanbanAgentPromptHandler;
}

function isLikelyGitHubCodebase(codebase: CodebaseData | null | undefined): boolean {
  if (!codebase) return false;
  if (codebase.sourceType === "github") return true;
  if (codebase.sourceUrl?.includes("github.com")) return true;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(codebase.label?.trim() ?? "");
}

const KANBAN_BOARD_QUERY_KEY = "boardId";
const KANBAN_DETAIL_TASK_QUERY_KEY = "taskId";

/**
 * Fields the list projection omits (see src/app/api/tasks/task-list-projection.ts).
 * They must come from the hydrated detail fetch, not from the board summary.
 */
function pickHydratedDetailFields(hydrated: TaskInfo): Partial<TaskInfo> {
  const detail: Partial<TaskInfo> = {};
  if (hydrated.comment !== undefined) detail.comment = hydrated.comment;
  if (hydrated.comments !== undefined) detail.comments = hydrated.comments;
  if (hydrated.jitContextSnapshot !== undefined) detail.jitContextSnapshot = hydrated.jitContextSnapshot;
  if (hydrated.verificationReport !== undefined) detail.verificationReport = hydrated.verificationReport;
  if (hydrated.contextSearchSpec !== undefined) detail.contextSearchSpec = hydrated.contextSearchSpec;
  // The summary objective is truncated; the hydrated one is authoritative.
  if (hydrated.objective !== undefined) detail.objective = hydrated.objective;
  return detail;
}

function isPlanBacklogBoard(board: KanbanBoardInfo): boolean {
  return board.name.trim().replace(/\s+/g, " ").toLowerCase() === "plan backlog";
}

function getKanbanUrlState(): { boardId: string | null; taskId: string | null } | null {
  if (typeof window === "undefined") return null;
  const searchParams = new URLSearchParams(window.location.search);
  return {
    boardId: searchParams.get(KANBAN_BOARD_QUERY_KEY),
    taskId: searchParams.get(KANBAN_DETAIL_TASK_QUERY_KEY),
  };
}

function updateKanbanUrlState(
  state: { boardId?: string | null; taskId?: string | null },
  mode: "push" | "replace" = "push",
): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (state.boardId) {
    url.searchParams.set(KANBAN_BOARD_QUERY_KEY, state.boardId);
  } else {
    url.searchParams.delete(KANBAN_BOARD_QUERY_KEY);
  }

  if (state.taskId) {
    url.searchParams.set(KANBAN_DETAIL_TASK_QUERY_KEY, state.taskId);
  } else {
    url.searchParams.delete(KANBAN_DETAIL_TASK_QUERY_KEY);
  }

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;

  window.history[mode === "push" ? "pushState" : "replaceState"](window.history.state, "", nextUrl);
}

export function KanbanTab({
  workspaceId,
  refreshSignal,
  boards,
  tasks,
  sessions,
  providers,
  specialists,
  specialistLanguage = "en",
  onSpecialistLanguageChange: _onSpecialistLanguageChange,
  codebases,
  onRefresh,
  repoSync,
  repoChanges = [],
  repoChangesLoading = false,
  pushedSessionTails,
  acp,
  onAgentPrompt,
}: KanbanTabProps) {
  const { t } = useTranslation();
  const kanbanTaskAgentCopy = getKanbanTaskAgentCopy(specialistLanguage);
  const [localBoards, setLocalBoards] = useState<KanbanBoardInfo[]>(boards);
  const visibleBoards = useMemo(
    () => localBoards.filter((board) => !isPlanBacklogBoard(board)),
    [localBoards],
  );
  const resolveSpecialist = useMemo(
    () => createKanbanSpecialistResolver(specialists),
    [specialists],
  );
  const defaultBoardId = useMemo(
    () => localBoards.find((board) => !isPlanBacklogBoard(board) && board.isDefault)?.id
      ?? visibleBoards[0]?.id
      ?? localBoards[0]?.id
      ?? null,
    [localBoards, visibleBoards],
  );
  const allCodebaseIds = useMemo(
    () => codebases.map((codebase) => codebase.id),
    [codebases],
  );
  const defaultCodebase = useMemo(
    () => codebases.find((codebase) => codebase.isDefault) ?? codebases[0] ?? null,
    [codebases],
  );
  const hasGitHubCodebase = useMemo(
    () => codebases.some((codebase) => isLikelyGitHubCodebase(codebase)),
    [codebases],
  );
  const githubAvailable = isLikelyGitHubCodebase(defaultCodebase);

  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(() => {
    const initialUrlState = getKanbanUrlState();
    return initialUrlState?.boardId ?? defaultBoardId;
  });
  const [localTasks, setLocalTasks] = useState<TaskInfo[]>(tasks);
  const autoPatchedTasksRef = useRef(new Set<string>());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGitHubImportModal, setShowGitHubImportModal] = useState(false);
  const [githubAccessAvailable, setGitHubAccessAvailable] = useState(false);
  const [githubAccessSource, setGitHubAccessSource] = useState<"board" | "env" | "gh" | "none">("none");
  const [draft, setDraft] = useState<TaskDraft>({
    ...EMPTY_DRAFT,
    createGitHubIssue: false,
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null); // For card detail view;
  // taskId -> full record fetched from GET /api/tasks/:id (detail-only fields).
  const [hydratedTaskDetails, setHydratedTaskDetails] = useState<Record<string, TaskInfo>>({});
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const [agentSessionId, setAgentSessionId] = useState<string | null>(null);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [showFitnessWorkbench, setShowFitnessWorkbench] = useState(false);
  const [fitnessWorkbenchSessionId, setFitnessWorkbenchSessionId] = useState<string | null>(null);


  const [backfilledSessions, setBackfilledSessions] = useState<Record<string, SessionInfo>>({});

  // Settings state - column automation rules (initialized from board columns)
  const [columnAutomation, setColumnAutomation] = useState<Record<string, ColumnAutomationConfig>>({});

  // Delete confirmation modal state
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<TaskInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Manual card creation in-flight state (Phase 1.3: three-state buttons)
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);
  const [isTaskDetailFullscreen, setIsTaskDetailFullscreen] = useState(false);
  const [fileChangesOpen, setFileChangesOpen] = useState(false);
  const [gitLogOpen, setGitLogOpen] = useState(false);
  const sessionBackfillInFlightRef = useRef(new Set<string>());
  const emptySessionRecoveryRef = useRef<string | null>(null);
  const previousPreferredTaskSessionIdRef = useRef<string | null>(null);
  // Sessions the detail panel deliberately switched to (e.g. the replacement
  // after a dead-session Resume). The reconcile effect below must not bounce
  // off them while the card record and ACP list catch up.
  const pinnedSessionIdsRef = useRef(new Set<string>());
  // Mirror of activeTaskId for callbacks that must not close over a stale value.
  const activeTaskIdRef = useRef<string | null>(null);
  const [isPageVisible, setIsPageVisible] = useState(() => (
    typeof document === "undefined" || document.visibilityState === "visible"
  ));

  const sessionMap = useMemo(() => {
    const map = new Map<string, SessionInfo>();
    for (const session of sessions) {
      map.set(session.sessionId, session);
    }
    for (const [sessionId, session] of Object.entries(backfilledSessions)) {
      if (!map.has(sessionId)) {
        map.set(sessionId, session);
      }
    }
    return map;
  }, [backfilledSessions, sessions]);
  const combinedSessions = useMemo(
    () => Array.from(sessionMap.values()),
    [sessionMap],
  );
  // The board list is served as a slim projection (no comments /
  // jitContextSnapshot / full objective), so the detail panel hydrates the
  // full record separately and it is kept here. A list refresh must not
  // clobber the hydrated copy, hence a cache rather than a merge into
  // localTasks.
  const summaryActiveTask = useMemo(
    () => activeTaskId ? localTasks.find((task) => task.id === activeTaskId) ?? null : null,
    [activeTaskId, localTasks],
  );
  const activeTask = useMemo(() => {
    if (!activeTaskId) return null;
    const hydrated = hydratedTaskDetails[activeTaskId];
    if (!hydrated) return summaryActiveTask;
    if (!summaryActiveTask) return hydrated;
    // Summary fields are the fresher ones (they arrive on every SSE refresh);
    // the hydrated record supplies the detail-only fields underneath.
    return { ...hydrated, ...summaryActiveTask, ...pickHydratedDetailFields(hydrated) };
  }, [activeTaskId, hydratedTaskDetails, summaryActiveTask]);
  const preferredActiveTaskSessionId = useMemo(
    () => getPreferredTaskSessionId(activeTask),
    [activeTask],
  );
  const board = useMemo(
    () => localBoards.find((item) => item.id === selectedBoardId) ?? null,
    [localBoards, selectedBoardId],
  );
  const boardQueue = board?.queue;
  const boardAutoProviderId = useMemo(
    () => resolveKanbanBoardAutoProviderId(board, acp?.selectedProvider),
    [acp?.selectedProvider, board],
  );
  const activeTaskEffectiveAutomation = useMemo(
    () => activeTask
      ? resolveEffectiveTaskAutomation(activeTask, board?.columns ?? [], resolveSpecialist, {
        autoProviderId: boardAutoProviderId,
      })
      : null,
    [activeTask, board?.columns, boardAutoProviderId, resolveSpecialist],
  );
  const queuedPositions = boardQueue?.queuedPositions ?? {};

  const { detailSplitRatio, setIsDraggingDetailSplit, detailSplitContainerRef } = useKanbanDetailSplit();

  const openAgentPanel = useCallback((sessionId: string) => {
    setAgentSessionId(sessionId);
    setAgentPanelOpen(true);
    acp?.selectSession(sessionId);
  }, [acp]);

  const persistBoardAutoProvider = useCallback(async (providerId: string | null | undefined) => {
    if (!board?.id) return;
    await desktopAwareFetch(`/api/kanban/boards/${encodeURIComponent(board.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoProviderId: providerId ?? "" }),
    });
  }, [board?.id]);

  const setKanbanBoardProvider = useCallback((providerId: string) => {
    if (!providerId) return;
    acp?.setProvider(providerId);
    if (board?.autoProviderId !== providerId) {
      void persistBoardAutoProvider(providerId).catch((error) => {
        console.error("[kanban] Failed to persist board auto provider:", error);
      });
    }
  }, [acp, board?.autoProviderId, persistBoardAutoProvider]);

  const ensureBoardAutoProviderPersisted = useCallback(async () => {
    if (!board?.id || !boardAutoProviderId || board.autoProviderId === boardAutoProviderId) {
      return;
    }
    await persistBoardAutoProvider(boardAutoProviderId);
  }, [board?.autoProviderId, board?.id, boardAutoProviderId, persistBoardAutoProvider]);

  // Auto-persist board provider on mount / when the resolved value drifts from
  // what's stored in workspace metadata.  This is a belt-and-suspenders fallback;
  // individual actions that trigger server-side automation also await the persist
  // synchronously before proceeding.
  useEffect(() => {
    void ensureBoardAutoProviderPersisted().catch((error) => {
      console.error("[kanban] Failed to auto-persist board provider:", error);
    });
  }, [ensureBoardAutoProviderPersisted]);

  const {
    agentInput,
    setAgentInput,
    agentLoading,
    handleAgentSubmit,
  } = useKanbanAgentInput({
    workspaceId,
    selectedBoardId,
    defaultBoardId,
    defaultCodebase,
    boardAutoProviderId,
    specialistLanguage,
    ensureBoardAutoProviderPersisted,
    openAgentPanel,
    onAgentPrompt,
    onRefresh,
  });

  useEffect(() => {
    if (!hasGitHubCodebase) {
      setGitHubAccessAvailable(false);
      setGitHubAccessSource("none");
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const searchParams = new URLSearchParams();
        if (selectedBoardId) {
          searchParams.set("boardId", selectedBoardId);
        }
        const response = await desktopAwareFetch(
          `/api/github/access${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
          { cache: "no-store" },
        );
        const payload = await response.json().catch(() => ({}));
        if (cancelled) return;

        const available = response.ok && payload?.available === true;
        const source = payload?.source === "board" || payload?.source === "env" || payload?.source === "gh"
          ? payload.source
          : "none";
        setGitHubAccessAvailable(available);
        setGitHubAccessSource(available ? source : "none");
      } catch {
        if (cancelled) return;
        setGitHubAccessAvailable(false);
        setGitHubAccessSource("none");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasGitHubCodebase, selectedBoardId]);

  useEffect(() => {
    setLocalBoards(boards);
  }, [boards]);

  useEffect(() => {
    const urlState = getKanbanUrlState();
    const candidateBoardId = urlState?.boardId;
    if (candidateBoardId && localBoards.some((board) => board.id === candidateBoardId)) {
      setSelectedBoardId(candidateBoardId);
      return;
    }

    setSelectedBoardId(defaultBoardId);
    if (defaultBoardId) {
      updateKanbanUrlState({
        boardId: defaultBoardId,
        taskId: urlState?.taskId ?? null,
      }, "replace");
    }
  }, [defaultBoardId, localBoards]);

  const patchTask = useCallback(async (taskId: string, payload: Record<string, unknown>) => {
    const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new TaskPatchError(data.error ?? "Failed to update task", {
        storyReadiness: data.storyReadiness,
        missingTaskFields: Array.isArray(data.missingTaskFields)
          ? data.missingTaskFields.filter((item: unknown): item is string => typeof item === "string")
          : undefined,
      });
    }
    const updated = data.task as TaskInfo;
    setLocalTasks((current) => current.map((task) => (task.id === taskId ? updated : task)));
    return updated;
  }, []);

  const fetchTaskById = useCallback(async (taskId: string) => {
    const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : "Failed to load task");
    }
    return data.task as TaskInfo;
  }, []);

  const { worktreeCache, setWorktreeCache } = useKanbanWorktreeCache({
    localTasks,
    setLocalTasks,
    patchTask,
  });

  // Everything about the "repositories" modal lives in its own hook; the board
  // only needs `open` (for the Escape handler) and `openCodebaseModal`.
  const codebaseModal = useKanbanCodebaseModal({
    workspaceId,
    codebases,
    defaultCodebase,
    localTasks,
    setLocalTasks,
    setWorktreeCache,
    patchTask,
    onRefresh,
  });
  const showCodebaseModal = codebaseModal.open;
  const { openCodebaseModal, closeCodebaseModal, selectCodebase, selectedCodebase } = codebaseModal;

  useEffect(() => {
    setLocalTasks(tasks);
  }, [tasks]);

  // Hydrate the open card's detail-only fields, and re-hydrate when the board
  // reports the card changed (updatedAt moves on every agent write).
  const activeTaskUpdatedAt = summaryActiveTask?.updatedAt;
  useEffect(() => {
    if (!activeTaskId) return;
    let cancelled = false;

    void (async () => {
      try {
        const full = await fetchTaskById(activeTaskId);
        if (cancelled) return;
        setHydratedTaskDetails((current) => ({ ...current, [activeTaskId]: full }));
      } catch (error) {
        // The summary record still renders; only detail-only fields are missing.
        console.error("[kanban] Failed to hydrate task detail:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTaskId, activeTaskUpdatedAt, fetchTaskById]);

  useEffect(() => {
    setBackfilledSessions((current) => {
      const next = { ...current };
      let changed = false;
      for (const session of sessions) {
        if (next[session.sessionId]) {
          delete next[session.sessionId];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [sessions]);

  useEffect(() => {
    if (codebases.length === 0 || localTasks.length === 0) return;

    const codebaseById = new Map(codebases.map((codebase) => [codebase.id, codebase]));

    const pendingPatches: Array<{ taskId: string; codebaseId: string }> = [];

    for (const task of localTasks) {
      if (autoPatchedTasksRef.current.has(task.id)) continue;

      const taskCodebaseIds = task.codebaseIds ?? [];
      const hasValidCodebase = taskCodebaseIds.some((id) => codebaseById.has(id));
      if (hasValidCodebase) continue;

      let resolved: CodebaseData | null = null;
      const session = task.triggerSessionId ? sessionMap.get(task.triggerSessionId) : null;
      if (session?.cwd) {
        resolved = codebases.find((codebase) => codebase.repoPath === session.cwd) ?? null;
      }

      if (!resolved && defaultCodebase) {
        resolved = defaultCodebase;
      }

      if (resolved) {
        pendingPatches.push({ taskId: task.id, codebaseId: resolved.id });
      }
    }

    if (pendingPatches.length === 0) return;

    for (const patch of pendingPatches) {
      autoPatchedTasksRef.current.add(patch.taskId);
      void patchTask(patch.taskId, { codebaseIds: [patch.codebaseId] });
    }
  }, [codebases, defaultCodebase, localTasks, patchTask, sessionMap]);

  const repoHealth = useMemo(() => {
    if (codebases.length === 0) {
      return { missingRepoTasks: 0, cwdMismatchTasks: 0 };
    }

    const codebaseById = new Map(codebases.map((cb) => [cb.id, cb]));
    let missingRepoTasks = 0;
    let cwdMismatchTasks = 0;

    for (const task of localTasks) {
      const taskCodebaseIds = task.codebaseIds && task.codebaseIds.length > 0
        ? task.codebaseIds
        : [];
      const hasMissingRepo = taskCodebaseIds.length > 0 &&
        taskCodebaseIds.every((cbId) => !codebaseById.has(cbId));
      if (hasMissingRepo) {
        missingRepoTasks += 1;
      }

      if (task.triggerSessionId) {
        const session = sessionMap.get(task.triggerSessionId);
        if (session?.cwd) {
          const primaryCodebase = taskCodebaseIds.length > 0
            ? codebaseById.get(taskCodebaseIds[0]) ?? defaultCodebase
            : defaultCodebase;
          if (primaryCodebase?.repoPath && session.cwd !== primaryCodebase.repoPath) {
            cwdMismatchTasks += 1;
          }
        }
      }
    }

    return { missingRepoTasks, cwdMismatchTasks };
  }, [codebases, defaultCodebase, localTasks, sessionMap]);

  const fileChangesSummary = useMemo(() => {
    return getKanbanFileChangesSummary(repoChanges);
  }, [repoChanges]);

  const selectedProviderInfo = useMemo(() => {
    return acp?.providers?.find((p) => p.id === acp.selectedProvider) ?? null;
  }, [acp]);
  const runtimeFitness = useRuntimeFitnessStatus({
    workspaceId,
    codebaseId: defaultCodebase?.id ?? null,
    enabled: workspaceId !== "__placeholder__",
    refreshSignal,
    isPageVisible,
  });

  // Sync task's assignedProvider to ACP state when activeTaskId changes
  useEffect(() => {
    if (!activeTaskId) return;
    const task = localTasks.find((t) => t.id === activeTaskId);
    const effectiveAutomation = task
      ? resolveEffectiveTaskAutomation(task, board?.columns ?? [], resolveSpecialist, {
        autoProviderId: boardAutoProviderId,
      })
      : null;
    if (task?.assignedProvider && effectiveAutomation?.source === "card" && acp?.setProvider) {
      acp.setProvider(task.assignedProvider);
    }
    // Only trigger when activeTaskId changes, not when acp changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskId]);

  useEffect(() => {
    if (!board?.id || !acp?.setProvider) return;
    if (activeTaskEffectiveAutomation?.source === "card") return;
    if (board.autoProviderId && acp.selectedProvider !== board.autoProviderId) {
      acp.setProvider(board.autoProviderId);
    }
  }, [acp, activeTaskEffectiveAutomation?.source, board?.autoProviderId, board?.id]);

  useEffect(() => {
    if (!activeTask) {
      previousPreferredTaskSessionIdRef.current = null;
      return;
    }
    if (!preferredActiveTaskSessionId) {
      previousPreferredTaskSessionIdRef.current = null;
      return;
    }
    const previousPreferredTaskSessionId = previousPreferredTaskSessionIdRef.current;
    setActiveSessionId((current) => {
      if (!current) return preferredActiveTaskSessionId;
      // A session the panel just switched to (the replacement after a
      // dead-session Resume) is not in the card record until the PATCH round
      // trips and the list refetches. Without the pin, this reconcile would
      // snap the panel back to the dead session in that window.
      const ownedByCard = taskOwnsSession(activeTask, current);
      const pinned = pinnedSessionIdsRef.current.has(current);
      if (!ownedByCard && !pinned) return preferredActiveTaskSessionId;
      // Once the card record carries it, the pin has done its job.
      if (ownedByCard && pinned) pinnedSessionIdsRef.current.delete(current);
      if (current === preferredActiveTaskSessionId) return current;
      if (previousPreferredTaskSessionId && current === previousPreferredTaskSessionId) {
        return preferredActiveTaskSessionId;
      }
      return current;
    });
    previousPreferredTaskSessionIdRef.current = preferredActiveTaskSessionId;
  }, [activeTask, preferredActiveTaskSessionId]);

  useEffect(() => {
    const targetSessionId = preferredActiveTaskSessionId ?? activeSessionId;
    const sessionsInFlight = sessionBackfillInFlightRef.current;
    if (!activeTask || !targetSessionId) return;
    if (isA2ATaskSession(activeTask, targetSessionId)) return;
    if (sessionMap.has(targetSessionId)) return;
    if (sessionsInFlight.has(targetSessionId)) return;

    const controller = new AbortController();
    sessionsInFlight.add(targetSessionId);

    void (async () => {
      try {
        const response = await desktopAwareFetch(`/api/sessions/${encodeURIComponent(targetSessionId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = await response.json();
        if (controller.signal.aborted) return;
        const session = data?.session as SessionInfo | undefined;
        if (!session?.sessionId) return;
        setBackfilledSessions((current) => ({ ...current, [session.sessionId]: session }));
      } catch {
        // Ignore targeted backfill failures; the manual refresh control remains available.
      } finally {
        sessionsInFlight.delete(targetSessionId);
      }
    })();

    return () => {
      controller.abort();
      sessionsInFlight.delete(targetSessionId);
    };
  }, [activeSessionId, activeTask, preferredActiveTaskSessionId, sessionMap]);

  useEffect(() => {
    if (!activeTask || !activeSessionId || !acp) return;
    if (!canSelectTaskSessionInAcp(activeTask, activeSessionId, sessionMap)) return;
    if (acp.sessionId === activeSessionId) return;
    acp.selectSession(activeSessionId);
  }, [acp, activeSessionId, activeTask, sessionMap]);

  useEffect(() => {
    if (!activeTask) {
      emptySessionRecoveryRef.current = null;
      return;
    }
    if (activeSessionId || preferredActiveTaskSessionId) {
      emptySessionRecoveryRef.current = null;
      return;
    }
    if (!resolveEffectiveTaskAutomation(
      activeTask,
      board?.columns ?? [],
      resolveSpecialist,
      { autoProviderId: boardAutoProviderId },
    ).canRun || activeTask.columnId === "done") {
      emptySessionRecoveryRef.current = null;
      return;
    }

    const recoveryKey = `${activeTask.id}:${activeTask.columnId ?? "backlog"}`;
    if (emptySessionRecoveryRef.current === recoveryKey) {
      return;
    }

    emptySessionRecoveryRef.current = recoveryKey;
    return scheduleKanbanRefreshBurst(onRefresh);
  }, [activeSessionId, activeTask, board?.columns, boardAutoProviderId, onRefresh, preferredActiveTaskSessionId, resolveSpecialist]);

  // Initialize visible columns when board changes
  useEffect(() => {
    if (board) {
      // Use persisted visibility if available, otherwise show all columns
      const columnsWithVisibility = board.columns.filter((col) => 
        col.visible !== undefined ? col.visible : true
      );
      setVisibleColumns(columnsWithVisibility.map((col) => col.id));
    }
  }, [board]);

  // Initialize column automation from board when it changes
  useEffect(() => {
    if (board) {
      const automation: Record<string, ColumnAutomationConfig> = {};
      for (const col of board.columns) {
        if (col.automation) {
          automation[col.id] = { ...col.automation };
        }
      }
      setColumnAutomation(automation);
    }
  }, [board]);

  const boardTasks = useMemo(() => {
    const effectiveBoardId = selectedBoardId ?? defaultBoardId;
    return localTasks
      .filter((task) => task.creationSource !== "session")
      .filter((task) => (task.boardId ?? defaultBoardId) === effectiveBoardId)
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  }, [defaultBoardId, localTasks, selectedBoardId]);

  const availableProviders = useMemo(() => {
    const uniqueProviders = new Map<string, AcpProviderInfo>();
    for (const provider of providers) {
      if (provider.status !== "available") continue;
      if (!uniqueProviders.has(provider.id)) {
        uniqueProviders.set(provider.id, provider);
      }
    }
    return Array.from(uniqueProviders.values());
  }, [providers]);
  const activeLiveSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of boardTasks) {
      if (!task.triggerSessionId) continue;
      const laneSession = task.laneSessions?.find((entry) => entry.sessionId === task.triggerSessionId);
      if (laneSession?.status !== "running") continue;
      const session = sessionMap.get(task.triggerSessionId);
      if (!session) continue;
      ids.add(task.triggerSessionId);
    }
    return Array.from(ids);
  }, [boardTasks, sessionMap]);
  const liveSessionTails = useKanbanLiveTails({
    activeLiveSessionIds,
    isPageVisible,
    pushedTails: pushedSessionTails,
  });
  const agentSession = agentSessionId ? sessionMap.get(agentSessionId) : undefined;
  const kanbanRepoSelection = useMemo<RepoSelection | null>(() => {
    if (!defaultCodebase) return null;
    return {
      path: defaultCodebase.repoPath,
      branch: defaultCodebase.branch ?? "",
      name: defaultCodebase.label ?? defaultCodebase.repoPath.split("/").pop() ?? "",
    };
  }, [defaultCodebase]);

  const ensureKanbanAgentSession = useCallback(async (
    cwd?: string,
    provider?: string,
    _modeId?: string,
    model?: string,
  ) => {
    if (!acp) return null;
    if (agentSessionId) {
      return agentSessionId;
    }

    const result = await acp.createSession(
      cwd ?? defaultCodebase?.repoPath,
      provider ?? boardAutoProviderId,
      undefined,
      "DEVELOPER",
      workspaceId,
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "full",
      [],
      undefined,
      undefined,
      true,
    );

    if (!result?.sessionId) {
      return null;
    }

    openAgentPanel(result.sessionId);
    return result.sessionId;
  }, [acp, agentSessionId, boardAutoProviderId, defaultCodebase?.repoPath, openAgentPanel, workspaceId]);

  useEffect(() => {
    activeTaskIdRef.current = activeTaskId;
  }, [activeTaskId]);

  const syncTaskDetailFromUrl = useCallback(() => {
    const urlState = getKanbanUrlState();
    const requestedBoardId = urlState?.boardId;
    const requestedTaskId = urlState?.taskId;
    if (requestedBoardId && localBoards.some((board) => board.id === requestedBoardId)) {
      setSelectedBoardId(requestedBoardId);
    }

    if (!requestedTaskId) {
      setActiveTaskId(null);
      setActiveSessionId(null);
      setIsTaskDetailFullscreen(false);
      return;
    }

    const requestedTask = localTasks.find((task) => task.id === requestedTaskId) ?? null;
    if (!requestedTask) {
      if (localTasks.length > 0) {
        updateKanbanUrlState({
          boardId: requestedBoardId ?? selectedBoardId ?? defaultBoardId ?? null,
          taskId: null,
        }, "replace");
      }
      return;
    }

    if (requestedBoardId !== requestedTask.boardId) {
      updateKanbanUrlState({
        boardId: requestedTask.boardId ?? selectedBoardId ?? defaultBoardId ?? null,
        taskId: requestedTask.id,
      }, "replace");
    }

    if (requestedTask.boardId) {
      setSelectedBoardId(requestedTask.boardId);
    }
    // This runs on every localTasks change (dependency below), not only on
    // real URL navigation. Re-picking the preferred session while the same
    // card is already open would discard a session the user switched to —
    // including the replacement after a dead-session Resume. Only reset the
    // session when the card itself changed. (Read the current id from a ref:
    // calling setState inside another setState's updater is not reliable.)
    const isSameCard = activeTaskIdRef.current === requestedTask.id;
    setActiveTaskId(requestedTask.id);
    if (!isSameCard) {
      setActiveSessionId(getPreferredTaskSessionId(requestedTask) ?? null);
    }
    setIsTaskDetailFullscreen(false);
  }, [defaultBoardId, localBoards, localTasks, selectedBoardId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    syncTaskDetailFromUrl();
    window.addEventListener("popstate", syncTaskDetailFromUrl);
    return () => window.removeEventListener("popstate", syncTaskDetailFromUrl);
  }, [syncTaskDetailFromUrl]);

  const openTaskDetail = useCallback(async (task: TaskInfo) => {
    if (task.boardId) {
      setSelectedBoardId(task.boardId);
    }
    setActiveTaskId(task.id);
    const latestSession = getPreferredTaskSessionId(task);
    setActiveSessionId(latestSession ?? null);
    setIsTaskDetailFullscreen(false);
    updateKanbanUrlState({
      boardId: task.boardId ?? selectedBoardId ?? defaultBoardId ?? null,
      taskId: task.id,
    }, "push");

    if (task.codebaseIds?.length === 0 && defaultCodebase) {
      try {
        await patchTask(task.id, { codebaseIds: [defaultCodebase.id] });
      } catch (error) {
        console.error("Failed to auto-assign default repo to task", error);
      }
    }

    // Select the session in ACP if it exists
    if (latestSession && acp && canSelectTaskSessionInAcp(task, latestSession, sessionMap)) {
      acp.selectSession(latestSession);
    }
  }, [acp, defaultBoardId, defaultCodebase, patchTask, selectedBoardId, sessionMap]);

  const openSession = useCallback((sessionId: string | null, task?: TaskInfo | null) => {
    setActiveTaskId(null);
    setActiveSessionId(sessionId);
    setIsTaskDetailFullscreen(false);
    // Select the session in ACP
    if (sessionId && acp && (
      task ? canSelectTaskSessionInAcp(task, sessionId, sessionMap) : sessionMap.has(sessionId)
    )) {
      acp.selectSession(sessionId);
    }
  }, [acp, sessionMap]);

  const closeTaskDetail = useCallback(() => {
    setActiveTaskId(null);
    setActiveSessionId(null);
    setIsTaskDetailFullscreen(false);
    updateKanbanUrlState({
      boardId: selectedBoardId ?? defaultBoardId ?? null,
      taskId: null,
    }, "replace");
  }, [defaultBoardId, selectedBoardId]);

  // Card moves (optimistic update, worktree cleanup prompt, gate-blocked
  // handling, agent-delegated remediation) live in their own hook.
  const cardMove = useKanbanCardMove({
    workspaceId,
    selectedBoardId,
    defaultBoardId,
    defaultCodebase,
    boardAutoProviderId,
    specialistLanguage,
    tasks,
    localTasks,
    boardTasks,
    setLocalTasks,
    setWorktreeCache,
    patchTask,
    fetchTaskById,
    ensureBoardAutoProviderPersisted,
    openSession,
    openAgentPanel,
    onAgentPrompt,
    onRefresh,
  });
  const {
    moveTask,
    moveError,
    setMoveError,
    moveBlockedState,
    setMoveBlockedState,
    moveBlockedDelegatingTaskId,
    delegateMoveBlockedFix,
    worktreeCleanupPrompt,
    resolveWorktreeCleanupPrompt,
  } = cardMove;

  const handleSelectBoard = useCallback((boardId: string) => {
    setSelectedBoardId(boardId);

    const nextActiveTaskId = activeTask?.boardId === boardId ? activeTask.id : null;
    if (!nextActiveTaskId) {
      setActiveTaskId(null);
      setActiveSessionId(null);
      setIsTaskDetailFullscreen(false);
    }

    updateKanbanUrlState({
      boardId,
      taskId: nextActiveTaskId,
    }, "push");
  }, [activeTask]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const updatePageVisibility = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };

    updatePageVisibility();
    document.addEventListener("visibilitychange", updatePageVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updatePageVisibility);
    };
  }, []);

  useEffect(() => {
    if (!agentSessionId || !agentPanelOpen) return;

    return scheduleKanbanRefreshBurst(onRefresh);
  }, [agentPanelOpen, agentSessionId, onRefresh]);


  // Codebase edit handlers - use RepoPicker for re-selecting/cloning
  // Close modal on Escape key
  useEffect(() => {
    if (!activeTaskId && !activeSessionId && !showSettings && !showCodebaseModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeTaskId || activeSessionId) {
          closeTaskDetail();
        } else if (showSettings) {
          setShowSettings(false);
        } else if (showCodebaseModal) {
          closeCodebaseModal();
        }
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [activeTaskId, activeSessionId, showSettings, showCodebaseModal, closeTaskDetail, closeCodebaseModal]);


  async function createTaskCard() {
    if (isCreatingTask) return;
    setIsCreatingTask(true);
    setCreateTaskError(null);
    try {
      await ensureBoardAutoProviderPersisted();
      const effectiveCodebaseIds = draft.codebaseIds.length > 0 ? draft.codebaseIds : allCodebaseIds;
      const response = await desktopAwareFetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          boardId: selectedBoardId ?? defaultBoardId,
          title: draft.title,
          objective: draft.objectiveHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
          testCases: draft.testCases.split("\n").map((item) => item.trim()).filter(Boolean),
          priority: draft.priority,
          labels: draft.labels.split(",").map((label) => label.trim()).filter(Boolean),
          createGitHubIssue: draft.createGitHubIssue,
          creationSource: "manual",
          repoPath: effectiveCodebaseIds.length > 0
            ? codebases.find((codebase) => codebase.id === effectiveCodebaseIds[0])?.repoPath
            : defaultCodebase?.repoPath,
          codebaseIds: effectiveCodebaseIds,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to create task");
      }
      setLocalTasks((current) => [...current, data.task as TaskInfo]);
      setDraft({ ...EMPTY_DRAFT, objectiveHtml: "", createGitHubIssue: false });
      setShowCreateModal(false);
      toast.success(t.feedback.cardCreated, { description: draft.title });
      onRefresh();
    } catch (error) {
      // Keep the modal open so the draft is not lost, and tell the user why.
      const message = error instanceof Error ? error.message : String(error);
      console.error("[kanban] Failed to create task:", error);
      setCreateTaskError(message);
      toast.error(t.feedback.cardCreateFailed, { description: message });
    } finally {
      setIsCreatingTask(false);
    }
  }

  /** Shared tail of both GitHub importers: merge new cards into local state. */
  function mergeImportedTasks(importedTasks: TaskInfo[]) {
    if (importedTasks.length === 0) return;
    setLocalTasks((current) => {
      const existingIds = new Set(current.map((task) => task.id));
      return [...current, ...importedTasks.filter((task) => !existingIds.has(task.id))];
    });
    onRefresh();
  }

  async function importGitHubIssues(
    codebaseId: string,
    issues: GitHubIssueListItemInfo[],
    repo: string,
    mergeAsSingleCard: boolean,
  ) {
    await ensureBoardAutoProviderPersisted();
    const boardId = selectedBoardId ?? defaultBoardId;
    mergeImportedTasks(await importGitHubItems({
      workspaceId,
      boardId,
      codebaseId,
      items: issues,
      mergeAsSingleCard,
      mergedTitle: t.kanbanImport.mergedIssuesTitle,
      mergedObjectiveLabels: { heading: t.kanbanImport.mergedSourceListHeading, summary: t.kanbanImport.mergedSummaryLabel },
      mergeFallbackMessage: t.kanbanImport.importFailed,
      createItemPayload: (issue) => ({
        workspaceId,
        boardId,
        columnId: "backlog",
        title: issue.title,
        objective: issue.body?.trim() || issue.title,
        labels: issue.labels,
        codebaseIds: [codebaseId],
        githubId: issue.id,
        githubNumber: issue.number,
        githubUrl: issue.url,
        githubRepo: repo,
        githubState: issue.state,
      }),
      createItemFallbackMessage: (issue) => `Failed to import GitHub issue #${issue.number}`,
    }));
  }

  async function importGitHubPulls(
    codebaseId: string,
    pulls: GitHubPRListItemInfo[],
    repo: string,
    mergeAsSingleCard: boolean,
  ) {
    await ensureBoardAutoProviderPersisted();
    const boardId = selectedBoardId ?? defaultBoardId;
    mergeImportedTasks(await importGitHubItems({
      workspaceId,
      boardId,
      codebaseId,
      items: pulls,
      mergeAsSingleCard,
      mergedTitle: t.kanbanImport.mergedPullsTitle,
      mergedObjectiveLabels: { heading: t.kanbanImport.mergedSourceListHeading, summary: t.kanbanImport.mergedSummaryLabel },
      mergeFallbackMessage: t.kanbanImport.importPullsFailed,
      createItemPayload: (pull) => ({
        workspaceId,
        boardId,
        columnId: "backlog",
        title: pull.title,
        objective: pull.body?.trim() || pull.title,
        labels: pull.labels,
        codebaseIds: [codebaseId],
        githubId: pull.id,
        githubNumber: pull.number,
        githubUrl: pull.url,
        githubRepo: repo,
        githubState: pull.state,
        isPullRequest: true,
      }),
      createItemFallbackMessage: (pull) => `Failed to import GitHub pull request #${pull.number}`,
    }));
  }

  async function retryTaskTrigger(taskId: string) {
    await ensureBoardAutoProviderPersisted();
    const task = localTasks.find((item) => item.id === taskId);
    const effectiveAutomation = task
      ? resolveEffectiveTaskAutomation(task, board?.columns ?? [], resolveSpecialist, {
        autoProviderId: boardAutoProviderId,
      })
      : undefined;
    const retryProviderId = task
      && effectiveAutomation?.source !== "card"
      && effectiveAutomation?.transport !== "a2a"
      && effectiveAutomation?.providerSource === "auto"
      && boardAutoProviderId
      ? boardAutoProviderId
      : undefined;
    const updated = await patchTask(taskId, {
      retryTrigger: true,
      ...(retryProviderId ? { retryProviderId } : {}),
    });
    if (updated.triggerSessionId) {
      // Keep the task detail open and update the session ID
      setActiveSessionId(updated.triggerSessionId);
      // Select the new session in ACP
      if (acp) {
        acp.selectSession(updated.triggerSessionId);
      }
    }
    onRefresh();
  }

  async function runTaskPullRequest(taskId: string): Promise<string | null> {
    await ensureBoardAutoProviderPersisted();
    const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(taskId)}/pr-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specialistLocale: specialistLanguage }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof data?.error === "string" ? data.error : "Failed to start PR session");
    }
    const sessionId = typeof data?.sessionId === "string" ? data.sessionId : null;
    if (sessionId) {
      setActiveSessionId(sessionId);
      acp?.selectSession(sessionId);
      onRefresh();
    }
    return sessionId;
  }

  function confirmDeleteTask(task: TaskInfo) {
    setIsDeleting(false);
    setDeleteError(null);
    setDeleteConfirmTask(task);
  }

  async function executeDeleteTask() {
    if (!deleteConfirmTask) return;

    const deletedTitle = deleteConfirmTask.title;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const response = await desktopAwareFetch(`/api/tasks/${encodeURIComponent(deleteConfirmTask.id)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to delete task");
      }
      setLocalTasks((current) => current.filter((task) => task.id !== deleteConfirmTask.id));
      setDeleteConfirmTask(null);
      closeTaskDetail();
      toast.success(t.feedback.cardDeleted, { description: deletedTitle });
      onRefresh();
    } catch (error) {
      // Keep the modal open so the user can retry — and now actually tell them.
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to delete task:", error);
      setDeleteError(message);
      toast.error(t.feedback.cardDeleteFailed, { description: message });
    } finally {
      setIsDeleting(false);
    }
  }

  function cancelDeleteTask() {
    setDeleteConfirmTask(null);
    setIsDeleting(false);
    setDeleteError(null);
  }

  const kanbanTabHeaderProps = {
    tasksCount: tasks.length,
    board,
    boardQueue,
    boards: visibleBoards,
    selectedBoardId,
    onSelectBoard: handleSelectBoard,
    githubImportVisible: hasGitHubCodebase && githubAccessAvailable,
    onOpenGitHubImport: () => setShowGitHubImportModal(true),
    onRefresh,
    onOpenSettings: board ? () => setShowSettings(true) : undefined,
  };

  const kanbanTabHeaderActionProps = {
    board,
    onAgentPrompt,
    availableProviders,
    selectedProviderId: resolveKanbanBoardAutoProviderId(board, acp?.selectedProvider) ?? "",
    onBoardProviderChange: setKanbanBoardProvider,
    disableBoardProvider: !acp?.connected || availableProviders.length === 0,
    kanbanTaskAgentCopy,
    agentInput,
    onAgentInputChange: setAgentInput,
    onAgentSubmit: () => {
      void handleAgentSubmit();
    },
    showCreateTaskModal: () => setShowCreateModal(true),
    agentLoading,
    agentSessionId,
    openAgentPanel,
  };

  const settingsModalProps: KanbanSettingsModalProps | undefined = board ? {
    board,
    columnAutomation,
    availableProviders,
    specialists,
    specialistLanguage,
    githubImportAvailable: hasGitHubCodebase && githubAccessAvailable,
    githubAccessSource,
    onClose: () => setShowSettings(false),
    onClearAll: async () => {
      const response = await desktopAwareFetch(`/api/tasks?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to clear tasks");
      }

      setLocalTasks([]);
      closeTaskDetail();
      setShowSettings(false);
      onRefresh();
    },
    onSave: async (
      newColumns: KanbanBoardInfo["columns"],
      newColumnAutomation: Record<string, ColumnAutomationConfig>,
      sessionConcurrencyLimit: number,
      devSessionSupervision: KanbanDevSessionSupervisionInfo,
      historyMemoryPolicy: KanbanHistoryMemoryPolicyInfo,
      githubTokenUpdate?: { token?: string; clear?: boolean },
    ) => {
      const updatedColumns = newColumns.map((col) => ({
        ...col,
        automation: newColumnAutomation[col.id]
          ? (normalizeKanbanAutomation(newColumnAutomation[col.id]) ?? newColumnAutomation[col.id])
          : undefined,
      }));

      const response = await desktopAwareFetch(`/api/kanban/boards/${encodeURIComponent(board.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns: updatedColumns,
          sessionConcurrencyLimit,
          devSessionSupervision,
          historyMemoryPolicy,
          ...(githubTokenUpdate?.token ? { githubToken: githubTokenUpdate.token } : {}),
          ...(githubTokenUpdate?.clear ? { clearGitHubToken: true } : {}),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error ?? "Failed to save settings");
      }

      const data = await response.json();
      const updatedBoard = data.board as KanbanBoardInfo | undefined;
      if (updatedBoard) {
        setLocalBoards((current) => current.map((item) => (
          item.id === updatedBoard.id ? updatedBoard : item
        )));
      }

      setVisibleColumns(updatedColumns.filter((col) => col.visible !== false).map((col) => col.id));
      setColumnAutomation(newColumnAutomation);
      setShowSettings(false);
      onRefresh();
    },
  } : undefined;

  const boardSurfaceProps = board ? {
    moveError,
    onDismissMoveError: () => setMoveError(null),
    codebases,
    workspaceId,
    defaultCodebase,
    repoSync,
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
    runTaskPullRequest,
    openTaskDetail,
    agentSession,
    onCloseAgentPanel: () => setAgentPanelOpen(false),
    ensureKanbanAgentSession,
    kanbanRepoSelection,
    fileChangesOpen,
    setFileChangesOpen,
    gitLogOpen,
    setGitLogOpen,
  } : undefined;

  const taskDetailOverlayProps = board ? {
    activeSessionId,
    activeTaskId,
    activeTask,
    board,
    resolveSpecialist,
    acp,
    boardAutoProviderId,
    onBoardProviderChange: setKanbanBoardProvider,
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
    pinSessionId: (sessionId: string) => {
      pinnedSessionIdsRef.current.add(sessionId);
    },
    sessionMap,
    workspaceId,
    isTaskDetailFullscreen,
    onToggleTaskDetailFullscreen: setIsTaskDetailFullscreen,
    closeTaskDetail,
  } : undefined;

  const createTaskModalProps = {
    showCreateModal,
    draft,
    setDraft,
    onClose: () => {
      setShowCreateModal(false);
      setCreateTaskError(null);
    },
    onCreate: () => {
      void createTaskCard();
    },
    creating: isCreatingTask,
    createError: createTaskError,
    githubAvailable,
    codebases,
    allCodebaseIds,
  };

  const githubImportModalProps = {
    show: showGitHubImportModal,
    workspaceId,
    boardId: board?.id,
    codebases,
    tasks: localTasks,
    onClose: () => setShowGitHubImportModal(false),
    onImport: importGitHubIssues,
    onImportPulls: importGitHubPulls,
  };

  const codebaseModalProps = {
    key: showCodebaseModal ? (selectedCodebase?.id ?? "workspace-repos-open") : "workspace-repos-closed",
    open: showCodebaseModal,
    selectedCodebase,
    editingCodebase: codebaseModal.editingCodebase,
    codebases,
    addRepoSelection: codebaseModal.addRepoSelection,
    setAddRepoSelection: codebaseModal.setAddRepoSelection,
    addSaving: codebaseModal.addSaving,
    addError: codebaseModal.addError,
    onAddRepository: codebaseModal.handleAddCodebase,
    editRepoSelection: codebaseModal.editRepoSelection,
    onRepoSelectionChange: codebaseModal.handleRepoSelectionChange,
    editError: codebaseModal.editError,
    recloneError: codebaseModal.recloneError,
    editSaving: codebaseModal.editSaving,
    replacingAll: codebaseModal.replacingAll,
    setShowReplaceAllConfirm: codebaseModal.setShowReplaceAllConfirm,
    handleCancelEditCodebase: codebaseModal.handleCancelEditCodebase,
    codebaseWorktrees: codebaseModal.codebaseWorktrees,
    worktreeActionError: codebaseModal.worktreeActionError,
    localTasks,
    handleDeleteCodebaseWorktrees: codebaseModal.handleDeleteCodebaseWorktrees,
    deletingWorktreeIds: codebaseModal.deletingWorktreeIds,
    liveBranchInfo: codebaseModal.liveBranchInfo,
    branchActionError: codebaseModal.branchActionError,
    repoHealth,
    onSelectCodebase: (codebase: CodebaseData) => {
      void selectCodebase(codebase);
    },
    handleDeleteIssueBranch: codebaseModal.handleDeleteIssueBranch,
    handleDeleteIssueBranches: codebaseModal.handleDeleteIssueBranches,
    deletingBranchNames: codebaseModal.deletingBranchNames,
    handleReclone: codebaseModal.handleReclone,
    recloning: codebaseModal.recloning,
    recloneSuccess: codebaseModal.recloneSuccess,
    onStartEditCodebase: codebaseModal.handleStartEditCodebase,
    onRequestRemoveCodebase: () => codebaseModal.setShowDeleteCodebaseConfirm(true),
    onClose: closeCodebaseModal,
  };

  const deleteCodebaseModalProps = {
    show: codebaseModal.showDeleteCodebaseConfirm,
    selectedCodebase,
    editError: codebaseModal.editError,
    deletingCodebase: codebaseModal.deletingCodebase,
    onCancel: () => codebaseModal.setShowDeleteCodebaseConfirm(false),
    onConfirm: codebaseModal.handleRemoveCodebase,
  };

  const replaceAllReposModalProps = {
    show: codebaseModal.showReplaceAllConfirm,
    editRepoSelection: codebaseModal.editRepoSelection,
    codebasesCount: codebases.length,
    recloneError: codebaseModal.recloneError,
    replacingAll: codebaseModal.replacingAll,
    onCancel: () => codebaseModal.setShowReplaceAllConfirm(false),
    onConfirm: codebaseModal.handleReplaceAllRepos,
  };

  const deleteTaskModalProps = {
    deleteConfirmTask,
    isDeleting,
    deleteError,
    onCancel: cancelDeleteTask,
    onConfirm: executeDeleteTask,
  };

  const worktreeCleanupModalProps = {
    prompt: worktreeCleanupPrompt,
    onConfirm: () => {
      void resolveWorktreeCleanupPrompt(true);
    },
    onSkip: () => {
      void resolveWorktreeCleanupPrompt(false);
    },
  };

  const blockedTask = moveBlockedState
    ? localTasks.find((task) => task.id === moveBlockedState.taskId)
      ?? tasks.find((task) => task.id === moveBlockedState.taskId)
      ?? null
    : null;
  const moveBlockedModalProps = {
    blocked: moveBlockedState,
    onClose: () => setMoveBlockedState(null),
    onDelegateFix: moveBlockedState && onAgentPrompt
      ? () => {
        void delegateMoveBlockedFix(moveBlockedState);
      }
      : undefined,
    isDelegating: moveBlockedState?.taskId === moveBlockedDelegatingTaskId,
    onOpenCard: blockedTask ? () => {
      void openTaskDetail(blockedTask);
      setMoveBlockedState(null);
    } : undefined,
  };

  const statusBarProps = {
    defaultCodebase,
    codebases,
    fileChangesSummary,
    board,
    boardQueue,
    repoHealth,
    selectedProvider: selectedProviderInfo,
    onRepoClick: openCodebaseModal,
    onFileChangesClick: () => setFileChangesOpen((prev) => !prev),
    onGitLogClick: () => setGitLogOpen((prev) => !prev),
    onProviderClick: () => {
      // Could open provider settings or do nothing
    },
    onFitnessClick: () => {
      setShowFitnessWorkbench(true);
    },
    fileChangesOpen,
    gitLogOpen,
    repoSync,
    runtimeFitness: runtimeFitness.data,
    runtimeFitnessLoading: runtimeFitness.loading,
    runtimeFitnessError: runtimeFitness.error,
  };

  const fitnessWorkbenchModalProps = {
    open: showFitnessWorkbench,
    workspaceId,
    codebase: defaultCodebase,
    runtimeFitness: runtimeFitness.data,
    sessionId: fitnessWorkbenchSessionId,
    onSessionIdChange: setFitnessWorkbenchSessionId,
    onClose: () => setShowFitnessWorkbench(false),
  };

  return (
    <KanbanTabContent
      headerProps={kanbanTabHeaderProps}
      headerActionProps={kanbanTabHeaderActionProps}
      boardSurfaceProps={boardSurfaceProps}
      createTaskModalProps={createTaskModalProps}
      githubImportModalProps={githubImportModalProps}
      taskDetailOverlayProps={taskDetailOverlayProps}
      showSettingsModal={showSettings}
      settingsModalProps={settingsModalProps}
      codebaseModalProps={codebaseModalProps}
      deleteCodebaseModalProps={deleteCodebaseModalProps}
      replaceAllReposModalProps={replaceAllReposModalProps}
      deleteTaskModalProps={deleteTaskModalProps}
      worktreeCleanupModalProps={worktreeCleanupModalProps}
      moveBlockedModalProps={moveBlockedModalProps}
      statusBarProps={statusBarProps}
      fitnessWorkbenchModalProps={fitnessWorkbenchModalProps}
    />
  );
}
