import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enTail } from "@/i18n/locales/en-tail";
import { KanbanCardActivityBar } from "../kanban-card-activity";
import { buildRunTabTooltip } from "../kanban-run-tab-tooltip";
import type { TaskInfo, TaskRunInfo } from "../../types";
import { createDetailTask } from "./kanban-detail-fixtures";

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

const en = enTail.kanbanDetailRedesign.runTabTooltip;

function mockRuns(taskId: string, runs: Partial<TaskRunInfo>[]) {
  desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === `/api/tasks/${taskId}/runs`) {
      return new Response(JSON.stringify({ runs }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected desktopAwareFetch: ${url}`);
  });
}

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

const LANES: LaneSession[] = [
  { sessionId: "s-dev", columnId: "dev", columnName: "Dev", stepName: "Flight Dev Crafter", status: "running", startedAt: "2026-10-23T02:48:16Z", completedAt: "2026-10-23T03:47:26Z" },
  { sessionId: "s-review", columnId: "review", columnName: "Review", stepName: "Review Guard", status: "completed", startedAt: "2026-10-23T04:04:28Z", completedAt: "2026-10-23T04:05:18Z" },
  { sessionId: "s-backlog", columnId: "backlog", columnName: "Backlog", stepName: "Backlog Refiner", status: "completed", startedAt: "2026-10-23T01:00:00Z", completedAt: "2026-10-23T01:30:00Z" },
  // Lane session without a start time: time line must come from the run.
  { sessionId: "s-todo", columnId: "todo", columnName: "Todo", stepName: "Planner", status: "completed", startedAt: "" } as LaneSession,
];

const RUNS: Partial<TaskRunInfo>[] = [
  // Run status wins over the lane status; run start time differs and must be ignored.
  { id: "r-dev", sessionId: "s-dev", status: "timed_out", kind: "embedded_acp", startedAt: "2026-10-23T09:00:00Z", completedAt: "2026-10-23T09:30:00Z" },
  { id: "r-review", sessionId: "s-review", status: "failed", kind: "embedded_acp", startedAt: "2026-10-23T04:04:28Z", completedAt: "2026-10-23T04:05:18Z" },
  { id: "r-todo", sessionId: "s-todo", status: "transitioned", kind: "embedded_acp", startedAt: "2026-10-23T05:00:00Z", completedAt: "2026-10-23T05:10:00Z" },
  // Run-only tab (no lane session): status and time both come from the run.
  { id: "r-extra", sessionId: "s-extra", status: "completed", kind: "embedded_acp", columnId: "done", startedAt: "2026-10-23T06:00:00Z", completedAt: "2026-10-23T06:20:00Z" },
];

function renderBar(onSelectSession = vi.fn(), onCloseSession = vi.fn()) {
  mockRuns("task-wiring", RUNS);
  const utils = render(
    <KanbanCardActivityBar
      task={createDetailTask("task-wiring", "Wiring", { laneSessions: LANES, triggerSessionId: "s-review" })}
      currentSessionId="s-review"
      onSelectSession={onSelectSession}
      onCloseSession={onCloseSession}
    />,
  );
  return { ...utils, onSelectSession, onCloseSession };
}

async function runTabs(): Promise<HTMLButtonElement[]> {
  await waitFor(() => {
    expect(screen.getAllByRole("button", { pressed: false }).length + screen.getAllByRole("button", { pressed: true }).length).toBe(5);
  });
  return [...screen.getAllByRole("button", { pressed: false }), ...screen.getAllByRole("button", { pressed: true })]
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)) as HTMLButtonElement[];
}

function expected(index: number, input: Partial<Parameters<typeof buildRunTabTooltip>[0]>) {
  return buildRunTabTooltip({ index, now: new Date(), copy: en, ...input });
}

beforeEach(() => {
  desktopAwareFetch.mockReset();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("run tab hover text wiring (C6, F4)", () => {
  it("every tab title equals buildRunTabTooltip for the same inputs, with real line breaks", async () => {
    renderBar();
    const tabs = await runTabs();
    await waitFor(() => expect(tabs[0].getAttribute("title")).toContain("Timed out"));

    const titles = tabs.map((tab) => tab.getAttribute("title") ?? "");
    expect(titles).toEqual([
      // laneSession time wins over the run time; run status wins over lane status.
      expected(0, { columnId: "dev", columnName: "Dev", status: "timed_out", startedAt: LANES[0].startedAt, completedAt: LANES[0].completedAt, stepLabel: "Flight Dev Crafter" }),
      expected(1, { columnId: "review", columnName: "Review", status: "failed", startedAt: LANES[1].startedAt, completedAt: LANES[1].completedAt, stepLabel: "Review Guard" }),
      // Lane-only tab: no run, status and time from the lane session.
      expected(2, { columnId: "backlog", columnName: "Backlog", status: "completed", startedAt: LANES[2].startedAt, completedAt: LANES[2].completedAt, stepLabel: "Backlog Refiner" }),
      // Lane session lacks a time: falls back to the run time.
      expected(3, { columnId: "todo", columnName: "Todo", status: "transitioned", startedAt: "2026-10-23T05:00:00Z", completedAt: "2026-10-23T05:10:00Z", stepLabel: "Planner" }),
      expected(4, { columnId: "done", status: "completed", startedAt: "2026-10-23T06:00:00Z", completedAt: "2026-10-23T06:20:00Z", stepLabel: titles[4].split("\n").at(-1) }),
    ]);

    for (const [i, title] of titles.entries()) {
      expect(title.includes("\n")).toBe(true);
      expect(title.includes("\\n")).toBe(false);
      expect(title.startsWith(`Run ${i + 1} · `)).toBe(true);
    }
    expect(titles[0].split("\n")[1]).toBe(en.statuses.timed_out);
    expect(titles[2].split("\n")[1]).toBe(en.statuses.completed);
    expect(titles[3].split("\n")[2]).toMatch(/^\d\d:\d\d–\d\d:\d\d, 10 min$/);
    expect(titles[4].split("\n")[0]).toBe(`Run 5 · ${en.lanes.done}`);
  });

  it("icon and number spans carry no title; hovering either resolves to the button title", async () => {
    renderBar();
    const tabs = await runTabs();
    for (const tab of tabs) {
      const [icon, number] = Array.from(tab.children) as HTMLElement[];
      expect(tab.querySelectorAll("[title]")).toHaveLength(0);
      expect(icon.getAttribute("title")).toBeNull();
      expect(number.getAttribute("title")).toBeNull();
      expect(icon.parentElement?.closest("[title]")).toBe(tab);
      expect(number.parentElement?.closest("[title]")).toBe(tab);
      expect(tab.hasAttribute("aria-describedby")).toBe(false);
    }
    expect(screen.getByLabelText("Dev").getAttribute("title")).toBeNull();
    expect(screen.getByLabelText("Review")).toBeTruthy();
  });
});

describe("run tab look and behaviour unchanged (C7)", () => {
  it("keeps structure, classes, aria-pressed, click switching and the hide-pane button", async () => {
    const { onSelectSession, onCloseSession } = renderBar();
    const tabs = await runTabs();
    await waitFor(() => expect(tabs[0].className).toContain("border-danger"));

    for (const [i, tab] of tabs.entries()) {
      expect(tab.tagName).toBe("BUTTON");
      expect(tab.children).toHaveLength(2);
      expect(Array.from(tab.children).map((child) => child.tagName)).toEqual(["SPAN", "SPAN"]);
      expect(tab.children[0].className).toBe("inline-flex h-5 w-5 items-center justify-center rounded-full bg-subtle text-secondary");
      expect(tab.children[0].querySelector("svg")).toBeTruthy();
      expect(tab.children[1].textContent).toBe(String(i + 1));
      expect(tab.className).toContain("inline-flex min-w-0 items-center gap-1 rounded-full border px-1.5 py-0.5");
    }
    // timed_out / failed keep the red border; the selected tab keeps the active style.
    expect(tabs[0].className).toContain("border-danger");
    expect(tabs[1].className).toContain("border-danger bg-danger-subtle");
    expect(tabs[1].getAttribute("aria-pressed")).toBe("true");
    expect(tabs[0].getAttribute("aria-pressed")).toBe("false");
    expect(tabs[0].parentElement?.className).toContain("flex-wrap");

    fireEvent.click(tabs[0]);
    expect(onSelectSession).toHaveBeenCalledWith("s-dev");

    const hide = screen.getByRole("button", { name: "Hide session pane" });
    fireEvent.click(hide);
    expect(onCloseSession).toHaveBeenCalledTimes(1);

    expect(document.querySelector("[role='tooltip']")).toBeNull();
    // The status chip row under the tabs is still rendered for the selected run.
    const laneChip = screen.getByText("Review");
    expect(laneChip.tagName).toBe("SPAN");
    expect(laneChip.className).toContain("rounded-full bg-accent-subtle");
    expect(laneChip.parentElement?.className).toContain("flex flex-wrap items-center gap-1.5 border-b");
  });
});
