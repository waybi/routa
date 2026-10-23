/**
 * Narrow columns are horizontal at every board width (card 92744a50, change of
 * 2026-10-23 13:15: "text is never vertical, always horizontal"). Empty
 * columns and the collapsed Done keep the ~88px EMPTY_COLUMN_RAIL_WIDTH and
 * horizontal text whether the board container is 300px or 2000px wide; when
 * the board does not fit, the board container scrolls sideways. The collapsed
 * Done also shows its lane automation (pusher name).
 */
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nContext } from "@/i18n/context";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { KanbanTab } from "../kanban-tab";
import { KanbanBoardSkeleton } from "../kanban-tab-content";
import { EMPTY_COLUMN_RAIL_WIDTH, KanbanDoneCollapsedRail } from "../kanban-empty-column-rail";
import { formatLaneAutomationRailLabel } from "../kanban-tab-helpers";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";

const { desktopAwareFetch, dnd } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
  dnd: {
    onDragEnd: null as null | ((event: { active: { id: string; data?: { current?: Record<string, unknown> } }; over: { id: string } | null }) => void),
  },
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd?: typeof dnd.onDragEnd }) => {
    dnd.onDragEnd = onDragEnd ?? null;
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

/**
 * ResizeObserver stand-in that reports a chosen width for every observed
 * element, so a width-dependent layout would show up in these tests.
 */
class FakeResizeObserver {
  static instances = new Set<FakeResizeObserver>();
  elements = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.add(this);
  }
  observe(element: Element) {
    this.elements.add(element);
  }
  unobserve(element: Element) {
    this.elements.delete(element);
  }
  disconnect() {
    this.elements.clear();
    FakeResizeObserver.instances.delete(this);
  }
  static resizeAll(width: number) {
    for (const observer of FakeResizeObserver.instances) {
      const entries = [...observer.elements].map((target) => ({ target, contentRect: { width } as DOMRectReadOnly }) as ResizeObserverEntry);
      if (entries.length > 0) observer.callback(entries, observer as unknown as ResizeObserver);
    }
  }
}

type Lang = "en" | "zh";
const dictionaries = { en, zh } as const;

function withLang(lang: Lang, node: ReactNode) {
  return (
    <I18nContext.Provider value={{ locale: lang, setLocale: () => {}, t: dictionaries[lang] }}>
      {node}
    </I18nContext.Provider>
  );
}

function subtreeClasses(root: Element): string {
  return [root, ...Array.from(root.querySelectorAll("*"))].map((element) => element.getAttribute("class") ?? "").join(" ");
}

/** True when the element carries a width-mode attribute (data-rail-*), which the removed vertical mode used. */
function hasRailModeAttribute(element: Element): boolean {
  return [...element.attributes].some((attribute) => attribute.name.startsWith("data-rail"));
}

function classes(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/);
}

/** Rotated, vertical or hidden/truncated text is never allowed in a narrow column. */
const FORBIDDEN = /vertical-rl|vertical-lr|writing-mode|rotate-|truncate|text-ellipsis|line-clamp|sr-only|\bhidden\b|opacity-0/;

/** Make the board container (and window) report a given width, as a resized window would. */
function setBoardWidth(width: number) {
  act(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    for (const element of screen.queryAllByTestId("kanban-board-content")) {
      Object.defineProperty(element, "clientWidth", { configurable: true, value: width });
      (element as HTMLElement).style.width = `${width}px`;
    }
    FakeResizeObserver.resizeAll(width);
    window.dispatchEvent(new Event("resize"));
  });
}

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.localStorage.clear();
  FakeResizeObserver.instances.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collapsed Done rail content", () => {
  it.each([
    ["en", "12 unmerged", "Expand Done"],
    ["zh", "12 张未合入", "展开 Done"],
  ] as const)("%s: button, total, badge and pusher name are visible horizontal text", (lang, badgeText, expandLabel) => {
    const onExpand = vi.fn();
    render(withLang(lang, (
      <KanbanDoneCollapsedRail
        columnId="done"
        name="Done"
        total={29}
        unmergedCount={12}
        onExpand={onExpand}
        automationLabel="Main Pusher"
        automationTitle="-> Main Pusher -> Done Reporter"
      />
    )));
    const rail = screen.getByTestId("kanban-done-collapsed-rail");
    expect(subtreeClasses(rail)).not.toMatch(FORBIDDEN);

    const toggle = within(rail).getByTestId("kanban-done-collapse-toggle");
    expect(toggle.textContent).toBe("Done");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe(expandLabel);
    expect(within(rail).getByTestId("kanban-column-count-done").textContent).toBe("29");
    expect(within(rail).getByTestId("kanban-done-unmerged-count").textContent).toBe(badgeText);
    const automation = within(rail).getByTestId("kanban-rail-automation-done");
    expect(automation.textContent).toBe("Main Pusher");
    expect(automation.getAttribute("title")).toBe("-> Main Pusher -> Done Reporter");

    fireEvent.click(toggle);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("hides the badge when 0 unmerged and the pusher name when the lane has no automation", () => {
    render(<KanbanDoneCollapsedRail columnId="done" name="Done" total={3} unmergedCount={0} onExpand={vi.fn()} />);
    const rail = screen.getByTestId("kanban-done-collapsed-rail");
    expect(within(rail).queryByTestId("kanban-done-unmerged-count")).toBeNull();
    expect(within(rail).queryByTestId("kanban-rail-automation-done")).toBeNull();
  });
});

