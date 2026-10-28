import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ workspaceId: "w1" }),
}));

import { KanbanOverview } from "../kanban-overview";
import { __resetKanbanOverviewCacheForTests } from "../use-kanban-overview-data";
import { summarizeRhythm } from "../kanban-overview-status-rules";
import en from "@/i18n/locales/en";
import { I18nContext } from "@/i18n/context";

class MockEventSource {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly close = vi.fn();
  constructor(readonly url: string) {}
}

type Lane = NonNullable<TaskInfo["laneSessions"]>[number];
const MIN = 60_000;
const NOW = new Date(2026, 9, 28, 15, 0).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const day = (back: number, hour: number) => new Date(2026, 9, 28 - back, hour, 0).getTime();

let n = 0;
function lane(columnId: string, start: number, minutes: number, status: Lane["status"] = "completed"): Lane {
  n += 1;
  return { sessionId: `s${n}`, columnId, status, startedAt: iso(start), completedAt: iso(start + minutes * MIN) };
}
/** Done card whose dev work (and optional extra runs) takes `devMinutes` in total. */
function card(id: string, back: number, devRuns: Array<[number, Lane["status"]?]>): TaskInfo {
  const enter = day(back, 12);
  let cursor = enter - 600 * MIN;
  const runs: Lane[] = [];
  for (const [minutes, status] of devRuns) {
    runs.push(lane("dev", cursor, minutes, status ?? "completed"));
    cursor += minutes * MIN + MIN;
  }
  return {
    id, title: `Card ${id}`, status: "COMPLETED", columnId: "done", boardId: "bx", createdAt: iso(enter - 1000 * MIN), updatedAt: iso(enter),
    laneSessions: [...runs, { sessionId: `d${id}`, columnId: "done", status: "completed", startedAt: iso(enter), completedAt: iso(enter) }],
    completionReport: { excerpt: `sum ${id}`, commit: "abc1234", hasLeftover: false, createdAt: iso(enter) },
    deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 },
  } as TaskInfo;
}

// X: 30 min, 60 min, 120 min (dev ran 3 times: 40 + 40 + 40), 300 min with a 40-min timed_out run → AI 8.5 h in total.
const X: TaskInfo[] = [
  card("a", 0, [[30]]),
  card("b", 1, [[60]]),
  card("c", 1, [[40], [40], [40]]),
  card("d", 3, [[40, "timed_out"], [260]]),
];

function respond(url: string): Response {
  const parsed = new URL(url, "http://localhost");
  const ws = parsed.searchParams.get("workspaceId") ?? "";
  if (parsed.pathname === "/api/workspaces") {
    return Response.json({ workspaces: ["X", "Y"].map((id) => ({ id, title: `Project ${id}`, status: "active", metadata: {}, createdAt: iso(0), updatedAt: iso(0) })) });
  }
  if (parsed.pathname === "/api/tasks") return Response.json({ tasks: ws === "X" ? X : [] });
  if (parsed.pathname === "/api/kanban/boards") {
    const board = { id: "bx", workspaceId: ws, name: ws, isDefault: true, createdAt: iso(0), updatedAt: iso(0), columns: [{ id: "done", name: "Done", position: 0, stage: "done" }] } as unknown as KanbanBoardInfo;
    return Response.json({ boards: [board] });
  }
  return new Response("nf", { status: 404 });
}

beforeEach(() => {
  __resetKanbanOverviewCacheForTests();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => respond(url)));
  window.history.replaceState(null, "", "/workspace/w1/kanban?view=all&overviewMode=status");
});
afterEach(() => vi.unstubAllGlobals());

async function renderIt() {
  render(<I18nContext.Provider value={{ locale: "en", setLocale: () => {}, t: en }}><KanbanOverview onShowBoard={vi.fn()} now={NOW} /></I18nContext.Provider>);
  await waitFor(() => expect(screen.getByTestId("kanban-overview-group-done")).toBeTruthy());
}
const projectBlock = (ws: string) => screen.getAllByTestId("kanban-overview-rhythm-project").find((el) => el.getAttribute("data-workspace-id") === ws)!;

