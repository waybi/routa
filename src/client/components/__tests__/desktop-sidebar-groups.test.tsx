import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathnameState = vi.hoisted(() => ({
  pathname: "/workspace/ws-1/kanban",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.pathname,
}));

import { DesktopSidebar } from "../desktop-sidebar";
import { resetSidebarNavGroupCache } from "../shell/sidebar-nav-groups";

function group(id: "resources" | "developer") {
  return document.querySelector<HTMLElement>(`[data-nav-group="${id}"]`)!;
}

function groupButton(id: "resources" | "developer") {
  return within(group(id)).getByRole("button");
}

function groupLinks(id: "resources" | "developer") {
  return within(group(id)).queryAllByRole("link");
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;

function mockApi(codebases: Array<{ id: string }>, canvasArtifacts: Array<{ id: string }>) {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/codebases")) return jsonResponse({ codebases });
    if (url.includes("/canvas")) return jsonResponse({ canvasArtifacts });
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  window.localStorage.clear();
  resetSidebarNavGroupCache();
  pathnameState.pathname = "/workspace/ws-1/kanban";
  mockApi([{ id: "cb-1" }, { id: "cb-2" }], [{ id: "cv-9" }]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DesktopSidebar resource and developer groups", () => {
  it("starts with both groups collapsed and no links inside them", () => {
    render(<DesktopSidebar workspaceId="ws-1" />);

    expect(groupButton("resources").textContent).toBe("Resources");
    expect(groupButton("developer").textContent).toBe("Developer");
    expect(groupButton("resources").getAttribute("aria-expanded")).toBe("false");
    expect(groupButton("developer").getAttribute("aria-expanded")).toBe("false");
    expect(groupLinks("resources")).toHaveLength(0);
    expect(groupLinks("developer")).toHaveLength(0);
    expect(within(screen.getByRole("navigation")).getAllByRole("link")).toHaveLength(7);
  });

  it("opens the developer group, stores it, and keeps it open after a remount", () => {
    const { unmount } = render(<DesktopSidebar workspaceId="ws-1" />);
    fireEvent.click(groupButton("developer"));

    expect(groupButton("developer").getAttribute("aria-expanded")).toBe("true");
    expect(groupLinks("developer").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Traces", "/traces"],
      ["Background messages", "/messages"],
      ["A2A", "/a2a"],
      ["AG-UI", "/ag-ui"],
      ["ACP replay", "/debug/acp-replay"],
      ["Document lab", "/debug/office-wasm-poc"],
    ]);
    expect(window.localStorage.getItem("routa.shell.nav.developer")).toBe("true");
    unmount();

    render(<DesktopSidebar workspaceId="ws-1" />);
    expect(groupButton("developer").getAttribute("aria-expanded")).toBe("true");
    expect(groupLinks("developer")).toHaveLength(6);
    expect(groupButton("resources").getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(groupButton("developer"));
    expect(window.localStorage.getItem("routa.shell.nav.developer")).toBe("false");
    expect(groupLinks("developer")).toHaveLength(0);
  });

  it("auto-expands the developer group on /traces and marks the item current", () => {
    pathnameState.pathname = "/traces";
    render(<DesktopSidebar workspaceId="ws-1" />);

    expect(groupButton("developer").getAttribute("aria-expanded")).toBe("true");
    expect(within(group("developer")).getByRole("link", { name: "Traces" }).getAttribute("aria-current")).toBe("page");
    expect(within(group("developer")).getByRole("link", { name: "A2A" }).getAttribute("aria-current")).toBeNull();
    expect(groupButton("resources").getAttribute("aria-expanded")).toBe("false");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets the user collapse the auto-expanded group on its own page", () => {
    pathnameState.pathname = "/traces";
    render(<DesktopSidebar workspaceId="ws-1" />);
    fireEvent.click(groupButton("developer"));

    expect(groupButton("developer").getAttribute("aria-expanded")).toBe("false");
    expect(groupLinks("developer")).toHaveLength(0);
    expect(window.localStorage.getItem("routa.shell.nav.developer")).toBe("false");
  });

  it("behaves the same inside the narrow-screen drawer", () => {
    pathnameState.pathname = "/debug/acp-replay";
    render(<DesktopSidebar workspaceId="ws-1" drawerOpen onDrawerClose={() => {}} />);

    expect(screen.getByTestId("desktop-shell-sidebar").dataset.drawerOpen).toBe("true");
    expect(groupButton("developer").getAttribute("aria-expanded")).toBe("true");
    expect(within(group("developer")).getByRole("link", { name: "ACP replay" }).getAttribute("aria-current")).toBe("page");
  });

  it("fetches codebase and canvas ids only after the resources group opens", async () => {
    render(<DesktopSidebar workspaceId="ws-1" />);
    fireEvent.click(groupButton("developer"));
    expect(fetchMock).toHaveBeenCalledTimes(0);

    fireEvent.click(groupButton("resources"));
    await waitFor(() => expect(groupLinks("resources")).toHaveLength(3));

    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls).toEqual(["/api/workspaces/ws-1/codebases", "/api/canvas?workspaceId=ws-1"]);
    expect(groupLinks("resources").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Feature explorer", "/workspace/ws-1/feature-explorer"],
      ["Repo slides", "/workspace/ws-1/codebases/cb-1/reposlide"],
      ["Canvas", "/canvas/cv-9"],
    ]);
    expect(window.localStorage.getItem("routa.shell.nav.resources")).toBe("true");
  });

  it("does not refetch on remount", async () => {
    const { unmount } = render(<DesktopSidebar workspaceId="ws-1" />);
    fireEvent.click(groupButton("resources"));
    await waitFor(() => expect(groupLinks("resources")).toHaveLength(3));
    unmount();

    render(<DesktopSidebar workspaceId="ws-1" />);
    await waitFor(() => expect(groupLinks("resources")).toHaveLength(3));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hides repo slides and canvas when the workspace has none", async () => {
    mockApi([], []);
    render(<DesktopSidebar workspaceId="ws-1" />);
    await act(async () => {
      fireEvent.click(groupButton("resources"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(groupLinks("resources").map((link) => link.textContent)).toEqual(["Feature explorer"]);
  });

  it("hides the items quietly when the lookups fail", async () => {
    fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DesktopSidebar workspaceId="ws-1" />);
    await act(async () => {
      fireEvent.click(groupButton("resources"));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(groupLinks("resources").map((link) => link.textContent)).toEqual(["Feature explorer"]);
  });

  it("auto-expands resources on a repo slides page and marks it current", async () => {
    pathnameState.pathname = "/workspace/ws-1/codebases/cb-7/reposlide";
    render(<DesktopSidebar workspaceId="ws-1" />);

    expect(groupButton("resources").getAttribute("aria-expanded")).toBe("true");
    const current = within(group("resources")).getByRole("link", { name: "Repo slides" });
    expect(current.getAttribute("href")).toBe("/workspace/ws-1/codebases/cb-7/reposlide");
    expect(current.getAttribute("aria-current")).toBe("page");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
