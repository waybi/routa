import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
import { EMPTY_COLUMN_RAIL_WIDTH } from "../kanban-empty-column-rail";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";

const { desktopAwareFetch, dndKitHarness } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
  dndKitHarness: {
    onDragEnd: null as null | ((event: {
      active: { id: string; data?: { current?: Record<string, unknown> } };
      over: { id: string } | null;
    }) => void),
    emitDragEnd(event: {
      active: { id: string; data?: { current?: Record<string, unknown> } };
      over: { id: string } | null;
    }) {
      this.onDragEnd?.(event);
    },
    reset() {
      this.onDragEnd = null;
    },
  },
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd?: (event: {
      active: { id: string; data?: { current?: Record<string, unknown> } };
      over: { id: string } | null;
    }) => void;
  }) => {
    dndKitHarness.onDragEnd = onDragEnd ?? null;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => <>{children}</>,
  MouseSensor: class {},
  TouchSensor: class {},
  closestCorners: vi.fn(),
  useDroppable: () => ({ isOver: false, setNodeRef: vi.fn() }),
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setNodeRef: vi.fn(), transform: null }),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

vi.mock("@/client/utils/diagnostics", async () => {
  const actual = await vi.importActual<typeof import("@/client/utils/diagnostics")>("@/client/utils/diagnostics");
  return { ...actual, desktopAwareFetch };
});

vi.mock("@/client/components/repo-picker", () => ({
  RepoPicker: () => <div data-testid="repo-picker-mock" />,
  shortenRepoPath: (value: string) => value,
}));

vi.mock("../use-runtime-fitness-status", async () => {
  const { mockUseRuntimeFitnessStatus } = await import("./test-utils");
  return { useRuntimeFitnessStatus: mockUseRuntimeFitnessStatus };
});

function makeBoard(id: string): KanbanBoardInfo {
  return {
    id,
    workspaceId: "workspace-1",
    name: `Board ${id}`,
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
      { id: "done", name: "Done", position: 1, stage: "done" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function minutes(n: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
}

/** `count` cards in `columnId`; card i is updated at minute i (so the last one is newest). */
function makeTasks(boardId: string, columnId: string, count: number, prefix = columnId): TaskInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    title: `${prefix} card ${index}`,
    objective: "objective",
    status: columnId === "done" ? "COMPLETED" : "PENDING",
    boardId,
    columnId,
    position: index,
    createdAt: minutes(0),
    updatedAt: minutes(index),
    deliveryLanding: columnId === "done"
      ? { landedOnBase: false, commitsSinceBase: 1 }
      : undefined,
  } as TaskInfo));
}

function renderTab(board: KanbanBoardInfo, tasks: TaskInfo[]) {
  return render(
    <KanbanTab
      workspaceId="workspace-1"
      boards={[board]}
      tasks={tasks}
      sessions={[]}
      providers={[]}
      specialists={[]}
      codebases={[]}
      onRefresh={vi.fn()}
    />,
  );
}

function column(name: string): HTMLElement {
  const match = screen.getAllByTestId("kanban-column").find((element) =>
    element.textContent?.startsWith(name),
  );
  if (!match) throw new Error(`column ${name} not found`);
  return match;
}

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  dndKitHarness.reset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function collapseDone() {
  fireEvent.click(within(column("Done")).getByTestId("kanban-done-collapse-toggle"));
}

