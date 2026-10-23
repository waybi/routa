/**
 * Card c908dc70: count badge on the "Needs you" nav entry.
 * Contract items C2 (display), C3 (not ready), C4 (scope), C5 (hide /
 * restore / storage), C6 (request budget), C10 (error), C11 (minute clock).
 * Expected numbers are written out from the requirement, not computed by the
 * code under test.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KanbanBoardInfo, TaskInfo } from "@/app/workspace/[workspaceId]/types";
import { I18nProvider } from "@/i18n";
import {
  attentionDismissalsStorageKey,
  dismissAttentionItem,
  resetAttentionDismissalsForTests,
  restoreAttentionItem,
} from "@/app/workspace/[workspaceId]/kanban/use-kanban-attention-dismissals";
import type { OverviewWorkspaceData } from "@/app/workspace/[workspaceId]/kanban/use-kanban-overview-data";

const nav = vi.hoisted(() => ({ pathname: "/workspace/ws1/kanban" }));
const clock = vi.hoisted(() => ({ now: Date.UTC(2026, 9, 21, 12) as number | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
}));
vi.mock("@/client/components/home/relative-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client/components/home/relative-time")>();
  return {
    ...actual,
    useMinuteClock: () => {
      const real = actual.useMinuteClock();
      return clock.now === null ? real : clock.now;
    },
  };
});

import { InboxBadgeDataProvider } from "../inbox-badge-data-context";
import { InboxNavBadge, InboxNavBadgeView } from "../inbox-nav-badge";
import { DesktopSidebar } from "../../desktop-sidebar";
import { DesktopNavRail } from "../../desktop-nav-rail";

const NOW = Date.UTC(2026, 9, 21, 12);

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();
  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
}

function board(id: string): KanbanBoardInfo {
  return {
    id,
    name: id,
    isDefault: true,
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "done", name: "Done", position: 1, stage: "done" },
      { id: "blocked", name: "Blocked", position: 2, stage: "blocked" },
    ],
  } as unknown as KanbanBoardInfo;
}

/** `n` blocked cards on board `<ws>-b`: each is exactly one Needs-you row. */
function blocked(ws: string, n: number): TaskInfo[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `${ws}-c${index}`,
    title: `${ws} card ${index}`,
    status: "PENDING",
    boardId: `${ws}-b`,
    columnId: "blocked",
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    updatedAt: new Date(NOW - 3_600_000).toISOString(),
  }) as unknown as TaskInfo);
}

function ready(ws: string, n: number): OverviewWorkspaceData {
  return { status: "ready", tasks: blocked(ws, n), boards: [board(`${ws}-b`)] };
}

const WS = [{ id: "ws1", title: "One" }, { id: "ws2", title: "Two" }, { id: "default", title: "Default" }];
const fetchCalls: Array<{ url: string; method: string }> = [];
let serverData: Record<string, { tasks: TaskInfo[]; boards: KanbanBoardInfo[] }>;

beforeEach(() => {
  nav.pathname = "/workspace/ws1/kanban";
  clock.now = NOW;
  window.history.replaceState(null, "", "/workspace/ws1/kanban");
  window.localStorage.clear();
  resetAttentionDismissalsForTests();
  MockEventSource.instances = [];
  fetchCalls.length = 0;
  serverData = {
    ws1: { tasks: blocked("ws1", 2), boards: [board("ws1-b")] },
    ws2: { tasks: blocked("ws2", 3), boards: [board("ws2-b")] },
    default: { tasks: blocked("default", 4), boards: [board("default-b")] },
  };
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase() });
    const parsed = new URL(String(url), "http://localhost");
    const ws = parsed.searchParams.get("workspaceId") ?? "";
    if (parsed.pathname === "/api/tasks") return Promise.resolve(Response.json({ tasks: serverData[ws]?.tasks ?? [] }));
    if (parsed.pathname === "/api/kanban/boards") return Promise.resolve(Response.json({ boards: serverData[ws]?.boards ?? [] }));
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function withLocale(locale: "en" | "zh") {
  window.localStorage.setItem("routa.locale", locale);
}

