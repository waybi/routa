/**
 * One-shot "open the card on this detail tab" requests.
 *
 * Completion notifications should land on the completion report even when the
 * user last left that card on another tab. Two entry points feed this:
 * - the toast "Open card" button calls `requestKanbanDetailTab` before it
 *   navigates (same page, so an in-memory map is enough);
 * - links carry `?detailTab=<id>&taskId=<card>` (bell entry: completion,
 *   session detail evidence link: changes), read here when the card detail
 *   renders.
 *
 * Requests are keyed by task id and consumed once, so a later manual tab
 * choice — or a page refresh — is not forced back.
 */

export const KANBAN_DETAIL_TAB_QUERY_KEY = "detailTab";

const KANBAN_DETAIL_TASK_QUERY_KEY = "taskId";

/**
 * The eight card-detail tabs, in the order of the detail before the
 * redesign (the plain-language tab stays removed).
 */
export type KanbanDetailTabId =
  | "overview"
  | "readiness"
  | "execution"
  | "jitContext"
  | "changes"
  | "evidence"
  | "runs"
  | "completion";

export const KANBAN_DETAIL_TAB_IDS: readonly KanbanDetailTabId[] = ["overview", "readiness", "execution", "jitContext", "changes", "evidence", "runs", "completion"];

/**
 * Ids from other detail layouts, mapped onto the eight tabs: the four-tab
 * redesign (construction) and the removed plain-language tab. Written as
 * tuples so these ids never appear as object keys elsewhere.
 */
const OTHER_KANBAN_DETAIL_TAB_IDS = new Map<string, KanbanDetailTabId>([
  ["construction", "execution"],
  ["humanReadable", "overview"],
]);

/** Maps a tab id (current, redesign or removed) to one of the eight tabs; unknown → null. */
export function migrateLegacyKanbanDetailTab(id: string | null | undefined): KanbanDetailTabId | null {
  if (!id) return null;
  if ((KANBAN_DETAIL_TAB_IDS as readonly string[]).includes(id)) return id as KanbanDetailTabId;
  return OTHER_KANBAN_DETAIL_TAB_IDS.get(id) ?? null;
}

const pendingKanbanDetailTabs = new Map<string, KanbanDetailTabId>();

export function requestKanbanDetailTab(taskId: string, tab: KanbanDetailTabId): void {
  pendingKanbanDetailTabs.set(taskId, tab);
}

function consumeDetailTabFromUrl(taskId: string): KanbanDetailTabId | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const tab = url.searchParams.get(KANBAN_DETAIL_TAB_QUERY_KEY);
  if (!tab || url.searchParams.get(KANBAN_DETAIL_TASK_QUERY_KEY) !== taskId) return null;
  // Read now (the first render must already show the tab), but rewrite the
  // URL outside render: Next's router hooks history.replaceState.
  queueMicrotask(() => {
    const current = new URL(window.location.href);
    if (!current.searchParams.has(KANBAN_DETAIL_TAB_QUERY_KEY)) return;
    current.searchParams.delete(KANBAN_DETAIL_TAB_QUERY_KEY);
    window.history.replaceState(window.history.state, "", `${current.pathname}${current.search}${current.hash}`);
  });
  return migrateLegacyKanbanDetailTab(tab);
}

/** Returns and clears the pending tab request for this card, if any. */
export function consumeKanbanDetailTabRequest(taskId: string): KanbanDetailTabId | null {
  const fromUrl = consumeDetailTabFromUrl(taskId);
  const pending = pendingKanbanDetailTabs.get(taskId) ?? null;
  pendingKanbanDetailTabs.delete(taskId);
  return pending ?? fromUrl;
}

/**
 * Which tab the detail opens on:
 * 1. a notification request (`?detailTab=<id>` / requestKanbanDetailTab);
 * 2. the tab the user picked on this card before (other layouts' ids mapped);
 * 3. the completion report when the card has one;
 * 4. the overview.
 */
export function resolveKanbanDetailTab({
  requested,
  persisted,
  hasCompletionReport,
}: {
  requested?: string | null;
  persisted?: string | null;
  hasCompletionReport: boolean;
}): KanbanDetailTabId {
  const forced = migrateLegacyKanbanDetailTab(requested);
  if (forced) return forced;
  const remembered = migrateLegacyKanbanDetailTab(persisted);
  if (remembered) return remembered;
  return resolveDefaultKanbanDetailTab(hasCompletionReport);
}

/** Default tab when the user has not picked one for this card yet. */
export function resolveDefaultKanbanDetailTab(hasCompletionReport: boolean): "completion" | "overview" {
  return hasCompletionReport ? "completion" : "overview";
}
