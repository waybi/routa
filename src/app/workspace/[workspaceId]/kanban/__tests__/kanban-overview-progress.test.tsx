import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KanbanOverviewProgress } from "../kanban-overview-progress";
import type { TaskInfo } from "../../types";

type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

const NOW = Date.UTC(2026, 9, 28, 12);
const MIN = 60_000;
const run = (columnId: string, status: LaneSession["status"], extra: Partial<LaneSession> = {}): LaneSession => ({
  sessionId: `s-${columnId}-${status}`, columnId, status, startedAt: new Date(NOW - 13 * MIN).toISOString(), ...extra,
});
const card = (columnId: string, laneSessions?: LaneSession[]) => ({ id: "c", title: "T", status: "PENDING", columnId, laneSessions }) as TaskInfo;

function cells(): string[] {
  return Array.from(document.querySelectorAll("[data-cell]")).map((el) => el.getAttribute("data-cell") ?? "");
}

describe("KanbanOverviewProgress (AC2)", () => {
  it("shows Dev 3/5, specialist, running time and step for a running dev card", () => {
    render(<KanbanOverviewProgress task={card("dev", [run("dev", "running", { specialistName: "Dev Crafter", stepIndex: 1 })])} laneLabel="Dev" now={NOW} />);
    const root = screen.getByTestId("kanban-overview-progress");
    expect(root.textContent).toContain("Dev 3/5");
    expect(root.textContent).toContain("Dev Crafter");
    expect(root.textContent).toContain("Step 2");
    expect(root.textContent).toContain("13 min");
    expect(cells()).toEqual(["past", "past", "current", "future", "future"]);
    const current = document.querySelector("[data-cell='current']")!;
    expect(current.className).toContain("--lane-dev");
    expect(current.className).toContain("animate-pulse");
    expect(document.querySelector("[data-cell='past']")!.className).toContain("bg-accent/40");
    expect(document.querySelector("[data-cell='future']")!.className).toContain("bg-default");
  });

  it.each(["failed", "timed_out"] as const)("marks a %s current run red", (status) => {
    render(<KanbanOverviewProgress task={card("dev", [run("dev", status)])} laneLabel="Dev" now={NOW} />);
    expect(document.querySelector("[data-cell='current']")!.className).toContain("bg-danger");
    expect(screen.getByText("Dev 3/5").className).toContain("text-danger");
  });

  it.each([["backlog", 1], ["todo", 2], ["review", 4], ["done", 5]] as const)("%s is step %i of 5", (lane, step) => {
    render(<KanbanOverviewProgress task={card(lane)} laneLabel={lane} now={NOW} />);
    expect(screen.getByTestId("kanban-overview-progress").textContent).toContain(`${lane} ${step}/5`);
  });

  it("an old card without lane sessions shows column and n/5 only, without crashing", () => {
    render(<KanbanOverviewProgress task={card("review")} laneLabel="Review" now={NOW} />);
    const text = screen.getByTestId("kanban-overview-progress").textContent ?? "";
    expect(text).toContain("Review 4/5");
    expect(text).not.toContain("·");
  });
});
