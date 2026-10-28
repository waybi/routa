import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ workspaceId: "w1" }),
}));

import { KanbanOverview } from "../kanban-overview";
import { __resetKanbanOverviewCacheForTests } from "../use-kanban-overview-data";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import { I18nContext } from "@/i18n/context";
import { KanbanTabContent } from "../kanban-tab-content";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();
  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
}

const NOW = Date.UTC(2026, 9, 21, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

function board(id: string, workspaceId: string): KanbanBoardInfo {
  return {
    id,
    workspaceId,
    name: id,
    isDefault: true,
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
      { id: "done", name: "Done", position: 2, stage: "done", automation: { enabled: true, steps: [{ id: "p", specialistId: "kanban-main-pusher" }] } },
    ],
    createdAt: iso(0),
    updatedAt: iso(0),
  };
}

function task(id: string, workspaceId: string, boardId: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: `Card ${id}`,
    status: "PENDING",
    columnId: "dev",
    boardId,
    workspaceId,
    createdAt: iso(NOW - 40 * DAY),
    updatedAt: iso(NOW - HOUR),
    ...overrides,
  } as TaskInfo;
}

const DATA: Record<string, { tasks: TaskInfo[]; boards: KanbanBoardInfo[] }> = {
  w1: { tasks: [task("t1", "w1", "b1")], boards: [board("b1", "w1")] },
  w2: {
    tasks: [
      task("t2", "w2", "b2", { columnId: "blocked" }),
      task("old", "w2", "b2", {
        title: "Old shipped card",
        columnId: "done",
        status: "COMPLETED",
        laneSessions: [{ sessionId: "s", columnId: "done", startedAt: iso(NOW - 30 * DAY), status: "completed" }],
        completionReport: { excerpt: "shipped thing", commit: "c0ffee9876543", hasLeftover: false, createdAt: iso(NOW - 30 * DAY) },
        deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 },
      }),
    ],
    boards: [board("b2", "w2")],
  },
  w3: { tasks: [], boards: [board("b3", "w3")] },
};

let failTasksFor: string | null = null;

function respond(url: string): Response {
  const parsed = new URL(url, "http://localhost");
  const ws = parsed.searchParams.get("workspaceId") ?? "";
  if (parsed.pathname === "/api/workspaces") {
    return Response.json({
      workspaces: ["w1", "w2", "w3"].map((id) => ({ id, title: `Space ${id}`, status: "active", metadata: {}, createdAt: iso(0), updatedAt: iso(0) })),
    });
  }
  if (parsed.pathname === "/api/tasks") {
    if (failTasksFor === ws) return new Response("boom", { status: 500 });
    return Response.json({ tasks: DATA[ws]?.tasks ?? [] });
  }
  if (parsed.pathname === "/api/kanban/boards") return Response.json({ boards: DATA[ws]?.boards ?? [] });
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  __resetKanbanOverviewCacheForTests();
  failTasksFor = null;
  routerPush.mockReset();
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => respond(url)));
  window.history.replaceState(null, "", "/workspace/w1/kanban?view=all");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function rowOf(workspaceId: string): HTMLElement {
  return screen.getAllByTestId("kanban-overview-row").find((row) => row.getAttribute("data-workspace-id") === workspaceId)!;
}

async function renderOverview(onShowBoard = vi.fn()) {
  render(<KanbanOverview onShowBoard={onShowBoard} now={NOW} />);
  await waitFor(() => expect(within(rowOf("w2")).getAllByTestId("kanban-overview-card").length).toBeGreaterThan(0));
  return onShowBoard;
}

type TabContentProps = ComponentProps<typeof KanbanTabContent>;

function renderTabContent(wrap: (node: ReactNode) => ReactNode = (node) => node) {
  const props = {
    headerProps: {
      tasksCount: 0,
      board: null,
      boards: [],
      selectedBoardId: null,
      onSelectBoard: vi.fn(),
      onOpenGitHubImport: vi.fn(),
      onRefresh: vi.fn(),
    },
    headerActionProps: {} as TabContentProps["headerActionProps"],
    codebaseModalProps: {} as TabContentProps["codebaseModalProps"],
  } as unknown as TabContentProps;
  return render(<>{wrap(<KanbanTabContent {...props} />)}</>);
}

