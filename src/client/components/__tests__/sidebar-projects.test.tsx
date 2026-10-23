import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathnameState = vi.hoisted(() => ({ pathname: "/workspace/ws-routa/kanban" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameState.pathname,
  // Only for the kanban-overview import below; the sidebar itself never calls it.
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { DesktopSidebar } from "../desktop-sidebar";
import { resetSidebarNavGroupCache } from "../shell/sidebar-nav-groups";
import { resetSidebarWorkspacesCache } from "../shell/use-sidebar-workspaces";
import { useKanbanViewMode } from "@/app/workspace/[workspaceId]/kanban/kanban-overview";
import { I18nContext } from "@/i18n/context";
import zh from "@/i18n/locales/zh";

/** Same six active workspaces as routa.db, createdAt ascending in this order. */
const WORKSPACES = [
  { id: "default", title: "Default Workspace" },
  { id: "ws-topbi", title: "TopBI" },
  { id: "ws-routa", title: "Routa" },
  { id: "ws-dsh", title: "deepseek-harness" },
  { id: "ws-lt", title: "local-tools" },
  { id: "ws-turnilo", title: "turnilo" },
].map((workspace, index) => ({
  ...workspace,
  status: "active",
  metadata: {},
  createdAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;
let workspaceBody: () => Promise<Response> | Response;

function installFetch() {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/workspaces?status=active")) return workspaceBody();
    if (url.includes("/codebases")) return jsonResponse({ codebases: [] });
    if (url.includes("/canvas")) return jsonResponse({ canvasArtifacts: [] });
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
}

function workspaceCalls() {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes("/workspaces?status=active"));
}

function projects() {
  return screen.getByTestId("shell-sidebar-projects");
}

function projectLinks() {
  return within(projects()).queryAllByRole("link");
}

async function waitForRows(count: number) {
  await waitFor(() => expect(projectLinks()).toHaveLength(count));
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  window.localStorage.clear();
  resetSidebarNavGroupCache();
  resetSidebarWorkspacesCache();
  pathnameState.pathname = "/workspace/ws-routa/kanban";
  window.history.replaceState(null, "", "/workspace/ws-routa/kanban");
  workspaceBody = () => jsonResponse({ workspaces: WORKSPACES });
  installFetch();
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
  vi.unstubAllGlobals();
  delete (window as { __TAURI__?: unknown }).__TAURI__;
});

describe("Sidebar Projects group: list, order, highlight (AC2, AC3, C2)", () => {
  it("lists every active workspace, current first, the rest by createdAt, Default last", async () => {
    render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);

    expect(projectLinks().map((link) => link.textContent)).toEqual([
      "Routa",
      "TopBI",
      "deepseek-harness",
      "local-tools",
      "turnilo",
      "Default Workspace",
    ]);
    expect(projectLinks().map((link) => link.getAttribute("title"))).toEqual(projectLinks().map((link) => link.textContent));
    expect(projects().tagName).toBe("SECTION");
    const headingId = projects().getAttribute("aria-labelledby");
    expect(headingId && document.getElementById(headingId)?.textContent).toBe("Projects");
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getByRole("navigation").contains(projects())).toBe(false);
    expect(projects().closest("details")).toBeNull();
  });

  it("puts Default first when it is the current workspace", async () => {
    render(<DesktopSidebar workspaceId="default" />);
    await waitForRows(6);
    expect(projectLinks().map((link) => link.textContent)).toEqual([
      "Default Workspace",
      "TopBI",
      "Routa",
      "deepseek-harness",
      "local-tools",
      "turnilo",
    ]);
  });

  it("highlights only the current workspace, follows a rerender, and highlights none without one", async () => {
    const { rerender } = render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);
    const current = () => projectLinks().filter((link) => link.getAttribute("aria-current") === "true");

    expect(current().map((link) => link.textContent)).toEqual(["Routa"]);
    expect(current()[0].className).toContain("bg-accent-subtle");
    expect(current()[0].className).toContain("font-semibold");
    expect(projectLinks().some((link) => link.getAttribute("aria-current") === "page")).toBe(false);

    rerender(<DesktopSidebar workspaceId="ws-topbi" />);
    await waitFor(() => expect(current().map((link) => link.textContent)).toEqual(["TopBI"]));
    expect(projectLinks()[0].textContent).toBe("TopBI");

    rerender(<DesktopSidebar workspaceId={null} />);
    await waitFor(() => expect(current()).toHaveLength(0));
    expect(projectLinks()).toHaveLength(6);
  });

  it("keeps 20 workspaces in their own scroll container, outside the top entries and groups (AC7)", async () => {
    workspaceBody = () =>
      jsonResponse({
        workspaces: Array.from({ length: 20 }, (_, i) => ({
          id: `p-${i}`,
          title: `Project ${i}`,
          createdAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(),
        })),
      });
    render(<DesktopSidebar workspaceId="p-0" />);
    await waitForRows(20);

    const list = screen.getByTestId("shell-sidebar-projects-list");
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toContain("min-h-0");
    const developerButton = within(document.querySelector<HTMLElement>('[data-nav-group="developer"]')!).getByRole("button");
    expect(list.contains(developerButton)).toBe(false);
    expect(list.contains(screen.getByRole("link", { name: "Settings" }))).toBe(false);
    expect(screen.getByRole("navigation").className).toContain("shrink-0");
    expect(screen.getByTestId("desktop-shell-sidebar").className).toContain("overflow-hidden");
  });
});

describe("Sidebar workspace read: failure, sharing, re-read, side effects (C3)", () => {
  it.each([
    ["fetch throws", () => Promise.reject(new Error("offline"))],
    ["500 response", () => jsonResponse({ error: "boom" }, 500)],
    ["body is not JSON", () => new Response("<html>nope</html>", { status: 200 })],
    ["workspaces is not an array", () => jsonResponse({ session: {} })],
  ])("shows the empty text when %s, without throwing or unhandled rejections", async (_label, body) => {
    workspaceBody = body as () => Promise<Response>;
    render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitFor(() => expect(workspaceCalls()).toHaveLength(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(projects()).toBeTruthy();
    expect(within(projects()).getByText("No workspaces yet")).toBeTruthy();
    expect(projectLinks()).toHaveLength(0);
    expect(unhandled).toEqual([]);
  });

  it("shares one request between two sidebars and only sends GET /api/workspaces?status=active", async () => {
    render(
      <>
        <DesktopSidebar workspaceId="ws-routa" />
        <DesktopSidebar workspaceId="ws-routa" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId("shell-sidebar-projects")[1].querySelectorAll("a")).toHaveLength(6));

    expect(workspaceCalls()).toHaveLength(1);
    for (const [input, init] of fetchMock.mock.calls) {
      expect(String(input)).not.toContain("/api/kanban/boards");
      expect((init as RequestInit | undefined)?.method ?? "GET").toBe("GET");
    }
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(["/api/workspaces?status=active"]);
  });

  it("re-reads once (not in a loop) when the current workspace is missing from the list", async () => {
    render(
      <>
        <DesktopSidebar workspaceId="ghost" />
        <DesktopSidebar workspaceId="ghost" />
      </>,
    );
    await waitFor(() => expect(workspaceCalls()).toHaveLength(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(workspaceCalls()).toHaveLength(2);
    expect(screen.getAllByTestId("shell-sidebar-projects")[0].querySelectorAll("a")).toHaveLength(6);
  });

  it("picks up a workspace created after the first read", async () => {
    const { rerender } = render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);
    workspaceBody = () =>
      jsonResponse({ workspaces: [...WORKSPACES, { id: "ws-new", title: "Fresh", createdAt: "2026-10-23T00:00:00.000Z" }] });
    rerender(<DesktopSidebar workspaceId="ws-new" />);
    await waitForRows(7);
    expect(projectLinks()[0].textContent).toBe("Fresh");
    expect(projectLinks()[0].getAttribute("aria-current")).toBe("true");
  });

  it("reads through the desktop backend base URL in the Tauri runtime (F4 ③)", async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    window.localStorage.setItem("routa.backendBaseUrl", "http://127.0.0.1:3210");
    render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);
    expect(workspaceCalls().map(([input]) => String(input))).toEqual(["http://127.0.0.1:3210/api/workspaces?status=active"]);
  });
});

describe("Sidebar project rows: switching (AC4, C4, C13)", () => {
  it("links to the same kind of page in the other workspace", async () => {
    pathnameState.pathname = "/workspace/ws-1/kanban";
    const { unmount } = render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);
    expect(within(projects()).getByRole("link", { name: "TopBI" }).getAttribute("href")).toBe("/workspace/ws-topbi/kanban");
    unmount();

    pathnameState.pathname = "/workspace/ws-1/sessions/s-9";
    render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);
    expect(within(projects()).getByRole("link", { name: "TopBI" }).getAttribute("href")).toBe("/workspace/ws-topbi/sessions");
  });

  it("uses a plain full-reload anchor on the harness page", async () => {
    pathnameState.pathname = "/settings/harness";
    window.history.replaceState(null, "", "/settings/harness?section=s");
    render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);
    const row = within(projects()).getByRole("link", { name: "TopBI" });
    expect(row.tagName).toBe("A");
    expect(row.getAttribute("data-full-reload")).toBe("true");
    expect(row.getAttribute("href")).toBe("/settings/harness?workspaceId=ws-topbi&section=s");
    expect(within(projects()).getByRole("link", { name: "Routa" }).getAttribute("data-full-reload")).toBe("true");
  });

  it("uses next/link rows (no full reload) on the board", async () => {
    render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);
    expect(projectLinks().every((link) => link.getAttribute("data-full-reload") === null)).toBe(true);
  });

  it("remembers the clicked workspace as the last workspace", async () => {
    render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);
    fireEvent.click(within(projects()).getByRole("link", { name: "TopBI" }));
    expect(window.localStorage.getItem("routa.desktop.last-workspace-id")).toBe("ws-topbi");
  });

  it("re-reads a query-only URL change on hover or focus", async () => {
    pathnameState.pathname = "/settings";
    window.history.replaceState(null, "", "/settings?tab=a");
    render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);
    const row = () => within(projects()).getByRole("link", { name: "TopBI" });
    expect(row().getAttribute("href")).toBe("/settings?workspaceId=ws-topbi&tab=a");

    window.history.replaceState(null, "", "/settings?tab=b");
    fireEvent.pointerEnter(projects());
    expect(row().getAttribute("href")).toBe("/settings?workspaceId=ws-topbi&tab=b");

    window.history.replaceState(null, "", "/settings?tab=c");
    fireEvent.focus(row());
    expect(row().getAttribute("href")).toBe("/settings?workspaceId=ws-topbi&tab=c");
  });
});

