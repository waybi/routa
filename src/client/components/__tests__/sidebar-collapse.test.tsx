import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathnameState = vi.hoisted(() => ({ pathname: "/workspace/ws-routa/kanban" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.pathname,
  // For the top bar's command palette; the sidebar itself only uses usePathname.
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../shell-header-controls", () => ({
  ShellHeaderControls: () => <div data-testid="shell-header-controls" />,
}));

import { DesktopAppShell } from "../desktop-app-shell";
import { DesktopSidebar } from "../desktop-sidebar";
import { resetSidebarNavGroupCache } from "../shell/sidebar-nav-groups";
import { resetSidebarWorkspacesCache } from "../shell/use-sidebar-workspaces";
import { useSidebarCollapsed } from "../shell/use-sidebar-collapsed";

const WORKSPACES = [
  { id: "default", title: "Default Workspace" },
  { id: "ws-topbi", title: "TopBI" },
  { id: "ws-routa", title: "Routa" },
  { id: "ws-dsh", title: "deepseek-harness" },
  { id: "ws-lt", title: "local-tools" },
  { id: "ws-turnilo", title: "turnilo" },
].map((workspace, index) => ({ ...workspace, createdAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString() }));

const TOP_LEVEL = ["Home", "Needs you", "Board", "Sessions", "Team", "Spec", "Feature explorer", "Harness", "Fluency", "Settings"];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  window.localStorage.clear();
  resetSidebarNavGroupCache();
  resetSidebarWorkspacesCache();
  pathnameState.pathname = "/workspace/ws-routa/kanban";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/api/workspaces") ? jsonResponse({ workspaces: WORKSPACES }) : jsonResponse({}),
    ),
  );
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function toggle() {
  return screen.getByTestId("desktop-shell-sidebar-toggle");
}

function projectLinks() {
  return within(screen.getByTestId("shell-sidebar-projects")).queryAllByRole("link");
}

