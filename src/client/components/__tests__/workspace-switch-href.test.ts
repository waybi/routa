import { describe, expect, it } from "vitest";

import { buildWorkspaceSwitchHref } from "../shell/workspace-switch-href";

/**
 * Expected values are written by hand from the card's route table (调研结论
 * 第 4 节), not copied from the implementation.
 */
const ROWS: Array<[string, string, string, string, boolean]> = [
  // [pathname, search, nextId, expected href, fullReload]
  ["/", "", "tb", "/?workspace=tb", false],
  ["/", "?workspace=old", "a/b", "/?workspace=a%2Fb", false],
  ["/workspace/ws-1", "", "tb", "/workspace/tb", false],
  ["/workspace/ws-1/overview", "?view=all", "tb", "/workspace/tb/overview?view=all", false],
  ["/workspace/ws-1/overview", "", "tb", "/workspace/tb/overview", false],
  ["/workspace/ws-1/kanban", "?view=all&card=x&tab=y", "tb", "/workspace/tb/kanban?view=all", false],
  ["/workspace/ws-1/kanban", "?card=x&tab=y", "tb", "/workspace/tb/kanban", false],
  ["/workspace/ws-1/kanban", "?view=all", "a/b", "/workspace/a%2Fb/kanban?view=all", false],
  ["/workspace/ws-1/sessions", "", "tb", "/workspace/tb/sessions", false],
  ["/workspace/ws-1/sessions/s-9", "", "tb", "/workspace/tb/sessions", false],
  ["/workspace/ws-1/team", "", "tb", "/workspace/tb/team", false],
  ["/workspace/ws-1/team/s-3", "", "tb", "/workspace/tb/team", false],
  ["/workspace/ws-1/spec", "?view=all", "tb", "/workspace/tb/spec", false],
  ["/workspace/ws-1/feature-explorer", "?f=1", "tb", "/workspace/tb/feature-explorer", false],
  ["/settings", "?tab=t", "tb", "/settings?workspaceId=tb&tab=t", false],
  ["/settings", "?workspaceId=old", "a/b", "/settings?workspaceId=a%2Fb", false],
  ["/traces", "?view=v&sessionId=s", "tb", "/traces?workspaceId=tb&view=v", false],
  ["/traces", "", "tb", "/traces?workspaceId=tb", false],
  ["/settings/harness", "?section=s", "tb", "/settings/harness?workspaceId=tb&section=s", true],
  ["/settings/harness", "?workspaceId=old", "a/b", "/settings/harness?workspaceId=a%2Fb", true],
  ["/settings/fluency", "?codebaseId=c&repoPath=p", "tb", "/settings/fluency?workspaceId=tb", true],
  ["/settings/schedules", "", "tb", "/workspace/tb", false],
  ["/messages", "", "tb", "/workspace/tb", false],
  ["/ag-ui", "", "tb", "/workspace/tb", false],
  ["/workspace/ws-1/codebases/c1/reposlide", "", "tb", "/workspace/tb", false],
  ["/a2a", "", "tb", "/workspace/tb", false],
  ["/canvas/x", "", "tb", "/workspace/tb", false],
  ["/mcp-tools", "", "tb", "/workspace/tb", false],
  ["/settings/agents", "", "tb", "/workspace/tb", false],
  ["/settings/webhooks", "", "a/b", "/workspace/a%2Fb", false],
  ["/debug/acp-replay", "", "tb", "/workspace/tb", false],
];

