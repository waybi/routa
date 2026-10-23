"use client";

/**
 * Sidebar "Projects" group: every active workspace, one row each, current one
 * first and highlighted. A row links to the same kind of page in that
 * workspace (see workspace-switch-href.ts) and remembers it as the last
 * workspace, exactly like the top-bar switcher does. The list scrolls on its
 * own so the entries above it never leave the viewport.
 *
 * Also exports the "Workspaces / All projects" row shown under the logo.
 */

import React, { useId, useReducer, useSyncExternalStore } from "react";
import Link from "next/link";

import type { TranslationDictionary } from "@/i18n";
import { DESKTOP_LAST_WORKSPACE_ID_STORAGE_KEY } from "../workspace-switcher";
import { useSidebarWorkspaces, type SidebarWorkspace } from "./use-sidebar-workspaces";
import { buildWorkspaceSwitchHref } from "./workspace-switch-href";

/** Same event the board's "This board / All projects" toggle listens to (kanban-overview.tsx). */
const KANBAN_VIEW_CHANGE_EVENT = "routa:kanban-view-change";
const INBOX_SCOPE_CHANGE_EVENT = "routa:inbox-scope-change";
const SEARCH_EVENTS = ["popstate", KANBAN_VIEW_CHANGE_EVENT, INBOX_SCOPE_CHANGE_EVENT] as const;

function subscribeSearch(listener: () => void): () => void {
  SEARCH_EVENTS.forEach((name) => window.addEventListener(name, listener));
  return () => SEARCH_EVENTS.forEach((name) => window.removeEventListener(name, listener));
}

/** Current query string; empty during server render. Re-read on every render. */
function useLocationSearch(): string {
  return useSyncExternalStore(subscribeSearch, () => window.location.search, () => "");
}

function rememberWorkspace(id: string): void {
  try {
    window.localStorage.setItem(DESKTOP_LAST_WORKSPACE_ID_STORAGE_KEY, id);
  } catch {
    // Storage can be unavailable (private mode); the switch itself still works.
  }
}

function initialOf(title: string): string {
  const first = Array.from(title.trim())[0] ?? "?";
  return first.toUpperCase();
}

const rowBase =
  "flex min-h-[30px] items-center rounded-md text-xs transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent";

interface SidebarProjectsProps {
  t: TranslationDictionary;
  workspaceId?: string | null;
  pathname: string;
  /** Icon-rail mode: one square per workspace showing its first character. */
  compact?: boolean;
  onNavigate?: () => void;
}

export function SidebarProjects({ t, workspaceId, pathname, compact = false, onNavigate }: SidebarProjectsProps) {
  const currentId = workspaceId?.trim() || null;
  const { workspaces } = useSidebarWorkspaces(currentId);
  const search = useLocationSearch();
  // Query-only soft navigations fire no event; hovering or focusing re-reads the URL.
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const headingId = useId();

  const renderRow = (workspace: SidebarWorkspace) => {
    const target = buildWorkspaceSwitchHref(pathname, search, workspace.id);
    const current = workspace.id === currentId;
    const className = `${rowBase} ${compact ? "h-8 w-full justify-center font-semibold" : "gap-2 px-2.5 py-1"} ${
      current ? "bg-accent-subtle font-semibold text-primary" : "text-secondary hover:bg-hover hover:text-primary"
    }`;
    const props = {
      href: target.href,
      title: workspace.title,
      "aria-label": compact ? workspace.title : undefined,
      "aria-current": current ? ("true" as const) : undefined,
      "data-workspace-id": workspace.id,
      className,
      onClick: () => {
        rememberWorkspace(workspace.id);
        onNavigate?.();
      },
    };
    const content = compact ? <span aria-hidden="true">{initialOf(workspace.title)}</span> : <span className="truncate">{workspace.title}</span>;
    return (
      <li key={workspace.id}>
        {target.fullReload ? (
          <a {...props} data-full-reload="true">
            {content}
          </a>
        ) : (
          <Link {...props}>{content}</Link>
        )}
      </li>
    );
  };

  return (
    <section
      data-testid="shell-sidebar-projects"
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col gap-1 border-t border-default pt-3"
      onPointerEnter={refresh}
      onFocus={refresh}
    >
      {/* In the icon rail the section's top border is the divider; the heading stays for screen readers. */}
      <h2 id={headingId} className={compact ? "sr-only" : "px-2.5 text-[11px] font-semibold text-secondary"}>
        {t.shell.projects.title}
      </h2>
      <ul
        aria-label={t.shell.projects.regionLabel}
        data-testid="shell-sidebar-projects-list"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
      >
        {workspaces.length === 0 ? (
          <li className={`px-2.5 py-1 text-xs text-secondary ${compact ? "text-center" : ""}`} title={t.workspace.noWorkspacesYet}>
            {compact ? "–" : t.workspace.noWorkspacesYet}
          </li>
        ) : (
          workspaces.map(renderRow)
        )}
      </ul>
    </section>
  );
}

const allProjectsIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-4 w-4 shrink-0"
  >
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);

interface SidebarAllProjectsRowProps {
  t: TranslationDictionary;
  workspaceId?: string | null;
  compact?: boolean;
  onNavigate?: () => void;
}

/** "Workspaces / All projects": opens the board's all-projects overview. */
export function SidebarAllProjectsRow({ t, workspaceId, compact = false, onNavigate }: SidebarAllProjectsRowProps) {
  const boardPath = `/workspace/${encodeURIComponent(workspaceId?.trim() || "default")}/kanban`;
  const label = t.shell.projects.allProjects;

  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onNavigate?.();
    if (window.location.pathname !== boardPath) return;
    // Already on this board: a soft navigation would not notify the board's view toggle.
    event.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.set("view", "all");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    window.dispatchEvent(new Event(KANBAN_VIEW_CHANGE_EVENT));
  };

  if (compact) {
    return (
      <Link
        href={`${boardPath}?view=all`}
        title={label}
        aria-label={label}
        data-testid="shell-sidebar-all-projects"
        onClick={onClick}
        className={`${rowBase} h-8 w-full shrink-0 justify-center text-secondary hover:bg-hover hover:text-primary`}
      >
        {allProjectsIcon}
      </Link>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1 px-2.5 text-[11px] text-secondary">
      <span className="truncate">{t.workspace.workspaces}</span>
      <span aria-hidden="true">/</span>
      <Link
        href={`${boardPath}?view=all`}
        title={label}
        data-testid="shell-sidebar-all-projects"
        onClick={onClick}
        className="truncate rounded-sm text-secondary hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {label}
      </Link>
    </div>
  );
}
