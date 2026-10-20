import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
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

describe("Kanban Done column window", () => {
  it("AC1: renders only the 20 newest Done cards while header and unmerged count use all 25", () => {
    const board = makeBoard("board-1");
    renderTab(board, makeTasks(board.id, "done", 25));

    const done = column("Done");
    const cards = within(done).getAllByTestId("kanban-card");
    expect(cards).toHaveLength(20);
    expect(cards[0].textContent).toContain("done card 24");
    expect(cards[19].textContent).toContain("done card 5");
    expect(within(done).getByTestId("kanban-column-count-done").textContent).toContain("25");
    expect(within(done).getByTestId("kanban-done-unmerged-count").textContent).toContain("25");
  });

  it("AC2: show earlier reveals the rest, show less returns to 20", () => {
    const board = makeBoard("board-1");
    renderTab(board, makeTasks(board.id, "done", 25));

    const done = column("Done");
    const showMore = within(done).getByTestId("kanban-done-show-more");
    expect(showMore.textContent).toContain("5");
    fireEvent.click(showMore);
    expect(within(done).getAllByTestId("kanban-card")).toHaveLength(25);

    fireEvent.click(within(done).getByTestId("kanban-done-show-more"));
    expect(within(done).getAllByTestId("kanban-card")).toHaveLength(20);
  });

  it("AC2: each click adds at most 20 cards", () => {
    const board = makeBoard("board-1");
    renderTab(board, makeTasks(board.id, "done", 45));

    const done = column("Done");
    expect(within(done).getByTestId("kanban-done-show-more").textContent).toContain("20");
    fireEvent.click(within(done).getByTestId("kanban-done-show-more"));
    expect(within(done).getAllByTestId("kanban-card")).toHaveLength(40);
    expect(within(done).getByTestId("kanban-done-show-more").textContent).toContain("5");
  });

  it("AC3: collapse hides all cards, persists per board, and survives remount", async () => {
    const board = makeBoard("board-1");
    const tasks = makeTasks(board.id, "done", 25);
    const first = renderTab(board, tasks);

    fireEvent.click(within(column("Done")).getByTestId("kanban-done-collapse-toggle"));
    expect(within(column("Done")).queryAllByTestId("kanban-card")).toHaveLength(0);
    expect(within(column("Done")).getByTestId("kanban-column-count-done").textContent).toContain("25");
    expect(within(column("Done")).queryByTestId("kanban-done-show-more")).toBeNull();
    expect(window.localStorage.getItem("routa.kanban.doneCollapsed.board-1")).toBe("1");
    first.unmount();

    const second = renderTab(board, tasks);
    await waitFor(() => {
      expect(within(column("Done")).queryAllByTestId("kanban-card")).toHaveLength(0);
    });
    second.unmount();

    const otherBoard = makeBoard("board-2");
    renderTab(otherBoard, makeTasks(otherBoard.id, "done", 25));
    expect(within(column("Done")).getAllByTestId("kanban-card")).toHaveLength(20);

    fireEvent.click(within(column("Done")).getByTestId("kanban-done-collapse-toggle"));
    expect(window.localStorage.getItem("routa.kanban.doneCollapsed.board-2")).toBe("1");
    fireEvent.click(within(column("Done")).getByTestId("kanban-done-collapse-toggle"));
    expect(within(column("Done")).getAllByTestId("kanban-card")).toHaveLength(20);
  });

  it("AC4: non-Done columns render every card in board order without Done controls", () => {
    const board = makeBoard("board-1");
    renderTab(board, makeTasks(board.id, "backlog", 25));

    const backlog = column("Backlog");
    const cards = within(backlog).getAllByTestId("kanban-card");
    expect(cards).toHaveLength(25);
    expect(cards[0].textContent).toContain("backlog card 0");
    expect(within(backlog).queryByTestId("kanban-done-show-more")).toBeNull();
    expect(within(backlog).queryByTestId("kanban-done-collapse-toggle")).toBeNull();
  });

  it("AC6: a card dragged into Done lands first via the optimistic updatedAt", async () => {
    const board = makeBoard("board-1");
    const backlogTask = {
      ...makeTasks(board.id, "backlog", 1, "moving")[0],
      title: "Moving card",
      updatedAt: minutes(-30),
    };
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    renderTab(board, [...makeTasks(board.id, "done", 25), backlogTask]);

    await act(async () => {
      dndKitHarness.emitDragEnd({
        active: { id: backlogTask.id, data: { current: { columnId: "backlog" } } },
        over: { id: "column:done" },
      });
    });

    await waitFor(() => {
      const cards = within(column("Done")).getAllByTestId("kanban-card");
      expect(cards[0].textContent).toContain("Moving card");
    });
    expect(within(column("Done")).getAllByTestId("kanban-card")).toHaveLength(20);
    expect(within(column("Done")).getByTestId("kanban-column-count-done").textContent).toContain("26");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks/moving-0",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
  });

  it("AC6: dragging out of Done still calls moveTask", async () => {
    const board = makeBoard("board-1");
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    renderTab(board, makeTasks(board.id, "done", 3));

    await act(async () => {
      dndKitHarness.emitDragEnd({
        active: { id: "done-1", data: { current: { columnId: "done" } } },
        over: { id: "column:backlog" },
      });
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/done-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId: "backlog", position: 0 }),
      });
    });
    expect(within(column("Backlog")).getAllByTestId("kanban-card")).toHaveLength(1);
  });
});

