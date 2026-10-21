import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return {
    ...actual,
    desktopAwareFetch,
  };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return {
    useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus,
  };
});

const board: KanbanBoardInfo = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Default Board",
  isDefault: true,
  sessionConcurrencyLimit: 1,
  queue: {
    runningCount: 0,
    runningCards: [],
    queuedCount: 0,
    queuedCardIds: [],
    queuedCards: [],
    queuedPositions: {},
  },
  columns: [
    { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
  ],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

function createTask(id: string, title: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title,
    objective: `${title} objective`,
    status: "PENDING",
    boardId: board.id,
    columnId: "backlog",
    position: 0,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function expectClasses(element: Element | null, present: string[], absent: string[] = []) {
  const classes = Array.from(element?.classList ?? []);
  for (const name of present) expect(classes).toContain(name);
  for (const name of absent) expect(classes).not.toContain(name);
}

function getDetailOverlay() {
  const toolbar = screen.getByTestId("kanban-detail-sticky-toolbar");
  const outer = toolbar.closest(".fixed.inset-0") as HTMLElement;
  return { outer, inner: outer.firstElementChild as HTMLElement };
}

function expectFullscreenOverlay() {
  const { outer, inner } = getDetailOverlay();
  expectClasses(outer, ["items-stretch"], ["px-4", "py-6"]);
  expectClasses(inner, ["h-screen", "max-w-none", "border-0"], ["h-[88vh]", "max-w-7xl"]);
  expect(screen.getByRole("button", { name: /Exit fullscreen/i })).toBeTruthy();
}

function expectWindowedOverlay() {
  const { inner } = getDetailOverlay();
  expectClasses(inner, ["h-[88vh]", "max-w-7xl"], ["h-screen"]);
  expect(screen.getByRole("button", { name: /Enter fullscreen/i })).toBeTruthy();
}

const RED_COLOR_CLASS = /(?:^|\s)(?:[a-z-]+:)*(?:bg|text|border|ring)-(?:red|rose)-/;

function getToolbarCloseButton(): HTMLElement {
  return within(screen.getByTestId("kanban-detail-sticky-toolbar")).getByRole("button", { name: /Close card detail/i });
}

function expectToolbarCloseButton() {
  const closeButtons = screen.getAllByRole("button", { name: /Close card detail/i });
  expect(closeButtons).toHaveLength(1);
  const [closeButton] = closeButtons;
  expect(screen.getByTestId("kanban-detail-sticky-toolbar").contains(closeButton)).toBe(true);
  expect(closeButton.parentElement?.firstElementChild).toBe(closeButton);
  expectClasses(closeButton, [
    "rounded-full", "h-8", "text-[13px]", "border-slate-300", "text-slate-700",
    "dark:border-slate-600", "dark:text-slate-200",
    "hover:border-amber-300", "hover:bg-amber-50", "hover:text-amber-700",
  ]);
  expect(closeButton.className).not.toMatch(RED_COLOR_CLASS);
  expectClasses(closeButton.querySelector("svg"), ["h-4", "w-4"]);
  expect(closeButton.textContent?.trim()).toBe("Close card detail");
  expect(closeButton.getAttribute("title")).toBe("Close (Esc)");
}

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.history.replaceState({}, "", "/workspace/workspace-1/kanban");
});

