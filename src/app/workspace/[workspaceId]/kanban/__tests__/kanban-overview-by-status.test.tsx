import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ workspaceId: "w1" }),
}));

import { KanbanOverview } from "../kanban-overview";
import { readOverviewMode } from "../kanban-overview-mode";
import { __resetKanbanOverviewCacheForTests } from "../use-kanban-overview-data";
import en from "@/i18n/locales/en";
import { I18nContext } from "@/i18n/context";

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();
  constructor(readonly url: string) {}
}

const NOW = new Date(2026, 9, 28, 15, 0).getTime();
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const at = (daysBack: number, hour: number) => new Date(2026, 9, 28 - daysBack, hour, 0).getTime();

function board(ws: string): KanbanBoardInfo {
  return {
    id: `b-${ws}`, workspaceId: ws, name: ws, isDefault: true, createdAt: iso(0), updatedAt: iso(0),
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
      { id: "done", name: "Done", position: 2, stage: "done", automation: { enabled: true, steps: [{ id: "p", specialistId: "kanban-main-pusher" }] } },
    ],
  } as unknown as KanbanBoardInfo;
}
function base(ws: string, id: string, columnId: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return { id, title: `Card ${id}`, status: "PENDING", columnId, boardId: `b-${ws}`, createdAt: iso(NOW - 40 * 24 * HOUR), updatedAt: iso(NOW - HOUR), ...overrides } as TaskInfo;
}
function done(ws: string, id: string, when: number): TaskInfo {
  return base(ws, id, "done", {
    status: "COMPLETED",
    laneSessions: [{ sessionId: `d-${id}`, columnId: "done", startedAt: iso(when), completedAt: iso(when + 60_000), status: "completed" }],
    completionReport: { excerpt: `summary ${id}`, commit: `abcdef0${id.length}`, hasLeftover: false, createdAt: iso(when) },
    deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 },
  });
}

const DATA: Record<string, TaskInfo[]> = {
  w1: [
    base("w1", "blk", "blocked", { lastSyncError: "push failed" }),
    base("w1", "run1", "dev", { laneSessions: [{ sessionId: "r", columnId: "dev", status: "running", startedAt: iso(NOW - 20 * 60_000), specialistName: "Dev Crafter", stepIndex: 0 }] }),
    base("w1", "wait", "todo"),
    done("w1", "t1", at(0, 10)), done("w1", "t2", at(0, 9)),
    done("w1", "y1", at(1, 11)), done("w1", "y2", at(1, 10)), done("w1", "y3", at(1, 9)),
  ],
  w2: [
    base("w2", "run2", "dev", { laneSessions: [{ sessionId: "r2", columnId: "dev", status: "running", startedAt: iso(NOW - 5 * 60_000), specialistName: "Dev Crafter", stepIndex: 1 }] }),
    done("w2", "e1", at(2, 12)),
  ],
  w3: [],
};

function respond(url: string): Response {
  const parsed = new URL(url, "http://localhost");
  const ws = parsed.searchParams.get("workspaceId") ?? "";
  if (parsed.pathname === "/api/workspaces") {
    return Response.json({ workspaces: ["w1", "w2", "w3"].map((id) => ({ id, title: `Space ${id}`, status: "active", metadata: {}, createdAt: iso(0), updatedAt: iso(0) })) });
  }
  if (parsed.pathname === "/api/tasks") return Response.json({ tasks: DATA[ws] ?? [] });
  if (parsed.pathname === "/api/kanban/boards") return Response.json({ boards: [board(ws)] });
  if (parsed.pathname.startsWith("/api/tasks/")) return Response.json({ task: { id: parsed.pathname.split("/").pop(), objective: "x" } });
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  __resetKanbanOverviewCacheForTests();
  routerPush.mockReset();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => respond(url)));
  window.history.replaceState(null, "", "/workspace/w1/kanban?view=all&overviewMode=status&boardId=B&taskId=T");
});
afterEach(() => vi.unstubAllGlobals());

async function renderStatus() {
  render(<I18nContext.Provider value={{ locale: "en", setLocale: () => {}, t: en }}><KanbanOverview onShowBoard={vi.fn()} now={NOW} /></I18nContext.Provider>);
  await waitFor(() => expect(screen.getByTestId("kanban-overview-group-done")).toBeTruthy());
}
const ids = (scope: HTMLElement) => within(scope).getAllByTestId("kanban-overview-card").map((el) => el.getAttribute("data-task-id"));

