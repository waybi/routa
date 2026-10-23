"use client";

/**
 * Workspace list for the sidebar "Projects" group.
 *
 * Reads GET /api/workspaces?status=active once per page lifetime (module
 * cache) and shares the result between every sidebar instance. Any failure
 * (network error, non-2xx, body that is not JSON or has no `workspaces`
 * array) turns into an empty list, so the sidebar never throws and never
 * leaves an unhandled rejection behind. When the current workspace id is
 * missing from the cached list (e.g. it was just created from the top-bar
 * switcher) the list is read again, at most once per unknown id.
 */

import { useEffect, useState } from "react";

import { resolveApiPath } from "@/client/config/backend";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

export interface SidebarWorkspace {
  id: string;
  title: string;
  createdAt?: string;
}

const DEFAULT_WORKSPACE_ID = "default";

let cachedList: Promise<SidebarWorkspace[]> | null = null;
const refetchedFor = new Set<string>();

/** Test hook: forget the cached workspace list. */
export function resetSidebarWorkspacesCache(): void {
  cachedList = null;
  refetchedFor.clear();
}

function toSidebarWorkspace(value: unknown): SidebarWorkspace | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  const title = typeof record.title === "string" && record.title.trim() ? record.title : record.id;
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : undefined;
  return { id: record.id, title, createdAt };
}

async function fetchSidebarWorkspaces(): Promise<SidebarWorkspace[]> {
  try {
    const response = await desktopAwareFetch(resolveApiPath("/workspaces?status=active"));
    if (!response.ok) return [];
    const body = (await response.json()) as { workspaces?: unknown } | null;
    const list = body?.workspaces;
    if (!Array.isArray(list)) return [];
    return list.map(toSidebarWorkspace).filter((item): item is SidebarWorkspace => item !== null);
  } catch {
    return [];
  }
}

/** Cached list; reads again once when `currentId` is not in it. Never rejects. */
export function loadSidebarWorkspaces(currentId?: string | null): Promise<SidebarWorkspace[]> {
  if (!cachedList) cachedList = fetchSidebarWorkspaces();
  const id = currentId?.trim();
  if (!id) return cachedList;
  return cachedList.then((list) => {
    if (list.some((workspace) => workspace.id === id) || refetchedFor.has(id)) return list;
    refetchedFor.add(id);
    cachedList = fetchSidebarWorkspaces();
    return cachedList;
  });
}

function createdAtValue(workspace: SidebarWorkspace): number {
  const value = workspace.createdAt ? Date.parse(workspace.createdAt) : Number.NaN;
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

/**
 * Display order: the current workspace first, then the rest by createdAt
 * ascending (missing dates last, ties by id), and "default" last unless it is
 * the current one.
 */
export function sortSidebarWorkspaces(list: readonly SidebarWorkspace[], currentId?: string | null): SidebarWorkspace[] {
  const current = currentId?.trim() || null;
  const rank = (workspace: SidebarWorkspace) => {
    if (workspace.id === current) return 0;
    if (workspace.id === DEFAULT_WORKSPACE_ID) return 2;
    return 1;
  };
  return [...list].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const aTime = createdAtValue(a);
    const bTime = createdAtValue(b);
    if (aTime !== bTime) return aTime < bTime ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  });
}

/** Sorted workspaces for the sidebar; empty until (and unless) the read succeeds. */
export function useSidebarWorkspaces(currentId?: string | null): { workspaces: SidebarWorkspace[]; loaded: boolean } {
  const [state, setState] = useState<{ list: SidebarWorkspace[]; loaded: boolean }>({ list: [], loaded: false });

  useEffect(() => {
    let cancelled = false;
    void loadSidebarWorkspaces(currentId).then((list) => {
      if (!cancelled) setState({ list, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  return { workspaces: sortSidebarWorkspaces(state.list, currentId), loaded: state.loaded };
}
