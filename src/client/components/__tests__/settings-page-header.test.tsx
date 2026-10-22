import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/workflows",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="desktop-shell-root">{children}</div>,
}));

import { SettingsPageHeader } from "../settings-page-header";
import { SettingsRouteShell } from "../settings-route-shell";

describe("SettingsPageHeader", () => {
  it("renders a 21px title, a one-line description and right-hand actions", () => {
    render(
      <SettingsPageHeader
        title="Workflows"
        description="Chain specialists into multi-step workflows."
        actions={<button type="button">New</button>}
      />,
    );
    const header = screen.getByTestId("settings-page-header");
    const heading = within(header).getByRole("heading", { level: 1, name: "Workflows" });
    expect(heading.className).toContain("text-[21px]");
    expect(within(header).getByText("Chain specialists into multi-step workflows.")).toBeTruthy();
    expect(within(screen.getByTestId("settings-page-header-actions")).getByRole("button", { name: "New" })).toBeTruthy();
  });

  it("omits the actions slot when there are no actions", () => {
    render(<SettingsPageHeader title="Agents" />);
    expect(screen.queryByTestId("settings-page-header-actions")).toBeNull();
  });
});

describe("SettingsRouteShell", () => {
  it("renders exactly one page header next to the settings sub-navigation", () => {
    render(
      <SettingsRouteShell activeSettingsItem="workflows" title="Workflows" description="desc">
        <p>body</p>
      </SettingsRouteShell>,
    );
    expect(screen.getAllByTestId("settings-page-header")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId("settings-center-nav")).toBeTruthy();
    expect(screen.getByText("body")).toBeTruthy();
  });
});
