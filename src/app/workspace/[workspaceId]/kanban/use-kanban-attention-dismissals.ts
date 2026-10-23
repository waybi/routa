"use client";

/**
 * Dismissed attention items per board, persisted in localStorage with an
 * in-memory fallback when storage is unavailable (private mode, quota, or
 * stubbed in tests). Mirrors the Done-collapse store in
 * kanban-done-column-window.ts.
 */

const STORAGE_PREFIX = "routa.kanban.attentionDismissed.";

export function attentionDismissalsStorageKey(boardId: string): string {
  return `${STORAGE_PREFIX}${boardId}`;
}

/** Only holds boards whose last localStorage write failed. */
const memoryDismissals = new Map<string, string[]>();
/** Stable snapshots per raw value so repeated reads return the same array. */
const snapshotCache = new Map<string, { raw: string; keys: readonly string[] }>();
const EMPTY: readonly string[] = [];

function parse(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readRaw(boardId: string): string {
  const key = attentionDismissalsStorageKey(boardId);
  const fallback = memoryDismissals.get(key);
  if (fallback) return JSON.stringify(fallback);
  try {
    return window.localStorage?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function readDismissed(boardId: string): readonly string[] {
  const raw = readRaw(boardId);
  if (!raw) return EMPTY;
  const cached = snapshotCache.get(boardId);
  if (cached && cached.raw === raw) return cached.keys;
  const keys = parse(raw);
  snapshotCache.set(boardId, { raw, keys });
  return keys;
}

function writeDismissed(boardId: string, keys: string[]): void {
  const key = attentionDismissalsStorageKey(boardId);
  const raw = JSON.stringify(keys);
  try {
    window.localStorage.setItem(key, raw);
    memoryDismissals.delete(key);
  } catch {
    memoryDismissals.set(key, keys);
  }
}

/** Non-hook read of a board's dismissed keys (e.g. the all-projects overview). */
export function readAttentionDismissals(boardId: string): readonly string[] {
  if (typeof window === "undefined") return EMPTY;
  return readDismissed(boardId);
}

/** Non-hook write (e.g. the "Needs you" page hides items across boards). */
export function dismissAttentionItem(boardId: string, dismissKey: string): void {
  const current = readDismissed(boardId);
  if (current.includes(dismissKey)) return;
  writeDismissed(boardId, [...current, dismissKey]);
}

/** Non-hook undo of dismissAttentionItem. */
export function restoreAttentionItem(boardId: string, dismissKey: string): void {
  const current = readDismissed(boardId);
  if (!current.includes(dismissKey)) return;
  writeDismissed(boardId, current.filter((key) => key !== dismissKey));
}

/** Test-only: drop in-memory fallbacks and cached snapshots. */
export function resetAttentionDismissalsForTests(): void {
  memoryDismissals.clear();
  snapshotCache.clear();
}
