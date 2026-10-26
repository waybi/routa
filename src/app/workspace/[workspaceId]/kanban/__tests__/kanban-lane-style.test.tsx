/**
 * Board restyle (card 42b16b6d): Attio-style columns in light, Linear-style in
 * dark, buttons untouched. Locks that the status marker reaches every path
 * (column header, empty rail, collapsed Done rail, Done column with segments,
 * the three overview blocks) and that columns / cards / blocks read their
 * surfaces from the --kanban-* variables, while older shapes stay intact.
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { KanbanTab } from "../kanban-tab";
import { KanbanOverview } from "../kanban-overview";
import { KanbanLaneMarker } from "../kanban-lane-marker";
import { __resetKanbanOverviewCacheForTests } from "../use-kanban-overview-data";
import { doneCollapsedStorageKey } from "../kanban-done-column-window";
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ workspaceId: "workspace-1" }),
  usePathname: () => "/workspace/workspace-1/kanban",
  useSearchParams: () => new URLSearchParams(window.location.search),
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

const STAGES = ["backlog", "todo", "dev", "review", "done", "blocked"] as const;

function makeBoard(): KanbanBoardInfo {
  return {
    id: "board-1",
    workspaceId: "workspace-1",
    name: "Board",
    isDefault: true,
    sessionConcurrencyLimit: 1,
    queue: { runningCount: 0, runningCards: [], queuedCount: 0, queuedCardIds: [], queuedCards: [], queuedPositions: {} },
    columns: [
      ...STAGES.map((stage, position) => ({ id: stage, name: stage === "review" ? "待验收" : stage, position, stage })),
      { id: "icebox", name: "Icebox", position: 9, stage: "backlog" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as KanbanBoardInfo;
}

function card(id: string, columnId: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: `${id} title`,
    objective: "objective",
    status: columnId === "done" ? "COMPLETED" : "PENDING",
    boardId: "board-1",
    columnId,
    position: 0,
    createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 1)).toISOString(),
    ...overrides,
  } as TaskInfo;
}

const TASKS = [
  ...STAGES.map((stage) => card(`${stage}-1`, stage)),
  card("done-2", "done", { deliveryLanding: { landedOnBase: false, commitsSinceBase: 2 } } as Partial<TaskInfo>),
];

function renderTab(tasks: TaskInfo[] = TASKS) {
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

function column(id: string): HTMLElement {
  const match = screen.getAllByTestId("kanban-column").find((element) => element.getAttribute("data-column-id") === id);
  if (!match) throw new Error(`column ${id} not found`);
  return match;
}

function markerVar(marker: Element): string {
  return (marker as HTMLElement).style.getPropertyValue("--lane-marker");
}

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/workspace/workspace-1/kanban");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KanbanLaneMarker (C4)", () => {
  it.each([
    ["todo", "var(--lane-todo)"],
    ["done", "var(--lane-done)"],
    ["backlog", "var(--lane-backlog)"],
  ])("%s marker is decorative and references %s", (stage, variable) => {
    const { container } = render(<KanbanLaneMarker stage={stage} />);
    const marker = container.firstElementChild as HTMLElement;
    expect(marker.getAttribute("aria-hidden")).toBe("true");
    expect(marker.textContent).toBe("");
    expect(marker.getAttribute("title")).toBeNull();
    expect(marker.getAttribute("aria-label")).toBeNull();
    expect(markerVar(marker)).toBe(variable);
    expect(marker.className).toContain("bg-[color:var(--lane-marker)]");
    // Light: 8x8 square dot, radius 2px; dark: 10x10 ring with a 2px border.
    expect(marker.className).toContain("size-2 ");
    expect(marker.className).toContain("rounded-[2px]");
    expect(marker.className).toContain("dark:size-2.5");
    expect(marker.className).toContain("dark:rounded-full");
    expect(marker.className).toContain("dark:border-2");
    expect(marker.className).toContain("shrink-0");
  });

  it("done is filled in dark, backlog is dashed, todo is a hollow solid ring", () => {
    const cls = (stage: string) => (render(<KanbanLaneMarker stage={stage} />).container.firstElementChild as HTMLElement).className;
    const done = cls("done");
    expect(done).toContain("dark:bg-[color:var(--lane-marker)]");
    expect(done).not.toContain("dark:bg-transparent");
    const backlog = cls("backlog");
    expect(backlog).toContain("dark:border-dashed");
    expect(backlog).toContain("dark:bg-transparent");
    const todo = cls("todo");
    expect(todo).toContain("dark:bg-transparent");
    expect(todo).toContain("dark:border-solid");
    expect(todo).not.toContain("dark:border-dashed");
  });
});

describe("single board: marker reaches every column path (F4 ①②③⑤)", () => {
  it("each of the six stage headers has a marker in front of the name with its own variable", () => {
    renderTab();
    for (const stage of STAGES) {
      const name = screen.getByTestId(`kanban-column-name-${stage}`);
      const row = name.parentElement!;
      const marker = within(row).getByTestId("kanban-lane-marker");
      expect(markerVar(marker)).toBe(`var(--lane-${stage})`);
      expect(marker.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // Column name keeps its single-line truncation.
      expect(name.className).toContain("min-w-0 truncate");
    }
    // Custom column name, colored by stage.
    expect(screen.getByTestId("kanban-column-name-review").textContent).toBe("待验收");
  });

  it("an empty column rail carries a marker colored by that column's stage", () => {
    renderTab();
    const rail = within(column("icebox")).getByTestId("kanban-empty-column-rail");
    expect(markerVar(within(rail).getByTestId("kanban-lane-marker"))).toBe("var(--lane-backlog)");
    expect(within(rail).getByTestId("kanban-rail-column-name").textContent).toBe("Icebox");
  });

  it("the Done column with day segments and the collapsed Done rail both reference var(--lane-done)", () => {
    const { unmount } = renderTab();
    const done = column("done");
    expect(within(done).getAllByTestId(/^kanban-done-segment-/).length).toBeGreaterThan(0);
    expect(markerVar(within(done).getByTestId("kanban-lane-marker"))).toBe("var(--lane-done)");
    unmount();

    window.localStorage.setItem(doneCollapsedStorageKey("board-1"), "1");
    renderTab();
    const rail = within(column("done")).getByTestId("kanban-done-collapsed-rail");
    expect(markerVar(within(rail).getByTestId("kanban-lane-marker"))).toBe("var(--lane-done)");
    // Old shape: unmerged count still on the rail, rail still expands.
    expect(within(rail).getByTestId("kanban-done-unmerged-count").textContent).toContain("1");
    fireEvent.click(within(rail).getByTestId("kanban-done-collapse-toggle"));
    expect(within(column("done")).queryByTestId("kanban-done-collapsed-rail")).toBeNull();
  });

  it("columns and cards take their surfaces from --kanban-* variables; layout classes are unchanged", () => {
    renderTab();
    for (const element of screen.getAllByTestId("kanban-column")) {
      expect(element.className).toContain("bg-[color:var(--kanban-col-bg)]");
      expect(element.className).toContain("border-[color:var(--kanban-col-border)]");
      expect(element.className).not.toContain("bg-subtle");
      expect(element.className).toContain("rounded-md");
    }
    const regular = within(column("dev")).getByTestId("kanban-card");
    expect(regular.className).toContain("bg-[color:var(--kanban-card-bg)]");
    expect(regular.className).toContain("border-[color:var(--kanban-card-border)]");
    expect(regular.className).toContain("rounded-[var(--kanban-card-radius)]");
    expect(regular.className).toContain("shadow-[var(--kanban-card-shadow)]");
    expect(regular.className).toContain("hover:bg-[color:var(--kanban-card-hover)]");
    expect(regular.className).toContain("py-2.5 pl-7 pr-2.5");
    const doneCard = within(column("done")).getAllByTestId("kanban-card")[0];
    expect(doneCard.className).toContain("bg-[color:var(--kanban-card-bg)]");
    expect(doneCard.className).toContain("rounded-[var(--kanban-card-radius)]");
  });

  it("old header shapes stay: count, Done collapse button, lane description, unmerged badge", () => {
    renderTab();
    expect(screen.getByTestId("kanban-column-count-dev").textContent).toBe("1 cards");
    expect(screen.getByTestId("kanban-column-count-done").textContent).toBe("2 cards");
    expect(within(column("done")).getByTestId("kanban-done-collapse-toggle").textContent).toBe("Collapse");
    expect(within(column("done")).getByTestId("kanban-done-unmerged-count").textContent).toContain("1");
    expect(screen.getByTestId("kanban-column-automation-blocked").textContent).toBeTruthy();
  });
});

const NOW = Date.UTC(2026, 9, 21, 12);
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function overviewBoard(): KanbanBoardInfo {
  return {
    id: "b1",
    workspaceId: "w1",
    name: "b1",
    isDefault: true,
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
      { id: "done", name: "Done", position: 2, stage: "done" },
    ],
    createdAt: iso(0),
    updatedAt: iso(0),
  } as KanbanBoardInfo;
}

function overviewFetch(tasks: TaskInfo[]) {
  return vi.fn(async (url: string) => {
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname === "/api/workspaces") {
      return Response.json({ workspaces: [{ id: "w1", title: "Space w1", status: "active", metadata: {}, createdAt: iso(0), updatedAt: iso(0) }] });
    }
    if (parsed.pathname === "/api/tasks") return Response.json({ tasks });
    if (parsed.pathname === "/api/kanban/boards") return Response.json({ boards: [overviewBoard()] });
    return new Response("not found", { status: 404 });
  });
}

class NoopEventSource {
  onmessage = null;
  onerror = null;
  close = vi.fn();
}

describe("all-projects overview blocks (F4 ④, C17)", () => {
  beforeEach(() => {
    __resetKanbanOverviewCacheForTests();
    vi.stubGlobal("EventSource", NoopEventSource as unknown as typeof EventSource);
    window.history.replaceState(null, "", "/workspace/w1/kanban?view=all");
  });

  it("the three blocks reference dev, blocked and done in order and read the block variables", async () => {
    vi.stubGlobal("fetch", overviewFetch([
      { id: "t1", title: "Card t1", status: "PENDING", columnId: "dev", boardId: "b1", workspaceId: "w1", createdAt: iso(NOW - 40 * 24 * HOUR), updatedAt: iso(NOW - HOUR) } as TaskInfo,
    ]));
    render(<KanbanOverview onShowBoard={vi.fn()} now={NOW} />);
    await waitFor(() => expect(screen.getAllByTestId("kanban-overview-card").length).toBeGreaterThan(0));

    const ids = ["kanban-overview-in-progress", "kanban-overview-attention", "kanban-overview-recent-done"];
    const expected = ["var(--lane-dev)", "var(--lane-blocked)", "var(--lane-done)"];
    ids.forEach((id, index) => {
      const block = screen.getByTestId(id);
      const header = screen.getByTestId(`${id}-header`);
      const marker = within(header).getByTestId("kanban-lane-marker");
      expect(markerVar(marker)).toBe(expected[index]);
      expect(header.firstElementChild).toBe(marker);
      expect(block.className).toContain("bg-[color:var(--kanban-block-bg)]");
      expect(block.className).toContain("border-[length:var(--kanban-block-border-width)]");
      expect(block.className).not.toContain("border-default");
    });
    // Old shape: titles unchanged.
    expect(screen.getByTestId("kanban-overview-in-progress-header").textContent).toContain("In progress");
    expect(screen.getByTestId("kanban-overview-attention-header").textContent).toContain("Needs you");
  });

  it("an empty block still renders with its marker, as before (C17)", async () => {
    vi.stubGlobal("fetch", overviewFetch([
      { id: "t1", title: "Card t1", status: "PENDING", columnId: "dev", boardId: "b1", workspaceId: "w1", createdAt: iso(NOW - 40 * 24 * HOUR), updatedAt: iso(NOW - HOUR) } as TaskInfo,
    ]));
    render(<KanbanOverview onShowBoard={vi.fn()} now={NOW} />);
    await waitFor(() => expect(screen.getAllByTestId("kanban-overview-card").length).toBeGreaterThan(0));
    const attention = screen.getByTestId("kanban-overview-attention");
    expect(within(attention).queryAllByTestId("kanban-overview-card")).toHaveLength(0);
    expect(within(screen.getByTestId("kanban-overview-attention-header")).getByTestId("kanban-lane-marker")).toBeTruthy();
  });
});