function provided(data: Record<string, OverviewWorkspaceData | undefined>, options: { workspacesLoading?: boolean; workspaces?: typeof WS } = {}) {
  return function ProvidedBadgeData({ children }: { children: React.ReactNode }) {
    return (
      <I18nProvider>
        <InboxBadgeDataProvider workspaces={options.workspaces ?? WS} workspacesLoading={options.workspacesLoading ?? false} data={data}>
          {children}
        </InboxBadgeDataProvider>
      </I18nProvider>
    );
  };
}

function badge(): HTMLElement | null {
  return screen.queryByTestId("inbox-nav-badge");
}

describe("C2 display: number, 99+, aria-label, only on the inbox entry", () => {
  const cases: Array<[number, string]> = [[1, "1"], [3, "3"], [99, "99"], [100, "99+"], [120, "99+"]];

  for (const variant of ["row", "rail"] as const) {
    for (const [count, text] of cases) {
      it(`${variant}: ${count} → "${text}" (en + zh labels)`, () => {
        withLocale("en");
        const view = render(<I18nProvider><InboxNavBadgeView count={count} variant={variant} /></I18nProvider>);
        expect(badge()?.textContent).toBe(text);
        // aria-label always carries the real count, also above 99.
        expect(badge()?.getAttribute("aria-label")).toBe(`Needs you, ${count} items`);
        view.unmount();
        withLocale("zh");
        render(<I18nProvider><InboxNavBadgeView count={count} variant={variant} /></I18nProvider>);
        expect(badge()?.getAttribute("aria-label")).toBe(`需要你处理，${count} 项`);
        const className = badge()?.className ?? "";
        for (const token of ["bg-danger", "text-on-accent", "rounded-full"]) expect(className).toContain(token);
        if (variant === "rail") expect(className).toContain("absolute");
        else expect(className).toContain("ml-auto");
      });
    }
  }

  it("sidebar: 0 rows → no badge on any entry", () => {
    serverData.ws1.tasks = [];
    render(<DesktopSidebar workspaceId="ws1" />, { wrapper: provided({ ws1: ready("ws1", 0) }) });
    expect(badge()).toBeNull();
  });

  it("sidebar: 3 rows → badge only on the Needs-you link", () => {
    render(<DesktopSidebar workspaceId="ws1" />, { wrapper: provided({ ws1: ready("ws1", 3) }) });
    const links = within(screen.getByRole("navigation")).getAllByRole("link").slice(0, 7);
    const withBadge = links.filter((link) => within(link).queryByTestId("inbox-nav-badge"));
    expect(withBadge.map((link) => link.getAttribute("data-nav-id"))).toEqual(["inbox"]);
    expect(within(withBadge[0]).getByTestId("inbox-nav-badge").textContent).toBe("3");
    expect(within(withBadge[0]).getByTestId("inbox-nav-badge").getAttribute("aria-label")).toBe("Needs you, 3 items");
  });

  it("sidebar: 120 rows → 99+", () => {
    render(<DesktopSidebar workspaceId="ws1" />, { wrapper: provided({ ws1: ready("ws1", 120) }) });
    expect(badge()?.textContent).toBe("99+");
  });

  it("sidebar drawer (narrow screen) open: badge still rendered inside the drawer", () => {
    render(<DesktopSidebar workspaceId="ws1" drawerOpen onDrawerClose={vi.fn()} />, { wrapper: provided({ ws1: ready("ws1", 2) }) });
    const aside = screen.getByTestId("desktop-shell-sidebar");
    expect(aside.dataset.drawerOpen).toBe("true");
    expect(within(aside).getByTestId("inbox-nav-badge").textContent).toBe("2");
  });

  it("nav rail: 0 rows → no badge; 4 rows → badge on the inbox icon's top-right corner", () => {
    const view = render(<DesktopNavRail workspaceId="ws1" />, { wrapper: provided({ ws1: ready("ws1", 0) }) });
    expect(badge()).toBeNull();
    view.unmount();
    render(<DesktopNavRail workspaceId="ws1" />, { wrapper: provided({ ws1: ready("ws1", 4) }) });
    const el = badge();
    expect(el?.textContent).toBe("4");
    expect(el?.className).toContain("absolute");
    const link = el?.closest("a");
    expect(link?.getAttribute("href")).toBe("/workspace/ws1/overview");
    expect(link?.className).toContain("relative");
    expect(screen.getAllByTestId("inbox-nav-badge")).toHaveLength(1);
  });
});

