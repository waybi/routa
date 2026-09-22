"use client";

/**
 * Moving a card between columns: optimistic update, worktree cleanup prompt,
 * gate-blocked handling, and delegating a blocked move to an agent that fixes
 * the story so the move can proceed.
 *
 * Extracted from `kanban-tab.tsx` following `docs/REFACTOR.md` (orchestration
 * shell + domain hooks). The board passes in what it already owns — task state
 * and the shared `patchTask` — and reads back the move state for its modals.
 */

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { KanbanAgentPromptHandler, TaskInfo, WorktreeInfo } from "../types";
import { scheduleKanbanRefreshBurst } from "./kanban-agent-input";
import { buildKanbanMoveBlockedRemediationPrompt } from "./i18n/kanban-task-agent";
import { buildKanbanTaskAdaptiveHarnessOptions } from "./kanban-task-adaptive";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";

export type MoveBlockedState = {
  message: string;
  taskId: string;
  targetColumnId: string;
  storyReadiness?: TaskInfo["storyReadiness"];
  missingTaskFields?: string[];
};

/**
 * Thrown by `patchTask` when the server refuses a transition. Carries the
 * gate details so the blocked-move modal can say what is missing.
 */
export class TaskPatchError extends Error {
  storyReadiness?: TaskInfo["storyReadiness"];
  missingTaskFields?: string[];

  constructor(
    message: string,
    options?: {
      storyReadiness?: TaskInfo["storyReadiness"];
      missingTaskFields?: string[];
    },
  ) {
    super(message);
    this.name = "TaskPatchError";
    this.storyReadiness = options?.storyReadiness;
    this.missingTaskFields = options?.missingTaskFields;
  }
}

export type WorktreeCleanupPrompt = {
  taskId: string;
  targetColumnId: string;
};

/** How long delegateMoveBlockedFix waits for the agent to make the card ready. */
const REMEDIATION_POLL_UNTIL_MS = 30_000;
const REMEDIATION_POLL_INTERVAL_MS = 2_000;

function statusForColumn(columnId: string): TaskInfo["status"] {
  switch (columnId) {
    case "dev":
      return "IN_PROGRESS";
    case "review":
      return "REVIEW_REQUIRED";
    case "blocked":
      return "BLOCKED";
    case "done":
      return "COMPLETED";
    default:
      return "PENDING";
  }
}

export interface UseKanbanCardMoveOptions {
  workspaceId: string;
  selectedBoardId: string | null;
  defaultBoardId: string | null;
  defaultCodebase: CodebaseData | null | undefined;
  boardAutoProviderId: string | undefined;
  specialistLanguage: KanbanSpecialistLanguage;
  tasks: TaskInfo[];
  localTasks: TaskInfo[];
  boardTasks: TaskInfo[];
  setLocalTasks: Dispatch<SetStateAction<TaskInfo[]>>;
  setWorktreeCache: Dispatch<SetStateAction<Record<string, WorktreeInfo>>>;
  patchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  fetchTaskById: (taskId: string) => Promise<TaskInfo>;
  ensureBoardAutoProviderPersisted: () => Promise<void>;
  openSession: (sessionId: string | null, task?: TaskInfo | null) => void;
  openAgentPanel: (sessionId: string) => void;
  onAgentPrompt?: KanbanAgentPromptHandler;
  onRefresh: () => void;
}

