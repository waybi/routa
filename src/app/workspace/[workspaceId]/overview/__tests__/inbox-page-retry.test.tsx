import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { HOUR, NOW, card, doneCard, interruptedCard, iso, makeBoard } from "./inbox-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ workspaceId: "w1" }),
}));
vi.mock("@/client/components/desktop-app-shell", () => ({
  DesktopAppShell: ({ children }: { children: ReactNode }) => <div data-testid="shell">{children}</div>,
}));
vi.mock("@/client/components/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
const { desktopFetchSpy } = vi.hoisted(() => ({ desktopFetchSpy: vi.fn() }));
vi.mock("@/client/utils/diagnostics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/client/utils/diagnostics")>();
  return {
    ...actual,
    desktopAwareFetch: (path: string, init?: RequestInit) => {
      desktopFetchSpy(path, init);
      return actual.desktopAwareFetch(path, init);
    },
  };
});

import { InboxPageClient } from "../inbox-page-client";
import { dismissAttentionItem, resetAttentionDismissalsForTests } from "../../kanban/use-kanban-attention-dismissals";
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

type Call = { url: string; method: string; body?: unknown };
type Gate = { call: Call; resolve: (response: Response) => void };

let tasks: TaskInfo[];
let boards: KanbanBoardInfo[];
let fresh: Record<string, TaskInfo>;
let calls: Call[];
let gates: Gate[];
let patchReply: (id: string) => Response;

function listResponse(url: string): Response {
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname === "/api/workspaces") {
    return Response.json({ workspaces: [{ id: "w1", title: "Alpha", status: "active", metadata: {}, createdAt: iso(0), updatedAt: iso(0) }] });
  }
  if (parsed.pathname === "/api/tasks") return Response.json({ tasks });
  if (parsed.pathname === "/api/kanban/boards") return Response.json({ boards });
  return new Response("not found", { status: 404 });
}

beforeEach(() => {
  const board = { ...makeBoard("b1", true), workspaceId: "w1", autoProviderId: "dsh" } as KanbanBoardInfo;
  board.columns = [
    { id: "dev", name: "Dev", position: 0, stage: "dev", automation: { enabled: true, steps: [{ id: "c", specialistId: "crafter" }] } },
    ...board.columns.filter((column) => column.id !== "dev"),
  ] as KanbanBoardInfo["columns"];
  boards = [board];
  tasks = [
    interruptedCard("i1", "dev", "failed", { title: "Card one", lastSyncError: "usage_limit_reached" }),
    interruptedCard("i2", "dev", "timed_out", { title: "Card two" }),
    interruptedCard("i3", "dev", "failed", { title: "Card three" }),
    card("blk", { title: "Blocked card", columnId: "blocked", lastSyncError: "hook", updatedAt: iso(NOW - 5 * HOUR) }),
    doneCard("f1", "failed", { title: "Done failed card" }),
  ];
  fresh = Object.fromEntries(tasks.map((task) => [task.id, task]));
  calls = [];
  gates = [];
  patchReply = () => Response.json({ task: { triggerSessionId: "new-session" } });
  MockEventSource.instances = [];
  desktopFetchSpy.mockReset();
  window.localStorage.clear();
  resetAttentionDismissalsForTests();
  __resetKanbanOverviewCacheForTests();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const call: Call = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const single = new URL(url, "http://localhost").pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (!single) return Promise.resolve(listResponse(url));
    return new Promise<Response>((resolve) => {
      gates.push({ call, resolve });
    });
  }));
  window.history.replaceState(null, "", "/workspace/w1/overview");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderReady() {
  render(<InboxPageClient now={NOW} />);
  await waitFor(() => expect(screen.getAllByTestId("inbox-row").length).toBe(5));
}

function rowByTitle(title: string): HTMLElement {
  return screen.getAllByTestId("inbox-row").find((row) => row.querySelector("h3")?.textContent === title)!;
}

function taskWrites(): Call[] {
  return calls.filter((call) => /\/api\/tasks\/[^/?]+$/.test(new URL(call.url, "http://localhost").pathname));
}

/** Resolve the one in-flight /api/tasks/<id> request (asserting it is the only one). */
async function settleNext(expected: string, reply?: Response) {
  await waitFor(() => expect(gates.length).toBeGreaterThan(0));
  expect(gates).toHaveLength(1);
  const gate = gates.shift()!;
  const id = decodeURIComponent(new URL(gate.call.url, "http://localhost").pathname.split("/").pop()!);
  expect(`${gate.call.method} ${id}`).toBe(expected);
  await act(async () => {
    gate.resolve(reply ?? (gate.call.method === "GET" ? Response.json({ task: fresh[id] }) : patchReply(id)));
  });
}

