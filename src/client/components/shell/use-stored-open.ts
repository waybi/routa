"use client";

/**
 * Remembered open / collapsed state for the sidebar's foldable sections
 * (Projects, Resources, Developer). Each section stores "true" or "false"
 * under its own localStorage key; every reader on the page is notified when
 * one of them toggles, and changes from other tabs arrive via "storage".
 */

import { useSyncExternalStore } from "react";

const storageListeners = new Set<() => void>();

function subscribeStored(listener: () => void): () => void {
  storageListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    storageListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** "true" / "false" as stored; anything else (missing, unknown, storage error) is `fallback`. */
export function readStored(key: string, fallback = false): boolean {
  try {
    const value = window.localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Storage can be unavailable (private mode); the toggle then only lasts until reload.
  }
  storageListeners.forEach((listener) => listener());
}

/** Remembered open state; `fallback` during server render and hydration. */
export function useStoredOpen(key: string, fallback = false): boolean {
  return useSyncExternalStore(
    subscribeStored,
    () => readStored(key, fallback),
    () => fallback,
  );
}
