"use client";

import type { ReactNode } from "react";

import type { TranslationDictionary } from "@/i18n";

/**
 * The seven global sidebar entries from design-spec §3, in display order.
 * Workspace switching lives in the top bar; settings sub-pages live in the
 * settings sub-navigation and never appear here.
 */
export type ShellNavId = "home" | "inbox" | "kanban" | "sessions" | "team" | "spec" | "settings";

export interface ShellNavItem {
  id: ShellNavId;
  label: string;
  href: string;
  icon: ReactNode;
}

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className: "h-4 w-4 shrink-0",
  "aria-hidden": true,
};

/** Unified line icons (24×24, stroke only) in the prototype style. */
export const SHELL_NAV_ICONS: Record<ShellNavId, ReactNode> = {
  home: (
    <svg {...svgProps}>
      <path d="M4 11.5 12 5l8 6.5M6 10v9h4.5v-5h3v5H18v-9" />
    </svg>
  ),
  inbox: (
    <svg {...svgProps}>
      <path d="M4 4h16v16H4zM4 13h5l2 3h2l2-3h5" />
    </svg>
  ),
  kanban: (
    <svg {...svgProps}>
      <rect x="4" y="4" width="4.5" height="16" rx="1" />
      <rect x="10" y="4" width="4.5" height="11" rx="1" />
      <rect x="16" y="4" width="4" height="7" rx="1" />
    </svg>
  ),
  sessions: (
    <svg {...svgProps}>
      <path d="M4 4h16v13H9l-5 4zM8 8h8M8 12h5" />
    </svg>
  ),
  team: (
    <svg {...svgProps}>
      <circle cx="9" cy="8.5" r="3" />
      <circle cx="17" cy="9.5" r="2.2" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M15 14.2c2.6-.3 4.8 1.2 5.5 4.3" />
    </svg>
  ),
  spec: (
    <svg {...svgProps}>
      <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5" />
    </svg>
  ),
  settings: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
    </svg>
  ),
};

export const SHELL_NAV_ORDER: readonly ShellNavId[] = [
  "home",
  "inbox",
  "kanban",
  "sessions",
  "team",
  "spec",
  "settings",
];

/** Builds the sidebar entries; workspace routes fall back to "default". */
export function buildShellNavItems(t: TranslationDictionary, workspaceId?: string | null): ShellNavItem[] {
  const ws = encodeURIComponent(workspaceId?.trim() || "default");
  const hrefs: Record<ShellNavId, string> = {
    home: "/",
    inbox: `/workspace/${ws}/overview`,
    kanban: `/workspace/${ws}/kanban`,
    sessions: `/workspace/${ws}/sessions`,
    team: `/workspace/${ws}/team`,
    spec: `/workspace/${ws}/spec`,
    settings: "/settings",
  };
  return SHELL_NAV_ORDER.map((id) => ({
    id,
    label: t.shell.nav[id],
    href: hrefs[id],
    icon: SHELL_NAV_ICONS[id],
  }));
}

/**
 * Which entry is current. Settings owns every /settings/* page plus
 * /mcp-tools (design-spec §3 files it under settings).
 */
export function isShellNavActive(item: ShellNavItem, pathname: string): boolean {
  if (item.id === "home") return pathname === "/";
  if (item.id === "settings") {
    return pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/mcp-tools";
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Collapsible sidebar groups below the seven global entries. */
export type ShellNavGroupId = "resources" | "developer";

/** localStorage keys that remember whether each group is expanded. */
export const SHELL_NAV_GROUP_STORAGE_KEYS: Record<ShellNavGroupId, string> = {
  resources: "routa.shell.nav.resources",
  developer: "routa.shell.nav.developer",
};

export interface ShellNavGroupItem {
  id: string;
  label: string;
  href: string;
  /** Whether this item owns the given pathname. */
  matches: (pathname: string) => boolean;
}

export interface ShellNavGroup {
  id: ShellNavGroupId;
  label: string;
  /** localStorage key that remembers whether the group is expanded. */
  storageKey: string;
  items: ShellNavGroupItem[];
  /** True when the pathname belongs to any page of the group, even one whose link is hidden. */
  ownsPath: (pathname: string) => boolean;
}

export interface ShellNavGroupIds {
  /** First codebase of the workspace; the repo slides item is hidden without it. */
  codebaseId?: string | null;
  /** A canvas artifact id; the canvas item is hidden without it. */
  canvasId?: string | null;
}

const REPOSLIDE_PATH = /^\/workspace\/[^/]+\/codebases\/([^/]+)\/reposlide(?:\/|$)/;
const CANVAS_PATH = /^\/canvas\/([^/]+)/;

function prefixMatcher(href: string) {
  return (pathname: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** Ids already present in the current URL, so the active item can link to itself without a fetch. */
export function readShellNavGroupIdsFromPath(pathname: string): ShellNavGroupIds {
  return {
    codebaseId: REPOSLIDE_PATH.exec(pathname)?.[1] ?? null,
    canvasId: CANVAS_PATH.exec(pathname)?.[1] ?? null,
  };
}

/** Builds the Resources and Developer groups; items without a usable id are left out. */
export function buildShellNavGroups(
  t: TranslationDictionary,
  workspaceId?: string | null,
  ids: ShellNavGroupIds = {},
): ShellNavGroup[] {
  const ws = encodeURIComponent(workspaceId?.trim() || "default");
  const labels = t.pagesRedesign.sidebar;
  const featureExplorerHref = `/workspace/${ws}/feature-explorer`;
  const matchesReposlide = (pathname: string) => REPOSLIDE_PATH.test(pathname);
  const matchesCanvas = (pathname: string) => CANVAS_PATH.test(pathname);

  const resourceItems: ShellNavGroupItem[] = [
    { id: "featureExplorer", label: labels.featureExplorer, href: featureExplorerHref, matches: prefixMatcher(featureExplorerHref) },
  ];
  if (ids.codebaseId) {
    resourceItems.push({
      id: "reposlide",
      label: labels.reposlide,
      href: `/workspace/${ws}/codebases/${encodeURIComponent(ids.codebaseId)}/reposlide`,
      matches: matchesReposlide,
    });
  }
  if (ids.canvasId) {
    resourceItems.push({
      id: "canvas",
      label: labels.canvas,
      href: `/canvas/${encodeURIComponent(ids.canvasId)}`,
      matches: matchesCanvas,
    });
  }

  const developerItems: ShellNavGroupItem[] = (
    [
      ["traces", labels.traces, "/traces"],
      ["messages", labels.messages, "/messages"],
      ["a2a", labels.a2a, "/a2a"],
      ["agUi", labels.agUi, "/ag-ui"],
      ["acpReplay", labels.acpReplay, "/debug/acp-replay"],
      ["officeLab", labels.officeLab, "/debug/office-wasm-poc"],
    ] as const
  ).map(([id, label, href]) => ({ id, label, href, matches: prefixMatcher(href) }));

  return [
    {
      id: "resources",
      label: labels.resources,
      storageKey: SHELL_NAV_GROUP_STORAGE_KEYS.resources,
      items: resourceItems,
      ownsPath: (pathname) =>
        prefixMatcher(featureExplorerHref)(pathname) || matchesReposlide(pathname) || matchesCanvas(pathname),
    },
    {
      id: "developer",
      label: labels.developer,
      storageKey: SHELL_NAV_GROUP_STORAGE_KEYS.developer,
      items: developerItems,
      ownsPath: (pathname) => developerItems.some((item) => item.matches(pathname)),
    },
  ];
}