describe("buildWorkspaceSwitchHref: same kind of page in the other workspace", () => {
  it("covers at least 20 routes", () => {
    expect(ROWS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(ROWS)("%s%s → [%s] %s (fullReload=%s)", (pathname, search, nextId, href, fullReload) => {
    expect(buildWorkspaceSwitchHref(pathname, search, nextId)).toEqual({ href, fullReload });
  });
});

/* ---------------- F3: seeded random cross-check against an independent judge ---------------- */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Judge written from the requirement table only (regex per row, no shared helpers). */
function judge(pathname: string, search: string, nextId: string): { href: string; fullReload: boolean } {
  const n = encodeURIComponent(nextId);
  const q = new URLSearchParams(search.replace(/^\?/, ""));
  const enc = (v: string) => encodeURIComponent(v);
  const keep = (base: string, key: string | null) => {
    let out = `${base}?workspaceId=${n}`;
    if (key && q.has(key)) out += `&${key}=${enc(q.get(key) as string)}`;
    return out;
  };
  if (pathname === "/") return { href: `/?workspace=${n}`, fullReload: false };
  let m = /^\/workspace\/[^/]+\/(overview|kanban)$/.exec(pathname);
  if (m) return { href: `/workspace/${n}/${m[1]}${q.get("view") === "all" ? "?view=all" : ""}`, fullReload: false };
  m = /^\/workspace\/[^/]+\/(sessions|team)(\/[^/]+)?$/.exec(pathname);
  if (m) return { href: `/workspace/${n}/${m[1]}`, fullReload: false };
  m = /^\/workspace\/[^/]+\/(spec|feature-explorer)$/.exec(pathname);
  if (m) return { href: `/workspace/${n}/${m[1]}`, fullReload: false };
  if (pathname === "/settings") return { href: keep("/settings", "tab"), fullReload: false };
  if (pathname === "/traces") return { href: keep("/traces", "view"), fullReload: false };
  if (pathname === "/settings/harness") return { href: keep("/settings/harness", "section"), fullReload: true };
  if (pathname === "/settings/fluency") return { href: keep("/settings/fluency", null), fullReload: true };
  return { href: `/workspace/${n}`, fullReload: false };
}

const SEED = 20261023;
const ID_CHARS = ["a", "b", "Z", "0", "9", "-", "_", "/", "%", " ", "项", "目", "?", "&", "#"];
const TEMPLATES = [
  "/",
  "/workspace/{id}",
  "/workspace/{id}/overview",
  "/workspace/{id}/kanban",
  "/workspace/{id}/sessions",
  "/workspace/{id}/sessions/{id}",
  "/workspace/{id}/team",
  "/workspace/{id}/team/{id}",
  "/workspace/{id}/spec",
  "/workspace/{id}/feature-explorer",
  "/workspace/{id}/codebases/{id}/reposlide",
  "/settings",
  "/settings/harness",
  "/settings/fluency",
  "/settings/schedules",
  "/settings/agents",
  "/traces",
  "/messages",
  "/ag-ui",
  "/a2a",
  "/canvas/{id}",
  "/mcp-tools",
  "/debug/office-wasm-poc",
  "/unknown/{id}",
];
const QUERY_KEYS = ["view", "tab", "section", "sessionId", "codebaseId", "repoPath", "card", "workspaceId", "x"];

function randomCase(rand: () => number) {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const randomId = (min = 1) => {
    const len = min + Math.floor(rand() * 8);
    return Array.from({ length: len }, () => pick(ID_CHARS)).join("");
  };
  const segmentId = () => encodeURIComponent(randomId());
  const pathname = pick(TEMPLATES).replace(/\{id\}/g, segmentId);
  const params = new URLSearchParams();
  const count = Math.floor(rand() * 4);
  for (let i = 0; i < count; i += 1) {
    const key = pick(QUERY_KEYS);
    params.set(key, key === "view" && rand() < 0.5 ? "all" : randomId());
  }
  const query = params.toString();
  const search = query ? (rand() < 0.8 ? `?${query}` : query) : "";
  return { pathname, search, nextId: randomId() };
}

describe("buildWorkspaceSwitchHref random cross-check (F3)", () => {
  it(`matches the independent judge on 10,000 seeded cases (seed ${SEED})`, () => {
    const rand = mulberry32(SEED);
    const mismatches: string[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      const c = randomCase(rand);
      const got = buildWorkspaceSwitchHref(c.pathname, c.search, c.nextId);
      const want = judge(c.pathname, c.search, c.nextId);
      if (got.href !== want.href || got.fullReload !== want.fullReload) {
        mismatches.push(`${JSON.stringify(c)} → got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
      }
    }
    expect(mismatches.slice(0, 5), `first counter-examples of ${mismatches.length}`).toEqual([]);
  });
});
