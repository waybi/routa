import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { publishKanbanTaskChanges, useKanbanTaskChangeSignal } from "../kanban-task-change-signal";

function Probe({ taskId, seen, base }: { taskId: string; seen: number[]; base?: number }) {
  seen.push(useKanbanTaskChangeSignal(taskId, base));
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

  it("adds the board-wide signal so either source reloads the panel", () => {
    const seen: number[] = [];
    const { rerender } = render(<Probe taskId="task-c" seen={seen} base={5} />);
    expect(seen.at(-1)).toBe(5);
    act(() => publishKanbanTaskChanges(["task-c"]));
    expect(seen.at(-1)).toBe(6);
    rerender(<Probe taskId="task-c" seen={seen} base={6} />);
    expect(seen.at(-1)).toBe(7);
  });
});