describe("by-status page (AC5)", () => {
  it("starts in status mode from the URL and keeps the other params on switching", async () => {
    await renderStatus();
    expect(screen.getByTestId("kanban-overview-by-status")).toBeTruthy();
    expect(screen.getByTestId("kanban-overview-mode-status").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("kanban-overview-mode-project"));
    expect(window.location.search).toBe("?view=all&boardId=B&taskId=T");
    expect(screen.queryByTestId("kanban-overview-by-status")).toBeNull();
    fireEvent.click(screen.getByTestId("kanban-overview-mode-status"));
    expect(window.location.search).toBe("?view=all&boardId=B&taskId=T&overviewMode=status");
  });

  it("falls back to by-project for a missing or unknown overviewMode", () => {
    window.history.replaceState(null, "", "/workspace/w1/kanban?view=all&overviewMode=xxx");
    expect(readOverviewMode()).toBe("project");
    window.history.replaceState(null, "", "/workspace/w1/kanban?view=all");
    expect(readOverviewMode()).toBe("project");
  });

  it("orders the groups needs-you → running → queued → done, running cards of one project side by side", async () => {
    await renderStatus();
    const order = ["attention", "running", "queued", "done"].map((g) => screen.getByTestId(`kanban-overview-group-${g}`));
    for (let i = 0; i < order.length - 1; i += 1) {
      expect(order[i].compareDocumentPosition(order[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(ids(order[0])).toEqual(["blk"]);
    expect(order[0].textContent).toContain("push failed");
    expect(ids(order[1])).toEqual(["run1", "run2"]);
    expect(order[1].textContent).toContain("Dev 3/5");
    expect(ids(order[2])).toEqual(["wait"]);
  });

  it("splits Done by day: today open, earlier days one line with the first two names", async () => {
    await renderStatus();
    const days = screen.getAllByTestId("kanban-overview-day");
    expect(days.map((d) => d.getAttribute("data-open"))).toEqual(["true", "false", "false"]);
    expect(ids(days[0])).toEqual(["t1", "t2"]);
    expect(within(days[1]).queryAllByTestId("kanban-overview-card")).toHaveLength(0);
    expect(within(days[1]).getByTestId("kanban-overview-day-preview").textContent).toBe("Card y1 · Card y2");
    fireEvent.click(within(days[1]).getByTestId("kanban-overview-day-toggle"));
    expect(ids(screen.getAllByTestId("kanban-overview-day")[1])).toEqual(["y1", "y2", "y3"]);
    const first = within(days[0]).getAllByTestId("kanban-overview-card")[0];
    expect(first.getAttribute("title")).toBe("summary t1");
  });

  it("folds a group on a title click", async () => {
    await renderStatus();
    fireEvent.click(screen.getByTestId("kanban-overview-group-running-title"));
    const group = screen.getByTestId("kanban-overview-group-running");
    expect(group.getAttribute("data-folded")).toBe("true");
    expect(within(group).queryAllByTestId("kanban-overview-card")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("kanban-overview-group-running-title"));
    expect(within(screen.getByTestId("kanban-overview-group-running")).getAllByTestId("kanban-overview-card")).toHaveLength(2);
  });

  it("filters by project capsule and shows the two counts; a second click undoes it", async () => {
    await renderStatus();
    const capsules = screen.getAllByTestId("kanban-overview-capsule");
    const w2 = capsules.find((c) => c.getAttribute("data-workspace-id") === "w2")!;
    expect(w2.textContent).toContain("Space w2");
    expect(w2.textContent).toContain("1 · 1");
    fireEvent.click(w2);
    expect(screen.queryByTestId("kanban-overview-group-attention")).toBeNull();
    expect(ids(screen.getByTestId("kanban-overview-group-running"))).toEqual(["run2"]);
    fireEvent.click(w2);
    expect(ids(screen.getByTestId("kanban-overview-group-running"))).toEqual(["run1", "run2"]);
  });

  it("the status bar shows one group only and is shared with the by-project page", async () => {
    await renderStatus();
    fireEvent.click(screen.getByTestId("kanban-overview-status-queued"));
    expect(screen.queryByTestId("kanban-overview-group-running")).toBeNull();
    expect(ids(screen.getByTestId("kanban-overview-group-queued"))).toEqual(["wait"]);
    fireEvent.click(screen.getByTestId("kanban-overview-status-queued"));
    expect(screen.getByTestId("kanban-overview-group-running")).toBeTruthy();
  });

  it("J / K move the selection, Enter opens the drawer, Esc closes it; keys are ignored in inputs", async () => {
    await renderStatus();
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "j" });
    const selected = () => screen.getAllByTestId("kanban-overview-status-row").filter((r) => r.getAttribute("data-selected") === "true");
    expect(selected()).toHaveLength(1);
    expect(selected()[0].querySelector("[data-task-id]")!.getAttribute("data-task-id")).toBe("run1");
    fireEvent.keyDown(document.body, { key: "k" });
    expect(selected()[0].querySelector("[data-task-id]")!.getAttribute("data-task-id")).toBe("blk");
    const input = screen.getByTestId("kanban-board-search");
    fireEvent.keyDown(input, { key: "j" });
    expect(selected()[0].querySelector("[data-task-id]")!.getAttribute("data-task-id")).toBe("blk");
    fireEvent.keyDown(document.body, { key: "Enter" });
    await screen.findByRole("dialog");
    fireEvent.keyDown(document.body, { key: "j" });
    expect(selected()[0].querySelector("[data-task-id]")!.getAttribute("data-task-id")).toBe("blk");
    act(() => { fireEvent.keyDown(document.body, { key: "Escape" }); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the drawer on a row click in this view too", async () => {
    await renderStatus();
    fireEvent.click(screen.getAllByTestId("kanban-overview-card").find((el) => el.getAttribute("data-task-id") === "run2")!);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(routerPush).not.toHaveBeenCalled();
  });
});
