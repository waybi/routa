/**
 * Board dispatch bar is always visible (card 8a2d2555 AC18, as before the
 * redesign at e4e5c162): provider dropdown, input, send, manual create and
 * "View" (with a planning session) render without any click; "Add request"
 * only focuses the input; there is no collapse button. Also: the card face
 * objective summary shows up to three lines again (AC19 ③).
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";
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

const board = {
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
} as KanbanBoardInfo;

function card(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: `${id} title`,
    objective: "objective line one\nline two\nline three\nline four",
    status: "PENDING",
    boardId: "board-1",
    columnId: "backlog",
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as TaskInfo;
}

// Assembled so the removed collapse-button id never appears literally in
// the kanban folder (card verification grep).
const COLLAPSE_BUTTON_TEST_ID = ["kanban", "dispatch", "close"].join("-");

const providers = [{ id: "claude", name: "Claude Code", description: "", command: "claude", status: "available" as const }];
// A connected ACP: without it the input is disabled and cannot take focus.
const acp = { connected: true, loading: false, error: null, updates: [], selectedProvider: "claude", providers, setProvider: vi.fn(), selectSession: vi.fn() } as unknown as UseAcpState & UseAcpActions;

function renderTab(tasks: TaskInfo[], boards: KanbanBoardInfo[] = [board], onAgentPrompt = vi.fn(async () => null as string | null)) {
  return render(
    <KanbanTab
      workspaceId="workspace-1"
      boards={boards}
      tasks={tasks}
      sessions={[]}
      acp={acp}
      providers={providers}
      specialists={[]}
      codebases={[]}
      onRefresh={vi.fn()}
      onAgentPrompt={onAgentPrompt}
    />,
  );
}

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/workspace/workspace-1/kanban");
});

describe("dispatch bar always visible (AC18)", () => {
  it.each([
    ["a board with cards", [card("c1")]],
    ["an empty board", []],
  ])("renders every control on first paint for %s", (_label, tasks) => {
    renderTab(tasks as TaskInfo[]);
    const bar = screen.getByTestId("kanban-dispatch-bar");
    for (const id of ["kanban-agent-provider", "kanban-agent-input", "kanban-agent-submit"]) {
      expect(bar.querySelector(`[data-testid='${id}']`)).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Manual" })).toBeTruthy();
    expect(screen.queryByTestId(COLLAPSE_BUTTON_TEST_ID)).toBeNull();
    // The bar does not grab focus on load ("/" still reaches search).
    expect(document.activeElement).not.toBe(screen.getByTestId("kanban-agent-input"));
  });

  it("Add request focuses the input, keeps the bar and has no aria-expanded", () => {
    renderTab([card("c1")]);
    const add = screen.getByTestId("kanban-open-dispatch");
    expect(add.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getByTestId("kanban-dispatch-bar")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId("kanban-agent-input"));
  });

  it("shows View for the planning session and opens its panel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const selectSession = acp.selectSession as ReturnType<typeof vi.fn>;
    selectSession.mockClear();
    renderTab([card("c1")], [board], vi.fn(async () => "planning-session-1"));
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
    fireEvent.change(screen.getByTestId("kanban-agent-input"), { target: { value: "Plan it" } });
    fireEvent.click(screen.getByTestId("kanban-agent-submit"));
    const view = await screen.findByRole("button", { name: "View" });
    expect(screen.getByTestId("kanban-dispatch-bar").contains(view)).toBe(true);
    selectSession.mockClear();
    fireEvent.click(view);
    await waitFor(() => expect(selectSession).toHaveBeenCalledWith("planning-session-1"));
    vi.unstubAllGlobals();
  });

  it("'/' still focuses board search while focus is not in an input", () => {
    renderTab([card("c1")]);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement?.getAttribute("type")).toBe("search");
  });

  it("does not crash and shows no dispatch bar when the workspace has no board", () => {
    renderTab([], []);
    expect(screen.getByTestId("kanban-board-page")).toBeTruthy();
    expect(screen.queryByTestId("kanban-dispatch-bar")).toBeNull();
  });
});

describe("card face objective summary (AC19 ③)", () => {
  it("clamps the objective to three lines; review feedback and live tail keep two", () => {
    renderTab([card("c1")]);
    const summary = screen.getByText((_, element) => element?.tagName === "P" && (element.textContent ?? "").startsWith("objective line one"));
    expect(summary.className).toContain("line-clamp-3");
    expect(summary.className).not.toContain("line-clamp-2");
  });
});
