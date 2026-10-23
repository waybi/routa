/**
 * Board page redesign (card 6972ad2e): header order, Done window, search
 * through a collapsed Done lane, view=all, skeleton / error / empty states,
 * empty-rail drop target and the board keyboard. Each test locks a retained
 * feature so later restyles cannot silently drop it.
 */
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
import { EMPTY_COLUMN_RAIL_WIDTH } from "../kanban-empty-column-rail";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";
import { toast } from "@/client/components/toast";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";

const { desktopAwareFetch, dnd } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
  dnd: {
    onDragEnd: null as null | ((event: { active: { id: string; data?: { current?: Record<string, unknown> } }; over: { id: string } | null }) => void),
    droppables: [] as string[],
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
  useDroppable: ({ id }: { id: string }) => {
    if (!dnd.droppables.includes(id)) dnd.droppables.push(id);
    return { isOver: false, setNodeRef: vi.fn() };
  },
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

function makeBoard(columns = [
  { id: "backlog", name: "Backlog", position: 0, stage: "backlog" },
  { id: "review", name: "Review", position: 1, stage: "review" },
  { id: "done", name: "Done", position: 2, stage: "done" },
]): KanbanBoardInfo {
  return {
    id: "board-1",
    workspaceId: "workspace-1",
    name: "Board",
    isDefault: true,
    sessionConcurrencyLimit: 1,
    queue: { runningCount: 0, runningCards: [], queuedCount: 0, queuedCardIds: [], queuedCards: [], queuedPositions: {} },
    columns,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as KanbanBoardInfo;
}

function card(id: string, columnId: string, minute: number, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: `${id} title`,
    objective: "objective",
    status: columnId === "done" ? "COMPLETED" : "PENDING",
    boardId: "board-1",
    columnId,
    position: minute,
    createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    ...overrides,
  } as TaskInfo;
}

function doneCards(count: number): TaskInfo[] {
  return Array.from({ length: count }, (_, index) => card(`done-${index}`, "done", index));
}

function renderTab(tasks: TaskInfo[], extra: Partial<Parameters<typeof KanbanTab>[0]> = {}) {
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
      {...extra}
    />,
  );
}

function column(id: string): HTMLElement {
  const match = screen.getAllByTestId("kanban-column").find((element) => element.getAttribute("data-column-id") === id);
  if (!match) throw new Error(`column ${id} not found`);
  return match;
}

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  dnd.onDragEnd = null;
  dnd.droppables = [];
  window.localStorage.clear();
  window.history.replaceState(null, "", "/workspace/workspace-1/kanban");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AC1 header and toolbar", () => {
  it("orders Board settings · Add request · New card, and New card opens the create modal", () => {
    renderTab([card("backlog-1", "backlog", 0)]);
    const actions = screen.getByTestId("kanban-header-actions");
    const labels = within(actions).getAllByRole("button").map((button) => button.textContent?.trim());
    expect(labels).toEqual(["Board settings", "Add request", "New card"]);
    expect(within(actions).getByTestId("kanban-new-card").getAttribute("data-variant")).toBe("primary");

    const toolbar = screen.getByTestId("kanban-toolbar");
    const order = [
      within(toolbar).getByTestId("kanban-view-toggle"),
      within(toolbar).getByTestId("kanban-board-search"),
      within(toolbar).getByTestId("kanban-toolbar-hit-count"),
    ];
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(within(toolbar).getByTestId("kanban-toolbar-hit-count").textContent).toBe("1 / 1");

    expect(screen.queryByTestId("kanban-create-submit")).toBeNull();
    fireEvent.click(screen.getByTestId("kanban-new-card"));
    expect(screen.getByTestId("kanban-create-submit")).toBeTruthy();
  });

  it("Add request reveals the board dispatch input", () => {
    renderTab([card("backlog-1", "backlog", 0)], { onAgentPrompt: vi.fn() });
    expect(screen.queryByTestId("kanban-dispatch-bar")).toBeNull();
    fireEvent.click(screen.getByTestId("kanban-open-dispatch"));
    expect(screen.getByTestId("kanban-dispatch-bar")).toBeTruthy();
    expect(screen.getByTestId("kanban-agent-input")).toBeTruthy();
  });
});

