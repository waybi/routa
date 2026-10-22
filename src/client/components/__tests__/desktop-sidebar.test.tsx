import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pathnameState = vi.hoisted(() => ({
  pathname: "/workspace/default/kanban",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.pathname,
}));

import { DesktopSidebar } from "../desktop-sidebar";

function navLinks() {
  return within(screen.getByRole("navigation")).getAllByRole("link");
}

describe("DesktopSidebar (redesign: 7 global entries)", () => {
  it("shows exactly the seven spec entries in order with workspace-scoped hrefs", () => {
    render(<DesktopSidebar workspaceId="ws-1" />);

    const links = navLinks();
    expect(links.map((link) => link.textContent)).toEqual([
      "Home",
      "Needs you",
      "Board",
      "Sessions",
      "Team",
      "Spec",
      "Settings",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/workspace/ws-1/overview",
      "/workspace/ws-1/kanban",
      "/workspace/ws-1/sessions",
      "/workspace/ws-1/team",
      "/workspace/ws-1/spec",
      "/settings",
    ]);
  });

  it("uses seven distinct icons", () => {
    render(<DesktopSidebar workspaceId="ws-1" />);
    const svgs = navLinks().map((link) => link.querySelector("svg")?.innerHTML ?? "");
    expect(svgs.every((svg) => svg.length > 0)).toBe(true);
    expect(new Set(svgs).size).toBe(7);
  });

  it("has no workspace entry and no settings sub-page entries", () => {
    render(<DesktopSidebar workspaceId="ws-1" />);
    const hrefs = navLinks().map((link) => link.getAttribute("href") ?? "");
    expect(hrefs).not.toContain("/workspace/ws-1");
    expect(hrefs.some((href) => href.startsWith("/settings/"))).toBe(false);
    expect(hrefs).not.toContain("/mcp-tools");
  });

  it("falls back to the default workspace when none is selected", () => {
    render(<DesktopSidebar workspaceId={null} />);
    expect(screen.getByRole("link", { name: "Board" }).getAttribute("href")).toBe("/workspace/default/kanban");
  });

  it("marks the current entry, and Settings for any settings sub-page", () => {
    pathnameState.pathname = "/workspace/ws-1/kanban";
    const { unmount } = render(<DesktopSidebar workspaceId="ws-1" />);
    expect(screen.getByRole("link", { name: "Board" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    unmount();

    pathnameState.pathname = "/settings/harness";
    render(<DesktopSidebar workspaceId="ws-1" />);
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBe("page");
  });

  it("closes the narrow-screen drawer on Escape and on backdrop click", () => {
    const onDrawerClose = vi.fn();
    const { rerender } = render(<DesktopSidebar workspaceId="ws-1" drawerOpen onDrawerClose={onDrawerClose} />);

    expect(screen.getByTestId("desktop-shell-sidebar").dataset.drawerOpen).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDrawerClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("desktop-shell-drawer-backdrop"));
    expect(onDrawerClose).toHaveBeenCalledTimes(2);

    rerender(<DesktopSidebar workspaceId="ws-1" drawerOpen={false} onDrawerClose={onDrawerClose} />);
    expect(screen.queryByTestId("desktop-shell-drawer-backdrop")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDrawerClose).toHaveBeenCalledTimes(2);
  });

  it("turns off the drawer transition under prefers-reduced-motion", () => {
    render(<DesktopSidebar workspaceId="ws-1" />);
    const className = screen.getByTestId("desktop-shell-sidebar").className;
    expect(className).toContain("max-[800px]:transition-transform");
    expect(className).toContain("max-[800px]:motion-reduce:transition-none");
  });
});
