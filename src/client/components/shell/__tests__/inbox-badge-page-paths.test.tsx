/**
 * Card c908dc70, contract F4 (new effect on every path) and F2 (7): each page
 * that already loads tasks / boards hands them to the badge, so the number
 * is right and the page's request list is the same with or without the
 * badge. The shell is replaced by a stub that renders the real badge.
 */
import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KanbanBoardInfo, TaskInfo } from "@/app/workspace/[workspaceId]/types";
import { resetAttentionDismissalsForTests } from "@/app/workspace/[workspaceId]/kanban/use-kanban-attention-dismissals";

const NOW = Date.UTC(2026, 9, 21, 12);

const nav = vi.hoisted(() => ({ pathname: "/workspace/ws1/overview", workspaceId: "ws1", search: new URLSearchParams() }));
const shell = vi.hoisted(() => ({ withBadge: true }));
const acp = vi.hoisted(() => ({ connected: true, loading: false, providers: [], connect: () => {}, promptSession: async () => {} }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useParams: () => ({ workspaceId: nav.workspaceId }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ get: (key: string) => nav.search.get(key) }),
}));
vi.mock("@/client/components/home/relative-time", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client/components/home/relative-time")>();
  return { ...actual, useMinuteClock: () => NOW };
});
vi.mock("@/client/components/desktop-app-shell", async () => {
  const { InboxNavBadge } = await import("../inbox-nav-badge");
  return {
    DesktopAppShell: ({ children, workspaceId }: { children: ReactNode; workspaceId?: string | null }) => (
      <div data-testid="shell-stub" data-workspace-id={workspaceId ?? ""}>
        <nav data-testid="nav-stub">{shell.withBadge ? <InboxNavBadge workspaceId={workspaceId} variant="row" /> : null}</nav>
        {children}
      </div>
    ),
  };
});
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("@/client/hooks/use-acp", () => ({ useAcp: () => acp }));
vi.mock("@/client/hooks/use-kanban-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client/hooks/use-kanban-events")>();
  return { ...actual, useKanbanEvents: () => {} };
});
vi.mock("@/app/workspace/[workspaceId]/kanban/kanban-tab", () => ({ KanbanTab: () => <div data-testid="kanban-tab-stub" /> }));
vi.mock("@/app/workspace/[workspaceId]/kanban/use-task-lifecycle-notifications", () => ({ useTaskLifecycleNotifications: () => () => {} }));
vi.mock("@/client/components/settings-panel", () => ({
  SettingsPanel: () => null,
  loadDefaultProviders: () => ({}),
  loadDockerOpencodeAuthJson: () => "",
  loadProviderConnections: () => ({}),
}));
vi.mock("@/client/components/repo-picker", () => ({ RepoPicker: () => null, shortenRepoPath: (value: string) => value }));
vi.mock("@/client/components/home/onboarding-card", () => ({ OnboardingCard: () => null }));

import { InboxPageClient } from "@/app/workspace/[workspaceId]/overview/inbox-page-client";
import { KanbanPageClient } from "@/app/workspace/[workspaceId]/kanban/kanban-page-client";
import HomePage from "@/app/page";

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
      { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
    ],
  } as unknown as KanbanBoardInfo;
}

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

const DATA: Record<string, { tasks: TaskInfo[]; boards: KanbanBoardInfo[] }> = {
  ws1: { tasks: blocked("ws1", 2), boards: [board("ws1-b")] },
  ws2: { tasks: blocked("ws2", 3), boards: [board("ws2-b")] },
};
const calls: Array<{ url: string; method: string }> = [];

function respond(url: string): Response {
  const parsed = new URL(url, "http://localhost");
  const ws = parsed.searchParams.get("workspaceId") ?? "";
  switch (parsed.pathname) {
    case "/api/workspaces":
      return Response.json({ workspaces: [["ws1", "One"], ["ws2", "Two"]].map(([id, title]) => ({ id, title, status: "active", metadata: {}, createdAt: "", updatedAt: "" })) });
    case "/api/tasks":
      return Response.json({ tasks: DATA[ws]?.tasks ?? [] });
    case "/api/kanban/boards":
      return Response.json({ boards: DATA[ws]?.boards ?? [] });
    default:
      return Response.json({});
  }
}