export function useKanbanCardMove({
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
}: UseKanbanCardMoveOptions) {
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveBlockedState, setMoveBlockedState] = useState<MoveBlockedState | null>(null);
  const [moveBlockedDelegatingTaskId, setMoveBlockedDelegatingTaskId] = useState<string | null>(null);
  // Moving a card with an attached worktree into Done asks first.
  const [worktreeCleanupPrompt, setWorktreeCleanupPrompt] = useState<WorktreeCleanupPrompt | null>(null);

  const performMoveTask = useCallback(async (
    taskId: string,
    targetColumnId: string,
    shouldCleanupWorktree: boolean,
  ) => {
    const movingTask = localTasks.find((task) => task.id === taskId);
    if (!movingTask) return;

    await ensureBoardAutoProviderPersisted();
    setMoveError(null);
    setMoveBlockedState(null);

    const nextPosition = boardTasks.filter((task) => task.columnId === targetColumnId).length;
    setLocalTasks(localTasks.map((task) =>
      task.id === taskId
        ? { ...task, columnId: targetColumnId, position: nextPosition, status: statusForColumn(targetColumnId) }
        : task,
    ));

    try {
      let updated = await patchTask(taskId, { columnId: targetColumnId, position: nextPosition });
      if (shouldCleanupWorktree && movingTask.worktreeId) {
        const response = await desktopAwareFetch(`/api/worktrees/${encodeURIComponent(movingTask.worktreeId)}`, {
          method: "DELETE",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to remove worktree");
        }
        updated = await patchTask(taskId, { worktreeId: null });
        const removedWorktreeId = movingTask.worktreeId;
        setWorktreeCache((current) => {
          const next = { ...current };
          delete next[removedWorktreeId];
          return next;
        });
      }
      if (updated.triggerSessionId && updated.triggerSessionId !== movingTask.triggerSessionId) {
        openSession(updated.triggerSessionId, updated);
      }
      setMoveError(null);
      onRefresh();
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to move task";
      if (message.startsWith("Cannot move ")) {
        setMoveBlockedState({
          message,
          taskId,
          targetColumnId,
          storyReadiness: error instanceof TaskPatchError ? error.storyReadiness : undefined,
          missingTaskFields: error instanceof TaskPatchError ? error.missingTaskFields : undefined,
        });
        setMoveError(null);
      } else {
        setMoveError(message);
      }
      // Roll the optimistic update back to the last server-confirmed state.
      setLocalTasks(tasks);
    }
  }, [
    boardTasks,
    ensureBoardAutoProviderPersisted,
    localTasks,
    onRefresh,
    openSession,
    patchTask,
    setLocalTasks,
    setWorktreeCache,
    tasks,
  ]);

  const moveTask = useCallback(async (taskId: string, targetColumnId: string) => {
    const movingTask = localTasks.find((task) => task.id === taskId);
    if (!movingTask) return;

    if (targetColumnId === "done" && movingTask.worktreeId) {
      setWorktreeCleanupPrompt({ taskId, targetColumnId });
      return;
    }

    await performMoveTask(taskId, targetColumnId, false);
  }, [localTasks, performMoveTask]);

  const resolveWorktreeCleanupPrompt = useCallback(async (shouldCleanup: boolean) => {
    const pending = worktreeCleanupPrompt;
    setWorktreeCleanupPrompt(null);
    if (!pending) return;
    await performMoveTask(pending.taskId, pending.targetColumnId, shouldCleanup);
  }, [performMoveTask, worktreeCleanupPrompt]);

  /**
   * Hands a gate-blocked move to a planning agent, then polls the card and
   * retries the move once the agent has made it story-ready.
   */
  const delegateMoveBlockedFix = useCallback(async (blocked: MoveBlockedState) => {
    if (!onAgentPrompt || moveBlockedDelegatingTaskId) return;

    const task = localTasks.find((item) => item.id === blocked.taskId)
      ?? tasks.find((item) => item.id === blocked.taskId)
      ?? null;
    if (!task) return;

    setMoveBlockedDelegatingTaskId(blocked.taskId);
    setMoveError(null);

    try {
      await ensureBoardAutoProviderPersisted();
      const missingFields = blocked.storyReadiness?.missing?.length
        ? blocked.storyReadiness.missing
        : blocked.missingTaskFields ?? [];
      const remediationPrompt = buildKanbanMoveBlockedRemediationPrompt({
        workspaceId,
        boardId: selectedBoardId ?? defaultBoardId ?? "default",
        cardId: blocked.taskId,
        cardTitle: task.title,
        targetColumnId: blocked.targetColumnId,
        repoPath: defaultCodebase?.repoPath,
        missingFields,
        language: specialistLanguage,
      });
      const sessionId = await onAgentPrompt(remediationPrompt, {
        boardId: selectedBoardId ?? defaultBoardId ?? task.boardId ?? undefined,
        provider: boardAutoProviderId,
        role: "CRAFTER",
        toolMode: "full",
        allowedNativeTools: ["Read", "Grep", "Glob"],
        mcpProfile: "kanban-planning",
        systemPrompt: remediationPrompt,
        taskAdaptiveHarness: buildKanbanTaskAdaptiveHarnessOptions(task.title, {
          locale: specialistLanguage,
          role: "CRAFTER",
          taskType: "planning",
          task,
        }),
      });
      if (!sessionId) return;

      openAgentPanel(sessionId);
      setMoveBlockedState(null);
      scheduleKanbanRefreshBurst(onRefresh);

      const startedAt = Date.now();
      while (Date.now() - startedAt < REMEDIATION_POLL_UNTIL_MS) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, REMEDIATION_POLL_INTERVAL_MS);
        });
        const refreshedTask = await fetchTaskById(blocked.taskId).catch(() => null);
        if (!refreshedTask) continue;
        setLocalTasks((current) => current.map((entry) => (entry.id === refreshedTask.id ? refreshedTask : entry)));
        if (refreshedTask.storyReadiness?.ready) {
          await moveTask(blocked.taskId, blocked.targetColumnId);
          return;
        }
      }
    } catch (error) {
      console.error("[kanban] Failed to delegate story-readiness remediation:", error);
    } finally {
      setMoveBlockedDelegatingTaskId((current) => (current === blocked.taskId ? null : current));
    }
  }, [
    boardAutoProviderId,
    defaultBoardId,
    defaultCodebase?.repoPath,
    ensureBoardAutoProviderPersisted,
    fetchTaskById,
    localTasks,
    moveBlockedDelegatingTaskId,
    moveTask,
    onAgentPrompt,
    onRefresh,
    openAgentPanel,
    selectedBoardId,
    setLocalTasks,
    specialistLanguage,
    tasks,
    workspaceId,
  ]);

  return {
    moveTask,
    moveError,
    setMoveError,
    moveBlockedState,
    setMoveBlockedState,
    moveBlockedDelegatingTaskId,
    delegateMoveBlockedFix,
    worktreeCleanupPrompt,
    resolveWorktreeCleanupPrompt,
  };
}
