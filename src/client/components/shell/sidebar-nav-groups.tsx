"use client";

/**
 * Collapsible Resources and Developer groups rendered under the sidebar's
 * Projects group. Collapsed groups render no links at all, so the global
 * entry list stays exactly the top-level links. Expanded state is remembered
 * in localStorage; the group that owns the current page opens automatically.
 *
 * Resources holds only id-dependent links (repo slides, canvas). Their ids
 * are fetched only after the group is first opened, and cached per workspace
 * for the lifetime of the page so remounts do not refetch. Once the lookup
 * shows the workspace has neither, the whole group is left out.
 */

import React, { useEffect, useState } from "react";
import Link from "next/link";

import type { TranslationDictionary } from "@/i18n";
import { resolveApiPath } from "@/client/config/backend";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import {
  buildShellNavGroups,
  readShellNavGroupIdsFromPath,
  SHELL_NAV_GROUP_STORAGE_KEYS,
  type ShellNavGroupId,
  type ShellNavGroupIds,
} from "./shell-nav-items";
import { SIDEBAR_FOLD_BUTTON_CLASS, SidebarChevron } from "./sidebar-chevron";
import { useStoredOpen, writeStored } from "./use-stored-open";

const resourceIdCache = new Map<string, Promise<ShellNavGroupIds>>();

/** Test hook: forget cached codebase / canvas ids. */
export function resetSidebarNavGroupCache(): void {
  resourceIdCache.clear();
}

async function fetchFirstId(path: string, listKey: string): Promise<string | null> {
  try {
    const response = await desktopAwareFetch(resolveApiPath(path));
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown> | null;
    const list = body?.[listKey];
    if (!Array.isArray(list) || list.length === 0) return null;
    const id = (list[0] as { id?: unknown } | null)?.id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function loadResourceIds(workspaceId: string): Promise<ShellNavGroupIds> {
  let pending = resourceIdCache.get(workspaceId);
  if (!pending) {
    const ws = encodeURIComponent(workspaceId);
    pending = Promise.all([
      fetchFirstId(`/workspaces/${ws}/codebases`, "codebases"),
      fetchFirstId(`/canvas?workspaceId=${ws}`, "canvasArtifacts"),
    ]).then(([codebaseId, canvasId]) => ({ codebaseId, canvasId }));
    resourceIdCache.set(workspaceId, pending);
  }
  return pending;
}

interface SidebarNavGroupsProps {
  t: TranslationDictionary;
  workspaceId?: string | null;
  pathname: string;
  onNavigate?: () => void;
}

export function SidebarNavGroups({ t, workspaceId, pathname, onNavigate }: SidebarNavGroupsProps) {
  const ws = workspaceId?.trim() || "default";
  const [fetchedIds, setFetchedIds] = useState<{ ws: string; ids: ShellNavGroupIds } | null>(null);
  // Groups the user closed while standing on one of their pages; reset on navigation.
  const [dismissed, setDismissed] = useState<{ pathname: string; ids: ShellNavGroupId[] }>({ pathname, ids: [] });
  const storedOpen: Record<ShellNavGroupId, boolean> = {
    resources: useStoredOpen(SHELL_NAV_GROUP_STORAGE_KEYS.resources),
    developer: useStoredOpen(SHELL_NAV_GROUP_STORAGE_KEYS.developer),
  };

  const pathIds = readShellNavGroupIdsFromPath(pathname);
  const loadedIds = fetchedIds?.ws === ws ? fetchedIds.ids : {};
  const groups = buildShellNavGroups(t, ws, {
    codebaseId: pathIds.codebaseId ?? loadedIds.codebaseId,
    canvasId: pathIds.canvasId ?? loadedIds.canvasId,
  });

  const dismissedHere = dismissed.pathname === pathname ? dismissed.ids : [];
  const isOpen = (id: ShellNavGroupId, ownsPath: boolean) =>
    storedOpen[id] || (ownsPath && !dismissedHere.includes(id));
  const resourcesGroup = groups.find((group) => group.id === "resources");
  const resourcesOpen = resourcesGroup ? isOpen("resources", resourcesGroup.ownsPath(pathname)) : false;

  useEffect(() => {
    if (!resourcesOpen) return;
    let cancelled = false;
    void loadResourceIds(ws).then((ids) => {
      if (!cancelled) setFetchedIds({ ws, ids });
    });
    return () => {
      cancelled = true;
    };
  }, [resourcesOpen, ws]);

  const toggle = (id: ShellNavGroupId, currentlyOpen: boolean) => {
    writeStored(SHELL_NAV_GROUP_STORAGE_KEYS[id], !currentlyOpen);
    setDismissed({
      pathname,
      ids: currentlyOpen ? [...dismissedHere.filter((other) => other !== id), id] : dismissedHere.filter((other) => other !== id),
    });
  };

  // Resources with nothing to show (lookup finished, no ids) is left out entirely.
  const resourcesKnownEmpty = fetchedIds?.ws === ws && !pathIds.codebaseId && !pathIds.canvasId
    && !loadedIds.codebaseId && !loadedIds.canvasId;
  const visibleGroups = groups.filter((group) => group.id !== "resources" || !resourcesKnownEmpty);

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-default pt-3">
      {visibleGroups.map((group) => {
        const open = isOpen(group.id, group.ownsPath(pathname));
        const listId = `routa-shell-nav-group-${group.id}`;
        return (
          <div key={group.id} data-nav-group={group.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              onClick={() => toggle(group.id, open)}
              className={SIDEBAR_FOLD_BUTTON_CLASS}
            >
              <SidebarChevron expanded={open} />
              <span className="truncate">{group.label}</span>
            </button>
            {open ? (
              <div id={listId} className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = item.matches(pathname);
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      data-nav-id={item.id}
                      aria-current={active ? "page" : undefined}
                      onClick={onNavigate}
                      className={`flex min-h-[30px] items-center rounded-md py-1 pl-8 pr-2.5 text-xs transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent ${
                        active ? "bg-accent-subtle text-primary" : "text-secondary hover:bg-hover hover:text-primary"
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
