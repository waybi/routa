import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * Redesign card 6/6, AC1 + AC2: every route registered in
 * src/client/components/ui/command-palette-routes.ts opens with a 200, shows
 * the desktop shell, and does not scroll sideways at 1440 / 1024 / 768.
 * The settings sub-navigation highlights the right entry, and
 * /settings/fitness and /mcp-tools land where they should.
 *
 * Dynamic IDs come from the preview database (ROUTA_PREVIEW_DB, default
 * /tmp/routa-preview-6.db). Canvas uses a fixed ID: the page must render
 * its in-shell error or empty state, not crash.
 */

const PREVIEW_DB = process.env.ROUTA_PREVIEW_DB || "/tmp/routa-preview-6.db";

function sqlite(query: string): string {
  if (!existsSync(PREVIEW_DB)) return "";
  try {
    return execFileSync("sqlite3", ["-readonly", PREVIEW_DB, query], { encoding: "utf8" }).trim().split("\n")[0] ?? "";
  } catch {
    return "";
  }
}

const workspaceId = sqlite("select id from workspaces order by id = 'default' desc limit 1") || "default";
const sessionId = sqlite(`select id from acp_sessions where workspace_id = '${workspaceId}' limit 1`) || "missing-session";
const codebaseId = sqlite(`select id from codebases where workspace_id = '${workspaceId}' limit 1`) || "missing-codebase";

const ROUTES: string[] = [
  "/",
  `/workspace/${workspaceId}`,
  `/workspace/${workspaceId}/overview`,
  `/workspace/${workspaceId}/kanban`,
  `/workspace/${workspaceId}/sessions`,
  `/workspace/${workspaceId}/sessions/${sessionId}`,
  `/workspace/${workspaceId}/team`,
  `/workspace/${workspaceId}/team/${sessionId}`,
  `/workspace/${workspaceId}/spec`,
  `/workspace/${workspaceId}/feature-explorer`,
  `/workspace/${workspaceId}/codebases/${codebaseId}/reposlide`,
  "/settings",
  "/settings/agents",
  "/settings/specialists",
  "/settings/workflows",
  "/settings/mcp",
  "/settings/schedules",
  "/settings/webhooks",
  "/settings/harness",
  "/settings/fitness",
  "/settings/fluency",
  "/traces",
  "/messages",
  "/a2a",
  "/ag-ui",
  "/mcp-tools",
  "/canvas/redesign-preview-canvas",
  "/debug/acp-replay",
  "/debug/office-wasm-poc",
];

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
];

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

test.describe("redesign routes", () => {
  test("covers all 29 command palette routes", () => {
    expect(ROUTES).toHaveLength(29);
  });

  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${route} at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        const response = await page.goto(route, { waitUntil: "domcontentloaded" });
        expect(response?.status(), `status of ${route}`).toBe(200);
        await expect(page.locator('[data-testid="desktop-shell-root"]').first()).toBeVisible({ timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
        await expectNoHorizontalScroll(page);
      });
    }
  }

  test("settings sub-navigation highlights the current page", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0]);
    const pages = ["agents", "specialists", "workflows", "mcp", "schedules", "webhooks", "harness", "fluency"];
    for (const key of pages) {
      await page.goto(`/settings/${key}`, { waitUntil: "domcontentloaded" });
      const nav = page.locator('[data-testid="settings-center-nav"]');
      await expect(nav).toBeVisible({ timeout: 30_000 });
      await expect(nav.getByRole("link")).toHaveCount(11);
      await expect(nav.locator('a[aria-current="page"]')).toHaveAttribute("href", `/settings/${key}`);
    }
  });

  test("/settings/fitness ends on fluency and /mcp-tools on the MCP tools tab", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[0]);
    await page.goto(`/settings/fitness?workspaceId=${workspaceId}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/settings\/fluency/, { timeout: 30_000 });
    expect(new URL(page.url()).searchParams.get("workspaceId")).toBe(workspaceId);
    await expect(page.locator('[data-testid="settings-center-nav"] a[aria-current="page"]')).toHaveAttribute("href", "/settings/fluency");

    await page.goto("/mcp-tools", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/settings\/mcp\?tab=tools/, { timeout: 30_000 });
    await expect(page.locator('[data-testid="settings-center-nav"] a[aria-current="page"]')).toHaveAttribute("href", "/mcp-tools");
  });

  test("the settings sub-navigation fits into a top row at 768px", async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[2]);
    await page.goto("/settings/workflows", { waitUntil: "domcontentloaded" });
    const nav = page.locator('[data-testid="settings-center-nav"]');
    await expect(nav).toBeVisible({ timeout: 30_000 });
    const box = await nav.boundingBox();
    expect(box?.height ?? 0).toBeLessThan(120);
    await expectNoHorizontalScroll(page);
  });
});
