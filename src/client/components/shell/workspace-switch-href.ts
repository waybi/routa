/**
 * Where a sidebar project link goes: the same kind of page in the other
 * workspace. Pages that read the workspace from the path get the new path;
 * pages that read `?workspaceId=` keep their own view params; pages that keep
 * the workspace only in component state (schedules, messages, AG-UI) and
 * pages without a workspace land on the new workspace entry (its board).
 *
 * Harness and Fluency keep a locally picked workspace in state that outranks
 * the URL after a soft navigation, so those two need a full page load.
 */

export interface WorkspaceSwitchTarget {
  href: string;
  /** True when the link must be a plain anchor (full page load). */
  fullReload: boolean;
}

const SAME_KIND_WORKSPACE_PAGES = new Set(["overview", "kanban", "sessions", "team", "spec", "feature-explorer"]);
/** Workspace pages whose `view=all` survives a switch. */
const VIEW_ALL_PAGES = new Set(["overview", "kanban"]);

function queryPart(key: string, value: string): string {
  return `${key}=${encodeURIComponent(value)}`;
}

function withQuery(path: string, nextId: string, params: URLSearchParams, keep: readonly string[]): string {
  const parts = [queryPart("workspaceId", nextId)];
  for (const key of keep) {
    const value = params.get(key);
    if (value !== null) parts.push(queryPart(key, value));
  }
  return `${path}?${parts.join("&")}`;
}

export function buildWorkspaceSwitchHref(pathname: string, search: string, nextId: string): WorkspaceSwitchTarget {
  const ws = encodeURIComponent(nextId);
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const segments = pathname.split(/[?#]/)[0].split("/").filter(Boolean);
  const entry: WorkspaceSwitchTarget = { href: `/workspace/${ws}`, fullReload: false };

  if (segments.length === 0) return { href: `/?workspace=${ws}`, fullReload: false };

  const [root, second, third] = segments;
  if (root === "workspace" && second) {
    if (!third || !SAME_KIND_WORKSPACE_PAGES.has(third)) return entry;
    const base = `/workspace/${ws}/${third}`;
    if (VIEW_ALL_PAGES.has(third) && params.get("view") === "all") return { href: `${base}?view=all`, fullReload: false };
    return { href: base, fullReload: false };
  }

  if (root === "settings") {
    if (!second) return { href: withQuery("/settings", nextId, params, ["tab"]), fullReload: false };
    if (second === "harness") return { href: withQuery("/settings/harness", nextId, params, ["section"]), fullReload: true };
    if (second === "fluency") return { href: withQuery("/settings/fluency", nextId, params, []), fullReload: true };
    return entry;
  }

  if (root === "traces" && !second) return { href: withQuery("/traces", nextId, params, ["view"]), fullReload: false };

  return entry;
}