describe("KanbanTab URL state", () => {
  it("syncs card detail open and close with the taskId query param", async () => {
    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));
    await screen.findByText("Card Detail");

    expect(window.location.search).toContain("taskId=task-1");
    expectFullscreenOverlay();

    fireEvent.click(getToolbarCloseButton());

    await waitFor(() => {
      expect(screen.queryByText("Card Detail")).toBeNull();
    });
    expect(window.location.search).not.toContain("taskId=");
  });

  it("reopens the correct card detail when history navigation restores the taskId query param", async () => {
    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One"), createTask("task-2", "Story Two")]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story Two" }));
    await screen.findByDisplayValue("Story Two");

    fireEvent.click(getToolbarCloseButton());
    await waitFor(() => {
      expect(screen.queryByText("Card Detail")).toBeNull();
    });

    window.history.pushState({}, "", "/workspace/workspace-1/kanban?taskId=task-1");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await screen.findByText("Card Detail");
    expect(screen.getByDisplayValue("Story One")).toBeTruthy();
    expectFullscreenOverlay();

    fireEvent.click(screen.getByRole("button", { name: /Exit fullscreen/i }));
    expectWindowedOverlay();

    window.history.pushState({}, "", "/workspace/workspace-1/kanban?taskId=task-2");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await screen.findByDisplayValue("Story Two");
    expectFullscreenOverlay();
  });

  it("opens card detail fullscreen from a deep link", async () => {
    window.history.replaceState({}, "", "/workspace/workspace-1/kanban?taskId=task-1");

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One")]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await screen.findByDisplayValue("Story One");
    expectFullscreenOverlay();
  });

  it("keeps exit-fullscreen across board refreshes and reopens fullscreen with a single toolbar close button", async () => {
    const props = {
      workspaceId: "workspace-1",
      boards: [board],
      sessions: [],
      providers: [],
      specialists: [],
      codebases: [],
      onRefresh: vi.fn(),
    };
    const { rerender } = render(
      <KanbanTab {...props} tasks={[createTask("task-1", "Story One"), createTask("task-2", "Story Two")]} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));
    await screen.findByText("Card Detail");
    expectFullscreenOverlay();

    expectToolbarCloseButton();
    expectClasses(screen.getByTestId("kanban-detail-sticky-toolbar"), ["pr-4"], ["pr-12"]);

    fireEvent.click(screen.getByRole("button", { name: /Exit fullscreen/i }));
    expectWindowedOverlay();
    expectToolbarCloseButton();

    rerender(
      <KanbanTab
        {...props}
        tasks={[createTask("task-1", "Story One", { title: "Story One refreshed" }), createTask("task-2", "Story Two")]}
      />,
    );
    await screen.findByDisplayValue("Story One refreshed");
    expectWindowedOverlay();

    fireEvent.click(getToolbarCloseButton());
    await waitFor(() => {
      expect(screen.queryByText("Card Detail")).toBeNull();
    });
    expect(window.location.search).not.toContain("taskId=");

    fireEvent.click(screen.getByRole("button", { name: "Open Story Two" }));
    await screen.findByDisplayValue("Story Two");
    expectFullscreenOverlay();
  });

  it("hides only the session pane from its top row and restores it from the toolbar", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[createTask("task-1", "Story One", {
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
        })]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Story One" }));
    const topRow = await screen.findByTestId("kanban-session-pane-top-row");
    expectClasses(topRow, ["pr-2"], ["pr-12"]);
    expect(screen.getAllByRole("button", { name: /Close card detail/i })).toHaveLength(1);
    const hideButtons = within(topRow).getAllByRole("button", { name: /Hide session pane/i });
    expect(hideButtons).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Hide session pane/i })).toHaveLength(1);
    expect(hideButtons[0].textContent?.trim()).toBe("Hide session pane");
    expect(screen.getByTestId("kanban-detail-split-handle")).toBeTruthy();

    fireEvent.click(hideButtons[0]);

    await waitFor(() => {
      expect(screen.queryByTestId("kanban-session-pane-top-row")).toBeNull();
    });
    expect(screen.queryByTestId("kanban-detail-split-handle")).toBeNull();
    expect(screen.getByText("Card Detail")).toBeTruthy();
    expect(window.location.search).toContain("taskId=task-1");

    fireEvent.click(within(screen.getByTestId("kanban-detail-sticky-toolbar")).getByRole("button", { name: /Show session pane/i }));
    expect(await screen.findByTestId("kanban-session-pane-top-row")).toBeTruthy();
    expect(screen.getByTestId("kanban-detail-split-handle")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show session pane/i })).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Card Detail")).toBeNull();
    });
  });

  it("syncs board selection with boardId and restores a deep-linked board/task combination", async () => {
    const secondBoard: KanbanBoardInfo = {
      ...board,
      id: "board-2",
      name: "Review Board",
      isDefault: false,
    };

    window.history.replaceState({}, "", "/workspace/workspace-1/kanban?boardId=board-2&taskId=task-2");

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board, secondBoard]}
        tasks={[
          createTask("task-1", "Story One", { boardId: board.id }),
          createTask("task-2", "Story Two", { boardId: secondBoard.id }),
        ]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await screen.findByDisplayValue("Story Two");
    const boardSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(boardSelect.value).toBe("board-2");

    fireEvent.change(boardSelect, { target: { value: "board-1" } });

    await waitFor(() => {
      expect(screen.queryByText("Card Detail")).toBeNull();
    });
    expect(window.location.search).toContain("boardId=board-1");
    expect(window.location.search).not.toContain("taskId=");
  });
});
