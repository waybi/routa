import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanTab } from "../kanban-tab";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { resetDesktopAwareFetchToGlobalFetch } from "./test-utils";

// Board load must be read-only: a worktree that 404s is hidden locally and
// never PATCHed back to the server (card 47aea410).

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

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

beforeEach(() => {
  resetDesktopAwareFetchToGlobalFetch(desktopAwareFetch);
  vi.useRealTimers();
});

describe("KanbanTab stale worktree recovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides orphaned worktree ids locally after a 404 without patching the task", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method && url === "/api/worktrees/wt-missing") {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: "Worktree not found" }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const staleTask = createTask("task-1", "Story One", { worktreeId: "wt-missing" });
    const { rerender } = render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[staleTask]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/worktrees/wt-missing", { cache: "no-store" });
    });
    await waitFor(() => {
      expect(screen.queryByText(/^worktree /)).toBeNull();
    });
    // Loading the board is read-only: no PATCH to /api/tasks/:id.
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")).toBe(false);

    fetchMock.mockClear();

    // A refetch brings the same stale id back from the server.
    rerender(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[{ ...staleTask }]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText(/^worktree /)).toBeNull();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not PATCH any task when the board only renders", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!init?.method && url.startsWith("/api/worktrees/")) {
        const id = decodeURIComponent(url.slice("/api/worktrees/".length));
        if (id === "wt-live") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ worktree: { id: "wt-live", status: "active", branch: "issue/live", worktreePath: "/tmp/wt-live" } }),
          } as Response;
        }
        return { ok: false, status: 404, json: async () => ({ error: "Worktree not found" }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <KanbanTab
        workspaceId="workspace-1"
        boards={[board]}
        tasks={[
          createTask("task-1", "Live", { worktreeId: "wt-live" }),
          createTask("task-2", "Gone A", { worktreeId: "wt-gone-a" }),
          createTask("task-3", "Gone B", { worktreeId: "wt-gone-b" }),
        ]}
        sessions={[]}
        providers={[]}
        specialists={[]}
        codebases={[]}
        onRefresh={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/worktrees/wt-gone-b", { cache: "no-store" });
    });
    await waitFor(() => {
      expect(screen.getByText(/worktree active · issue\/live/)).toBeTruthy();
    });
    const patchCalls = fetchMock.mock.calls.filter(([url, init]) => (
      String(url).startsWith("/api/tasks/") && (init as RequestInit | undefined)?.method === "PATCH"
    ));
    expect(patchCalls).toEqual([]);
  });
});
