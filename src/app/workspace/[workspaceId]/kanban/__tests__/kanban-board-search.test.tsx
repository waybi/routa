import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { matchTask, splitHighlight } from "../kanban-board-search";
import { KanbanTab } from "../kanban-tab";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: ReactNode }) => <>{children}</>,
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

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id: "abc12345-0000",
    title: "Fix Done sorting",
    status: "COMPLETED",
    columnId: "done",
    createdAt: "2026-01-01T00:00:00.000Z",
    labels: ["req:kanban-revamp", "frontend"],
    completionReport: { excerpt: "Shipped segments", commit: "f00dcafe99", hasLeftover: false, createdAt: "2026-01-01T00:00:00.000Z" },
    ...overrides,
  } as TaskInfo;
}

describe("matchTask (AC7)", () => {
  it("matches title case-insensitively", () => {
    expect(matchTask(task(), "done SORT")).toBe(true);
  });

  it("matches card id by prefix only", () => {
    expect(matchTask(task(), "ABC1")).toBe(true);
    expect(matchTask(task(), "2345")).toBe(false);
  });

  it("matches only req: labels", () => {
    expect(matchTask(task(), "revamp")).toBe(true);
    expect(matchTask(task(), "frontend")).toBe(false);
  });

  it("matches report excerpt and commit", () => {
    expect(matchTask(task(), "segments")).toBe(true);
    expect(matchTask(task(), "cafe")).toBe(true);
    expect(matchTask(task({ completionReport: null }), "cafe")).toBe(false);
  });

  it("treats regex characters literally", () => {
    expect(matchTask(task({ title: "a.b (x*)" }), "a.b (x*")).toBe(true);
    expect(matchTask(task({ title: "axb" }), "a.b")).toBe(false);
    expect(() => matchTask(task(), "(")).not.toThrow();
  });

  it("empty query matches everything", () => {
    expect(matchTask(task(), "   ")).toBe(true);
  });
});

describe("splitHighlight", () => {
  it("splits every literal hit and keeps original casing", () => {
    expect(splitHighlight("Abc abc", "ABC")).toEqual([
      { text: "Abc", hit: true },
      { text: " ", hit: false },
      { text: "abc", hit: true },
    ]);
    expect(splitHighlight("1+1=2", "+")).toEqual([
      { text: "1", hit: false },
      { text: "+", hit: true },
      { text: "1=2", hit: false },
    ]);
  });
});

function makeBoard(): KanbanBoardInfo {
  return {
    id: "board-1",
    workspaceId: "workspace-1",
    name: "Board",
    isDefault: true,
    sessionConcurrencyLimit: 1,
    queue: { runningCount: 0, runningCards: [], queuedCount: 0, queuedCardIds: [], queuedCards: [], queuedPositions: {} },
    columns: [
      { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
      { id: "done", name: "Done", position: 1, stage: "done" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function doneTasks(count: number): TaskInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `done-${index}`,
    title: `done card ${index}`,
    objective: "objective",
    status: "COMPLETED",
    boardId: "board-1",
    columnId: "done",
    position: index,
    createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    completionReport: {
      excerpt: `delivered ${index}`,
      commit: index === 0 ? "zz9needle" : `c0ffee${index}`,
      hasLeftover: false,
      createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    },
  } as TaskInfo));
}

function renderTab(tasks: TaskInfo[]) {
  return render(
    <KanbanTab
      workspaceId="workspace-1"
      boards={[makeBoard()]}
      tasks={tasks}
      sessions={[]}
      providers={[]}
      specialists={[]}
      codebases={[]}
      onRefresh={vi.fn()}
    />,
  );
}

function doneColumn(): HTMLElement {
  const match = screen.getAllByTestId("kanban-column").find((element) => element.textContent?.startsWith("Done"));
  if (!match) throw new Error("Done column not found");
  return match;
}

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.localStorage.clear();
});

describe("Board search rendering (AC7)", () => {
  it("finds the oldest of 25 Done cards by commit alone, highlights it, and hides misses", () => {
    renderTab([...doneTasks(25), { ...doneTasks(1)[0], id: "backlog-1", title: "backlog thing", columnId: "backlog", completionReport: null } as TaskInfo]);
    // Without a query the oldest card is outside the 20-card window.
    expect(within(doneColumn()).queryByText("done card 0")).toBeNull();

    fireEvent.change(screen.getByTestId("kanban-board-search"), { target: { value: "NEEDLE" } });

    const cards = within(doneColumn()).getAllByTestId("kanban-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].textContent).toContain("done card 0");
    const marks = within(cards[0]).getAllByTestId("kanban-search-mark");
    expect(marks.map((mark) => mark.textContent)).toEqual(["needle"]);
    expect(within(cards[0]).getByTestId("kanban-done-card-commit").textContent).toBe("zz9needle");
    expect(within(doneColumn()).getByTestId("kanban-column-count-done").textContent).toBe("1 / 25");
    expect(screen.queryByText("backlog thing")).toBeNull();
  });

  it("Esc in the box clears the query", () => {
    renderTab(doneTasks(3));
    const input = screen.getByTestId("kanban-board-search") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "card 1" } });
    expect(within(doneColumn()).getAllByTestId("kanban-card")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(within(doneColumn()).getAllByTestId("kanban-card")).toHaveLength(3);
  });

  it("/ focuses the box, but not while typing in a textarea", () => {
    renderTab(doneTasks(1));
    const input = screen.getByTestId("kanban-board-search");
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "/" });
    expect(document.activeElement).toBe(textarea);

    textarea.blur();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(input);
    textarea.remove();
  });
});
