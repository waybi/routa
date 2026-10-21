import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { publishKanbanTaskChanges, useKanbanTaskChangeSignal } from "../kanban-task-change-signal";

function Probe({ taskId, seen }: { taskId: string; seen: number[] }) {
  seen.push(useKanbanTaskChangeSignal(taskId));
  return null;
}

describe("kanban task change signal", () => {
  it("bumps only the subscribed card when its id is published", () => {
    const seenA: number[] = [];
    const seenB: number[] = [];
    render(
      <>
        <Probe taskId="task-a" seen={seenA} />
        <Probe taskId="task-b" seen={seenB} />
      </>,
    );

    act(() => publishKanbanTaskChanges(["task-a", "task-x"]));
    expect(seenA.at(-1)).toBe(1);
    expect(seenB.at(-1)).toBe(0);

    act(() => publishKanbanTaskChanges(["task-a", "task-b"]));
    expect(seenA.at(-1)).toBe(2);
    expect(seenB.at(-1)).toBe(1);

    act(() => publishKanbanTaskChanges([]));
    expect(seenA.at(-1)).toBe(2);
  });
});