function rerunButtons(): HTMLButtonElement[] {
  return screen.queryAllByTestId("inbox-row-rerun") as HTMLButtonElement[];
}

describe("interrupted rows and the bulk bar", () => {
  it("shows the bar, checkboxes and Rerun only on interrupted rows, directly visible", async () => {
    await renderReady();
    const bar = screen.getByTestId("inbox-bulk-bar");
    expect(within(bar).getByTestId("inbox-bulk-count").textContent).toBe("3 cards interrupted");
    expect(within(bar).getByTestId("inbox-bulk-rerun").textContent).toBe("Rerun selected (0)");
    for (const title of ["Card one", "Card two", "Card three"]) {
      const row = rowByTitle(title);
      expect(row.getAttribute("data-reason")).toBe("interrupted");
      const button = within(row).getByTestId("inbox-row-rerun");
      expect(button.textContent).toBe("Rerun");
      expect(button.closest("details")).toBeNull();
      expect(within(row).getByTestId("inbox-row-select")).toBeTruthy();
    }
    for (const title of ["Blocked card", "Done failed card"]) {
      expect(within(rowByTitle(title)).queryByTestId("inbox-row-select")).toBeNull();
      expect(within(rowByTitle(title)).queryByTestId("inbox-row-rerun")).toBeNull();
    }
    // Three interrupted + blocked-with-error + done failed = 5 clear failures.
    expect(screen.getByTestId("inbox-count-p1-value").textContent).toBe("5");
  });

  it("select all skips locally hidden interrupted rows", async () => {
    dismissAttentionItem("b1", "i3|interrupted|i3-run");
    render(<InboxPageClient now={NOW} />);
    await waitFor(() => expect(screen.getByTestId("inbox-dismissed")).toBeTruthy());
    const hidden = screen.getByTestId("inbox-dismissed");
    expect(within(hidden).queryByTestId("inbox-row-select")).toBeNull();
    expect(within(hidden).queryByTestId("inbox-row-rerun")).toBeNull();
    fireEvent.click(screen.getByTestId("inbox-bulk-select-all"));
    expect(screen.getByTestId("inbox-bulk-count").textContent).toBe("2 cards interrupted");
    expect(screen.getByTestId("inbox-bulk-rerun").textContent).toBe("Rerun selected (2)");
  });

  it("no bar when nothing is interrupted", async () => {
    tasks = tasks.filter((task) => !task.id.startsWith("i"));
    render(<InboxPageClient now={NOW} />);
    await waitFor(() => expect(screen.getAllByTestId("inbox-row").length).toBe(2));
    expect(screen.queryByTestId("inbox-bulk-bar")).toBeNull();
  });
});

describe("single rerun", () => {
  it("rechecks with GET, then PATCHes retryTrigger with the board provider via desktopAwareFetch", async () => {
    await renderReady();
    fireEvent.click(within(rowByTitle("Card one")).getByTestId("inbox-row-rerun"));
    await waitFor(() => expect(within(rowByTitle("Card one")).getByTestId("inbox-row-retry-state").textContent).toBe("Starting…"));
    expect(rerunButtons().every((button) => button.disabled)).toBe(true);
    await settleNext("GET i1");
    await settleNext("PATCH i1");
    await waitFor(() => expect(within(rowByTitle("Card one")).getByTestId("inbox-row-retry-state").textContent).toBe("Rerun started"));
    const writes = taskWrites();
    expect(writes.map((call) => [call.method, new URL(call.url, "http://localhost").pathname])).toEqual([
      ["GET", "/api/tasks/i1"],
      ["PATCH", "/api/tasks/i1"],
    ]);
    expect(writes[1].body).toEqual({ retryTrigger: true, retryProviderId: "dsh" });
    expect(desktopFetchSpy.mock.calls.map(([path, init]) => `${init?.method ?? "GET"} ${path}`)).toEqual(
      expect.arrayContaining(["GET /api/tasks/i1", "PATCH /api/tasks/i1"]),
    );
    expect(window.confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("inbox-bulk-summary").textContent).toBe("Started 1, queued 0, skipped 0, failed 0");
  });

  it("omits retryProviderId when the board has no autoProviderId", async () => {
    boards = boards.map((board) => ({ ...board, autoProviderId: undefined }));
    await renderReady();
    fireEvent.click(within(rowByTitle("Card two")).getByTestId("inbox-row-rerun"));
    await settleNext("GET i2");
    await settleNext("PATCH i2");
    expect(taskWrites()[1].body).toEqual({ retryTrigger: true });
  });
});

