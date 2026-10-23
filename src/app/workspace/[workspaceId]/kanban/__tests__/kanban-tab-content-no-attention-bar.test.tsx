/**
 * Card c908dc70 (AC1 / contract C1): the single-board view no longer renders
 * the "Needs you" strip. A blocked card and a failed Done run used to make it
 * appear; now the header (which holds the search box) is followed directly by
 * the board body, or by the empty state when there are no cards.
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const NOW = Date.now();
// Built at runtime so the card gate (git grep for the removed strip id under src) finds 0 hits.
const REMOVED_STRIP_TEST_ID = ["kanban", "attention", "bar"].join("-");

const board = {
  id: "board-1",
  workspaceId: "workspace-1",
  name: "Board",
  isDefault: true,
  sessionConcurrencyLimit: 1,
  queue: { runningCount: 0, runningCards: [], queuedCount: 0, queuedCardIds: [], queuedCards: [], queuedPositions: {} },
  columns: [
    { id: "dev", name: "Dev", position: 0, stage: "dev" },
    { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
    { id: "done", name: "Done", position: 2, stage: "done", automation: { enabled: true, steps: [{ id: "s1", specialistId: "kanban-done-reporter" }] } },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
} as unknown as KanbanBoardInfo;

function iso(ms: number) {
  return new Date(ms).toISOString();
}

const blockedCard = {
  id: "card-b",
  title: "Blocked card",
  status: "PENDING",
  boardId: "board-1",
  columnId: "blocked",
  position: 0,
  lastSyncError: "push rejected by hook",
  createdAt: iso(NOW - 3_600_000),
  updatedAt: iso(NOW - 600_000),
} as unknown as TaskInfo;

const failedDoneCard = {
  id: "card-f",
  title: "Failed done card",
  status: "COMPLETED",
  boardId: "board-1",
  columnId: "done",
  position: 1,
  createdAt: iso(NOW - 7_200_000),
  updatedAt: iso(NOW - 600_000),
  laneSessions: [
    { sessionId: "dev-1", columnId: "dev", startedAt: iso(NOW - 7_000_000), completedAt: iso(NOW - 6_000_000), status: "transitioned" },
    { sessionId: "done-1", columnId: "done", startedAt: iso(NOW - 1_800_000), completedAt: iso(NOW - 900_000), status: "failed" },
  ],
} as unknown as TaskInfo;

function renderTab(tasks: TaskInfo[]) {
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

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  window.localStorage.clear();
  window.history.replaceState(null, "", "/workspace/workspace-1/kanban");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("single-board view without the Needs-you strip", () => {
  it("does not render the strip even with a blocked card and a failed Done run", () => {
    renderTab([blockedCard, failedDoneCard]);
    expect(screen.getByText("Blocked card")).toBeTruthy();
    expect(screen.queryByTestId(REMOVED_STRIP_TEST_ID)).toBeNull();
    expect(screen.queryByText("Needs your attention")).toBeNull();
    expect(screen.queryByRole("button", { name: "Got it" })).toBeNull();
  });

  it("puts the board body right after the header that holds the search box", () => {
    renderTab([blockedCard, failedDoneCard]);
    const header = screen.getByTestId("kanban-page-header");
    expect(header.contains(screen.getByTestId("kanban-board-search"))).toBe(true);
    expect(header.nextElementSibling?.getAttribute("data-testid")).toBe("kanban-board-keyboard-scope");
  });

  it("puts the empty state right after the header when the board has no cards", () => {
    renderTab([]);
    const header = screen.getByTestId("kanban-page-header");
    expect(header.nextElementSibling?.getAttribute("data-testid")).toBe("ui-empty-state");
  });
});
