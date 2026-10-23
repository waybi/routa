/**
 * Narrow columns adapt to the board width (card 92744a50, change of
 * 2026-10-23 10:40): with room the empty columns and the collapsed Done are
 * ~88px with horizontal text; without room they are ~40px rails with vertical
 * text. One mode for the whole board, from the board container width, with a
 * 16px hysteresis. The collapsed Done also shows its lane automation (AC8).
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
import {
  EMPTY_COLUMN_RAIL_VERTICAL_WIDTH,
  EMPTY_COLUMN_RAIL_WIDTH,
  KanbanDoneCollapsedRail,
  KanbanEmptyColumnRail,
} from "../kanban-empty-column-rail";
import {
  MIN_LANE_PX,
  RAIL_HORIZONTAL_PX,
  RAIL_MODE_HYSTERESIS_PX,
  RAIL_VERTICAL_PX,
  requiredHorizontalWidth,
  resolveRailMode,
  type RailMode,
} from "../kanban-rail-mode";
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

/** ResizeObserver stand-in: tests set an element's width and fire the callback. */
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
  static resize(element: Element, width: number) {
    for (const observer of FakeResizeObserver.instances) {
      if (!observer.elements.has(element)) continue;
      observer.callback([{ target: element, contentRect: { width } as DOMRectReadOnly } as ResizeObserverEntry], observer as unknown as ResizeObserver);
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

function classes(element: Element): string[] {
  return (element.getAttribute("class") ?? "").split(/\s+/);
}

/** Hide-or-truncate classes are never allowed on narrow column text. */
const HIDING = /truncate|text-ellipsis|line-clamp|sr-only|\bhidden\b|opacity-0/;

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.localStorage.clear();
  FakeResizeObserver.instances.clear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveRailMode (pure decision)", () => {
  const layout = { railCount: 4, laneWidthsPx: [288, 384], trailingPx: 16 };
  const required = requiredHorizontalWidth(layout);

  it("required width = lanes (≥210 each) + rails × 88 + gaps + trailing space", () => {
    expect(RAIL_HORIZONTAL_PX).toBe(88);
    expect(RAIL_VERTICAL_PX).toBe(40);
    expect(required).toBe(288 + 384 + 4 * 88 + 5 * 12 + 16);
    // A lane narrower than the minimum still needs 210px.
    expect(requiredHorizontalWidth({ railCount: 1, laneWidthsPx: [100] })).toBe(MIN_LANE_PX + 88 + 12);
  });

  it("exactly fits → horizontal; 1px short → vertical", () => {
    expect(resolveRailMode({ ...layout, containerWidth: required })).toBe("horizontal");
    expect(resolveRailMode({ ...layout, containerWidth: required - 1 })).toBe("vertical");
    expect(resolveRailMode({ ...layout, containerWidth: required, previousMode: "horizontal" })).toBe("horizontal");
    expect(resolveRailMode({ ...layout, containerWidth: required - 1, previousMode: "horizontal" })).toBe("vertical");
  });

  it("from vertical it needs 16px of spare room to go back to horizontal", () => {
    expect(RAIL_MODE_HYSTERESIS_PX).toBe(16);
    expect(resolveRailMode({ ...layout, containerWidth: required + 15, previousMode: "vertical" })).toBe("vertical");
    expect(resolveRailMode({ ...layout, containerWidth: required + 16, previousMode: "vertical" })).toBe("horizontal");
  });

  it("a width wobbling ±8px around the threshold does not flip the mode", () => {
    let mode: RailMode = "horizontal";
    const seen = new Set<RailMode>();
    // Start just short, then wobble within ±8px of the threshold.
    for (const delta of [-1, 8, -8, 7, -7, 8, -1, 8, 0, 8]) {
      mode = resolveRailMode({ ...layout, containerWidth: required + delta, previousMode: mode });
      seen.add(mode);
    }
    expect([...seen]).toEqual(["vertical"]);
  });

  it("decides from the board width, not from the narrow columns' current width", () => {
    // Same container width and lanes give the same answer whatever the previous rail width was.
    const wide = required + 100;
    expect(resolveRailMode({ ...layout, containerWidth: wide, previousMode: "vertical" })).toBe("horizontal");
    expect(resolveRailMode({ ...layout, containerWidth: wide, previousMode: "horizontal" })).toBe("horizontal");
  });

  it("works for any column mix, Dev included (random layouts, judged by the formula)", () => {
    let seed = 20261023;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let index = 0; index < 2000; index += 1) {
      const railCount = 1 + Math.floor(random() * 6);
      const laneWidthsPx = Array.from({ length: Math.floor(random() * 6) }, () => [224, 288, 384][Math.floor(random() * 3)]);
      const containerWidth = Math.floor(random() * 2600);
      const need = laneWidthsPx.reduce((sum, width) => sum + width, 0) + railCount * 88 + (railCount + laneWidthsPx.length - 1) * 12;
      expect(resolveRailMode({ railCount, laneWidthsPx, containerWidth })).toBe(containerWidth >= need ? "horizontal" : "vertical");
    }
  });
});

