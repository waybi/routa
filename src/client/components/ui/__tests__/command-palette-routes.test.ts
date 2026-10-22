import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import { COMMAND_ROUTES, buildCommandRouteEntries, filterCommandRouteEntries } from "../command-palette-routes";

const APP_DIR = resolve(__dirname, "../../../../app");

/** Every page.tsx under src/app, as a Next.js route pattern ("/" for the root). */
function scanPageRoutes(dir: string): string[] {
  const routes: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "api" || name.startsWith("_")) continue;
      routes.push(...scanPageRoutes(full));
    } else if (name === "page.tsx") {
      const rel = relative(APP_DIR, dir).split(sep).filter(Boolean);
      // Route groups "(x)" do not appear in the URL.
      const segments = rel.filter((segment) => !/^\(.*\)$/.test(segment));
      routes.push(`/${segments.join("/")}`.replace(/\/$/, "") || "/");
    }
  }
  return routes;
}

describe("command palette route registry", () => {
  it("registers exactly 29 routes", () => {
    expect(COMMAND_ROUTES).toHaveLength(29);
  });

  it("matches the src/app page.tsx files one-to-one", () => {
    const pages = scanPageRoutes(APP_DIR).sort();
    const registered = COMMAND_ROUTES.map((route) => route.pattern).sort();
    expect(new Set(registered).size).toBe(registered.length);
    expect(registered).toEqual(pages);
  });

  it("fills workspace routes and marks sub-ID routes as list landings", () => {
    const entries = buildCommandRouteEntries(en, "ws-9");
    const byKey = Object.fromEntries(entries.map((entry) => [entry.key, entry]));

    expect(byKey.kanban.href).toBe("/workspace/ws-9/kanban");
    expect(byKey.inbox.href).toBe("/workspace/ws-9/overview");
    for (const key of ["sessionDetail", "teamRun", "reposlide", "canvas"] as const) {
      expect(byKey[key].opensList).toBe(true);
      expect(byKey[key].hint).toBe(en.shell.commandPalette.opensList);
      expect(byKey[key].href).not.toMatch(/\[|\{/);
    }
    expect(byKey.sessionDetail.href).toBe("/workspace/ws-9/sessions");
    expect(byKey.teamRun.href).toBe("/workspace/ws-9/team");
    expect(entries.every((entry) => !entry.href.includes("{ws}"))).toBe(true);
  });

  it("has a label for every route in both languages", () => {
    for (const dict of [en, zh]) {
      for (const entry of buildCommandRouteEntries(dict, "w")) {
        expect(entry.label.length).toBeGreaterThan(0);
        expect(entry.groupLabel.length).toBeGreaterThan(0);
      }
    }
  });

  it("filters by label, group and path words", () => {
    const entries = buildCommandRouteEntries(en, "w");
    expect(filterCommandRouteEntries(entries, "").length).toBe(29);
    expect(filterCommandRouteEntries(entries, "board").map((entry) => entry.key)).toContain("kanban");
    expect(filterCommandRouteEntries(entries, "settings mcp").map((entry) => entry.key)).toEqual(
      expect.arrayContaining(["mcp", "mcpTools"]),
    );
    expect(filterCommandRouteEntries(entries, "zzz-nothing")).toEqual([]);
  });
});
