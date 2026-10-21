"use client";

/**
 * Per-card change signal for task-only refreshes.
 *
 * A `kanban:changed` frame for a task refetches `/api/tasks` only and leaves
 * the board-wide `refreshSignal` alone. Panels that load their own data for
 * one card and cannot rely on `task.updatedAt` (artifact uploads emit a task
 * event without touching the task row) subscribe here to reload for that card.
 */

import { useEffect, useState } from "react";

type Listener = (taskIds: ReadonlySet<string>) => void;

const listeners = new Set<Listener>();

export function publishKanbanTaskChanges(taskIds: readonly string[]): void {
  if (taskIds.length === 0) return;
  const ids = new Set(taskIds);
  for (const listener of listeners) listener(ids);
}

/**
 * Returns a refresh signal for one card's detail panels: the board-wide
 * `baseSignal` plus a counter that increments each time `taskId` is published.
 */
export function useKanbanTaskChangeSignal(taskId: string, baseSignal = 0): number {
  const [signal, setSignal] = useState(0);
  useEffect(() => {
    const listener: Listener = (ids) => {
      if (ids.has(taskId)) setSignal((value) => value + 1);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [taskId]);
  return baseSignal + signal;
}
