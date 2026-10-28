import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

class MockEventSource {
  static instances: MockEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();
  constructor(readonly url: string) {
    MockEventSource.instances.push(this);
  }
}

const NOW = Date.UTC(2026, 9, 28, 12);
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function board(queued: number): KanbanBoardInfo {
  return {
    id: "b1", workspaceId: "w1", name: "b1", isDefault: true, createdAt: iso(0), updatedAt: iso(0),
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
      { id: "done", name: "Done", position: 2, stage: "done", automation: { enabled: true, steps: [{ id: "p", specialistId: "kanban-main-pusher" }] } },
    ],
    queue: { queuedCount: queued, queuedCardIds: [], queuedCards: [], queuedPositions: {} },
  } as unknown as KanbanBoardInfo;
}

function base(id: string, columnId: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return { id, title: `Card ${id}`, status: "PENDING", columnId, boardId: "b1", createdAt: iso(NOW - 40 * 24 * HOUR), updatedAt: iso(NOW - HOUR), ...overrides } as TaskInfo;
}
function done(n: number): TaskInfo {
  const at = NOW - n * HOUR;
  return base(`done${n}`, "done", {
    status: "COMPLETED",
    laneSessions: [{ sessionId: `d${n}`, columnId: "done", startedAt: iso(at), completedAt: iso(at + 60_000), status: "completed" }],
    completionReport: { excerpt: `summary ${n}`, commit: `abcdef${n}1234`, hasLeftover: false, createdAt: iso(at) },
    deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 },
  });
}

const TASKS: TaskInfo[] = [
  base("run", "dev", { laneSessions: [{ sessionId: "r1", columnId: "dev", status: "running", startedAt: iso(NOW - 13 * 60_000), specialistName: "Dev Crafter", stepIndex: 1 }] }),
  base("blkerr", "blocked", { lastSyncError: "git push failed" }),
  base("blkcmt", "blocked", { comments: [{ id: "c1", body: "阻塞原因：上线前有一项老检查没过\n不用你管：AI 正在修这项检查", createdAt: iso(NOW - HOUR) }] }),
  ...[1, 2, 3, 4, 5, 6].map(done),
];

let detailStatus = 200;
const fetched: string[] = [];
function respond(url: string): Response {
  fetched.push(url);
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname === "/api/workspaces") {
    return Response.json({ workspaces: [{ id: "w1", title: "Space w1", status: "active", metadata: {}, createdAt: iso(0), updatedAt: iso(0) }] });
  }
  // The list projection drops comments (like GET /api/tasks does); the detail read returns them.
  if (parsed.pathname === "/api/tasks") return Response.json({ tasks: TASKS.map(({ comments: _comments, ...rest }) => rest) });
  if (parsed.pathname === "/api/kanban/boards") return Response.json({ boards: [board(4)] });
  const detail = parsed.pathname.match(/^\/api\/tasks\/(.+)$/);
  if (detail) {
    if (detailStatus !== 200) return new Response("boom", { status: detailStatus });
    const found = TASKS.find((t) => t.id === detail[1]);
    return Response.json({ task: { ...found, objective: "Full requirement text", comments: found?.comments ?? [] } });
  }
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  __resetKanbanOverviewCacheForTests();
  detailStatus = 200;
  fetched.length = 0;
  routerPush.mockReset();
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => respond(url)));
  window.history.replaceState(null, "", "/workspace/w1/kanban?view=all");
});
afterEach(() => vi.unstubAllGlobals());

async function renderIt(dict = en, locale: "en" | "zh" = "en") {
  render(<I18nContext.Provider value={{ locale, setLocale: () => {}, t: dict }}><KanbanOverview onShowBoard={vi.fn()} now={NOW} /></I18nContext.Provider>);
  await waitFor(() => expect(screen.getAllByTestId("kanban-overview-card").length).toBeGreaterThan(0));
}
const card = (id: string) => screen.getAllByTestId("kanban-overview-card").find((el) => el.getAttribute("data-task-id") === id)!;

