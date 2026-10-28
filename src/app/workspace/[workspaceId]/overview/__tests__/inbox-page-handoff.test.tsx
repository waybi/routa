/**
 * Card 4877583c, page level: "Hand to AI" goes through the rerun queue
 * (GET recheck → PATCH /api/tasks/<id> { retryTrigger: true } via
 * desktopAwareFetch), both list paths render the new fields, the reason
 * comment is read from the card detail, and nothing old disappears
 * (C4, C6, F4).
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { HOUR, NOW, doneCard, interruptedCard, iso } from "./inbox-fixtures";
import { blockedCard, blockedRun, comment, resolution, resolverBoard } from "./handler-fixtures";

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
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();
}

type Call = { url: string; method: string; body?: unknown };

let tasks: TaskInfo[];
let boards: KanbanBoardInfo[];
let fresh: Record<string, TaskInfo>;
let calls: Call[];
let patchGates: Array<{ call: Call; resolve: (response: Response) => void; reject: (error: Error) => void }>;

const pathOf = (url: string) => new URL(url, "http://localhost").pathname;

beforeEach(() => {
  boards = [{ ...resolverBoard(), workspaceId: "w1" } as KanbanBoardInfo];
  tasks = [
    blockedCard("queued", { title: "Queued card", lastSyncError: "rebase conflict" }),
    blockedCard("running", { title: "Running card", lastSyncError: "hook", laneSessions: [blockedRun(NOW - HOUR, "running")] }),
    blockedCard("owner", { title: "Owner card", attentionResolution: resolution("needs_owner", { conclusion: "需要你决定是否放弃" }) }),
    interruptedCard("int", "dev", "failed", { title: "Interrupted card" }),
  ];
  fresh = Object.fromEntries(tasks.map((task) => [task.id, task]));
  calls = [];
  patchGates = [];
  desktopFetchSpy.mockReset();
  window.localStorage.clear();
  resetAttentionDismissalsForTests();
  __resetKanbanOverviewCacheForTests();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const call: Call = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const path = pathOf(url);
    if (path === "/api/workspaces") {
      return Promise.resolve(Response.json({ workspaces: [{ id: "w1", title: "Alpha", status: "active", metadata: {}, createdAt: iso(0), updatedAt: iso(0) }] }));
    }
    if (path === "/api/tasks") return Promise.resolve(Response.json({ tasks }));
    if (path === "/api/kanban/boards") return Promise.resolve(Response.json({ boards }));
    const single = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (single && method === "GET") return Promise.resolve(Response.json({ task: fresh[decodeURIComponent(single[1])] }));
    if (single) return new Promise<Response>((resolve, reject) => patchGates.push({ call, resolve, reject }));
    return Promise.resolve(new Response("not found", { status: 404 }));
  }));
  window.history.replaceState(null, "", "/workspace/w1/overview");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderReady(count = 4) {
  const view = render(<InboxPageClient now={NOW} />);
  await waitFor(() => expect(screen.getAllByTestId("inbox-row").length).toBe(count));
  return view;
}

function rowByTitle(title: string): HTMLElement {
  return screen.getAllByTestId("inbox-row").find((row) => row.querySelector("h3")?.textContent === title)!;
}

function handOffOf(title: string): HTMLButtonElement {
  return within(rowByTitle(title)).getByTestId("inbox-row-hand-off") as HTMLButtonElement;
}

const patches = () => calls.filter((call) => call.method === "PATCH");

describe("handler per row on the page (C1 rendered)", () => {
  it("shows AI resolver · working / AI resolver · queued / You from the board's Blocked lane", async () => {
    await renderReady();
    const handlerOf = (title: string) => rowByTitle(title).querySelector("[data-testid='inbox-row-handler'] [data-handler]")?.getAttribute("data-handler");
    expect([handlerOf("Running card"), handlerOf("Queued card"), handlerOf("Owner card"), handlerOf("Interrupted card")])
      .toEqual(["aiRunning", "aiQueued", "owner", "owner"]);
  });
});

describe("Hand to AI (C4, AC4)", () => {
  it("①②③ disabled with a reason; ④ enabled for idle Blocked cards (needs_owner included)", async () => {
    await renderReady();
    expect(handOffOf("Interrupted card").disabled).toBe(true);
    expect(handOffOf("Interrupted card").title).toBe("The card is not in Blocked; the resolver only handles Blocked cards");
    expect(handOffOf("Running card").disabled).toBe(true);
    expect(handOffOf("Running card").title).toBe("The Blocked Resolver is already working on this card");
    expect(handOffOf("Queued card").disabled).toBe(false);
    expect(handOffOf("Owner card").disabled).toBe(false);
  });

  it("② a board without the resolver: every Hand to AI disabled, every handler is You, Rerun unchanged (F2)", async () => {
    boards = [{ ...resolverBoard({ enabled: false } as never), workspaceId: "w1" } as KanbanBoardInfo];
    await renderReady();
    for (const title of ["Queued card", "Running card", "Owner card", "Interrupted card"]) {
      expect(handOffOf(title).disabled).toBe(true);
      expect(within(rowByTitle(title)).getByTestId("inbox-row-handler").querySelector("[data-handler]")!.getAttribute("data-handler")).toBe("owner");
    }
    expect(handOffOf("Queued card").title).toBe("This board's Blocked lane has no Blocked Resolver; turn on Automation for it in board settings");
    expect((within(rowByTitle("Interrupted card")).getByTestId("inbox-row-rerun") as HTMLButtonElement).disabled).toBe(false);
  });

  it("④ rechecks with GET, PATCHes retryTrigger once via desktopAwareFetch and shows the rerun badge", async () => {
    await renderReady();
    fireEvent.click(handOffOf("Queued card"));
    await waitFor(() => expect(patchGates).toHaveLength(1));
    const writes = calls.filter((call) => pathOf(call.url) === "/api/tasks/queued");
    expect(writes.map((call) => `${call.method} ${pathOf(call.url)}`)).toEqual(["GET /api/tasks/queued", "PATCH /api/tasks/queued"]);
    expect(patchGates[0].call.url.endsWith("/api/tasks/queued")).toBe(true);
    expect(patchGates[0].call.body).toEqual({ retryTrigger: true, retryProviderId: "dsh" });
    expect(desktopFetchSpy.mock.calls.map(([path, init]) => `${init?.method ?? "GET"} ${path}`)).toEqual(
      expect.arrayContaining(["GET /api/tasks/queued", "PATCH /api/tasks/queued"]),
    );
    expect(within(rowByTitle("Queued card")).getByTestId("inbox-row-retry-state").textContent).toBe("Starting…");
    await act(async () => patchGates[0].resolve(Response.json({ task: { triggerSessionId: "s-new" } })));
    await waitFor(() => expect(within(rowByTitle("Queued card")).getByTestId("inbox-row-retry-state").textContent).toBe("Rerun started"));
    expect(patches()).toHaveLength(1);
  });

  it("⑤ a 500 shows the same failure badge as Rerun, the page stays", async () => {
    await renderReady();
    fireEvent.click(handOffOf("Owner card"));
    await waitFor(() => expect(patchGates).toHaveLength(1));
    await act(async () => patchGates[0].resolve(Response.json({ error: "Internal failure" }, { status: 500 })));
    await waitFor(() => expect(within(rowByTitle("Owner card")).getByTestId("inbox-row-retry-state").textContent).toBe("Failed: Internal failure"));
    expect(screen.getByTestId("inbox-list")).toBeTruthy();
    expect(handOffOf("Owner card").disabled).toBe(false);
  });

  it("⑤' a network error shows the failure badge", async () => {
    await renderReady();
    fireEvent.click(handOffOf("Queued card"));
    await waitFor(() => expect(patchGates).toHaveLength(1));
    await act(async () => patchGates[0].reject(new Error("network down")));
    await waitFor(() => expect(within(rowByTitle("Queued card")).getByTestId("inbox-row-retry-state").textContent).toBe("Failed: network down"));
  });

  it("⑥ rendering (and re-rendering) sends no PATCH", async () => {
    const view = await renderReady();
    view.rerender(<InboxPageClient now={NOW} />);
    await waitFor(() => expect(screen.getAllByTestId("inbox-row").length).toBe(4));
    expect(patches()).toEqual([]);
  });

  it("⑦ a second click while the request is in flight sends nothing", async () => {
    await renderReady();
    fireEvent.click(handOffOf("Queued card"));
    await waitFor(() => expect(patchGates).toHaveLength(1));
    const before = calls.length;
    expect(handOffOf("Queued card").disabled).toBe(true);
    fireEvent.click(handOffOf("Queued card"));
    fireEvent.click(handOffOf("Owner card"));
    expect(calls.length).toBe(before);
    expect(patchGates).toHaveLength(1);
  });

  it("skips without PATCH when the fresh card shows the resolver already running", async () => {
    fresh.queued = { ...fresh.queued, laneSessions: [blockedRun(NOW - 60_000, "running")] };
    await renderReady();
    fireEvent.click(handOffOf("Queued card"));
    await waitFor(() => expect(within(rowByTitle("Queued card")).getByTestId("inbox-row-retry-state").textContent).toBe("Already running, skipped"));
    expect(patches()).toEqual([]);
  });

  it("F4: the all-workspaces path renders the fields too and its button sends the PATCH", async () => {
    await renderReady();
    fireEvent.click(screen.getByTestId("inbox-scope-all"));
    const group = await screen.findByTestId("inbox-group");
    const row = within(group).getAllByTestId("inbox-row").find((node) => node.querySelector("h3")?.textContent === "Queued card")!;
    expect(within(row).getByTestId("inbox-row-handler").textContent).toContain("AI resolver · queued");
    expect(within(row).getByTestId("inbox-row-handling")).toBeTruthy();
    fireEvent.click(within(row).getByTestId("inbox-row-hand-off"));
    await waitFor(() => expect(patchGates).toHaveLength(1));
    expect(patchGates[0].call.body).toMatchObject({ retryTrigger: true });
  });
});

describe("reason comment from the card detail (AC3 in the page)", () => {
  it("reads GET /api/tasks/<id> for a Blocked row without lastSyncError and shows the comment", async () => {
    const body = "主干推送中止：冲突，未推送。\n\n详情";
    tasks = [blockedCard("d5549adc", { title: "No error card" })];
    fresh = { d5549adc: { ...tasks[0], comments: [comment("c", body, iso(NOW - HOUR))] } };
    await renderReady(1);
    const dd = () => within(rowByTitle("No error card")).getByTestId("inbox-row-reason").querySelector("dd")!;
    await waitFor(() => expect(within(rowByTitle("No error card")).getByTestId("inbox-row-reason-why").children[1].textContent).toBe("主干推送中止：冲突，未推送。"));
    expect(dd().getAttribute("title")).toBe(body);
    expect(calls.filter((call) => pathOf(call.url) === "/api/tasks/d5549adc").map((call) => call.method)).toEqual(["GET"]);
  });

  it("keeps 'reason not recorded' when the detail read fails", async () => {
    tasks = [blockedCard("gone", { title: "Gone card" })];
    fresh = {};
    await renderReady(1);
    await waitFor(() => expect(calls.some((call) => pathOf(call.url) === "/api/tasks/gone")).toBe(true));
    expect(within(rowByTitle("Gone card")).getByTestId("inbox-row-reason").textContent).toBe("ReasonBlocked, reason not recorded");
  });
});

describe("old features stay visible next to the new ones (C6, AC5)", () => {
  it("every old field and control is rendered directly, plus handler / handling / Hand to AI on each row", async () => {
    tasks.push(doneCard("landed", "failed", { title: "Landed card", attentionResolution: resolution("landed"), autoResolutionRecord: "## 自动处理记录" }));
    tasks.push(doneCard("hidden", "failed", { title: "Hidden card" }));
    dismissAttentionItem("b1", "hidden|doneFailed|0");
    await renderReady(5);
    const list = screen.getByTestId("inbox-list");
    expect(within(list).getByTestId("inbox-bulk-bar")).toBeTruthy();
    expect(within(list).getByTestId("inbox-row-needs-owner").textContent).toBe("Needs owner");
    for (const row of within(list).getAllByTestId("inbox-row")) {
      for (const id of ["inbox-row-handler", "inbox-row-handling", "inbox-row-hand-off", "inbox-row-reason", "inbox-row-source", "inbox-row-next", "inbox-row-open", "inbox-row-dismiss"]) {
        const node = within(row).getByTestId(id);
        expect(node.closest("details")).toBeNull();
      }
      expect(within(row).getByText("Happened")).toBeTruthy();
      expect(row.querySelector("h3")?.textContent).toBeTruthy();
    }
    const interrupted = rowByTitle("Interrupted card");
    expect(within(interrupted).getByTestId("inbox-row-select")).toBeTruthy();
    expect(within(interrupted).getByTestId("inbox-row-rerun").textContent).toBe("Rerun");
    expect(within(interrupted).getByText("P1 · Failed")).toBeTruthy();
    expect(within(interrupted).getByText("Interrupted")).toBeTruthy();
    expect(screen.getByTestId("inbox-resolved").closest("details")).toBeNull();
    expect(within(screen.getByTestId("inbox-resolved")).getByText("Landed card")).toBeTruthy();
    const hidden = screen.getByTestId("inbox-dismissed");
    expect(within(hidden).getByTestId("inbox-row-restore")).toBeTruthy();
    expect(within(hidden).getByTestId("inbox-row-hand-off")).toBeTruthy();
  });
});
