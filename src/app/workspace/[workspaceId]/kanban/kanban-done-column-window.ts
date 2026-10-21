"use client";

/**
 * Done column windowing: the Done lane only ever grows, so by default it
 * renders the most recently finished cards (newest first) and lets the user
 * reveal earlier ones page by page, or collapse the whole lane. The collapsed
 * flag is persisted per board in localStorage.
 *
 * Pure helpers (`sortDoneTasks`, `windowDoneTasks`) are kept separate from
 * the hook so they can be reused once the board gains search / filters
 * (pass `unlimited: true` then, so matches are never hidden).
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import type { TaskInfo } from "../types";
import { getDoneEnteredAt } from "./kanban-done-time";

export const DONE_COLUMN_ID = "done";
export const DONE_COLUMN_PAGE_SIZE = 20;

const COLLAPSED_STORAGE_PREFIX = "routa.kanban.doneCollapsed.";

export function doneCollapsedStorageKey(boardId: string): string {
  return `${COLLAPSED_STORAGE_PREFIX}${boardId}`;
}

/**
 * Newest first by the time the card entered Done (see `getDoneEnteredAt`:
 * trailing Done lane session, then `updatedAt`, then `createdAt`). Ties break
 * on position, then id, so cards finished within the same second keep a
 * stable order across renders. Returns a new array.
 */
export function sortDoneTasks(tasks: readonly TaskInfo[]): TaskInfo[] {
  return tasks.slice().sort((left, right) => {
    const byTime = getDoneEnteredAt(right) - getDoneEnteredAt(left);
    if (byTime !== 0) return byTime;
    const byPosition = (left.position ?? 0) - (right.position ?? 0);
    if (byPosition !== 0) return byPosition;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export interface DoneColumnWindow {
  /** Cards to render, newest first. */
  visible: TaskInfo[];
  /** All cards in the column. */
  total: number;
  hiddenCount: number;
  /** How many more cards the next "show earlier" click reveals. */
  nextStep: number;
}

export function windowDoneTasks(
  tasks: readonly TaskInfo[],
  options: { visibleCount: number; unlimited?: boolean },
): DoneColumnWindow {
  const sorted = sortDoneTasks(tasks);
  const limit = options.unlimited ? sorted.length : Math.max(0, options.visibleCount);
  const visible = sorted.slice(0, limit);
  const hiddenCount = sorted.length - visible.length;
  return {
    visible,
    total: sorted.length,
    hiddenCount,
    nextStep: Math.min(DONE_COLUMN_PAGE_SIZE, hiddenCount),
  };
}

// ---------------------------------------------------------------------------
// Collapsed flag store (localStorage, with an in-memory fallback when storage
// is unavailable: private mode, quota, or stubbed in tests).

/** Only holds keys whose last localStorage write failed. */
const memoryCollapsed = new Map<string, boolean>();
const listeners = new Set<() => void>();

function readCollapsed(boardId: string): boolean {
  const key = doneCollapsedStorageKey(boardId);
  const fallback = memoryCollapsed.get(key);
  if (fallback !== undefined) return fallback;
  try {
    return window.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(boardId: string, collapsed: boolean): void {
  const key = doneCollapsedStorageKey(boardId);
  try {
    window.localStorage.setItem(key, collapsed ? "1" : "0");
    memoryCollapsed.delete(key);
  } catch {
    // Storage unavailable (private mode, quota): keep the value for this tab.
    memoryCollapsed.set(key, collapsed);
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Server render has no localStorage: always start expanded, then sync. */
const getServerCollapsed = () => false;

export function useDoneColumnWindow(boardId: string) {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => readCollapsed(boardId),
    getServerCollapsed,
  );
  // Keyed by board so switching boards starts again from one page.
  const [expansion, setExpansion] = useState({ boardId, count: DONE_COLUMN_PAGE_SIZE });
  const visibleCount = expansion.boardId === boardId ? expansion.count : DONE_COLUMN_PAGE_SIZE;

  const toggleCollapsed = useCallback(() => {
    writeCollapsed(boardId, !readCollapsed(boardId));
  }, [boardId]);

  const showMore = useCallback(() => {
    setExpansion((current) => ({
      boardId,
      count: (current.boardId === boardId ? current.count : DONE_COLUMN_PAGE_SIZE) + DONE_COLUMN_PAGE_SIZE,
    }));
  }, [boardId]);

  const showLess = useCallback(() => {
    setExpansion({ boardId, count: DONE_COLUMN_PAGE_SIZE });
  }, [boardId]);

  return { collapsed, toggleCollapsed, visibleCount, showMore, showLess };
}
