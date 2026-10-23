"use client";

/**
 * Optional data for the "Needs you" nav badge. Pages that already load the
 * workspaces' tasks and boards (Needs-you page, home, board) provide them
 * here so the badge does not fetch the same data a second time.
 */

import React, { createContext, useContext, useMemo } from "react";

import type { InboxBadgeSource } from "./inbox-badge-rules";

const InboxBadgeDataContext = createContext<InboxBadgeSource | null>(null);

export function InboxBadgeDataProvider({
  workspaces,
  workspacesLoading,
  data,
  children,
}: InboxBadgeSource & { children: React.ReactNode }) {
  const value = useMemo(() => ({ workspaces, workspacesLoading, data }), [workspaces, workspacesLoading, data]);
  return <InboxBadgeDataContext.Provider value={value}>{children}</InboxBadgeDataContext.Provider>;
}

/** `null` when no page provides data; the badge then loads the current workspace itself. */
export function useInboxBadgeData(): InboxBadgeSource | null {
  return useContext(InboxBadgeDataContext);
}
