import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
import { KanbanTab } from "../kanban-tab";
import { countKanbanCardRuns, KanbanCardActivityBar } from "../kanban-card-activity";
import type { TaskInfo, TaskRunInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import { createDetailTask, detailBoard } from "./kanban-detail-fixtures";

/**
 * Card 8a2d2555 AC8 / AC17 / AC19: the session pane header of the card
 * detail is two lines at most — run tabs on one scrolling line with the
 * hide button pinned, then the selected run's chips together with session
 * id, Debug and Chat / Trace — and the run sub-tabs (with counts) are back
 * in both the detail's Runs tab and the A2A session pane.
 */

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return { useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus };
});

let ledger: TaskRunInfo[] = [];

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  ledger = [];
  desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
    if (/\/runs/.test(String(input))) return new Response(JSON.stringify({ runs: ledger }), { status: 200 });
    return new Response(JSON.stringify({ artifacts: [] }), { status: 200 });
  });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, "", "/workspace/workspace-1/kanban?taskId=task-1");
});

function makeAcp(error: string | null) {
  return {
    connected: true,
    sessionId: null,
    updates: [],
    providers: [{ id: "claude", name: "Claude Code", description: "", command: "claude" }],
    selectedProvider: "claude",
    loading: false,
    error,
    authError: null,
    dockerConfigError: null,
    connect: vi.fn(),
    createSession: vi.fn(),
    resumeSession: vi.fn(),
    forkSession: vi.fn(),
    selectSession: vi.fn(),
    setProvider: vi.fn(),
    setMode: vi.fn(),
    prompt: vi.fn(),
    promptSession: vi.fn(),
    respondToUserInput: vi.fn(),
    respondToUserInputForSession: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    cancel: vi.fn(),
    disconnect: vi.fn(),
    clearAuthError: vi.fn(),
    clearDockerConfigError: vi.fn(),
    listProviderModels: vi.fn(),
  } satisfies Partial<UseAcpState & UseAcpActions> as UseAcpState & UseAcpActions;
}