describe("rail components in each mode", () => {
  it.each(["en", "zh"] as const)("%s: horizontal empty rail has no vertical text; vertical one has", (lang) => {
    const { unmount } = render(withLang(lang, <KanbanEmptyColumnRail columnId="backlog" name="Backlog" mode="horizontal" />));
    let rail = screen.getByTestId("kanban-empty-column-rail");
    expect(rail.getAttribute("data-rail-mode")).toBe("horizontal");
    expect(subtreeClasses(rail)).not.toMatch(/vertical-rl|writing-mode/);
    expect(subtreeClasses(rail)).not.toMatch(HIDING);
    expect(within(rail).getByTestId("kanban-rail-column-name").textContent).toBe("Backlog");
    unmount();

    render(withLang(lang, <KanbanEmptyColumnRail columnId="backlog" name="Backlog" mode="vertical" />));
    rail = screen.getByTestId("kanban-empty-column-rail");
    expect(rail.getAttribute("data-rail-mode")).toBe("vertical");
    expect(classes(within(rail).getByTestId("kanban-rail-column-name"))).toContain("[writing-mode:vertical-rl]");
    expect(subtreeClasses(rail)).not.toMatch(HIDING);
    expect(within(rail).getByTestId("kanban-rail-column-name").textContent).toBe("Backlog");
    expect(within(rail).getByTestId("kanban-column-count-backlog").textContent).toBe("0");
  });

  it.each([
    ["en", "horizontal", "12 unmerged"],
    ["zh", "horizontal", "12 张未合入"],
    ["en", "vertical", "12 unmerged"],
    ["zh", "vertical", "12 张未合入"],
  ] as const)("%s %s: Done rail keeps the button, total, badge and automation as visible text", (lang, mode, badgeText) => {
    const onExpand = vi.fn();
    render(withLang(lang, (
      <KanbanDoneCollapsedRail
        columnId="done"
        name="Done"
        total={29}
        unmergedCount={12}
        onExpand={onExpand}
        mode={mode}
        automationLabel="Main Pusher"
        automationTitle="-> Main Pusher -> Done Reporter"
      />
    )));
    const rail = screen.getByTestId("kanban-done-collapsed-rail");
    expect(rail.getAttribute("data-rail-mode")).toBe(mode);
    expect(subtreeClasses(rail)).not.toMatch(HIDING);
    const hasVertical = /vertical-rl/.test(subtreeClasses(rail));
    expect(hasVertical).toBe(mode === "vertical");

    const toggle = within(rail).getByTestId("kanban-done-collapse-toggle");
    expect(toggle.textContent).toBe("Done");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe(lang === "en" ? "Expand Done" : "展开 Done");
    expect(within(rail).getByTestId("kanban-column-count-done").textContent).toBe("29");
    expect(within(rail).getByTestId("kanban-done-unmerged-count").textContent).toBe(badgeText);
    const automation = within(rail).getByTestId("kanban-rail-automation-done");
    expect(automation.textContent).toBe("Main Pusher");
    expect(automation.getAttribute("title")).toBe("-> Main Pusher -> Done Reporter");
    if (mode === "vertical") expect(classes(automation)).toContain("[writing-mode:vertical-rl]");
    else expect(classes(automation)).not.toContain("[writing-mode:vertical-rl]");

    fireEvent.click(toggle);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("Done rail hides the badge when 0 unmerged and the automation when the lane has none", () => {
    render(<KanbanDoneCollapsedRail columnId="done" name="Done" total={3} unmergedCount={0} onExpand={vi.fn()} mode="vertical" />);
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
// Narrow columns: Backlog, Todo, Dev, Review, Done (5); lane: Blocked (288).
const BOARD_REQUIRED = requiredHorizontalWidth({ railCount: 5, laneWidthsPx: [288], trailingPx: 16 });

function renderBoard(lang: Lang, tasks = [makeTask("blocked-0", "blocked", 0), ...Array.from({ length: 8 }, (_, index) => makeTask(`done-${index}`, "done", index))]) {
  window.localStorage.setItem("routa.kanban.doneCollapsed.board-1", "1");
  return render(withLang(lang, (
    <KanbanTab
      workspaceId="workspace-1"
      boards={[makeBoard()]}
      tasks={tasks}
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

function resizeBoard(width: number) {
  act(() => {
    FakeResizeObserver.resize(screen.getByTestId("kanban-board-content"), width);
  });
}

function expectBoardMode(mode: RailMode) {
  const width = mode === "vertical" ? EMPTY_COLUMN_RAIL_VERTICAL_WIDTH : EMPTY_COLUMN_RAIL_WIDTH;
  const other = mode === "vertical" ? EMPTY_COLUMN_RAIL_WIDTH : EMPTY_COLUMN_RAIL_VERTICAL_WIDTH;
  expect(screen.getByTestId("kanban-board-content").getAttribute("data-rail-mode")).toBe(mode);
  const columns = columnsById();
  for (const id of ["backlog", "todo", "dev", "review", "done"]) {
    const column = columns.get(id)!;
    expect(classes(column)).toContain(width);
    expect(classes(column)).not.toContain(other);
    const rail = within(column).queryByTestId("kanban-empty-column-rail") ?? within(column).getByTestId("kanban-done-collapsed-rail");
    // The whole board uses one mode.
    expect(rail.getAttribute("data-rail-mode")).toBe(mode);
    expect(/vertical-rl/.test(subtreeClasses(rail))).toBe(mode === "vertical");
    expect(subtreeClasses(rail)).not.toMatch(HIDING);
    expect(within(rail).getByTestId("kanban-rail-column-name").textContent).toBe(makeBoard().columns.find((c) => c.id === id)!.name);
  }
  // A column with cards keeps its normal width in both modes.
  const blocked = columns.get("blocked")!;
  expect(classes(blocked)).toContain("w-[18rem]");
  expect(classes(blocked)).not.toContain(width);
}

describe("board surface switches modes live from the container width", () => {
  it.each(["en", "zh"] as const)("%s: wide → horizontal, narrow → vertical, wide again → horizontal, no reload", (lang) => {
    renderBoard(lang);
    resizeBoard(1400);
    expectBoardMode("horizontal");

    resizeBoard(BOARD_REQUIRED - 1);
    expectBoardMode("vertical");

    // Inside the hysteresis band it stays vertical.
    resizeBoard(BOARD_REQUIRED + 8);
    expectBoardMode("vertical");

    resizeBoard(BOARD_REQUIRED + RAIL_MODE_HYSTERESIS_PX);
    expectBoardMode("horizontal");

    // Collapsed Done keeps the badge and lane automation visible.
    const doneRail = within(columnsById().get("done")!).getByTestId("kanban-done-collapsed-rail");
    expect(within(doneRail).getByTestId("kanban-done-unmerged-count").textContent).toBe(lang === "en" ? "3 unmerged" : "3 张未合入");
    expect(within(doneRail).getByTestId("kanban-rail-automation-done").textContent).toBe("Main Pusher");
  });

  it.each(["horizontal", "vertical"] as const)("%s: cards drop into an empty rail and into the collapsed Done rail", async (mode) => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    renderBoard("en");
    resizeBoard(mode === "horizontal" ? 1400 : 600);
    expectBoardMode(mode);

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

  it("the Done expand button works in vertical mode", () => {
    renderBoard("en");
    resizeBoard(600);
    expectBoardMode("vertical");
    fireEvent.click(within(columnsById().get("done")!).getByTestId("kanban-done-collapse-toggle"));
    const done = columnsById().get("done")!;
    expect(within(done).queryByTestId("kanban-done-collapsed-rail")).toBeNull();
    expect(within(done).getAllByTestId("kanban-card").length).toBeGreaterThan(0);
  });
});

describe("loading skeleton follows the same decision", () => {
  it("rail columns use the horizontal constant on a wide board and the vertical one on a narrow board", () => {
    render(<KanbanBoardSkeleton label="Loading" />);
    const skeleton = screen.getByTestId("kanban-board-skeleton");
    const rails = () => screen.getAllByTestId("kanban-board-skeleton-column").slice(0, 2);

    act(() => FakeResizeObserver.resize(skeleton, 1400));
    expect(skeleton.getAttribute("data-rail-mode")).toBe("horizontal");
    for (const rail of rails()) expect(classes(rail)).toContain(EMPTY_COLUMN_RAIL_WIDTH);

    act(() => FakeResizeObserver.resize(skeleton, 700));
    expect(skeleton.getAttribute("data-rail-mode")).toBe("vertical");
    for (const rail of rails()) {
      expect(classes(rail)).toContain(EMPTY_COLUMN_RAIL_VERTICAL_WIDTH);
      expect(classes(rail)).not.toContain(EMPTY_COLUMN_RAIL_WIDTH);
    }
  });
});