function ViewProbe() {
  const { view } = useKanbanViewMode();
  return <output data-testid="kanban-view-probe">{view}</output>;
}

describe("Workspaces / All projects row (AC5, C5)", () => {
  it("is visible without any click and links to the all-projects board view", () => {
    const { unmount } = render(<DesktopSidebar workspaceId="ws-1" />);
    const link = screen.getByRole("link", { name: "All projects" });
    expect(link.getAttribute("href")).toBe("/workspace/ws-1/kanban?view=all");
    expect(link.parentElement?.textContent).toContain("Workspaces");
    unmount();

    render(<DesktopSidebar workspaceId={null} />);
    expect(screen.getByRole("link", { name: "All projects" }).getAttribute("href")).toBe("/workspace/default/kanban?view=all");
  });

  it("switches the board already on screen to the all-projects view", () => {
    pathnameState.pathname = "/workspace/ws-1/kanban";
    window.history.replaceState(null, "", "/workspace/ws-1/kanban?card=c-1");
    render(
      <>
        <DesktopSidebar workspaceId="ws-1" />
        <ViewProbe />
      </>,
    );
    expect(screen.getByTestId("kanban-view-probe").textContent).toBe("board");

    fireEvent.click(screen.getByRole("link", { name: "All projects" }));
    expect(screen.getByTestId("kanban-view-probe").textContent).toBe("all");
    expect(new URLSearchParams(window.location.search).get("card")).toBe("c-1");
  });
});

describe("Projects group in Chinese (F4 ④)", () => {
  it("uses the zh copy for heading, region and the all-projects link", async () => {
    render(
      <I18nContext value={{ locale: "zh", setLocale: () => {}, t: zh }}>
        <DesktopSidebar workspaceId="ws-routa" />
      </I18nContext>,
    );
    await waitForRows(6);
    const headingId = projects().getAttribute("aria-labelledby");
    expect(headingId && document.getElementById(headingId)?.textContent).toBe("项目");
    expect(screen.getByRole("list", { name: "项目列表" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "全部项目" })).toBeTruthy();
    expect(screen.getByText("工作区")).toBeTruthy();
  });

  it("uses the en copy for the region label", async () => {
    render(<DesktopSidebar workspaceId="ws-routa" />);
    await waitForRows(6);
    expect(screen.getByRole("list", { name: "Project list" })).toBeTruthy();
  });
});