describe("C3 not ready → no badge", () => {
  it("now === 0 (not hydrated)", () => {
    clock.now = 0;
    render(<InboxNavBadge workspaceId="ws1" variant="row" />, { wrapper: provided({ ws1: ready("ws1", 3) }) });
    expect(badge()).toBeNull();
  });

  it("workspace list still loading", () => {
    render(<InboxNavBadge workspaceId="ws1" variant="row" />, { wrapper: provided({ ws1: ready("ws1", 3) }, { workspacesLoading: true }) });
    expect(badge()).toBeNull();
  });

  it("data for the workspace missing", () => {
    render(<InboxNavBadge workspaceId="ws1" variant="row" />, { wrapper: provided({}) });
    expect(badge()).toBeNull();
  });

  it("workspace status loading, then ready shows the number", () => {
    const loading: OverviewWorkspaceData = { ...ready("ws1", 3), status: "loading" };
    const view = render(<InboxNavBadge workspaceId="ws1" variant="row" />, { wrapper: provided({ ws1: loading }) });
    expect(badge()).toBeNull();
    view.rerender(<InboxNavBadge workspaceId="ws1" variant="row" />);
    view.unmount();
    render(<InboxNavBadge workspaceId="ws1" variant="row" />, { wrapper: provided({ ws1: ready("ws1", 3) }) });
    expect(badge()?.textContent).toBe("3");
  });

  it("ready but 0 rows", () => {
    render(<InboxNavBadge workspaceId="ws1" variant="row" />, { wrapper: provided({ ws1: ready("ws1", 0) }) });
    expect(badge()).toBeNull();
  });

  it("server render has no badge (the real minute clock is 0 on the server)", () => {
    clock.now = null;
    const Wrapper = provided({ ws1: ready("ws1", 3) });
    const html = renderToString(<Wrapper><InboxNavBadge workspaceId="ws1" variant="row" /></Wrapper>);
    expect(html).not.toContain("inbox-nav-badge");
    expect(html).not.toContain("Needs you,");
  });
});

describe("C4 scope", () => {
  // ws1 has 2 rows, ws2 has 3, default has 4.
  const data = { ws1: ready("ws1", 2), ws2: ready("ws2", 3), default: ready("default", 4) };
  const cases: Array<[string, string, string | null, string]> = [
    ["(a) Needs-you page, this workspace", "/workspace/ws1/overview", "ws1", "2"],
    ["(b) Needs-you page, view=all", "/workspace/ws1/overview?view=all", "ws1", "9"],
    ["(c) board all-projects view=all still counts this workspace", "/workspace/ws1/kanban?view=all", "ws1", "2"],
    ["(d) board", "/workspace/ws1/kanban", "ws1", "2"],
    ["(e) no workspace id → default", "/settings", null, "4"],
  ];
  for (const [name, url, workspaceId, expected] of cases) {
    it(name, () => {
      const [pathname] = url.split("?");
      nav.pathname = pathname;
      window.history.replaceState(null, "", url);
      render(<InboxNavBadge workspaceId={workspaceId} variant="row" />, { wrapper: provided(data) });
      expect(badge()?.textContent).toBe(expected);
    });
  }

  it("(b) equals the Needs-you page count when only ws1 + ws2 exist", () => {
    nav.pathname = "/workspace/ws1/overview";
    window.history.replaceState(null, "", "/workspace/ws1/overview?view=all");
    render(<InboxNavBadge workspaceId="ws1" variant="row" />, {
      wrapper: provided({ ws1: ready("ws1", 2), ws2: ready("ws2", 3) }, { workspaces: WS.slice(0, 2) }),
    });
    expect(badge()?.textContent).toBe("5");
  });
});

