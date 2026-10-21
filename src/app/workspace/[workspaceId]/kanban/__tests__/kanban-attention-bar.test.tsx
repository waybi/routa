import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanAttentionBar } from "../kanban-attention-bar";
import {
  attentionDismissalsStorageKey,
  resetAttentionDismissalsForTests,
} from "../use-kanban-attention-dismissals";
import type { KanbanBoardInfo, TaskInfo } from "../../types";

const NOW = Date.UTC(2026, 9, 21, 12);

const board: KanbanBoardInfo = {
  id: "board-attn",
  workspaceId: "workspace-1",
  name: "Board",
  isDefault: true,
  columns: [
    { id: "done", name: "Done", position: 0, stage: "done", automation: { enabled: true, steps: [{ id: "p", specialistId: "kanban-main-pusher" }] } },
    { id: "blocked", name: "Blocked", position: 1, stage: "blocked" },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function unmergedTask(ahead: number): TaskInfo {
  return {
    id: "card-u",
    title: "Unmerged card",
    status: "COMPLETED",
    columnId: "done",
    createdAt: new Date(NOW - 86_400_000).toISOString(),
    updatedAt: new Date(NOW - 3_600_000).toISOString(),
    completionReport: { excerpt: "x", commit: "y", hasLeftover: false, createdAt: new Date(NOW).toISOString() },
    deliveryLanding: { landedOnBase: false, commitsSinceBase: ahead },
  } as TaskInfo;
}

const blockedTask = {
  id: "card-b",
  title: "Blocked card",
  status: "PENDING",
  columnId: "blocked",
  createdAt: "2026-01-01T00:00:00.000Z",
} as TaskInfo;

function renderBar(tasks: TaskInfo[], onOpenTask = vi.fn()) {
  return render(<KanbanAttentionBar board={board} tasks={tasks} onOpenTask={onOpenTask} now={NOW} />);
}

beforeEach(() => {
  window.localStorage.clear();
  resetAttentionDismissalsForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("KanbanAttentionBar (AC9 / AC10)", () => {
  it("renders nothing when there are no items", () => {
    renderBar([{ ...blockedTask, columnId: "dev" }]);
    expect(screen.queryByTestId("kanban-attention-bar")).toBeNull();
  });

  it("lists items and opens the card on click", () => {
    const onOpenTask = vi.fn();
    renderBar([blockedTask, unmergedTask(2)], onOpenTask);
    const items = screen.getAllByTestId("kanban-attention-item");
    expect(items.map((item) => item.getAttribute("data-kind"))).toEqual(["blocked", "unmerged"]);
    expect(items[1].textContent).toContain("+2");
    fireEvent.click(screen.getAllByTestId("kanban-attention-open")[0]);
    expect(onOpenTask).toHaveBeenCalledWith(blockedTask);
  });

  it("hides a dismissed item, persists it, keeps it hidden after remount", () => {
    const first = renderBar([blockedTask, unmergedTask(2)]);
    fireEvent.click(screen.getAllByTestId("kanban-attention-dismiss")[0]);
    expect(screen.getAllByTestId("kanban-attention-item").map((item) => item.getAttribute("data-kind"))).toEqual(["unmerged"]);
    expect(JSON.parse(window.localStorage.getItem(attentionDismissalsStorageKey(board.id)) ?? "[]")).toEqual(["card-b|blocked|0"]);
    first.unmount();

    renderBar([blockedTask, unmergedTask(2)]);
    expect(screen.getAllByTestId("kanban-attention-item").map((item) => item.getAttribute("data-kind"))).toEqual(["unmerged"]);
  });

  it("resurfaces an unmerged item when commits ahead changes", () => {
    const view = renderBar([unmergedTask(2)]);
    fireEvent.click(screen.getByTestId("kanban-attention-dismiss"));
    expect(screen.queryByTestId("kanban-attention-bar")).toBeNull();

    view.rerender(<KanbanAttentionBar board={board} tasks={[unmergedTask(3)]} onOpenTask={vi.fn()} now={NOW} />);
    expect(screen.getByTestId("kanban-attention-item").textContent).toContain("+3");
  });

  it("falls back to memory without throwing when localStorage.setItem fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    renderBar([blockedTask]);
    expect(() => fireEvent.click(screen.getByTestId("kanban-attention-dismiss"))).not.toThrow();
    expect(screen.queryByTestId("kanban-attention-bar")).toBeNull();
  });
});