describe("formatLaneAutomationRailLabel", () => {
  const specialists = [{ id: "kanban-main-pusher", name: "Main Pusher", role: "DEVELOPER", displayName: "推送员" }];

  it("uses the first step's specialist display name, then its stored name, then the role", () => {
    expect(formatLaneAutomationRailLabel({ enabled: true, steps: [{ id: "s1", specialistId: "kanban-main-pusher" }] }, specialists)).toBe("推送员");
    expect(formatLaneAutomationRailLabel({ enabled: true, steps: [{ id: "s1", specialistId: "x", specialistName: "Main Pusher" }] }, [])).toBe("Main Pusher");
    expect(formatLaneAutomationRailLabel({ enabled: true, steps: [{ id: "s1", role: "GATE" }] }, [])).toBe("GATE");
  });

  it("is null for a lane without automation", () => {
    expect(formatLaneAutomationRailLabel(undefined, specialists)).toBeNull();
    expect(formatLaneAutomationRailLabel({ enabled: false, steps: [{ id: "s1", specialistName: "Main Pusher" }] }, specialists)).toBeNull();
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
      { id: "todo", name: "Todo", position: 1, stage: "todo" },
      { id: "dev", name: "Dev", position: 2, stage: "dev" },
      { id: "review", name: "Review", position: 3, stage: "review" },
      {
        id: "done",
        name: "Done",
        position: 4,
        stage: "done",
        automation: { enabled: true, steps: [{ id: "push", specialistId: "kanban-main-pusher", specialistName: "Main Pusher", role: "DEVELOPER" }] },
      },
      { id: "blocked", name: "Blocked", position: 5, stage: "blocked" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as KanbanBoardInfo;
}

function makeTask(id: string, columnId: string, index: number): TaskInfo {
  return {
    id,
    title: `${columnId} card ${index}`,
    objective: "objective",
    status: columnId === "done" ? "COMPLETED" : "PENDING",
    boardId: "board-1",
    columnId,
    position: index,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    deliveryLanding: columnId === "done" ? { landedOnBase: index >= 3, commitsSinceBase: index >= 3 ? 0 : 1 } : undefined,
  } as TaskInfo;
}

// The boss's screenshot: only Done and Blocked have cards; Done is collapsed.
function renderBoard(lang: Lang) {
  window.localStorage.setItem("routa.kanban.doneCollapsed.board-1", "1");
  return render(withLang(lang, (
    <KanbanTab
      workspaceId="workspace-1"
      boards={[makeBoard()]}
      tasks={[makeTask("blocked-0", "blocked", 0), ...Array.from({ length: 8 }, (_, index) => makeTask(`done-${index}`, "done", index))]}
      sessions={[]}
      providers={[]}
      specialists={[]}
      codebases={[]}
      onRefresh={vi.fn()}
    />
  )));
}

function columnsById() {
  return new Map(screen.getAllByTestId("kanban-column").map((element) => [element.getAttribute("data-column-id"), element]));
}

/** Every narrow column is horizontal with the one width constant; Blocked keeps its lane width. */
function expectHorizontalBoard() {
  const content = screen.getByTestId("kanban-board-content");
  // The board container scrolls sideways itself when the columns do not fit.
  expect(classes(content)).toContain("overflow-auto");
  const columns = columnsById();
  for (const id of ["backlog", "todo", "dev", "review", "done"]) {
    const column = columns.get(id)!;
    expect(classes(column)).toContain(EMPTY_COLUMN_RAIL_WIDTH);
    expect(classes(column)).not.toContain("w-10");
    const rail = within(column).queryByTestId("kanban-empty-column-rail") ?? within(column).getByTestId("kanban-done-collapsed-rail");
    expect(subtreeClasses(rail)).not.toMatch(FORBIDDEN);
    expect(within(rail).getByTestId("kanban-rail-column-name").textContent).toBe(makeBoard().columns.find((c) => c.id === id)!.name);
    // No width-dependent mode switch is left on the board.
    expect(hasRailModeAttribute(rail)).toBe(false);
  }
  expect(hasRailModeAttribute(content)).toBe(false);
  // A column with cards keeps its normal width and its 210px floor.
  const blocked = columns.get("blocked")!;
  expect(classes(blocked)).toContain("w-[18rem]");
  expect(classes(blocked)).toContain("min-w-[210px]");
  expect(classes(blocked)).not.toContain(EMPTY_COLUMN_RAIL_WIDTH);
}

describe("board surface is horizontal at any width", () => {
  it.each([
    ["en", 300],
    ["en", 2000],
    ["zh", 300],
    ["zh", 2000],
  ] as const)("%s at %ipx: narrow columns stay ~88px and horizontal", (lang, width) => {
    renderBoard(lang);
    setBoardWidth(width);
    expectHorizontalBoard();

    const doneRail = within(columnsById().get("done")!).getByTestId("kanban-done-collapsed-rail");
    expect(within(doneRail).getByTestId("kanban-done-unmerged-count").textContent).toBe(lang === "en" ? "3 unmerged" : "3 张未合入");
    expect(within(doneRail).getByTestId("kanban-rail-automation-done").textContent).toBe("Main Pusher");
  });

  it("resizing the window wide → narrow → wide never changes the narrow columns", () => {
    renderBoard("en");
    for (const width of [2000, 600, 300, 1440]) {
      setBoardWidth(width);
      expectHorizontalBoard();
    }
  });

  it.each([300, 2000])("at %ipx cards drop into an empty column and into the collapsed Done", async (width) => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    renderBoard("en");
    setBoardWidth(width);
    expectHorizontalBoard();

    await act(async () => {
      dnd.onDragEnd?.({ active: { id: "blocked-0", data: { current: { columnId: "blocked" } } }, over: { id: "column:review" } });
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/blocked-0", expect.objectContaining({ method: "PATCH", body: expect.stringContaining("\"columnId\":\"review\"") }));
    });
    await act(async () => {
      dnd.onDragEnd?.({ active: { id: "blocked-0", data: { current: { columnId: "blocked" } } }, over: { id: "column:done" } });
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/blocked-0", expect.objectContaining({ method: "PATCH", body: expect.stringContaining("\"columnId\":\"done\"") }));
    });
  });

  it("the Done expand button works on a narrow board", () => {
    renderBoard("en");
    setBoardWidth(300);
    fireEvent.click(within(columnsById().get("done")!).getByTestId("kanban-done-collapse-toggle"));
    const done = columnsById().get("done")!;
    expect(within(done).queryByTestId("kanban-done-collapsed-rail")).toBeNull();
    expect(within(done).getAllByTestId("kanban-card").length).toBeGreaterThan(0);
  });
});

describe("loading skeleton", () => {
  it.each([300, 2000])("at %ipx its rail columns use EMPTY_COLUMN_RAIL_WIDTH", (width) => {
    render(<KanbanBoardSkeleton label="Loading" />);
    const skeleton = screen.getByTestId("kanban-board-skeleton");
    act(() => {
      Object.defineProperty(skeleton, "clientWidth", { configurable: true, value: width });
      FakeResizeObserver.resizeAll(width);
    });
    for (const rail of screen.getAllByTestId("kanban-board-skeleton-column").slice(0, 2)) {
      expect(classes(rail)).toContain(EMPTY_COLUMN_RAIL_WIDTH);
      expect(classes(rail)).not.toContain("w-10");
    }
    expect(hasRailModeAttribute(skeleton)).toBe(false);
  });
});
