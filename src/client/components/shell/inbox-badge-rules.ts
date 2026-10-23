/**
 * Pure rules for the count badge on the sidebar "Needs you" entry.
 *
 * The number must equal what the Needs-you page shows after a click on that
 * entry, so the row set comes from the page's own buildInboxRows; this module
 * only decides which workspaces are in scope, when the number is not ready,
 * and how it is printed.
 */

import { buildInboxRows } from "@/app/workspace/[workspaceId]/overview/inbox-rules";
import type { InboxScope } from "@/app/workspace/[workspaceId]/overview/inbox-view-mode";
import type { OverviewWorkspace } from "@/app/workspace/[workspaceId]/kanban/kanban-overview-rules";
import type { OverviewWorkspaceData } from "@/app/workspace/[workspaceId]/kanban/use-kanban-overview-data";

export const INBOX_BADGE_MAX = 99;

export interface InboxBadgeSource {
  workspaces: readonly OverviewWorkspace[];
  workspacesLoading: boolean;
  data: Readonly<Record<string, OverviewWorkspaceData | undefined>>;
}

/** Same fallback as buildShellNavItems, so the count matches the link target. */
export function badgeWorkspaceId(workspaceId?: string | null): string {
  return workspaceId?.trim() || "default";
}

/**
 * `view=all` means "all workspaces" only on the Needs-you page. The board's
 * all-projects view uses the same query key, but the nav link points at
 * `/workspace/<ws>/overview` without it, so every other page counts the
 * current workspace only.
 */
export function resolveBadgeScope(pathname: string, urlScope: InboxScope): InboxScope {
  return /\/overview\/?$/.test(pathname) ? urlScope : "workspace";
}

/** Unhidden Needs-you rows in scope; `null` while not ready or when there are none. */
export function computeInboxBadgeCount(
  source: InboxBadgeSource,
  scope: InboxScope,
  workspaceId: string,
  now: number,
  dismissedByBoard: (boardId: string) => readonly string[],
): number | null {
  if (now === 0 || source.workspacesLoading) return null;
  const scoped = scope === "all"
    ? source.workspaces
    : source.workspaces.filter((workspace) => workspace.id === workspaceId);
  if (scoped.some((workspace) => !source.data[workspace.id] || source.data[workspace.id]?.status === "loading")) {
    return null;
  }
  const count = buildInboxRows(scoped, source.data, now, dismissedByBoard).active.length;
  return count > 0 ? count : null;
}

export function formatInboxBadgeCount(count: number): string {
  return count > INBOX_BADGE_MAX ? `${INBOX_BADGE_MAX}+` : String(count);
}
