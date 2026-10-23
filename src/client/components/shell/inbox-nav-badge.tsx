"use client";

/**
 * Red count badge on the "Needs you" nav entry, styled like the top-bar bell
 * badge. `row` sits at the right end of a sidebar row; `rail` sits on the
 * top-right corner of an icon (the parent link must be `relative`).
 */

import React from "react";

import { useTranslation } from "@/i18n";
import { formatInboxBadgeCount, type InboxBadgeSource } from "./inbox-badge-rules";
import { useInboxBadgeData } from "./inbox-badge-data-context";
import { useInboxBadgeCount, useSelfInboxBadgeSource } from "./use-inbox-badge-count";

export type InboxNavBadgeVariant = "row" | "rail";

const VARIANT_CLASS: Record<InboxNavBadgeVariant, string> = {
  row: "ml-auto shrink-0",
  rail: "absolute -right-0.5 -top-0.5",
};

export function InboxNavBadgeView({ count, variant }: { count: number; variant: InboxNavBadgeVariant }) {
  const { t } = useTranslation();
  return (
    <span
      data-testid="inbox-nav-badge"
      aria-label={t.shell.nav.inboxBadge.replace("{count}", String(count))}
      className={`${VARIANT_CLASS[variant]} flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-on-accent`}
    >
      {formatInboxBadgeCount(count)}
    </span>
  );
}

function BadgeFromSource({ source, workspaceId, variant }: { source: InboxBadgeSource; workspaceId?: string | null; variant: InboxNavBadgeVariant }) {
  const count = useInboxBadgeCount(source, workspaceId);
  return count === null ? null : <InboxNavBadgeView count={count} variant={variant} />;
}

function SelfLoadingBadge({ workspaceId, variant }: { workspaceId?: string | null; variant: InboxNavBadgeVariant }) {
  const source = useSelfInboxBadgeSource(workspaceId);
  return <BadgeFromSource source={source} workspaceId={workspaceId} variant={variant} />;
}

/** The self-loading fallback needs the SSE stream; skip it where EventSource is missing. */
function canSelfLoad(): boolean {
  return typeof window !== "undefined" && typeof window.EventSource === "function";
}

export function InboxNavBadge({ workspaceId, variant }: { workspaceId?: string | null; variant: InboxNavBadgeVariant }) {
  const provided = useInboxBadgeData();
  if (provided) return <BadgeFromSource source={provided} workspaceId={workspaceId} variant={variant} />;
  return canSelfLoad() ? <SelfLoadingBadge workspaceId={workspaceId} variant={variant} /> : null;
}