describe("view toggle (AC1)", () => {
  it("writes view=all, keeps boardId/taskId, restores after reload, removes view on switch back", async () => {
    window.history.replaceState(null, "", "/workspace/w1/kanban?boardId=b1&taskId=t9");
    const first = renderTabContent();
    expect(screen.queryByTestId("kanban-overview")).toBeNull();
    expect(screen.getByTestId("kanban-view-toggle-board").getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByTestId("kanban-view-toggle-all"));
    const params = new URLSearchParams(window.location.search);
    expect(params.get("view")).toBe("all");
    expect(params.get("boardId")).toBe("b1");
    expect(params.get("taskId")).toBe("t9");
    expect(screen.getByTestId("kanban-overview")).toBeTruthy();
    expect(screen.getByTestId("kanban-view-toggle-all").getAttribute("aria-pressed")).toBe("true");
    first.unmount();

    // "Reload": a fresh mount reads view=all from the URL.
    renderTabContent();
    expect(screen.getByTestId("kanban-overview")).toBeTruthy();
    fireEvent.click(screen.getByTestId("kanban-view-toggle-board"));
    expect(window.location.search).toBe("?boardId=b1&taskId=t9");
    expect(screen.queryByTestId("kanban-overview")).toBeNull();
    await waitFor(() => expect(MockEventSource.instances.every((source) => source.close.mock.calls.length > 0)).toBe(true));
  });
});