describe("all-projects page, by project (AC2 / AC3 / AC4)", () => {
  it("shows the queue badge, Dev 3/5 progress and the card name with the summary only in the title", async () => {
    await renderIt();
    const row = screen.getByTestId("kanban-overview-row");
    expect(within(row).getByTestId("kanban-overview-queued").textContent).toBe("Queued 4");
    expect(within(row).getByTestId("kanban-overview-progress").textContent).toContain("Dev 3/5");
    const recent = within(row).getByTestId("kanban-overview-recent-done");
    const first = within(recent).getAllByTestId("kanban-overview-card")[0];
    expect(first.textContent).toContain("Card done1");
    expect(first.textContent).toContain("abcdef1");
    expect(first.textContent).not.toContain("summary 1");
    expect(first.getAttribute("title")).toBe("summary 1");
  });

  it("expands the rest of the Done cards in place without navigating", async () => {
    await renderIt();
    const recent = screen.getByTestId("kanban-overview-recent-done");
    expect(within(recent).getAllByTestId("kanban-overview-card")).toHaveLength(3);
    const before = window.location.href;
    fireEvent.click(within(recent).getByTestId("kanban-overview-expand-done"));
    expect(within(screen.getByTestId("kanban-overview-recent-done")).getAllByTestId("kanban-overview-card")).toHaveLength(6);
    expect(window.location.href).toBe(before);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("lists Blocked cards only under needs-you, with the two-line reason", async () => {
    await renderIt();
    const inProgress = screen.getByTestId("kanban-overview-in-progress");
    const ids = within(inProgress).getAllByTestId("kanban-overview-card").map((el) => el.getAttribute("data-task-id"));
    expect(ids).toEqual(["run"]);
    const attention = screen.getByTestId("kanban-overview-attention");
    expect(within(attention).getAllByTestId("kanban-overview-card").map((el) => el.getAttribute("data-task-id")).sort()).toEqual(["blkcmt", "blkerr"]);
    await waitFor(() => expect(within(attention).getByTestId("inbox-row-reason-why").textContent).toContain("上线前有一项老检查没过"));
    expect(within(attention).getByTestId("inbox-row-reason-decision").textContent).toContain("不用你管");
    expect(attention.textContent).toContain("git push failed");
    // Only the Blocked card without lastSyncError triggers a detail read.
    expect(fetched.filter((u) => /\/api\/tasks\/[^?]/.test(u)).map((u) => u.split("/").pop())).toEqual(["blkcmt"]);
  });

  it("opens a drawer on click: no navigation, list data first, then the detail read; Esc closes and returns focus", async () => {
    await renderIt();
    const before = window.location.href;
    const trigger = card("run");
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(window.location.href).toBe(before);
    expect(routerPush).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId("kanban-overview-drawer-title").textContent).toBe("Card run");
    await waitFor(() => expect(within(dialog).getByText("Full requirement text")).toBeTruthy());
    expect(fetched.some((u) => u.endsWith("/api/tasks/run"))).toBe(true);
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card("run")));
  });

  it("keeps the list data and shows a notice when the detail read fails", async () => {
    detailStatus = 500;
    await renderIt();
    fireEvent.click(card("run"));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByTestId("kanban-overview-drawer-error")).toBeTruthy());
    expect(within(dialog).getByTestId("kanban-overview-drawer-title").textContent).toBe("Card run");
  });

  it("'Open in board' goes to the same address as overviewTaskHref and closes the drawer", async () => {
    await renderIt();
    fireEvent.click(card("run"));
    fireEvent.click(await screen.findByTestId("kanban-overview-drawer-open"));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/workspace/w1/kanban?boardId=b1&taskId=run");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Esc closes the drawer first and keeps the search text", async () => {
    await renderIt();
    const input = screen.getByTestId("kanban-board-search") as HTMLInputElement;
    act(() => { fireEvent.change(input, { target: { value: "Card" } }); });
    fireEvent.click(card("run"));
    await screen.findByRole("dialog");
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(input.value).toBe("Card");
  });

  it("renders Chinese copy for the new texts", async () => {
    await renderIt(zh, "zh");
    const row = screen.getByTestId("kanban-overview-row");
    expect(within(row).getByTestId("kanban-overview-queued").textContent).toBe("排队 4");
    expect(screen.getByTestId("kanban-overview-status-bar").textContent).toContain("今天完成");
    expect(within(row).getByTestId("kanban-overview-expand-done").textContent).toBe("展开其余 3 张");
  });
});

describe("entry paths (F4)", () => {
  it("shows the status bar, progress and queue when `view=all` is opened directly", async () => {
    await renderIt();
    expect(screen.getByTestId("kanban-overview-status-bar")).toBeTruthy();
    expect(screen.getByTestId("kanban-overview-progress").textContent).toContain("Dev 3/5");
    expect(screen.getByTestId("kanban-overview-queued").textContent).toBe("Queued 4");
  });

  it("returns to the overview with the browser back button after 'Open in board'", async () => {
    window.history.replaceState(null, "", "/workspace/w1/kanban?view=all");
    await renderIt();
    fireEvent.click(card("run"));
    fireEvent.click(await screen.findByTestId("kanban-overview-drawer-open"));
    expect(window.location.search).toContain("taskId=run");
    window.history.pushState(null, "", "/workspace/w1/kanban?view=all");
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(window.location.search).toBe("?view=all");
    expect(screen.getByTestId("kanban-overview-status-bar")).toBeTruthy();
  });

  it("updates the numbers after a workspace event reloads the data", async () => {
    await renderIt();
    expect(screen.getByTestId("kanban-overview-status-running-count").textContent).toBe("1");
    TASKS.push(base("run9", "dev", { laneSessions: [{ sessionId: "r9", columnId: "dev", status: "running", startedAt: iso(NOW - 60_000) }] }));
    const source = MockEventSource.instances[MockEventSource.instances.length - 1];
    act(() => {
      source.onmessage?.({ data: JSON.stringify({ type: "kanban:changed", workspaceId: "w1", entity: "task" }) } as MessageEvent);
    });
    await waitFor(() => expect(screen.getByTestId("kanban-overview-status-running-count").textContent).toBe("2"), { timeout: 3000 });
    TASKS.pop();
  });
});

describe("status bar (AC1)", () => {
  it("shows four counts and narrows the page to one state, then back", async () => {
    await renderIt();
    const bar = screen.getByTestId("kanban-overview-status-bar");
    expect(within(bar).getByTestId("kanban-overview-status-running-count").textContent).toBe("1");
    expect(within(bar).getByTestId("kanban-overview-status-attention-count").textContent).toBe("2");
    fireEvent.click(within(bar).getByTestId("kanban-overview-status-attention"));
    expect(within(bar).getByTestId("kanban-overview-status-attention").getAttribute("aria-pressed")).toBe("true");
    const row = screen.getByTestId("kanban-overview-row");
    expect(within(row).getByTestId("kanban-overview-in-progress").getAttribute("data-empty")).toBe("true");
    expect(within(row).getByTestId("kanban-overview-attention").getAttribute("data-empty")).toBe("false");
    fireEvent.click(within(bar).getByTestId("kanban-overview-status-attention"));
    expect(within(row).getByTestId("kanban-overview-in-progress").getAttribute("data-empty")).toBe("false");
  });
});
