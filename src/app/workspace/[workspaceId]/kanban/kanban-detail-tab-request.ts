/**
 * One-shot "open the card on this detail tab" requests.
 *
 * Completion notifications should land on the completion report even when the
 * user last left that card on another tab. Two entry points feed this:
 * - the toast "Open card" button calls `requestKanbanDetailTab` before it
 *   navigates (same page, so an in-memory map is enough);
 * - the bell entry is a plain link, so it carries `?detailTab=completion`,
 *   read here when the card detail renders.
 *
 * Requests are keyed by task id (the detail's persisted tab key also encodes
 * split/full layout) and consumed once, so a later manual tab choice — or a
 * page refresh — is not forced back.
 */

export const KANBAN_DETAIL_TAB_QUERY_KEY = "detailTab";

const KANBAN_DETAIL_TASK_QUERY_KEY = "taskId";
const REQUESTABLE_TABS = new Set(["completion"]);

export type RequestableKanbanDetailTab = "completion";

const pendingKanbanDetailTabs = new Map<string, RequestableKanbanDetailTab>();

export function requestKanbanDetailTab(taskId: string, tab: RequestableKanbanDetailTab): void {
  pendingKanbanDetailTabs.set(taskId, tab);
}

function consumeDetailTabFromUrl(taskId: string): RequestableKanbanDetailTab | null {
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
  return REQUESTABLE_TABS.has(tab) ? (tab as RequestableKanbanDetailTab) : null;
}

/** Returns and clears the pending tab request for this card, if any. */
export function consumeKanbanDetailTabRequest(taskId: string): RequestableKanbanDetailTab | null {
  const fromUrl = consumeDetailTabFromUrl(taskId);
  const pending = pendingKanbanDetailTabs.get(taskId) ?? null;
  pendingKanbanDetailTabs.delete(taskId);
  return pending ?? fromUrl;
}

/** The four card-detail tabs of the redesign (design-spec §10). */
export type KanbanDetailTabId = "overview" | "construction" | "changes" | "completion";

export const KANBAN_DETAIL_TAB_IDS: readonly KanbanDetailTabId[] = ["overview", "construction", "changes", "completion"];

/**
 * Tab ids from the nine-tab detail, folded into the four new tabs. Written
 * as tuples so the old ids never appear as object keys elsewhere.
 */
const LEGACY_KANBAN_DETAIL_TABS = new Map<string, KanbanDetailTabId>([
  ["humanReadable", "overview"],
  ["readiness", "overview"],
  ["execution", "construction"],
  ["jitContext", "construction"],
  ["runs", "construction"],
  ["evidence", "changes"],
]);

/** Maps a stored tab id (new or legacy) to one of the four tabs; unknown → null. */
export function migrateLegacyKanbanDetailTab(id: string | null | undefined): KanbanDetailTabId | null {
  if (!id) return null;
  if ((KANBAN_DETAIL_TAB_IDS as readonly string[]).includes(id)) return id as KanbanDetailTabId;
  return LEGACY_KANBAN_DETAIL_TABS.get(id) ?? null;
}

/**
 * Which tab the detail opens on:
 * 1. a notification request (`?detailTab=completion` / requestKanbanDetailTab);
 * 2. the tab the user picked on this card before (legacy ids migrated);
 * 3. the completion report when the card has one;
 * 4. the overview.
 */
export function resolveKanbanDetailTab({
  requested,
  persisted,
  hasCompletionReport,
}: {
  requested?: RequestableKanbanDetailTab | null;
  persisted?: string | null;
  hasCompletionReport: boolean;
}): KanbanDetailTabId {
  if (requested) return requested;
  const remembered = migrateLegacyKanbanDetailTab(persisted);
  if (remembered) return remembered;
  return resolveDefaultKanbanDetailTab(hasCompletionReport);
}

/** Default tab when the user has not picked one for this card yet. */
export function resolveDefaultKanbanDetailTab(hasCompletionReport: boolean): "completion" | "overview" {
  return hasCompletionReport ? "completion" : "overview";
}
