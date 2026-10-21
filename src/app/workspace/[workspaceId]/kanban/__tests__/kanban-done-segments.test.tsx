import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KanbanDoneSegments } from "../kanban-done-segments";
import type { TaskInfo } from "../../types";

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, isDragging: false, listeners: {}, setNodeRef: vi.fn(), transform: null }),
}));

// Wednesday 2026-10-21 15:00 local.
const NOW = new Date(2026, 9, 21, 15, 0);

function local(m: number, d: number, h = 12, min = 0): string {
  return new Date(2026, m - 1, d, h, min).toISOString();
}

function doneTask(id: string, updatedAt: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: `Card ${id}`,
    status: "COMPLETED",
    columnId: "done",
    position: 0,
    createdAt: local(1, 1),
    updatedAt,
    ...overrides,
  } as TaskInfo;
}

const report = (overrides: Partial<NonNullable<TaskInfo["completionReport"]>> = {}) => ({
  excerpt: "Shipped the thing",
  commit: "abcdef1234567890",
  hasLeftover: false,
  createdAt: local(10, 21),
  ...overrides,
});

describe("KanbanDoneSegments (AC4)", () => {
  const tasks = [
    doneTask("t1", local(10, 21, 10)),
    doneTask("y1", local(10, 20, 9)),
    doneTask("w1", local(10, 19, 9)),
    doneTask("o1", local(10, 1, 9)),
  ];

  it("renders one header per non-empty segment with counts and expands the first two", () => {
    render(<KanbanDoneSegments tasks={tasks} now={NOW} onOpenTask={vi.fn()} />);

    for (const key of ["today", "yesterday", "thisWeek", "older"]) {
      expect(screen.getByTestId(`kanban-done-segment-toggle-${key}`).textContent).toContain("1");
    }
    expect(screen.getByTestId("kanban-done-segment-toggle-today").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("kanban-done-segment-toggle-yesterday").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("kanban-done-segment-toggle-thisWeek").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("kanban-done-segment-toggle-older").getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByTestId("kanban-card").map((card) => card.getAttribute("data-segment"))).toEqual(["today", "yesterday"]);
  });

  it("skips empty segments and toggles a segment on header click", () => {
    render(<KanbanDoneSegments tasks={tasks.slice(1)} now={NOW} onOpenTask={vi.fn()} />);

    expect(screen.queryByTestId("kanban-done-segment-today")).toBeNull();
    fireEvent.click(screen.getByTestId("kanban-done-segment-toggle-older"));
    expect(within(screen.getByTestId("kanban-done-segment-older")).getAllByTestId("kanban-card")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("kanban-done-segment-toggle-yesterday"));
    expect(within(screen.getByTestId("kanban-done-segment-yesterday")).queryAllByTestId("kanban-card")).toHaveLength(0);
  });

  it("expands every non-empty segment in search mode", () => {
    render(<KanbanDoneSegments tasks={tasks} now={NOW} onOpenTask={vi.fn()} expandAll />);
    expect(screen.getAllByTestId("kanban-card")).toHaveLength(4);
  });
});

describe("KanbanDoneCard two-line layout (AC5)", () => {
  it("shows excerpt, 7-char commit and leftover pill; time is HH:mm today", () => {
    const onOpenTask = vi.fn();
    const task = doneTask("t1", local(10, 21, 9, 5), { completionReport: report({ hasLeftover: true }) });
    render(<KanbanDoneSegments tasks={[task]} now={NOW} onOpenTask={onOpenTask} />);

    const card = screen.getByTestId("kanban-card");
    expect(within(card).getByTestId("kanban-done-card-time").textContent).toBe("09:05");
    expect(within(card).getByTestId("kanban-done-card-line2").textContent).toContain("Shipped the thing");
    expect(within(card).getByTestId("kanban-done-card-commit").textContent).toBe("abcdef1");
    expect(within(card).getByTestId("kanban-done-card-leftover")).toBeTruthy();
    fireEvent.click(card);
    expect(onOpenTask).toHaveBeenCalledWith(task);
  });

  it("omits the commit pill when commit is null and the leftover pill when false", () => {
    render(
      <KanbanDoneSegments
        tasks={[doneTask("t1", local(10, 21, 9), { completionReport: report({ commit: null }) })]}
        now={NOW}
        onOpenTask={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("kanban-done-card-commit")).toBeNull();
    expect(screen.queryByTestId("kanban-done-card-leftover")).toBeNull();
  });

  it("shows the report-pending pill when there is no report and the trailing done session is running", () => {
    const task = doneTask("t1", local(10, 21, 9), {
      completionReport: null,
      laneSessions: [
        { sessionId: "dev", columnId: "dev", status: "completed", startedAt: local(10, 21, 8) },
        { sessionId: "done", columnId: "done", status: "running", startedAt: local(10, 21, 9) },
      ],
    });
    render(<KanbanDoneSegments tasks={[task]} now={NOW} onOpenTask={vi.fn()} />);
    expect(screen.getByTestId("kanban-done-card-report-pending")).toBeTruthy();
  });

  it("uses M-D and a single line in the older segment", () => {
    const task = doneTask("o1", local(3, 7, 9), { completionReport: report() });
    render(<KanbanDoneSegments tasks={[task]} now={NOW} onOpenTask={vi.fn()} />);
    const card = screen.getByTestId("kanban-card");
    expect(card.getAttribute("data-segment")).toBe("older");
    expect(within(card).getByTestId("kanban-done-card-time").textContent).toBe("3-7");
    expect(within(card).queryByTestId("kanban-done-card-line2")).toBeNull();
  });
});