describe("AC3 empty column rail", () => {
  it("an empty column is a rail that still accepts a drop", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    renderTab([card("mover", "backlog", 0), ...doneCards(2)]);

    const review = column("review");
    expect(within(review).getByTestId("kanban-empty-column-rail")).toBeTruthy();
    expect(review.className).toContain(EMPTY_COLUMN_RAIL_WIDTH);
    expect(dnd.droppables).toContain("column:review");

    await act(async () => {
      dnd.onDragEnd?.({ active: { id: "mover", data: { current: { columnId: "backlog" } } }, over: { id: "column:review" } });
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/tasks/mover", expect.objectContaining({ method: "PATCH" }));
    });
  });
});

describe("AC4 Done window", () => {
  it("show earlier goes 20 → 40, show less returns to 20, footer counts shown / total", () => {
    renderTab(doneCards(45));
    const done = column("done");
    expect(within(done).getAllByTestId("kanban-card")).toHaveLength(20);
    expect(within(done).getByTestId("kanban-done-window-count").textContent).toBe("Latest 20 / 45");

    fireEvent.click(within(done).getByTestId("kanban-done-show-more"));
    expect(within(done).getAllByTestId("kanban-card")).toHaveLength(40);
    fireEvent.click(within(done).getByTestId("kanban-done-show-more"));
    expect(within(done).getAllByTestId("kanban-card")).toHaveLength(45);
    expect(within(done).getByTestId("kanban-done-show-more").textContent).toBe("Show less");

    fireEvent.click(within(done).getByTestId("kanban-done-show-more"));
    expect(within(done).getAllByTestId("kanban-card")).toHaveLength(20);
  });
});

describe("AC5 search through a collapsed Done lane", () => {
  it("finds the 25th Done card even while the lane is collapsed", () => {
    const tasks = doneCards(30).map((task, index) => (index === 5
      ? { ...task, title: "needle in the hay" }
      : task));
    renderTab(tasks);
    fireEvent.click(within(column("done")).getByTestId("kanban-done-collapse-toggle"));
    expect(within(column("done")).queryAllByTestId("kanban-card")).toHaveLength(0);

    fireEvent.change(screen.getByTestId("kanban-board-search"), { target: { value: "needle" } });
    const hits = within(column("done")).getAllByTestId("kanban-card");
    expect(hits).toHaveLength(1);
    expect(hits[0].textContent).toContain("needle in the hay");
    expect(within(hits[0]).getByTestId("kanban-search-mark").className).toContain("text-attention");
    expect(screen.getByTestId("kanban-toolbar-hit-count").textContent).toBe("1 / 30");
  });
});

describe("AC6 view=all", () => {
  it("adds view=all on All projects and removes it on This board", () => {
    vi.stubGlobal("EventSource", class { close = vi.fn(); onmessage = null; onerror = null; });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ workspaces: [], tasks: [], boards: [] })));
    renderTab([card("backlog-1", "backlog", 0)]);
    fireEvent.click(screen.getByTestId("kanban-view-toggle-all"));
    expect(new URLSearchParams(window.location.search).get("view")).toBe("all");
    fireEvent.click(screen.getByTestId("kanban-view-toggle-board"));
    expect(new URLSearchParams(window.location.search).has("view")).toBe(false);
  });
});