describe("summarizeRhythm numbers (AC6 / AC7)", () => {
  it("X: 4 cards, 8.5 h AI time, median = mean of the two middle values, 1 reworked, 1 stuck of 40 min", () => {
    const r = summarizeRhythm(X, NOW);
    expect(r.count).toBe(4);
    expect(r.totalMs).toBe((30 + 60 + 120 + 300) * MIN);
    expect(r.medianMs).toBe(90 * MIN);
    expect(r.reworkCards).toBe(2);
    expect(r.stuckCards).toBe(1);
    expect(r.stuckMs).toBe(40 * MIN);
  });
});

describe("right column and list durations (AC7)", () => {
  it("shows per-project stat, day bars, bucket titles and the median / rework / stuck line", async () => {
    await renderIt();
    const block = projectBlock("X");
    expect(within(block).getByTestId("kanban-overview-rhythm-stat").textContent).toBe("4 cards · AI 8.5 h");
    const counts = within(block).getAllByTestId("kanban-overview-rhythm-day").map((el) => el.getAttribute("data-count"));
    expect(counts).toEqual(["0", "0", "0", "1", "0", "2", "1"]);
    const buckets = Array.from(block.querySelectorAll("[data-bucket]")).map((el) => `${el.getAttribute("data-bucket")}:${el.getAttribute("title")}`);
    expect(buckets).toContain("build:Build 7 h 50 min");
    expect(buckets).toContain("stuck:Stuck 40 min");
    const line = within(block).getByTestId("kanban-overview-rhythm-line").textContent ?? "";
    expect(line).toContain("Median 1 h 30 min per card");
    expect(line).toContain("2 reworked");
    expect(line).toContain("1 stuck 40 min");
  });

  it("an empty project shows zeros and a placeholder median without crashing", async () => {
    await renderIt();
    const block = projectBlock("Y");
    expect(within(block).getByTestId("kanban-overview-rhythm-stat").textContent).toBe("0 cards · AI 0 h");
    expect(within(block).getByTestId("kanban-overview-rhythm-line").textContent).toContain("Median — per card");
  });

  it("list rows show a small bar, total time, rework and stuck badges", async () => {
    await renderIt();
    // Only today is open; open the earlier days so every card has a row.
    for (const toggle of screen.getAllByTestId("kanban-overview-day-toggle")) {
      if (toggle.getAttribute("aria-expanded") === "false") fireEvent.click(toggle);
    }
    const rows = screen.getAllByTestId("kanban-overview-status-row");
    const rowOf = (id: string) => rows.find((r) => r.querySelector(`[data-task-id="${id}"]`))!;
    expect(within(rowOf("c")).getByTestId("kanban-overview-done-duration").textContent).toContain("2 h");
    expect(rowOf("c").textContent).toContain("Rework 2");
    expect(rowOf("a").textContent).not.toContain("Rework");
    expect(within(rowOf("a")).getByTestId("kanban-overview-duration-bar")).toBeTruthy();
    expect(within(rowOf("d")).getByText("Stuck 40 min")).toBeTruthy();
  });

  it("'stuck' narrows the Done list to stuck cards; a second click restores it; a project name acts like its capsule", async () => {
    await renderIt();
    const before = within(screen.getByTestId("kanban-overview-group-done")).getAllByTestId("kanban-overview-card").length;
    fireEvent.click(screen.getByTestId("kanban-overview-rhythm-stuck"));
    expect(screen.getByTestId("kanban-overview-rhythm-stuck").getAttribute("aria-pressed")).toBe("true");
    const stuckIds = Array.from(screen.getByTestId("kanban-overview-group-done").querySelectorAll("[data-task-id]")).map((el) => el.getAttribute("data-task-id"));
    // Only "d" is stuck and it sits on an earlier day, so its day is collapsed: the day preview names it.
    expect(stuckIds).toEqual([]);
    expect(screen.getByTestId("kanban-overview-day-preview").textContent).toBe("Card d");
    fireEvent.click(screen.getByTestId("kanban-overview-rhythm-stuck"));
    expect(within(screen.getByTestId("kanban-overview-group-done")).getAllByTestId("kanban-overview-card")).toHaveLength(before);

    fireEvent.click(within(projectBlock("Y")).getByTestId("kanban-overview-rhythm-name"));
    expect(screen.getAllByTestId("kanban-overview-capsule").find((c) => c.getAttribute("data-workspace-id") === "Y")!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(projectBlock("Y")).getByTestId("kanban-overview-rhythm-name"));
    expect(screen.getAllByTestId("kanban-overview-capsule").every((c) => c.getAttribute("aria-pressed") === "false")).toBe(true);
  });
});
