import { describe, expect, it } from "vitest";
import {
  DONE_COLUMN_PAGE_SIZE,
  doneCollapsedStorageKey,
  sortDoneTasks,
  windowDoneTasks,
} from "../kanban-done-column-window";
import type { TaskInfo } from "../../types";

function task(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: id,
    objective: id,
    status: "COMPLETED",
    columnId: "done",
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function minutes(n: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
}

describe("sortDoneTasks", () => {
  it("orders newest updatedAt first and does not mutate the input", () => {
    const input = [
      task("a", { updatedAt: minutes(1) }),
      task("b", { updatedAt: minutes(3) }),
      task("c", { updatedAt: minutes(2) }),
    ];
    const sorted = sortDoneTasks(input);
    expect(sorted.map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(input.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to createdAt when updatedAt is missing", () => {
    const sorted = sortDoneTasks([
      task("old", { updatedAt: minutes(1) }),
      task("created-later", { createdAt: minutes(5) }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["created-later", "old"]);
  });

  it("treats unparseable timestamps as oldest", () => {
    const sorted = sortDoneTasks([
      task("broken", { updatedAt: "not-a-date", createdAt: "nope" }),
      task("ok", { updatedAt: minutes(1) }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["ok", "broken"]);
  });

  it("breaks ties on position then id so the order is stable", () => {
    const same = minutes(4);
    const input = [
      task("z", { updatedAt: same, position: 1 }),
      task("b", { updatedAt: same, position: 0 }),
      task("a", { updatedAt: same, position: 0 }),
    ];
    expect(sortDoneTasks(input).map((item) => item.id)).toEqual(["a", "b", "z"]);
    expect(sortDoneTasks(input.slice().reverse()).map((item) => item.id)).toEqual(["a", "b", "z"]);
  });
});

describe("windowDoneTasks", () => {
  const tasks = Array.from({ length: 45 }, (_, index) => task(`t${index}`, { updatedAt: minutes(index) }));

  it("caps to the visible count and reports hidden cards", () => {
    const result = windowDoneTasks(tasks, { visibleCount: DONE_COLUMN_PAGE_SIZE });
    expect(result.visible).toHaveLength(20);
    expect(result.visible[0].id).toBe("t44");
    expect(result.total).toBe(45);
    expect(result.hiddenCount).toBe(25);
    expect(result.nextStep).toBe(20);
  });

  it("nextStep shrinks to whatever is left", () => {
    const result = windowDoneTasks(tasks, { visibleCount: 40 });
    expect(result.visible).toHaveLength(40);
    expect(result.hiddenCount).toBe(5);
    expect(result.nextStep).toBe(5);
  });

  it("returns everything when unlimited (reserved for search/filters)", () => {
    const result = windowDoneTasks(tasks, { visibleCount: DONE_COLUMN_PAGE_SIZE, unlimited: true });
    expect(result.visible).toHaveLength(45);
    expect(result.hiddenCount).toBe(0);
    expect(result.nextStep).toBe(0);
  });

  it("handles columns smaller than one page", () => {
    const result = windowDoneTasks(tasks.slice(0, 3), { visibleCount: DONE_COLUMN_PAGE_SIZE });
    expect(result.visible).toHaveLength(3);
    expect(result.hiddenCount).toBe(0);
  });
});

describe("doneCollapsedStorageKey", () => {
  it("is scoped by board id", () => {
    expect(doneCollapsedStorageKey("board-1")).toBe("routa.kanban.doneCollapsed.board-1");
    expect(doneCollapsedStorageKey("board-2")).not.toBe(doneCollapsedStorageKey("board-1"));
  });
});
