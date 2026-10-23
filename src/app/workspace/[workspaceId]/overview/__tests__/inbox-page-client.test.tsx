import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { DAY, HOUR, NOW, card, doneCard, iso, makeBoard, unmergedCard } from "./inbox-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ workspaceId: "w1" }),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));

import { InboxPageClient } from "../inbox-page-client";
import {
  dismissAttentionItem,
  readAttentionDismissals,
  resetAttentionDismissalsForTests,
} from "../../kanban/use-kanban-attention-dismissals";
import { __resetKanbanOverviewCacheForTests } from "../../kanban/use-kanban-overview-data";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();
  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
}

function boardFor(id: string, workspaceId: string): KanbanBoardInfo {
  return { ...makeBoard(id, true), workspaceId } as KanbanBoardInfo;
}

let DATA: Record<string, { tasks: TaskInfo[]; boards: KanbanBoardInfo[] }>;
let failTasksFor: string | null;
let holdTasks: boolean;
const fetchCalls: Array<{ url: string; method: string }> = [];

function respond(url: string): Response {
  const parsed = new URL(url, "http://localhost");
  const ws = parsed.searchParams.get("workspaceId") ?? "";
  if (parsed.pathname === "/api/workspaces") {
    return Response.json({
      workspaces: [["w1", "Alpha"], ["w2", "Beta"]].map(([id, title]) => ({ id, title, status: "active", metadata: {}, createdAt: iso(0), updatedAt: iso(0) })),
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
  DATA = {
    w1: {
      tasks: [
        doneCard("f1", "failed", { title: "Alpha failed card" }),
        card("blk", { title: "Alpha blocked card", columnId: "blocked", lastSyncError: "push rejected by hook", updatedAt: iso(NOW - 5 * HOUR) }),
        unmergedCard("u1", 3, { title: "Alpha unmerged card" }),
      ],
      boards: [boardFor("b1", "w1")],
    },
    w2: {
      tasks: [doneCard("n2", "completed", { title: "Beta unreported card", boardId: "b2" })],
      boards: [boardFor("b2", "w2")],
    },
  };
  failTasksFor = null;
  holdTasks = false;
  fetchCalls.length = 0;
  MockEventSource.instances = [];
  window.localStorage.clear();
  resetAttentionDismissalsForTests();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase() });
    if (holdTasks && String(url).includes("/api/tasks")) return new Promise<Response>(() => {});
    return Promise.resolve(respond(String(url)));
  }));
  window.history.replaceState(null, "", "/workspace/w1/overview");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function rowTitles(container: HTMLElement = document.body): string[] {
  return within(container).queryAllByTestId("inbox-row").map((row) => row.querySelector("h3")?.textContent ?? "");
}

async function renderReady() {
  render(<InboxPageClient now={NOW} />);
  await waitFor(() => expect(screen.getAllByTestId("inbox-row").length).toBeGreaterThan(0));
}

describe("scope", () => {
  it("shows only the URL workspace without view=all", async () => {
    await renderReady();
    expect(rowTitles(screen.getByTestId("inbox-list"))).toEqual(["Alpha failed card", "Alpha blocked card", "Alpha unmerged card"]);
    expect(screen.queryByTestId("inbox-group")).toBeNull();
  });

  it("groups every workspace with view=all", async () => {
    window.history.replaceState(null, "", "/workspace/w1/overview?view=all");
    await renderReady();
    const groups = screen.getAllByTestId("inbox-group");
    expect(groups.map((group) => group.getAttribute("data-workspace-id"))).toEqual(["w1", "w2"]);
    expect(rowTitles(groups[1])).toEqual(["Beta unreported card"]);
  });

  it("switching scope rewrites the URL without fetching", async () => {
    await renderReady();
    const before = fetchCalls.length;
    fireEvent.click(screen.getByTestId("inbox-scope-all"));
    await waitFor(() => expect(screen.getAllByTestId("inbox-group")).toHaveLength(2));
    expect(window.location.search).toBe("?view=all");
    expect(fetchCalls.length).toBe(before);
  });

  it("labels the three counts with text", async () => {
    await renderReady();
    expect(within(screen.getByTestId("inbox-count-p1")).getByText("Clear failures")).toBeTruthy();
    expect(screen.getByTestId("inbox-count-p1-value").textContent).toBe("2");
    expect(screen.getByTestId("inbox-count-p2-value").textContent).toBe("0");
    expect(screen.getByTestId("inbox-count-p3-value").textContent).toBe("1");
  });
});

describe("rows", () => {
  it("shows severity text, the verbatim error and an unmerged decision line", async () => {
    await renderReady();
    const rows = screen.getAllByTestId("inbox-row");
    expect(rows[1].getAttribute("data-reason")).toBe("blockedError");
    expect(within(rows[1]).getByTestId("inbox-row-reason").textContent).toContain("push rejected by hook");
    expect(within(rows[0]).getByText("P1 · Failed")).toBeTruthy();
    expect(within(rows[2]).getByText("P3 · Waiting for you")).toBeTruthy();
    expect(within(rows[2]).getByTestId("inbox-row-reason").textContent).toContain("+3");
  });

  it("view card links to the card detail, completion tab for failed cards; actions are a / button", async () => {
    await renderReady();
    const rows = screen.getAllByTestId("inbox-row");
    const failedLink = within(rows[0]).getByTestId("inbox-row-open");
    expect(failedLink.tagName).toBe("A");
    expect(failedLink.getAttribute("href")).toBe("/workspace/w1/kanban?boardId=b1&taskId=f1&detailTab=completion");
    expect(within(rows[1]).getByTestId("inbox-row-open").getAttribute("href")).toBe("/workspace/w1/kanban?boardId=b1&taskId=blk");
    expect(within(rows[0]).getByTestId("inbox-row-dismiss").tagName).toBe("BUTTON");
  });
});

