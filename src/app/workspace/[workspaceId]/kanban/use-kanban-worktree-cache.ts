"use client";

/**
 * Resolves `task.worktreeId` → `WorktreeInfo` for the cards on the board.
 *
 * When a card's worktree has disappeared (404) the stale id is hidden locally
 * only. Loading the board is a read: it must never PATCH tasks, otherwise every
 * page load rewrites `updated_at` and emits a `kanban:changed` event per stale
 * card. Cleaning stale ids in the database is not the browser's job.
 *
 * Extracted from `kanban-tab.tsx` (docs/REFACTOR.md: orchestration shell +
 * domain hooks). The cache is owned here; the codebase-modal and card-move
 * hooks receive `setWorktreeCache` to evict entries they delete.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { TaskInfo, WorktreeInfo } from "../types";

export interface UseKanbanWorktreeCacheOptions {
  localTasks: TaskInfo[];
  setLocalTasks: Dispatch<SetStateAction<TaskInfo[]>>;
}

export function useKanbanWorktreeCache({
  localTasks,
  setLocalTasks,
}: UseKanbanWorktreeCacheOptions) {
  const [worktreeCache, setWorktreeCache] = useState<Record<string, WorktreeInfo>>({});
  // Ids that already 404'd; remembered so a stale card does not refetch on every render.
  const [missingWorktreeIds, setMissingWorktreeIds] = useState<Record<string, true>>({});
  // Ids with a lookup in flight, so a re-render before it settles does not fire a duplicate GET.
  const inFlightIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const worktreeIds = [...new Set(
      localTasks.map((task) => task.worktreeId).filter((id): id is string => Boolean(id)),
    )];
    const missing = worktreeIds.filter((id) => (
      !worktreeCache[id] && !missingWorktreeIds[id] && !inFlightIdsRef.current.has(id)
    ));
    if (missing.length === 0) return;
    for (const id of missing) inFlightIdsRef.current.add(id);

    (async () => {
      const results: Record<string, WorktreeInfo> = {};
      const staleIds: string[] = [];
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
              staleIds.push(id);
            }
          } catch { /* ignore */ }
        }),
      );
      for (const id of missing) inFlightIdsRef.current.delete(id);
      if (Object.keys(results).length > 0) {
        setWorktreeCache((prev) => ({ ...prev, ...results }));
      }
      if (staleIds.length > 0) {
        setMissingWorktreeIds((prev) => ({
          ...prev,
          ...Object.fromEntries(staleIds.map((id) => [id, true] as const)),
        }));
      }
    })();
  }, [localTasks, missingWorktreeIds, worktreeCache]);

  // Hide stale ids locally. Re-applied whenever the board refetches tasks,
  // because the server still returns the old id and would otherwise bring the
  // "worktree loading..." badge back.
  useEffect(() => {
    const hasStale = localTasks.some((task) => task.worktreeId && missingWorktreeIds[task.worktreeId]);
    if (!hasStale) return;
    setLocalTasks((current) => current.map((task) => (
      task.worktreeId && missingWorktreeIds[task.worktreeId]
        ? { ...task, worktreeId: undefined }
        : task
    )));
  }, [localTasks, missingWorktreeIds, setLocalTasks]);

  return { worktreeCache, setWorktreeCache };
}
