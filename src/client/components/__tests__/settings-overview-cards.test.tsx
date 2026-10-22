import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("../../utils/diagnostics", () => ({ desktopAwareFetch }));
vi.mock("next/navigation", () => ({ usePathname: () => "/settings" }));
vi.mock("../github-webhook-panel", () => ({ GitHubWebhookPanel: () => <div>GitHub Webhook Panel</div> }));
vi.mock("../schedule-panel", () => ({ SchedulePanel: () => <div>Schedule Panel</div> }));
vi.mock("../agent-install-panel", () => ({ AgentInstallPanel: () => <div>Agent Install Panel</div> }));
vi.mock("../workflow-panel", () => ({ WorkflowPanel: () => <div>Workflow Panel</div> }));
vi.mock("../../utils/theme", () => ({
  getStoredThemePreference: () => "light",
  resolveThemePreference: () => "light",
  setThemePreference: () => "light",
  subscribeToThemePreference: () => () => {},
}));

import { SettingsOverviewCards } from "../settings-overview-cards";
import { SettingsPanel } from "../settings-panel";

const EXPECTED_HREFS = [
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

describe("SettingsOverviewCards", () => {
  beforeEach(() => {
    localStorage.clear();
    desktopAwareFetch.mockReset();
    desktopAwareFetch.mockResolvedValue({ ok: true, json: async () => ({ specialists: [] }) });
  });

  it("shows four group cards with ten configure links", () => {
    render(<SettingsOverviewCards />);
    for (const group of ["build", "integrations", "automation", "quality"]) {
      expect(screen.getByTestId(`settings-overview-card-${group}`)).toBeTruthy();
    }
    const hrefs = within(screen.getByTestId("settings-overview-cards"))
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    expect(hrefs).toHaveLength(10);
    expect([...hrefs].sort()).toEqual([...EXPECTED_HREFS].sort());
  });

  it("puts the cards above the legacy tabs on the page variant and keeps the models deep link", () => {
    render(<SettingsPanel open variant="page" onClose={() => {}} providers={[]} initialTab="models" />);
    const cards = screen.getByTestId("settings-overview-cards");
    const legacy = screen.getByTestId("settings-legacy-section");
    expect(cards.compareDocumentPosition(legacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByTestId("settings-page-header")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Models" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByText("Add Model").length).toBeGreaterThan(0);
  });

  it("does not render the cards in the modal variant", () => {
    render(<SettingsPanel open variant="modal" onClose={() => {}} providers={[]} initialTab="providers" />);
    expect(screen.queryByTestId("settings-overview-cards")).toBeNull();
  });
});