describe("view toggle order: all projects first, this board second", () => {
  const toggleOrder = () => within(screen.getByTestId("kanban-view-toggle")).getAllByRole("button");
  const expectAllFirst = () => {
    expect(toggleOrder().map((b) => b.getAttribute("data-testid"))).toEqual(["kanban-view-toggle-all", "kanban-view-toggle-board"]);
  };

  it.each([["en", en], ["zh", zh]] as const)("renders all before board in DOM order with %s labels", (lang, dict) => {
    window.history.replaceState(null, "", "/workspace/w1/kanban");
    renderTabContent((node) => (
      <I18nContext.Provider value={{ locale: lang, setLocale: () => {}, t: dict }}>{node}</I18nContext.Provider>
    ));
    expectAllFirst();
    expect(toggleOrder().map((b) => b.textContent)).toEqual([dict.kanbanOverview.viewAll, dict.kanbanOverview.viewBoard]);
    // Default view is still this board.
    expect(screen.getByTestId("kanban-view-toggle-board").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("kanban-view-toggle-all").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps all projects first on every path: no view, after clicking all, direct ?view=all", () => {
    window.history.replaceState(null, "", "/workspace/w1/kanban?boardId=b1");
    const first = renderTabContent();
    expectAllFirst();
    fireEvent.click(screen.getByTestId("kanban-view-toggle-all"));
    expect(screen.getByTestId("kanban-view-toggle-all").getAttribute("aria-pressed")).toBe("true");
    expectAllFirst();
    first.unmount();

    window.history.replaceState(null, "", "/workspace/w1/kanban?view=all");
    renderTabContent();
    expect(screen.getByTestId("kanban-overview")).toBeTruthy();
    expect(screen.getByTestId("kanban-view-toggle-all").getAttribute("aria-pressed")).toBe("true");
    expectAllFirst();
  });
});

describe("view toggle cache", () => {
  it("switching back to all projects shows the last data at once, then refreshes in the background", async () => {
    window.history.replaceState(null, "", "/workspace/w1/kanban");
    renderTabContent();
    fireEvent.click(screen.getByTestId("kanban-view-toggle-all"));
    await waitFor(() => expect(within(rowOf("w2")).getAllByTestId("kanban-overview-card").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId("kanban-view-toggle-board"));
    expect(screen.queryByTestId("kanban-overview")).toBeNull();

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByTestId("kanban-view-toggle-all"));
    // Same render as the click: cards are back and no row says "loading".
    expect(within(rowOf("w2")).getAllByTestId("kanban-overview-card").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("kanban-overview-row").map((row) => row.getAttribute("data-workspace-id"))).toEqual(["w2", "w1", "w3"]);
    expect(screen.queryByText(en.kanbanOverview.loading)).toBeNull();
    await waitFor(() => expect(fetchMock.mock.calls.slice(before).map((call) => String(call[0]))).toEqual(
      expect.arrayContaining(["/api/tasks?workspaceId=w2", "/api/kanban/boards?workspaceId=w2"]),
    ));
  });
});

describe("KanbanOverview", () => {
  it("renders expanded rows by score and the empty workspace collapsed last (AC3 / AC4)", async () => {
    await renderOverview();
    await waitFor(() => expect(rowOf("w3").getAttribute("data-collapsed")).toBe("true"));
    const order = screen.getAllByTestId("kanban-overview-row").map((row) => row.getAttribute("data-workspace-id"));
    // w2: 1 in progress ×3 + 1 attention ×2 = 5; w1: 1 ×3 = 3; w3 collapsed.
    expect(order).toEqual(["w2", "w1", "w3"]);
    expect(within(rowOf("w2")).getByTestId("kanban-overview-attention").querySelector("[data-kind='blocked']")).toBeTruthy();
    expect(within(rowOf("w2")).getByTestId("kanban-overview-recent-done").textContent).not.toContain("shipped thing");
  });

  it("shows a retry only on the workspace whose request failed (AC2)", async () => {
    failTasksFor = "w2";
    render(<KanbanOverview onShowBoard={vi.fn()} now={NOW} />);
    await waitFor(() => expect(within(rowOf("w2")).getByTestId("kanban-overview-retry")).toBeTruthy());
    await waitFor(() => expect(within(rowOf("w1")).getAllByTestId("kanban-overview-card")).toHaveLength(1));
    expect(within(rowOf("w1")).queryByTestId("kanban-overview-retry")).toBeNull();

    failTasksFor = null;
    fireEvent.click(within(rowOf("w2")).getByTestId("kanban-overview-retry"));
    await waitFor(() => expect(within(rowOf("w2")).queryByTestId("kanban-overview-retry")).toBeNull());
  });

  it("opens a card of the current workspace via pushState + popstate (AC5)", async () => {
    const onShowBoard = await renderOverview();
    const seen: string[] = [];
    const listener = () => seen.push(`${window.location.pathname}${window.location.search}`);
    window.addEventListener("popstate", listener);
    fireEvent.click(within(rowOf("w1")).getAllByTestId("kanban-overview-card")[0]);
    // AC4 ③: the click opens the drawer; the full page starts from its button.
    fireEvent.click(await screen.findByTestId("kanban-overview-drawer-open"));
    window.removeEventListener("popstate", listener);
    expect(seen).toEqual(["/workspace/w1/kanban?boardId=b1&taskId=t1"]);
    expect(onShowBoard).toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("opens a card of the current workspace and leaves the overview in tab content (AC5)", async () => {
    renderTabContent();
    await waitFor(() => expect(within(rowOf("w1")).getAllByTestId("kanban-overview-card").length).toBe(1));
    fireEvent.click(within(rowOf("w1")).getAllByTestId("kanban-overview-card")[0]);
    fireEvent.click(await screen.findByTestId("kanban-overview-drawer-open"));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/workspace/w1/kanban?boardId=b1&taskId=t1");
    expect(screen.queryByTestId("kanban-overview")).toBeNull();
  });

  it("navigates to another workspace with router.push (AC5)", async () => {
    await renderOverview();
    const card = within(rowOf("w2")).getAllByTestId("kanban-overview-card").find((el) => el.getAttribute("data-task-id") === "t2")!;
    fireEvent.click(card);
    fireEvent.click(await screen.findByTestId("kanban-overview-drawer-open"));
    expect(routerPush).toHaveBeenCalledWith("/workspace/w2/kanban?boardId=b2&taskId=t2");
  });

  it("finds a 30-day-old Done card by commit across workspaces, with mark and hit count (AC6)", async () => {
    await renderOverview();
    const input = screen.getByTestId("kanban-board-search");
    act(() => {
      fireEvent.change(input, { target: { value: "c0ffee9" } });
    });
    const done = within(rowOf("w2")).getByTestId("kanban-overview-recent-done");
    expect(within(done).getByTestId("kanban-overview-recent-done-header").textContent).toContain("1");
    const hit = within(done).getAllByTestId("kanban-overview-card");
    expect(hit.map((el) => el.getAttribute("data-task-id"))).toEqual(["old"]);
    expect(within(hit[0]).getByTestId("kanban-search-mark").textContent).toBe("c0ffee9");
    expect(rowOf("w1").getAttribute("data-collapsed")).toBe("true");
    expect(screen.getAllByTestId("kanban-overview-row").map((row) => row.getAttribute("data-workspace-id"))[0]).toBe("w2");

    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
  });
});

describe("KanbanOverview interrupted badge", () => {
  it("lists an interrupted card under needs-you with the Interrupted badge", async () => {
    const original = DATA.w1.tasks;
    DATA.w1.tasks = [...original, task("ti", "w1", "b1", {
      title: "Interrupted card",
      triggerSessionId: "run-x",
      laneSessions: [{ sessionId: "run-x", columnId: "dev", startedAt: iso(NOW - HOUR), status: "failed" }],
    })];
    try {
      await renderOverview();
      await waitFor(() => expect(within(rowOf("w1")).getByTestId("kanban-overview-attention").querySelector("[data-kind='interrupted']")).toBeTruthy());
      const entry = within(rowOf("w1")).getByTestId("kanban-overview-attention").querySelector("[data-kind='interrupted']")!;
      expect(entry.textContent).toContain("Interrupted");
      expect(entry.textContent).toContain("Interrupted card");
    } finally {
      DATA.w1.tasks = original;
    }
  });
});