describe("bulk rerun", () => {
  it("asks in-page first; cancel sends nothing", async () => {
    await renderReady();
    fireEvent.click(screen.getByTestId("inbox-bulk-select-all"));
    fireEvent.click(screen.getByTestId("inbox-bulk-rerun"));
    expect(screen.getByTestId("inbox-bulk-confirm").textContent).toContain("This reruns 3 cards; each one starts a new agent");
    fireEvent.click(screen.getByTestId("inbox-bulk-confirm-no"));
    expect(screen.queryByTestId("inbox-bulk-confirm")).toBeNull();
    expect(taskWrites()).toEqual([]);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("runs serially, skips cards no longer interrupted, keeps going after a 500, then sums up and reloads", async () => {
    tasks.push(interruptedCard("i4", "dev", "failed", { title: "Card four" }));
    fresh.i4 = tasks[tasks.length - 1];
    // i2 was rerun elsewhere: its fresh copy has a trigger not yet in laneSessions.
    fresh.i2 = { ...fresh.i2, triggerSessionId: "started-elsewhere" };
    patchReply = (id) => (id === "i3"
      ? Response.json({ error: "Internal failure" }, { status: 500 })
      : id === "i4" ? Response.json({ task: {} }) : Response.json({ task: { triggerSessionId: `new-${id}` } }));
    render(<InboxPageClient now={NOW} />);
    await waitFor(() => expect(screen.getAllByTestId("inbox-row").length).toBe(6));
    const listReadsBefore = calls.filter((call) => call.url.includes("/api/tasks?workspaceId=w1")).length;

    fireEvent.click(screen.getByTestId("inbox-bulk-select-all"));
    fireEvent.click(screen.getByTestId("inbox-bulk-rerun"));
    fireEvent.click(screen.getByTestId("inbox-bulk-confirm-yes"));

    await waitFor(() => expect(gates.length).toBe(1));
    expect((screen.getByTestId("inbox-bulk-rerun") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("inbox-bulk-select-all") as HTMLInputElement).disabled).toBe(true);
    expect(rerunButtons().every((button) => button.disabled)).toBe(true);

    // Rows are sorted newest first within P1; read the order the page sends.
    const order = screen.getAllByTestId("inbox-row")
      .filter((row) => row.getAttribute("data-reason") === "interrupted")
      .map((row) => row.querySelector("h3")?.textContent);
    expect(order).toHaveLength(4);
    const idOf: Record<string, string> = { "Card one": "i1", "Card two": "i2", "Card three": "i3", "Card four": "i4" };
    const expected: string[] = [];
    for (const title of order) {
      const id = idOf[title!];
      await settleNext(`GET ${id}`);
      expected.push(`GET ${id}`);
      if (id !== "i2") {
        // The next card's GET must not start before this PATCH resolves.
        await settleNext(`PATCH ${id}`);
        expected.push(`PATCH ${id}`);
      }
    }
    await waitFor(() => expect(screen.getByTestId("inbox-bulk-summary").textContent).toBe("Started 1, queued 1, skipped 1, failed 1"));
    expect(taskWrites().map((call) => `${call.method} ${new URL(call.url, "http://localhost").pathname.split("/").pop()}`)).toEqual(expected);

    const state = (title: string) => within(rowByTitle(title)).getByTestId("inbox-row-retry-state").textContent;
    expect(state("Card one")).toBe("Rerun started");
    expect(state("Card two")).toBe("Already running, skipped");
    expect(state("Card three")).toBe("Failed: Internal failure");
    expect(state("Card four")).toBe("Queued");
    await waitFor(() => expect(calls.filter((call) => call.url.includes("/api/tasks?workspaceId=w1")).length).toBe(listReadsBefore + 1));
    // Queued rows keep their result after the reload and are not selectable again.
    await waitFor(() => expect(state("Card four")).toBe("Queued"));
    expect((within(rowByTitle("Card four")).getByTestId("inbox-row-select") as HTMLInputElement).disabled).toBe(true);
    expect((within(rowByTitle("Card three")).getByTestId("inbox-row-rerun") as HTMLButtonElement).disabled).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe("many interrupted rows", () => {
  it("selects all 200 and confirms with the right count without hanging", async () => {
    tasks = Array.from({ length: 200 }, (_, index) => interruptedCard(`m${index}`, "dev", "failed", { title: `Many ${index}` }));
    const started = performance.now();
    render(<InboxPageClient now={NOW} />);
    await waitFor(() => expect(screen.getAllByTestId("inbox-row").length).toBe(200));
    fireEvent.click(screen.getByTestId("inbox-bulk-select-all"));
    fireEvent.click(screen.getByTestId("inbox-bulk-rerun"));
    expect(screen.getByTestId("inbox-bulk-rerun").textContent).toBe("Rerun selected (200)");
    expect(screen.getByTestId("inbox-bulk-confirm").textContent).toContain("This reruns 200 cards");
    expect(performance.now() - started).toBeLessThan(5000);
    expect(taskWrites()).toEqual([]);
  });
});
