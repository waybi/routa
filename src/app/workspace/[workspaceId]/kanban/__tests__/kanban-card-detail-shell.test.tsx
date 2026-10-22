import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
import { useKanbanTaskDetailHydration } from "../use-kanban-task-detail-hydration";
import type { TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import { createDetailTask, detailBoard } from "./kanban-detail-fixtures";

/**
 * Card detail redesign (card 3/6) wired into the board: three columns,
 * session pane hide/show, Esc close, and the open-time hydration states.
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

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.history.replaceState({}, "", "/workspace/workspace-1/kanban");
});

const a2aTask = createDetailTask("task-1", "Story One", {
  sessionIds: ["a2a-session-1"],
  triggerSessionId: "a2a-session-1",
  laneSessions: [{
    sessionId: "a2a-session-1",
    transport: "a2a",
    status: "completed",
    columnId: "backlog",
    columnName: "Backlog",
    externalTaskId: "remote-task-1",
    startedAt: "2025-01-01T00:00:00.000Z",
  }],
});

function renderBoard(tasks: TaskInfo[]) {
  return render(
    <KanbanTab
      workspaceId="workspace-1"
      boards={[detailBoard]}
      tasks={tasks}
      sessions={[]}
      providers={[]}
      specialists={[]}
      codebases={[]}
      onRefresh={vi.fn()}
    />,
  );
}

describe("card detail shell", () => {
  it("lays out detail + property rail + session pane, and the rail moves under the detail on narrow screens", async () => {
    renderBoard([a2aTask]);
    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));

    const detail = await screen.findByTestId("kanban-card-detail");
    const rail = within(detail).getByTestId("kanban-detail-property-rail");
    const railColumn = rail.parentElement as HTMLElement;
    // Wide: the rail is a fixed-width side column (~210px at xl, 170px at lg).
    expect(railColumn.className).toContain("xl:w-[210px]");
    expect(railColumn.className).toContain("lg:w-[170px]");
    // Narrow: the body stacks (flex-col) and only switches to a row at lg.
    expect(railColumn.parentElement?.className).toContain("flex-col");
    expect(railColumn.parentElement?.className).toContain("lg:flex-row");
    // Main column and session pane scroll on their own.
    expect(within(detail).getByTestId("kanban-detail-main").className).toContain("lg:overflow-y-auto");
    expect(screen.getByTestId("kanban-detail-split-handle")).toBeTruthy();
    const sessionColumn = screen.getByTestId("kanban-detail-split-handle").nextElementSibling as HTMLElement;
    expect(sessionColumn.contains(screen.getByTestId("kanban-session-pane-top-row"))).toBe(true);
    expect(sessionColumn.style.width).toMatch(/%$/);
    expect(sessionColumn.className).toContain("min-w-[260px]");
    expect(sessionColumn.className).toContain("max-w-[60%]");
  });

  it("hides only the session pane and shows it again from the toolbar", async () => {
    renderBoard([a2aTask]);
    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));
    const topRow = await screen.findByTestId("kanban-session-pane-top-row");

    fireEvent.click(within(topRow).getByRole("button", { name: "Hide session pane" }));
    await waitFor(() => expect(screen.queryByTestId("kanban-session-pane-top-row")).toBeNull());
    expect(screen.getByTestId("kanban-card-detail")).toBeTruthy();

    const toolbar = screen.getByTestId("kanban-detail-sticky-toolbar");
    fireEvent.click(within(toolbar).getByRole("button", { name: "Show session pane" }));
    expect(await screen.findByTestId("kanban-session-pane-top-row")).toBeTruthy();
    expect(within(toolbar).queryByRole("button", { name: "Show session pane" })).toBeNull();
  });

  it("closes the detail with Esc", async () => {
    renderBoard([createDetailTask("task-1", "Story One")]);
    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));
    await screen.findByTestId("kanban-card-detail");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("kanban-card-detail")).toBeNull());
  });

  it("shows the loading skeleton while the full record is read, then the content", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    desktopAwareFetch.mockImplementation((input: RequestInfo | URL) => {
      if (String(input) === "/api/tasks/task-1") {
        return new Promise<Response>((resolve) => { resolveFetch = resolve; });
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
    });
    renderBoard([createDetailTask("task-1", "Story One", { testCases: ["Summary line"] })]);
    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));

    expect(await screen.findByTestId("kanban-detail-loading")).toBeTruthy();
    await act(async () => {
      resolveFetch?.(new Response(JSON.stringify({ task: createDetailTask("task-1", "Story One", { testCases: ["Full line"] }) }), { status: 200 }));
    });
    await waitFor(() => expect(screen.queryByTestId("kanban-detail-loading")).toBeNull());
  });

  it("shows the error state when the read fails and retries on Read again", async () => {
    let calls = 0;
    desktopAwareFetch.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/tasks/task-1") {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ error: "db locked" }), { status: 500 });
        return new Response(JSON.stringify({ task: createDetailTask("task-1", "Story One") }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    renderBoard([createDetailTask("task-1", "Story One")]);
    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));

    const error = await screen.findByTestId("ui-error-state");
    expect(error.textContent).toContain("db locked");
    expect(screen.getByDisplayValue("Story One")).toBeTruthy();
    fireEvent.click(within(error).getByRole("button", { name: "Read again" }));
    await waitFor(() => expect(screen.queryByTestId("ui-error-state")).toBeNull());
    expect(calls).toBe(2);
  });
});

describe("useKanbanTaskDetailHydration", () => {
  it("is loading until the first read settles and keeps earlier data on a later failure", async () => {
    const fetchTaskById = vi.fn()
      .mockResolvedValueOnce(createDetailTask("t", "Full"))
      .mockRejectedValueOnce(new Error("offline"));
    const { result, rerender } = renderHook(
      ({ updatedAt }: { updatedAt: string }) => useKanbanTaskDetailHydration("t", updatedAt, fetchTaskById),
      { initialProps: { updatedAt: "1" } },
    );
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.hydratedTaskDetails.t?.title).toBe("Full"));
    expect(result.current.loading).toBe(false);

    rerender({ updatedAt: "2" });
    await waitFor(() => expect(result.current.error).toBe("offline"));
    expect(result.current.hydratedTaskDetails.t?.title).toBe("Full");
  });
});
