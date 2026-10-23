"use client";

/**
 * Remembered wide-screen sidebar collapse (56px icon rail). Same storage key
 * and change event as the pre-redesign shell, so earlier preferences still
 * apply. Server render and hydration always start expanded.
 */

import { useCallback, useSyncExternalStore } from "react";

export const SIDEBAR_COLLAPSED_STORAGE_KEY = "routa.desktop.sidebar-collapsed";
export const SIDEBAR_COLLAPSED_CHANGE_EVENT = "routa:desktop-sidebar-collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function subscribeCollapsed(listener: () => void): () => void {
  window.addEventListener(SIDEBAR_COLLAPSED_CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(SIDEBAR_COLLAPSED_CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Storage can be unavailable (private mode); the change event still syncs this page.
  }
  window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_CHANGE_EVENT));
}

export function useSidebarCollapsed(): { collapsed: boolean; toggleCollapsed: () => void } {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const toggleCollapsed = useCallback(() => writeSidebarCollapsed(!readCollapsed()), []);
  return { collapsed, toggleCollapsed };
}
