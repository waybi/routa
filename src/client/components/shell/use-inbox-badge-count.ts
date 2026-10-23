"use client";

/**
 * Count for the "Needs you" nav badge: buildInboxRows(...).active.length over
 * the workspaces in scope, recomputed every minute and whenever a hide /
 * restore happens in this tab or another one. Returns `null` when the badge
 * must not show (not hydrated, still loading, or nothing to do).
 */

import { useMemo } from "react";
import { usePathname } from "next/navigation";

import { useMinuteClock } from "@/client/components/home/relative-time";
import {
  readAttentionDismissals,
  useAttentionDismissalsVersion,
} from "@/app/workspace/[workspaceId]/kanban/use-kanban-attention-dismissals";
import { useKanbanOverviewData } from "@/app/workspace/[workspaceId]/kanban/use-kanban-overview-data";
import { useInboxScope } from "@/app/workspace/[workspaceId]/overview/inbox-view-mode";
import {
  badgeWorkspaceId,
  computeInboxBadgeCount,
  resolveBadgeScope,
  type InboxBadgeSource,
} from "./inbox-badge-rules";

export function useInboxBadgeCount(source: InboxBadgeSource, workspaceId?: string | null): number | null {
  const pathname = usePathname() ?? "/";
  const { scope: urlScope } = useInboxScope();
  const now = useMinuteClock();
  // Not read directly: subscribing re-renders after every hide / restore.
  const dismissVersion = useAttentionDismissalsVersion();
  const scope = resolveBadgeScope(pathname, urlScope);
  const id = badgeWorkspaceId(workspaceId);
  return useMemo(
    () => computeInboxBadgeCount(source, scope, id, now, readAttentionDismissals),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dismissVersion invalidates localStorage reads.
    [source, scope, id, now, dismissVersion],
  );
}

/**
 * Fallback when no page provides data: loads only the current workspace
 * (one GET /api/tasks, one GET /api/kanban/boards, plus the shared SSE).
 * Mounted only without a provider, so pages with data never fetch twice.
 */
export function useSelfInboxBadgeSource(workspaceId?: string | null): InboxBadgeSource {
  const id = badgeWorkspaceId(workspaceId);
  const workspaces = useMemo(() => [{ id, title: id }], [id]);
  const { data } = useKanbanOverviewData(workspaces);
  return useMemo(() => ({ workspaces, workspacesLoading: false, data }), [workspaces, data]);
}
