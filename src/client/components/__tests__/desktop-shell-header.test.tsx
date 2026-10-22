import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../shell-header-controls", () => ({
  ShellHeaderControls: ({ showPreferencesMenu }: { showPreferencesMenu?: boolean }) => (
    <div data-testid="shell-header-controls" data-show-preferences-menu={showPreferencesMenu ? "true" : "false"} />
  ),
}));

import { DesktopShellHeader } from "../desktop-shell-header";

describe("DesktopShellHeader", () => {
  it("shows global preferences controls in the shell header", () => {
    render(<DesktopShellHeader workspaceId="default" workspaceTitle="Default Workspace" />);

    expect(screen.getByTestId("shell-header-controls").getAttribute("data-show-preferences-menu")).toBe("true");
  });

  it("puts the workspace switcher in the top bar", () => {
    render(
      <DesktopShellHeader
        workspaceId="default"
        workspaceSwitcher={<div data-testid="switcher-slot">switcher</div>}
      />,
    );
    expect(screen.getByTestId("desktop-shell-header").contains(screen.getByTestId("switcher-slot"))).toBe(true);
  });

  it("offers a ⌘K entry and a narrow-screen menu button wired to the shell", () => {
    const onOpenCommandPalette = vi.fn();
    const onToggleDrawer = vi.fn();
    render(
      <DesktopShellHeader
        workspaceId="default"
        onOpenCommandPalette={onOpenCommandPalette}
        onToggleDrawer={onToggleDrawer}
      />,
    );

    fireEvent.click(screen.getByTestId("desktop-shell-command-button"));
    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);

    const menu = screen.getByTestId("desktop-shell-menu-button");
    expect(menu.getAttribute("aria-label")).toBe("Open navigation");
    expect(menu.className).toContain("min-[801px]:hidden");
    fireEvent.click(menu);
    expect(onToggleDrawer).toHaveBeenCalledTimes(1);
  });

  it("uses no uppercase + tracking eyebrow labels", () => {
    const { container } = render(<DesktopShellHeader workspaceId="default" onOpenCommandPalette={() => {}} />);
    const offenders = Array.from(container.querySelectorAll("[class]")).filter((node) => {
      const cls = node.getAttribute("class") ?? "";
      return cls.includes("uppercase") && cls.includes("tracking-");
    });
    expect(offenders).toHaveLength(0);
  });
});
