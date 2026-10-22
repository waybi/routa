"use client";

/**
 * "This workspace / All workspaces" scope of the Needs-you page, kept in the
 * URL as `view=all`. Switching rewrites the URL in place (history API), so
 * changing scope never fetches anything.
 */

import { useSyncExternalStore } from "react";

export type InboxScope = "workspace" | "all";
export const INBOX_VIEW_QUERY_KEY = "view";
const SCOPE_CHANGE_EVENT = "routa:inbox-scope-change";

function readScope(): InboxScope {
  return new URLSearchParams(window.location.search).get(INBOX_VIEW_QUERY_KEY) === "all" ? "all" : "workspace";
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  window.addEventListener(SCOPE_CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(SCOPE_CHANGE_EVENT, listener);
  };
}

export function writeInboxScope(scope: InboxScope): void {
  const url = new URL(window.location.href);
  if (scope === "all") url.searchParams.set(INBOX_VIEW_QUERY_KEY, "all");
  else url.searchParams.delete(INBOX_VIEW_QUERY_KEY);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  window.dispatchEvent(new Event(SCOPE_CHANGE_EVENT));
}

export function useInboxScope() {
  const scope = useSyncExternalStore(subscribe, readScope, () => "workspace" as InboxScope);
  return { scope, setScope: writeInboxScope };
}