describe("Wide-screen sidebar collapse (R9, AC8, C6)", () => {
  it("collapses to the icon rail, remembers it, and expands again", async () => {
    render(<DesktopAppShell workspaceId="ws-routa">x</DesktopAppShell>);
    await waitFor(() => expect(projectLinks()).toHaveLength(6));

    expect(toggle().getAttribute("aria-label")).toBe("Close sidebar");
    expect(toggle().getAttribute("title")).toBe("Close sidebar");
    for (let node: HTMLElement | null = toggle(); node; node = node.parentElement) {
      expect(node.className.toString()).not.toContain("min-[801px]:hidden");
    }
    const sidebar = screen.getByTestId("desktop-shell-sidebar");
    expect(sidebar.className).toContain("min-[1101px]:w-[216px]");

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-label")).toBe("Open sidebar");
    expect(window.localStorage.getItem("routa.desktop.sidebar-collapsed")).toBe("true");
    expect(sidebar.dataset.collapsed).toBe("true");
    expect(sidebar.className).toContain("min-[801px]:w-14");
    const nav = screen.getByRole("navigation");
    for (const name of TOP_LEVEL) {
      const link = within(nav).getByRole("link", { name });
      expect(link.textContent).toBe("");
      expect(link.getAttribute("title")).toBe(name);
    }
    expect(within(nav).getAllByRole("link")).toHaveLength(10);
    expect(within(nav).getByRole("link", { name: "Board" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-label")).toBe("Close sidebar");
    expect(window.localStorage.getItem("routa.desktop.sidebar-collapsed")).toBe("false");
    expect(within(nav).getByRole("link", { name: "Board" }).textContent).toBe("Board");
  });

  it("starts collapsed when the stored preference says so", () => {
    window.localStorage.setItem("routa.desktop.sidebar-collapsed", "true");
    render(<DesktopAppShell workspaceId="ws-routa">x</DesktopAppShell>);
    expect(toggle().getAttribute("aria-label")).toBe("Open sidebar");
    expect(screen.getByTestId("desktop-shell-sidebar").dataset.collapsed).toBe("true");
  });

  it("keeps several instances in sync, including changes from another tab (C14)", () => {
    function Probe({ id }: { id: string }) {
      const { collapsed, toggleCollapsed } = useSidebarCollapsed();
      return (
        <button type="button" data-testid={id} onClick={toggleCollapsed}>
          {collapsed ? "collapsed" : "expanded"}
        </button>
      );
    }
    render(
      <>
        <Probe id="a" />
        <Probe id="b" />
      </>,
    );
    fireEvent.click(screen.getByTestId("a"));
    expect(screen.getByTestId("b").textContent).toBe("collapsed");

    act(() => {
      window.localStorage.setItem("routa.desktop.sidebar-collapsed", "false");
      window.dispatchEvent(new StorageEvent("storage", { key: "routa.desktop.sidebar-collapsed" }));
    });
    expect(screen.getByTestId("a").textContent).toBe("expanded");
    expect(screen.getByTestId("b").textContent).toBe("expanded");
  });

  it("renders expanded on the server even with a stored collapsed preference (C12)", () => {
    window.localStorage.setItem("routa.desktop.sidebar-collapsed", "true");
    window.history.replaceState(null, "", "/settings?tab=a");
    pathnameState.pathname = "/settings";
    const html = renderToString(<DesktopAppShell workspaceId="ws-routa">x</DesktopAppShell>);
    expect(html).toContain('data-collapsed="false"');
    expect(html).toContain("Close sidebar");
    for (const name of TOP_LEVEL) expect(html).toContain(`>${name}</span>`);
    window.history.replaceState(null, "", "/");
  });
});

describe("Projects group in the icon rail and the drawer (AC10)", () => {
  it("shows one square per workspace with its first character, still linked and highlighted", async () => {
    window.localStorage.setItem("routa.desktop.sidebar-collapsed", "true");
    render(<DesktopAppShell workspaceId="ws-routa">x</DesktopAppShell>);
    await waitFor(() => expect(projectLinks()).toHaveLength(6));

    const topbi = screen.getByRole("link", { name: "TopBI" });
    expect(topbi.textContent).toBe("T");
    expect(topbi.getAttribute("title")).toBe("TopBI");
    expect(topbi.getAttribute("href")).toBe("/workspace/ws-topbi/kanban");
    expect(screen.getByRole("link", { name: "deepseek-harness" }).textContent).toBe("D");
    const routa = screen.getByRole("link", { name: "Routa" });
    expect(routa.getAttribute("aria-current")).toBe("true");
    expect(routa.className).toContain("bg-accent-subtle");
    expect(screen.getByRole("link", { name: "All projects" }).getAttribute("href")).toBe("/workspace/ws-routa/kanban?view=all");
  });

  it("opens the drawer at full width with names, even when collapsed, and closes it on a row click", async () => {
    window.localStorage.setItem("routa.desktop.sidebar-collapsed", "true");
    const onDrawerClose = vi.fn();
    render(<DesktopSidebar workspaceId="ws-routa" collapsed drawerOpen onDrawerClose={onDrawerClose} />);
    await waitFor(() => expect(projectLinks()).toHaveLength(6));

    expect(screen.getByTestId("desktop-shell-sidebar").dataset.collapsed).toBe("false");
    expect(projectLinks().map((link) => link.textContent)).toContain("TopBI");
    expect(screen.getByRole("link", { name: "Board" }).textContent).toBe("Board");

    fireEvent.click(screen.getByRole("link", { name: "TopBI" }));
    expect(onDrawerClose).toHaveBeenCalledTimes(1);
  });

  it("keeps full rows with a title at the 184px and 216px widths", async () => {
    render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitFor(() => expect(projectLinks()).toHaveLength(6));
    const className = screen.getByTestId("desktop-shell-sidebar").className;
    expect(className).toContain("min-[801px]:w-[184px]");
    expect(className).toContain("min-[1101px]:w-[216px]");
    expect(className).toContain("max-[800px]:w-[230px]");
    const row = screen.getByRole("link", { name: "deepseek-harness" });
    expect(row.querySelector("span")?.className).toContain("truncate");
    expect(row.getAttribute("title")).toBe("deepseek-harness");
  });
});
