import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/workspace/ws-1/kanban",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../shell-header-controls", () => ({
  ShellHeaderControls: () => <div data-testid="shell-header-controls" />,
}));

import { DesktopAppShell } from "../desktop-app-shell";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

describe("DesktopAppShell", () => {
  it("renders the sidebar, top bar and page content", () => {
    render(
      <DesktopAppShell workspaceId="ws-1">
        <p>page body</p>
      </DesktopAppShell>,
    );
    expect(screen.getByTestId("desktop-shell-sidebar")).toBeTruthy();
    expect(screen.getByTestId("desktop-shell-header")).toBeTruthy();
    expect(screen.getByTestId("desktop-shell-main").textContent).toBe("page body");
  });

  it("opens the narrow-screen drawer from the menu button and closes it with Esc", () => {
    render(<DesktopAppShell workspaceId="ws-1">x</DesktopAppShell>);
    const sidebar = screen.getByTestId("desktop-shell-sidebar");
    expect(sidebar.dataset.drawerOpen).toBe("false");

    fireEvent.click(screen.getByTestId("desktop-shell-menu-button"));
    expect(sidebar.dataset.drawerOpen).toBe("true");

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(sidebar.dataset.drawerOpen).toBe("false");
  });

  it("mounts the command palette, opened by ⌘K or the top-bar button", () => {
    render(<DesktopAppShell workspaceId="ws-1">x</DesktopAppShell>);
    const palette = screen.getByTestId("command-palette") as HTMLDialogElement;
    expect(palette.open).toBe(false);

    act(() => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    expect(palette.open).toBe(true);

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(palette.open).toBe(false);

    fireEvent.click(screen.getByTestId("desktop-shell-command-button"));
    expect(palette.open).toBe(true);
  });
});
