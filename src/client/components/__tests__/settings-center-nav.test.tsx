import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pathnameState = vi.hoisted(() => ({ pathname: "/settings" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.pathname,
}));

import { SettingsCenterNav, resolveSettingsNavKey } from "../settings-center-nav";

const EXPECTED_HREFS = [
  "/settings",
  "/settings/agents",
  "/settings/specialists",
  "/settings/workflows",
  "/settings/mcp",
  "/mcp-tools",
  "/settings/schedules",
  "/settings/webhooks",
  "/settings/harness",
  "/settings/fitness",
  "/settings/fluency",
];

function links() {
  return within(screen.getByTestId("settings-center-nav")).getAllByRole("link");
}

describe("SettingsCenterNav", () => {
  it("lists the overview, the nine settings pages and /mcp-tools (11 entries)", () => {
    render(<SettingsCenterNav />);
    const hrefs = links().map((link) => link.getAttribute("href"));
    expect(hrefs).toHaveLength(11);
    expect([...hrefs].sort()).toEqual([...EXPECTED_HREFS].sort());
  });

  it("highlights the entry for the current path", () => {
    pathnameState.pathname = "/settings/schedules";
    render(<SettingsCenterNav />);
    const current = links().filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual(["/settings/schedules"]);
  });

  it("highlights the overview for in-page tabs of /settings", () => {
    pathnameState.pathname = "/settings";
    render(<SettingsCenterNav activeItem="models" />);
    const current = links().filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual(["/settings"]);
  });

  it("resolves MCP tools from /mcp-tools or the explicit tools tab", () => {
    expect(resolveSettingsNavKey("/mcp-tools")).toBe("mcpTools");
    expect(resolveSettingsNavKey("/settings/mcp", "mcpTools")).toBe("mcpTools");
    expect(resolveSettingsNavKey("/settings/mcp")).toBe("mcp");
    expect(resolveSettingsNavKey("/settings/fluency")).toBe("fluency");
    expect(resolveSettingsNavKey("/workspace/x/kanban")).toBeNull();
  });
});
