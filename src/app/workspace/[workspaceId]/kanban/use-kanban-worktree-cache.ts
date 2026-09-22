"use client";

/**
 * Resolves `task.worktreeId` → `WorktreeInfo` for the cards on the board, and
 * heals cards whose worktree has disappeared (404) by clearing the stale id
 * both locally and on the server.
 *
 * Extracted from `kanban-tab.tsx` (docs/REFACTOR.md: orchestration shell +
 * domain hooks). The cache is owned here; the codebase-modal and card-move
 * hooks receive `setWorktreeCache` to evict entries they delete.
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { TaskInfo, WorktreeInfo } from "../types";

export interface UseKanbanWorktreeCacheOptions {
  localTasks: TaskInfo[];
  setLocalTasks: Dispatch<SetStateAction<TaskInfo[]>>;
  patchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
}

export function useKanbanWorktreeCache({
  localTasks,
  setLocalTasks,
  patchTask,
}: UseKanbanWorktreeCacheOptions) {
  const [worktreeCache, setWorktreeCache] = useState<Record<string, WorktreeInfo>>({});
  // Ids that already 404'd; remembered so a stale card does not refetch on every render.
  const [missingWorktreeIds, setMissingWorktreeIds] = useState<Record<string, true>>({});

  useEffect(() => {
    const worktreeIds = [...new Set(
      localTasks.map((task) => task.worktreeId).filter((id): id is string => Boolean(id)),
    )];
    const missing = worktreeIds.filter((id) => !worktreeCache[id] && !missingWorktreeIds[id]);
    if (missing.length === 0) return;

    (async () => {
      const results: Record<string, WorktreeInfo> = {};
      const staleIds = new Set<string>();
      await Promise.allSettled(
        missing.map(async (id) => {
          try {
            const res = await desktopAwareFetch(`/api/worktrees/${encodeURIComponent(id)}`, { cache: "no-store" });
            if (res.ok) {
              const data = await res.json();
              if (data.worktree) results[id] = data.worktree as WorktreeInfo;
              return;
            }
            if (res.status === 404) {
              staleIds.add(id);
            }
          } catch { /* ignore */ }
        }),
      );
      if (Object.keys(results).length > 0) {
        setWorktreeCache((prev) => ({ ...prev, ...results }));
      }
      if (staleIds.size > 0) {
        const staleIdList = [...staleIds];
        setMissingWorktreeIds((prev) => ({
          ...prev,
          ...Object.fromEntries(staleIdList.map((id) => [id, true] as const)),
        }));
        setLocalTasks((current) => current.map((task) => (
          task.worktreeId && staleIds.has(task.worktreeId)
            ? { ...task, worktreeId: undefined }
            : task
        )));

        const linkedTasks = localTasks
          .filter((task) => task.worktreeId && staleIds.has(task.worktreeId))
          .map((task) => task.id);

        await Promise.allSettled(linkedTasks.map(async (taskId) => {
          try {
            await patchTask(taskId, { worktreeId: null });
          } catch {
            // Ignore patch failures; the missing-id set prevents repeated 404 noise.
          }
        }));
      }
    })();
  }, [localTasks, missingWorktreeIds, patchTask, setLocalTasks, worktreeCache]);

  return { worktreeCache, setWorktreeCache };
}