describe("Kanban Done column collapsed rail", () => {
  it("collapsed Done uses the narrow rail width instead of the wide column", () => {
    const board = makeBoard("board-1");
    renderTab(board, makeTasks(board.id, "done", 25));

    expect(column("Done").className).toContain("w-[24rem]");
    collapseDone();

    const done = column("Done");
    expect(done.className).toContain(EMPTY_COLUMN_RAIL_WIDTH);
    expect(done.className).not.toContain("w-[24rem]");
    expect(within(done).getByTestId("kanban-done-collapsed-rail")).toBeTruthy();
  });

  it("the rail shows the vertical column name, the total and the unmerged count", () => {
    const board = makeBoard("board-1");
    const tasks = makeTasks(board.id, "done", 25);
    tasks[0] = { ...tasks[0], deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 } } as TaskInfo;
    renderTab(board, tasks);
    collapseDone();

    const rail = within(column("Done")).getByTestId("kanban-done-collapsed-rail");
    expect(rail.textContent).toContain("Done");
    expect(within(rail).getByTestId("kanban-column-count-done").textContent).toBe("25");
    const unmerged = within(rail).getByTestId("kanban-done-unmerged-count");
    expect(unmerged.textContent).toMatch(/\d+/);
    expect(Number(unmerged.textContent?.match(/\d+/)?.[0])).toBeGreaterThan(0);
    expect(within(column("Done")).queryAllByTestId("kanban-card")).toHaveLength(0);
  });

  it("the rail hides the unmerged count when every Done card has landed", () => {
    const board = makeBoard("board-1");
    const tasks = makeTasks(board.id, "done", 3).map((task) => ({
      ...task,
      deliveryLanding: { landedOnBase: true, commitsSinceBase: 0 },
    }) as TaskInfo);
    renderTab(board, tasks);
    collapseDone();

    expect(within(column("Done")).queryByTestId("kanban-done-unmerged-count")).toBeNull();
  });

  it("the expand button is a focusable button that reports aria-expanded=false and expands on Enter", () => {
    const board = makeBoard("board-1");
    renderTab(board, makeTasks(board.id, "done", 25));
    collapseDone();

    const toggle = within(column("Done")).getByTestId("kanban-done-collapse-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.className).toContain("focus-visible:outline");
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    // Native buttons turn Enter / Space into a click.
    fireEvent.keyDown(toggle, { key: "Enter" });
    fireEvent.click(toggle);

    const done = column("Done");
    expect(done.className).toContain("w-[24rem]");
    expect(within(done).getAllByTestId("kanban-card")).toHaveLength(20);
    expect(within(done).getByTestId("kanban-done-show-more")).toBeTruthy();
  });

  it("the rail is still a drop target: dropping a card on it calls moveTask to done", async () => {
    const board = makeBoard("board-1");
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    renderTab(board, [...makeTasks(board.id, "done", 5), ...makeTasks(board.id, "backlog", 1, "mover")]);
    collapseDone();
    expect(column("Done").className).toContain(EMPTY_COLUMN_RAIL_WIDTH);

    await act(async () => {
      dndKitHarness.emitDragEnd({
        active: { id: "mover-0", data: { current: { columnId: "backlog" } } },
        over: { id: "column:done" },
      });
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks/mover-0",
        expect.objectContaining({ method: "PATCH", body: expect.stringContaining("\"columnId\":\"done\"") }),
      );
    });
    expect(within(column("Done")).getByTestId("kanban-column-count-done").textContent).toBe("6");
  });

  it("stays a rail after remount (persisted per board)", async () => {
    const board = makeBoard("board-1");
    const tasks = makeTasks(board.id, "done", 25);
    const first = renderTab(board, tasks);
    collapseDone();
    expect(window.localStorage.getItem("routa.kanban.doneCollapsed.board-1")).toBe("1");
    first.unmount();

    renderTab(board, tasks);
    await waitFor(() => {
      expect(column("Done").className).toContain(EMPTY_COLUMN_RAIL_WIDTH);
    });
    expect(within(column("Done")).getByTestId("kanban-done-collapsed-rail")).toBeTruthy();
  });

  it("searching bypasses the collapse and shows the wide column with matches", async () => {
    const board = makeBoard("board-1");
    window.localStorage.setItem("routa.kanban.doneCollapsed.board-1", "1");
    renderTab(board, makeTasks(board.id, "done", 25));
    await waitFor(() => {
      expect(column("Done").className).toContain(EMPTY_COLUMN_RAIL_WIDTH);
    });

    const input = screen.getByTestId("kanban-board-search");
    fireEvent.change(input, { target: { value: "done card 3" } });

    await waitFor(() => {
      expect(column("Done").className).toContain("w-[24rem]");
    });
    expect(within(column("Done")).queryByTestId("kanban-done-collapsed-rail")).toBeNull();
    expect(within(column("Done")).getAllByTestId("kanban-card").length).toBeGreaterThan(0);
  });
});
