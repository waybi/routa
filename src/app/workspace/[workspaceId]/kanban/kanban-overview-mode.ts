"use client";

/** "By project / By status" switch of the all-projects page; lives in the URL as `overviewMode=status`. */

import { useSyncExternalStore } from "react";

export type OverviewMode = "project" | "status";
export const OVERVIEW_MODE_QUERY_KEY = "overviewMode";
const MODE_CHANGE_EVENT = "routa:kanban-overview-mode-change";

/** Anything but `status` (missing or unknown value) is the by-project page. */
export function readOverviewMode(): OverviewMode {
  return new URLSearchParams(window.location.search).get(OVERVIEW_MODE_QUERY_KEY) === "status" ? "status" : "project";
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(MODE_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(MODE_CHANGE_EVENT, listener);
  };
}

/** Writes the mode and keeps every other query param (view, boardId, taskId, ...). */
export function writeOverviewMode(mode: OverviewMode): void {
  const url = new URL(window.location.href);
  if (mode === "status") url.searchParams.set(OVERVIEW_MODE_QUERY_KEY, "status");
  else url.searchParams.delete(OVERVIEW_MODE_QUERY_KEY);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(MODE_CHANGE_EVENT));
}

export function useOverviewMode() {
  const mode = useSyncExternalStore(subscribe, readOverviewMode, () => "project" as OverviewMode);
  return { mode, setMode: writeOverviewMode };
}