describe("local hide shares the board's Got-it key", () => {
  it("hiding here writes attentionDismissKey into the board's storage and moves the row", async () => {
    await renderReady();
    fireEvent.click(within(screen.getAllByTestId("inbox-row")[0]).getByTestId("inbox-row-dismiss"));
    expect(readAttentionDismissals("b1")).toContain("f1|doneFailed|0");
    const details = await screen.findByTestId("inbox-dismissed");
    expect(details.tagName).toBe("DETAILS");
    expect(rowTitles(details)).toEqual(["Alpha failed card"]);
    expect(rowTitles(screen.getByTestId("inbox-list"))).not.toContain("Alpha failed card");
    expect(screen.getByTestId("inbox-count-p1-value").textContent).toBe("1");
  });

  it("keys hidden on the board land in the hidden section and can be shown again", async () => {
    dismissAttentionItem("b1", "u1|unmerged|3");
    await renderReady();
    const details = screen.getByTestId("inbox-dismissed");
    expect(rowTitles(details)).toEqual(["Alpha unmerged card"]);
    fireEvent.click(within(details).getByTestId("inbox-row-restore"));
    expect(readAttentionDismissals("b1")).not.toContain("u1|unmerged|3");
    await waitFor(() => expect(screen.queryByTestId("inbox-dismissed")).toBeNull());
  });
});

describe("loading, error and empty states", () => {
  it("does not show 0 while loading", async () => {
    holdTasks = true;
    render(<InboxPageClient now={NOW} />);
    await waitFor(() => expect(screen.getByTestId("ui-skeleton")).toBeTruthy());
    expect(screen.queryByTestId("inbox-count-p1-value")).toBeNull();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("keeps old rows on error and read-again calls the loader again", async () => {
    await renderReady();
    failTasksFor = "w1";
    // Force a refetch through the SSE stream.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      MockEventSource.instances[0].onmessage?.({ data: JSON.stringify({ type: "kanban:changed", workspaceId: "w1", entity: "task" }) } as MessageEvent);
    });
    await act(async () => {
      vi.runAllTimers();
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByTestId("ui-error-state")).toBeTruthy());
    expect(screen.getByTestId("ui-error-state").textContent).toContain("Alpha");
    expect(rowTitles(screen.getByTestId("inbox-list"))).toContain("Alpha failed card");
    expect(screen.getAllByText("Data may be stale").length).toBeGreaterThan(0);

    failTasksFor = null;
    const before = fetchCalls.filter((call) => call.url.includes("/api/tasks?workspaceId=w1")).length;
    fireEvent.click(within(screen.getByTestId("ui-error-state")).getByRole("button"));
    await waitFor(() => expect(screen.queryByTestId("ui-error-state")).toBeNull());
    expect(fetchCalls.filter((call) => call.url.includes("/api/tasks?workspaceId=w1")).length).toBe(before + 1);
  });

  it("shows a failed first read as an error, never as the empty state", async () => {
    failTasksFor = "w1";
    render(<InboxPageClient now={NOW} />);
    await waitFor(() => expect(screen.getByTestId("ui-error-state")).toBeTruthy());
    expect(screen.queryByText("Nothing needs you")).toBeNull();
  });

  it("shows the empty state with a reason and a board link when nothing needs you", async () => {
    DATA.w1.tasks = [card("ok", { columnId: "dev" })];
    DATA.w2.tasks = [];
    render(<InboxPageClient now={NOW} />);
    const empty = await screen.findByTestId("ui-empty-state");
    expect(empty.textContent).toContain("Nothing needs you");
    expect(empty.textContent).toContain("7 days");
    expect(within(empty).getByRole("link").getAttribute("href")).toBe("/workspace/w1/kanban");
  });

  it("uses scope-specific copy when only other workspaces have items", async () => {
    DATA.w1.tasks = [];
    render(<InboxPageClient now={NOW} />);
    const empty = await screen.findByTestId("ui-empty-state");
    expect(empty.textContent).toContain("Nothing needs you in this workspace");
  });
});

describe("read-only", () => {
  it("opening, switching scope, hiding and reading again only issue GETs", async () => {
    await renderReady();
    fireEvent.click(screen.getByTestId("inbox-scope-all"));
    fireEvent.click(within(screen.getAllByTestId("inbox-row")[0]).getByTestId("inbox-row-dismiss"));
    fireEvent.click(screen.getByTestId("inbox-scope-workspace"));
    await waitFor(() => expect(fetchCalls.length).toBeGreaterThan(0));
    expect(fetchCalls.filter((call) => call.method !== "GET")).toEqual([]);
    expect(fetchCalls.some((call) => call.url.includes("revive"))).toBe(false);
    const paths = new Set(fetchCalls.map((call) => new URL(call.url, "http://localhost").pathname));
    expect([...paths].sort()).toEqual(["/api/kanban/boards", "/api/tasks", "/api/workspaces"]);
    expect(MockEventSource.instances.every((source) => source.url.includes("/api/kanban/events"))).toBe(true);
  });

  it("ignores Done cards older than the 7-day window", async () => {
    DATA.w1.tasks = [doneCard("old", "failed", { title: "Old failure" }, NOW - 10 * DAY - HOUR)];
    DATA.w2.tasks = [];
    render(<InboxPageClient now={NOW} />);
    await screen.findByTestId("ui-empty-state");
    expect(screen.queryByText("Old failure")).toBeNull();
  });
});