beforeEach(() => {
  shell.withBadge = true;
  calls.length = 0;
  MockEventSource.instances = [];
  window.localStorage.clear();
  window.localStorage.setItem("routa.onboarding.completed", "true");
  resetAttentionDismissalsForTests();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase() });
    return Promise.resolve(respond(String(url)));
  }));
});

afterEach(() => vi.unstubAllGlobals());

function at(pathname: string, search = "") {
  nav.pathname = pathname;
  nav.workspaceId = pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? "";
  nav.search = new URLSearchParams(search);
  window.history.replaceState(null, "", `${pathname}${search}`);
}

function badgeText(): string | null {
  return within(screen.getByTestId("nav-stub")).queryByTestId("inbox-nav-badge")?.textContent ?? null;
}

/** Sorted "METHOD path?query" list after the page settles, plus EventSource count. */
async function requestsFor(ui: () => ReactNode, settle: () => Promise<void>) {
  calls.length = 0;
  MockEventSource.instances = [];
  const view = render(<>{ui()}</>);
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const list = calls.map((call) => `${call.method} ${call.url}`).sort();
  const sources = MockEventSource.instances.length;
  view.unmount();
  return { list, sources };
}

describe("F4 / F2(7) every page path", () => {
  it("Needs-you page, this workspace: badge = page rows (2), no extra requests", async () => {
    at("/workspace/ws1/overview");
    render(<InboxPageClient now={NOW} />);
    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(2));
    expect(badgeText()).toBe("2");
  });

  it("Needs-you page, view=all: badge = page rows (5)", async () => {
    at("/workspace/ws1/overview", "?view=all");
    render(<InboxPageClient now={NOW} />);
    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(5));
    expect(badgeText()).toBe("5");
  });

  it("Needs-you page request list is identical with and without the badge", async () => {
    at("/workspace/ws1/overview", "?view=all");
    const settle = () => waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(5));
    shell.withBadge = false;
    const before = await requestsFor(() => <InboxPageClient now={NOW} />, settle);
    shell.withBadge = true;
    const after = await requestsFor(() => <InboxPageClient now={NOW} />, async () => {
      await settle();
      await waitFor(() => expect(badgeText()).toBe("5"));
    });
    expect(after).toEqual(before);
    expect(after.list.every((entry) => entry.startsWith("GET "))).toBe(true);
  });

  it("board page: badge counts the board's own tasks (2), request list unchanged", async () => {
    at("/workspace/ws1/kanban");
    const settle = () => waitFor(() => expect(calls.some((call) => call.url.includes("/api/tasks"))).toBe(true));
    shell.withBadge = false;
    const before = await requestsFor(() => <KanbanPageClient />, settle);
    shell.withBadge = true;
    const after = await requestsFor(() => <KanbanPageClient />, async () => {
      await waitFor(() => expect(badgeText()).toBe("2"));
    });
    expect(after).toEqual(before);
    expect(after.sources).toBe(0);
  });

  it("board page all-projects view (view=all) still counts this workspace only", async () => {
    at("/workspace/ws1/kanban", "?view=all");
    render(<KanbanPageClient />);
    await waitFor(() => expect(badgeText()).toBe("2"));
  });

  it("home: badge counts the shell's workspace from the home overview data, request list unchanged", async () => {
    at("/");
    const settle = () => waitFor(() => expect(screen.getAllByTestId("home-workspace-card").length).toBe(2));
    shell.withBadge = false;
    const before = await requestsFor(() => <HomePage />, settle);
    shell.withBadge = true;
    const after = await requestsFor(() => <HomePage />, async () => {
      await settle();
      await waitFor(() => expect(badgeText()).toBe("2"));
      // Same workspace id as the one the shell received.
      expect(screen.getByTestId("shell-stub").getAttribute("data-workspace-id")).toBe("ws1");
    });
    expect(after).toEqual(before);
  });
});
