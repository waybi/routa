import type { TranslationDictionary } from "@/i18n";

/**
 * Every app route from design-spec §3 (29 entries), one per
 * src/app/**\/page.tsx. A test keeps this table and the page files in
 * one-to-one correspondence, so adding a page without registering it here
 * fails the build.
 *
 * `pattern` is the Next.js route as on disk. `target` is where the palette
 * navigates: workspace routes are filled with the current workspace; routes
 * that need a sub-ID (session, team run, codebase, canvas) land on the
 * closest page where that ID can be picked, flagged with `opensList`.
 */
export type CommandRouteGroup = "workspace" | "settings" | "resources" | "developer";

type RouteKey = keyof TranslationDictionary["shell"]["commandPalette"]["routes"];

export interface CommandRouteDefinition {
  key: RouteKey;
  pattern: string;
  group: CommandRouteGroup;
  /** Target template; `{ws}` is replaced by the current workspace id. */
  target: string;
  /** True when `target` is a list page standing in for a route with a sub-ID. */
  opensList?: boolean;
  /** Extra search words (route segments, synonyms). */
  keywords?: string;
}

export const COMMAND_ROUTES: readonly CommandRouteDefinition[] = [
  { key: "home", pattern: "/", group: "workspace", target: "/", keywords: "home" },
  { key: "workspaceEntry", pattern: "/workspace/[workspaceId]", group: "workspace", target: "/workspace/{ws}", keywords: "workspace" },
  { key: "inbox", pattern: "/workspace/[workspaceId]/overview", group: "workspace", target: "/workspace/{ws}/overview", keywords: "overview inbox" },
  { key: "kanban", pattern: "/workspace/[workspaceId]/kanban", group: "workspace", target: "/workspace/{ws}/kanban", keywords: "kanban board" },
  { key: "sessions", pattern: "/workspace/[workspaceId]/sessions", group: "workspace", target: "/workspace/{ws}/sessions", keywords: "sessions" },
  { key: "sessionDetail", pattern: "/workspace/[workspaceId]/sessions/[sessionId]", group: "workspace", target: "/workspace/{ws}/sessions", opensList: true, keywords: "session detail" },
  { key: "team", pattern: "/workspace/[workspaceId]/team", group: "workspace", target: "/workspace/{ws}/team", keywords: "team" },
  { key: "teamRun", pattern: "/workspace/[workspaceId]/team/[sessionId]", group: "workspace", target: "/workspace/{ws}/team", opensList: true, keywords: "team run session" },
  { key: "spec", pattern: "/workspace/[workspaceId]/spec", group: "workspace", target: "/workspace/{ws}/spec", keywords: "spec issues" },
  { key: "featureExplorer", pattern: "/workspace/[workspaceId]/feature-explorer", group: "resources", target: "/workspace/{ws}/feature-explorer", keywords: "feature explorer" },
  { key: "reposlide", pattern: "/workspace/[workspaceId]/codebases/[codebaseId]/reposlide", group: "resources", target: "/workspace/{ws}/kanban", opensList: true, keywords: "reposlide codebase slides" },
  { key: "settings", pattern: "/settings", group: "settings", target: "/settings", keywords: "settings providers" },
  { key: "agents", pattern: "/settings/agents", group: "settings", target: "/settings/agents", keywords: "agents acp" },
  { key: "specialists", pattern: "/settings/specialists", group: "settings", target: "/settings/specialists", keywords: "specialists" },
  { key: "workflows", pattern: "/settings/workflows", group: "settings", target: "/settings/workflows", keywords: "workflows" },
  { key: "mcp", pattern: "/settings/mcp", group: "settings", target: "/settings/mcp", keywords: "mcp servers" },
  { key: "schedules", pattern: "/settings/schedules", group: "settings", target: "/settings/schedules", keywords: "schedules cron" },
  { key: "webhooks", pattern: "/settings/webhooks", group: "settings", target: "/settings/webhooks", keywords: "webhooks github" },
  { key: "harness", pattern: "/settings/harness", group: "settings", target: "/settings/harness", keywords: "harness" },
  { key: "fitness", pattern: "/settings/fitness", group: "settings", target: "/settings/fitness", keywords: "fitness" },
  { key: "fluency", pattern: "/settings/fluency", group: "settings", target: "/settings/fluency", keywords: "fluency" },
  { key: "traces", pattern: "/traces", group: "developer", target: "/traces", keywords: "traces" },
  { key: "messages", pattern: "/messages", group: "developer", target: "/messages", keywords: "messages" },
  { key: "a2a", pattern: "/a2a", group: "developer", target: "/a2a", keywords: "a2a" },
  { key: "agUi", pattern: "/ag-ui", group: "developer", target: "/ag-ui", keywords: "ag-ui agui" },
  { key: "mcpTools", pattern: "/mcp-tools", group: "settings", target: "/mcp-tools", keywords: "mcp tools" },
  { key: "canvas", pattern: "/canvas/[id]", group: "resources", target: "/workspace/{ws}/sessions", opensList: true, keywords: "canvas" },
  { key: "acpReplay", pattern: "/debug/acp-replay", group: "developer", target: "/debug/acp-replay", keywords: "acp replay debug" },
  { key: "officeLab", pattern: "/debug/office-wasm-poc", group: "developer", target: "/debug/office-wasm-poc", keywords: "office wasm document debug" },
];

export interface CommandRouteEntry {
  key: RouteKey;
  label: string;
  group: CommandRouteGroup;
  groupLabel: string;
  href: string;
  opensList: boolean;
  hint: string | null;
  searchText: string;
}

export function buildCommandRouteEntries(t: TranslationDictionary, workspaceId?: string | null): CommandRouteEntry[] {
  const ws = encodeURIComponent(workspaceId?.trim() || "default");
  const copy = t.shell.commandPalette;
  return COMMAND_ROUTES.map((route) => {
    const label = copy.routes[route.key];
    const groupLabel = copy.groups[route.group];
    const href = route.target.replace("{ws}", ws);
    const opensList = route.opensList === true;
    return {
      key: route.key,
      label,
      group: route.group,
      groupLabel,
      href,
      opensList,
      hint: opensList ? copy.opensList : null,
      searchText: `${label} ${groupLabel} ${route.pattern} ${route.keywords ?? ""}`.toLowerCase(),
    };
  });
}

export function filterCommandRouteEntries(entries: CommandRouteEntry[], query: string): CommandRouteEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries.filter((entry) => words.every((word) => entry.searchText.includes(word)));
}