function tenRunCard(lastStatus: "completed" | "running", overrides: Partial<TaskInfo> = {}): TaskInfo {
  const laneSessions = Array.from({ length: 10 }, (_, index) => ({
    sessionId: `s-${index + 1}`,
    columnId: "backlog",
    columnName: "Backlog",
    status: index === 9 ? lastStatus : ("completed" as const),
    startedAt: `2026-10-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
  }));
  return createDetailTask("task-1", "Story One", {
    sessionIds: laneSessions.map((entry) => entry.sessionId),
    triggerSessionId: "s-10",
    laneSessions,
    ...overrides,
  });
}

function renderBoard(task: TaskInfo, acp?: UseAcpState & UseAcpActions) {
  return render(
    <KanbanTab
      workspaceId="workspace-1"
      boards={[detailBoard]}
      tasks={[task]}
      sessions={[]}
      providers={acp?.providers ?? []}
      specialists={[]}
      codebases={[]}
      onRefresh={vi.fn()}
      acp={acp}
    />,
  );
}

const GONE = "ACP agent (dsh) process is not running";

describe("session pane header: at most two lines (AC8)", () => {
  it("line 1: ten run tabs on one scrolling line, hide button pinned in the same row", async () => {
    renderBoard(tenRunCard("completed"), makeAcp(GONE));
    const runTabs = await screen.findByTestId("kanban-run-tabs");
    expect(runTabs.className).not.toContain("flex-wrap");
    expect(runTabs.className).toContain("overflow-x-auto");
    expect(runTabs.querySelectorAll("button")).toHaveLength(10);
    const row = screen.getByTestId("kanban-run-tabs-row");
    const hide = within(row).getByRole("button", { name: "Hide session pane" });
    expect(runTabs.contains(hide)).toBe(false);
  });

  it("line 2: run chips, session id, Debug and Chat / Trace share the chat panel's info row; no two-line finished banner", async () => {
    renderBoard(tenRunCard("completed"), makeAcp(GONE));
    const infoRow = await screen.findByTestId("chat-session-info-row");
    expect(within(infoRow).getByTestId("kanban-run-status-chips")).toBeTruthy();
    expect(within(infoRow).getByText("Backlog")).toBeTruthy();
    expect(within(infoRow).getByText(/s-10/)).toBeTruthy();
    expect(within(infoRow).getByRole("link", { name: "Debug" })).toBeTruthy();
    expect(within(infoRow).getByRole("button", { name: "Chat" })).toBeTruthy();
    expect(screen.queryByTestId("kanban-run-status-row")).toBeNull();
    expect(screen.queryByTestId("chat-ended-banner")).toBeNull();
    const note = within(infoRow).getByTestId("chat-ended-inline");
    expect(note.getAttribute("title")?.length ?? 0).toBeGreaterThan(note.textContent?.length ?? 0);
  });

  it("a real send failure still shows the red banner with Resume", async () => {
    renderBoard(tenRunCard("running"), makeAcp(GONE));
    expect(await screen.findByTestId("chat-error-banner")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("without a chat panel the chips get their own row (A2A / no ACP)", () => {
    render(<KanbanCardActivityBar task={tenRunCard("completed")} currentSessionId="s-10" onCloseSession={vi.fn()} />);
    expect(screen.getByTestId("kanban-run-status-row").className).toContain("overflow-x-auto");
  });
});

describe("selected run shows both the run status and the lane status (AC19 ②)", () => {
  it("run completed, lane running → two badges in the chips", async () => {
    ledger = [{ id: "run-10", kind: "embedded_acp", status: "completed", sessionId: "s-10", startedAt: "2026-10-19T00:00:00.000Z" }];
    render(<KanbanCardActivityBar task={tenRunCard("running")} currentSessionId="s-10" onCloseSession={vi.fn()} />);
    const chips = await screen.findByTestId("kanban-run-status-badge");
    const row = chips.closest("[data-testid='kanban-run-status-chips']") as HTMLElement;
    expect(within(row).getByTestId("kanban-run-status-badge").textContent).toBe("Ended");
    expect(within(row).getByTestId("kanban-lane-status-badge").textContent).toBe("Running");
  });
});

describe("run sub-tabs with counts (AC3 ⑦ / AC17 / AC19 ①)", () => {
  beforeEach(() => {
    ledger = ["a2a-1", "a2a-2", "a2a-3"].map((sessionId, index) => ({
      id: `run-${index}`,
      kind: "a2a_task" as const,
      status: "completed" as const,
      sessionId,
      startedAt: `2026-10-2${index}T00:00:00.000Z`,
    }));
  });

  const handoffCard = (overrides: Partial<TaskInfo> = {}) => createDetailTask("task-1", "Story One", {
    sessionIds: ["a2a-1", "a2a-2", "a2a-3"],
    triggerSessionId: "a2a-3",
    laneSessions: ["a2a-1", "a2a-2", "a2a-3"].map((sessionId, index) => ({
      sessionId,
      transport: "a2a",
      status: "completed" as const,
      columnId: "backlog",
      columnName: "Backlog",
      startedAt: `2026-10-2${index}T00:00:00.000Z`,
    })),
    laneHandoffs: [{
      id: "h-1",
      fromSessionId: "a2a-3",
      toSessionId: "a2a-2",
      requestType: "runtime_context",
      request: "Share the preview URL",
      status: "completed",
      requestedAt: "2026-10-22T01:00:00.000Z",
    }],
    githubNumber: 7,
    githubUrl: "https://github.com/o/r/issues/7",
    githubRepo: "o/r",
    ...overrides,
  });

  it("the A2A session pane shows Run records 3 / Handoffs 1 / GitHub and switches between them", async () => {
    renderBoard(handoffCard());
    // The A2A session pane (not the detail: it opens on Overview).
    const pane = (await screen.findByText("A2A Run")).closest("div.flex.h-full") as HTMLElement;
    expect(pane.contains(screen.getByTestId("kanban-session-pane-top-row"))).toBe(true);
    const subtabs = within(pane).getByTestId("kanban-activity-subtabs");
    await within(subtabs).findByText("3");
    expect(within(subtabs).getAllByRole("button").map((button) => button.textContent)).toEqual(["Run records3", "Handoffs1", "GitHub"]);
    fireEvent.click(within(subtabs).getByTestId("kanban-activity-subtab-handoffs"));
    expect(within(pane).getByText("Share the preview URL")).toBeTruthy();
    fireEvent.click(within(subtabs).getByTestId("kanban-activity-subtab-github"));
    expect(within(pane).getByRole("link", { name: "#7" }).getAttribute("href")).toBe("https://github.com/o/r/issues/7");
    expect(within(pane).getByText("o/r")).toBeTruthy();
  });

  it("the detail's Runs tab shows the same three sub-tabs", async () => {
    renderBoard(handoffCard());
    await screen.findByTestId("kanban-card-detail");
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    const panel = screen.getByTestId("kanban-detail-panel-runs");
    expect(within(panel).getAllByTestId(/^kanban-activity-subtab-(runs|handoffs|github)$/).map((tab) => tab.textContent)).toEqual(["Run records3", "Handoffs1", "GitHub"]);
    fireEvent.click(within(panel).getByTestId("kanban-activity-subtab-handoffs"));
    expect(within(panel).getByText("Share the preview URL")).toBeTruthy();
  });

  it("without handoffs and GitHub only Run records is offered", async () => {
    renderBoard(handoffCard({ laneHandoffs: [], githubNumber: undefined, githubUrl: undefined }));
    await screen.findByTestId("kanban-card-detail");
    fireEvent.click(screen.getByRole("tab", { name: "Runs" }));
    const panel = screen.getByTestId("kanban-detail-panel-runs");
    expect(within(within(panel).getByTestId("kanban-activity-subtabs")).getAllByRole("button").map((button) => button.textContent)).toEqual(["Run records3"]);
  });

  it("counts the run ledger when it loaded, otherwise the card's session ids", () => {
    const task = handoffCard();
    expect(countKanbanCardRuns(task, null)).toBe(3);
    expect(countKanbanCardRuns(task, undefined)).toBe(3);
    expect(countKanbanCardRuns(task, [{ id: "r", kind: "a2a_task", status: "completed", startedAt: "x" }])).toBe(1);
  });
});
