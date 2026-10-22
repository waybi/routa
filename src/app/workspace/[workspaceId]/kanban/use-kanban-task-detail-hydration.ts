"use client";

/**
 * Loads the open card's full record. The board list only carries a slim
 * projection (no comments / jitContextSnapshot / full objective), so the
 * detail fetches GET /api/tasks/:id when it opens and again whenever the
 * board reports the card changed (updatedAt moves on every agent write).
 *
 * Returns the cache of hydrated records plus the state the detail shell
 * shows: `loading` only while the open card has no hydrated copy yet, and
 * `error` when the latest read failed (the summary keeps rendering).
 * `retry` reads again; it never starts any agent work.
 *
 * Extracted from kanban-tab.tsx (redesign card 3/6).
 */

import { useCallback, useEffect, useState } from "react";
import type { TaskInfo } from "../types";

export interface KanbanTaskDetailHydration {
  hydratedTaskDetails: Record<string, TaskInfo>;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useKanbanTaskDetailHydration(
  activeTaskId: string | null,
  activeTaskUpdatedAt: string | undefined,
  fetchTaskById: (taskId: string) => Promise<TaskInfo>,
): KanbanTaskDetailHydration {
  const [hydratedTaskDetails, setHydratedTaskDetails] = useState<Record<string, TaskInfo>>({});
  // Cards whose read finished (with or without a record): ends "loading".
  const [settledTaskIds, setSettledTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const [failure, setFailure] = useState<{ taskId: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!activeTaskId) return;
    let cancelled = false;

    void (async () => {
      try {
        const full = await fetchTaskById(activeTaskId);
        if (cancelled) return;
        if (full) setHydratedTaskDetails((current) => ({ ...current, [activeTaskId]: full }));
        setSettledTaskIds((current) => (current.has(activeTaskId) ? current : new Set(current).add(activeTaskId)));
        setFailure((current) => (current?.taskId === activeTaskId ? null : current));
      } catch (error) {
        if (cancelled) return;
        // The summary record still renders; only detail-only fields are missing.
        console.error("[kanban] Failed to hydrate task detail:", error);
        setFailure({ taskId: activeTaskId, message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTaskId, activeTaskUpdatedAt, attempt, fetchTaskById]);

  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((value) => value + 1);
  }, []);

  const error = activeTaskId && failure?.taskId === activeTaskId ? failure.message : null;
  const loading = Boolean(activeTaskId && !hydratedTaskDetails[activeTaskId] && !settledTaskIds.has(activeTaskId) && !error);
  return { hydratedTaskDetails, loading, error, retry };
}