describe("C5 hide / restore / other tab", () => {
  it("3 → 2 → 3 on dismiss and restore, without fetching", () => {
    render(<InboxNavBadge workspaceId="ws1" variant="row" />, { wrapper: provided({ ws1: ready("ws1", 3) }) });
    expect(badge()?.textContent).toBe("3");
    const before = fetchCalls.length;
    act(() => dismissAttentionItem("ws1-b", "ws1-c0|blocked|0"));
    expect(badge()?.textContent).toBe("2");
    act(() => dismissAttentionItem("ws1-b", "ws1-c0|blocked|0"));
    expect(badge()?.textContent).toBe("2");
    act(() => restoreAttentionItem("ws1-b", "ws1-c0|blocked|0"));
    expect(badge()?.textContent).toBe("3");
    expect(fetchCalls.length).toBe(before);
  });

  it("a storage event from another tab recounts", () => {
    render(<InboxNavBadge workspaceId="ws1" variant="row" />, { wrapper: provided({ ws1: ready("ws1", 3) }) });
    expect(badge()?.textContent).toBe("3");
    act(() => {
      window.localStorage.setItem(attentionDismissalsStorageKey("ws1-b"), JSON.stringify(["ws1-c1|blocked|0"]));
      window.dispatchEvent(new StorageEvent("storage", { key: attentionDismissalsStorageKey("ws1-b") }));
    });
    expect(badge()?.textContent).toBe("2");
  });
});

describe("C6 request budget", () => {
  it("(a) with page data: 0 fetches, 0 EventSource", async () => {
    render(<DesktopSidebar workspaceId="ws1" />, { wrapper: provided({ ws1: ready("ws1", 3) }) });
    await act(async () => {});
    expect(fetchCalls).toEqual([]);
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("(b)+(c) without page data: only ws1 tasks + boards once each, GET only, stable across re-renders", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <I18nProvider>{children}</I18nProvider>;
    const view = render(<InboxNavBadge workspaceId="ws1" variant="row" />, { wrapper });
    await waitFor(() => expect(badge()?.textContent).toBe("2"));
    for (let i = 0; i < 5; i += 1) view.rerender(<InboxNavBadge workspaceId="ws1" variant="row" />);
    await act(async () => {});
    expect(fetchCalls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /api/kanban/boards?workspaceId=ws1",
      "GET /api/tasks?workspaceId=ws1",
    ]);
    expect(fetchCalls.some((call) => call.url.includes("revive"))).toBe(false);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toContain("/api/kanban/events");
  });

  it("without page data on a page with no workspace id: loads default only", async () => {
    nav.pathname = "/settings";
    render(<InboxNavBadge workspaceId={null} variant="row" />, { wrapper: ({ children }) => <I18nProvider>{children}</I18nProvider> });
    await waitFor(() => expect(badge()?.textContent).toBe("4"));
    expect(fetchCalls.map((call) => call.url).sort()).toEqual([
      "/api/kanban/boards?workspaceId=default",
      "/api/tasks?workspaceId=default",
    ]);
  });
});

describe("C10 / C11 spot checks", () => {
  it("C10: an errored workspace keeps its last rows, like the Needs-you page", () => {
    const errored: OverviewWorkspaceData = { ...ready("ws1", 2), status: "error" };
    render(<InboxNavBadge workspaceId="ws1" variant="row" />, { wrapper: provided({ ws1: errored }) });
    expect(badge()?.textContent).toBe("2");
  });

  it("C11: a minute later a Done card leaves the 7-day window and the badge follows", () => {
    const doneTask = {
      id: "old",
      title: "Old",
      status: "COMPLETED",
      boardId: "ws1-b",
      columnId: "done",
      createdAt: new Date(NOW - 8 * 86_400_000).toISOString(),
      updatedAt: new Date(NOW - 7 * 86_400_000).toISOString(),
      laneSessions: [{ sessionId: "d", columnId: "done", startedAt: new Date(NOW - 7 * 86_400_000 + 30_000).toISOString(), completedAt: new Date(NOW - 7 * 86_400_000 + 40_000).toISOString(), status: "failed" }],
    } as unknown as TaskInfo;
    const data = { ws1: { status: "ready" as const, tasks: [...blocked("ws1", 1), doneTask], boards: [board("ws1-b")] } };
    const Wrapper = provided(data);
    const view = render(<Wrapper><InboxNavBadge workspaceId="ws1" variant="row" /></Wrapper>);
    expect(badge()?.textContent).toBe("2");
    clock.now = NOW + 60_000;
    view.rerender(<Wrapper><InboxNavBadge workspaceId="ws1" variant="row" /></Wrapper>);
    expect(badge()?.textContent).toBe("1");
  });
});
