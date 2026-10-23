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

describe("DesktopSidebar (redesign: 10 global entries)", () => {
  it("shows exactly the ten top-level entries in order with workspace-scoped hrefs", () => {
    render(<DesktopSidebar workspaceId="ws-1" />);

    const links = navLinks();
    expect(links.map((link) => link.textContent)).toEqual([
      "Home",
      "Needs you",
      "Board",
      "Sessions",
      "Team",
      "Spec",
      "Feature explorer",
      "Harness",
      "Fluency",
      "Settings",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/workspace/ws-1/overview",
      "/workspace/ws-1/kanban",
      "/workspace/ws-1/sessions",
      "/workspace/ws-1/team",
      "/workspace/ws-1/spec",
      "/workspace/ws-1/feature-explorer",
      "/settings/harness?workspaceId=ws-1",
      "/settings/fluency?workspaceId=ws-1",
      "/settings?workspaceId=ws-1",
    ]);
  });

  it("uses ten distinct icons", () => {
    render(<DesktopSidebar workspaceId="ws-1" />);
    const svgs = navLinks().map((link) => link.querySelector("svg")?.innerHTML ?? "");
    expect(svgs.every((svg) => svg.length > 0)).toBe(true);
    expect(new Set(svgs).size).toBe(10);
  });

  it("has no bare workspace entry and only Harness and Fluency as settings sub-page entries", () => {
    render(<DesktopSidebar workspaceId="ws-1" />);
    const hrefs = navLinks().map((link) => link.getAttribute("href") ?? "");
    expect(hrefs).not.toContain("/workspace/ws-1");
    expect(hrefs.filter((href) => href.startsWith("/settings/"))).toEqual([
      "/settings/harness?workspaceId=ws-1",
      "/settings/fluency?workspaceId=ws-1",
    ]);
    expect(hrefs).not.toContain("/mcp-tools");
  });

  it("falls back to the default workspace when none is selected", () => {
    render(<DesktopSidebar workspaceId={null} />);
    expect(screen.getByRole("link", { name: "Board" }).getAttribute("href")).toBe("/workspace/default/kanban");
  });

  it("marks the current entry, and Harness (not Settings) on the harness page", () => {
    pathnameState.pathname = "/workspace/ws-1/kanban";
    const { unmount } = render(<DesktopSidebar workspaceId="ws-1" />);
    expect(screen.getByRole("link", { name: "Board" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    unmount();

    pathnameState.pathname = "/settings/harness";
    render(<DesktopSidebar workspaceId="ws-1" />);
    expect(screen.getByRole("link", { name: "Harness" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBeNull();
  });

  it("carries the workspace into Harness, Fluency and Settings and shows Feature explorer without stored group state", () => {
    window.localStorage.clear();
    const { unmount } = render(<DesktopSidebar workspaceId="ws-2" />);
    expect(screen.getByRole("link", { name: "Harness" }).getAttribute("href")).toBe("/settings/harness?workspaceId=ws-2");
    expect(screen.getByRole("link", { name: "Fluency" }).getAttribute("href")).toBe("/settings/fluency?workspaceId=ws-2");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings?workspaceId=ws-2");
    const featureExplorer = screen.getByRole("link", { name: "Feature explorer" });
    expect(featureExplorer.getAttribute("href")).toBe("/workspace/ws-2/feature-explorer");
    expect(featureExplorer.closest("[data-nav-group]")).toBeNull();
    unmount();

    const { unmount: unmountEscaped } = render(<DesktopSidebar workspaceId="a/b" />);
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings?workspaceId=a%2Fb");
    expect(screen.getByRole("link", { name: "Feature explorer" }).getAttribute("href")).toBe("/workspace/a%2Fb/feature-explorer");
    unmountEscaped();

    render(<DesktopSidebar workspaceId={null} />);
    expect(screen.getByRole("link", { name: "Harness" }).getAttribute("href")).toBe("/settings/harness");
    expect(screen.getByRole("link", { name: "Fluency" }).getAttribute("href")).toBe("/settings/fluency");
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
  });

  it.each([
    ["/settings/harness", "Harness"],
    ["/settings/fluency", "Fluency"],
    ["/settings/agents", "Settings"],
    ["/settings", "Settings"],
    ["/mcp-tools", "Settings"],
    ["/workspace/ws-2/feature-explorer", "Feature explorer"],
  ])("on %s only %s is current", (pathname, name) => {
    pathnameState.pathname = pathname;
    render(<DesktopSidebar workspaceId="ws-2" />);
    const current = navLinks().filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual([name]);
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