describe("AC10 skeleton, error and empty states", () => {
  it("shows a column-shaped skeleton before boards arrive", () => {
    render(
      <KanbanTab workspaceId="workspace-1" boards={[]} tasks={[]} sessions={[]} providers={[]} specialists={[]} codebases={[]} onRefresh={vi.fn()} />,
    );
    expect(screen.getByTestId("kanban-board-skeleton")).toBeTruthy();
    expect(screen.getAllByTestId("kanban-board-skeleton-column").length).toBeGreaterThanOrEqual(4);
  });

  it("keeps the loaded board under the error state and retries on click", () => {
    const onRefresh = vi.fn();
    renderTab([card("backlog-1", "backlog", 0)], { onRefresh, loadError: "HTTP 500" });
    const error = screen.getByTestId("ui-error-state");
    expect(error.textContent).toContain("HTTP 500");
    expect(screen.getAllByTestId("kanban-card")).toHaveLength(1);
    fireEvent.click(within(error).getByRole("button", { name: "Reload" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("says the board is empty and offers New card", () => {
    renderTab([]);
    const empty = screen.getByTestId("ui-empty-state");
    expect(empty.textContent).toContain("This board has no cards yet");
    fireEvent.click(within(empty).getByTestId("kanban-empty-new-card"));
    expect(screen.getByTestId("kanban-create-submit")).toBeTruthy();
  });
});

describe("AC13 board keyboard", () => {
  it("N opens New card on the board but not while typing in an input", () => {
    renderTab([card("backlog-1", "backlog", 0)]);
    const search = screen.getByTestId("kanban-board-search");
    search.focus();
    fireEvent.keyDown(search, { key: "n" });
    expect(screen.queryByTestId("kanban-create-submit")).toBeNull();

    search.blur();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(screen.getByTestId("kanban-create-submit")).toBeTruthy();
  });

  it("↓ moves focus to the next card in the same column, → to the next column", () => {
    renderTab([card("b-0", "backlog", 0), card("b-1", "backlog", 1), card("d-0", "done", 5)]);
    const backlogCards = within(column("backlog")).getAllByTestId("kanban-card");
    backlogCards[0].focus();
    fireEvent.keyDown(backlogCards[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(backlogCards[1]);

    fireEvent.keyDown(backlogCards[1], { key: "ArrowRight" });
    expect(document.activeElement).toBe(within(column("done")).getAllByTestId("kanban-card")[0]);

    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
    expect(new URLSearchParams(window.location.search).get("taskId")).toBe("d-0");
  });
});

describe("AC11 dispatch failure stays visible", () => {
  it("shows the error inline, raises a sticky error toast and keeps the typed request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const errorSpy = vi.spyOn(toast, "error");
    const onAgentPrompt = vi.fn(async () => {
      throw new Error("provider exploded");
    });
    const acp = {
      connected: true,
      loading: false,
      selectedProvider: "claude",
      providers: [{ id: "claude", name: "Claude Code", description: "", command: "claude", status: "available" }],
      setProvider: vi.fn(),
    } as unknown as UseAcpState & UseAcpActions;
    renderTab([card("backlog-1", "backlog", 0)], {
      onAgentPrompt,
      acp,
      providers: [{ id: "claude", name: "Claude Code", description: "", command: "claude", status: "available" }],
    });

    fireEvent.click(screen.getByTestId("kanban-open-dispatch"));
    const input = screen.getByTestId("kanban-agent-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Plan the redesign" } });
    fireEvent.click(screen.getByTestId("kanban-agent-submit"));

    await waitFor(() => expect(screen.getByTestId("kanban-agent-error").textContent).toContain("provider exploded"));
    expect(errorSpy).toHaveBeenCalledWith("Failed to create session", expect.objectContaining({ description: "provider exploded" }));
    expect((screen.getByTestId("kanban-agent-input") as HTMLInputElement).value).toBe("Plan the redesign");
    errorSpy.mockRestore();
  });

  it("disables Send and says what is running while the session is being created", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const onAgentPrompt = vi.fn(() => new Promise<string | null>(() => {}));
    const acp = {
      connected: true,
      loading: false,
      selectedProvider: "claude",
      providers: [{ id: "claude", name: "Claude Code", description: "", command: "claude", status: "available" }],
      setProvider: vi.fn(),
    } as unknown as UseAcpState & UseAcpActions;
    renderTab([card("backlog-1", "backlog", 0)], {
      onAgentPrompt,
      acp,
      providers: [{ id: "claude", name: "Claude Code", description: "", command: "claude", status: "available" }],
    });
    fireEvent.click(screen.getByTestId("kanban-open-dispatch"));
    fireEvent.change(screen.getByTestId("kanban-agent-input"), { target: { value: "Plan" } });
    fireEvent.click(screen.getByTestId("kanban-agent-submit"));
    await waitFor(() => expect(screen.getByTestId("kanban-agent-submit").textContent).toContain("Creating session"));
    expect((screen.getByTestId("kanban-agent-submit") as HTMLButtonElement).disabled).toBe(true);
  });
});
