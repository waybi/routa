"use client";

/**
 * Dismissed attention items per board, persisted in localStorage with an
 * in-memory fallback when storage is unavailable (private mode, quota, or
 * stubbed in tests). Mirrors the Done-collapse store in
 * kanban-done-column-window.ts.
 */

import { useSyncExternalStore } from "react";

const STORAGE_PREFIX = "routa.kanban.attentionDismissed.";

export function attentionDismissalsStorageKey(boardId: string): string {
  return `${STORAGE_PREFIX}${boardId}`;
}

/** Only holds boards whose last localStorage write failed. */
const memoryDismissals = new Map<string, string[]>();
const listeners = new Set<() => void>();
/** Stable snapshots per raw value so useSyncExternalStore does not loop. */
const snapshotCache = new Map<string, { raw: string; keys: readonly string[] }>();
const EMPTY: readonly string[] = [];
/** Bumped on every local write and every cross-tab `storage` event. */
let version = 0;

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
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  // Another tab wrote localStorage: bump first so the snapshot changes.
  const onStorage = () => {
    version += 1;
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const readVersion = () => version;
const getServerVersion = () => 0;

/**
 * Changes whenever any board's dismissals change (this tab or another), so
 * callers that read via readAttentionDismissals re-render and recount.
 */
export function useAttentionDismissalsVersion(): number {
  return useSyncExternalStore(subscribe, readVersion, getServerVersion);
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
