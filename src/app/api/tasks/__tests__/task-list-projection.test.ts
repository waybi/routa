import { describe, expect, it } from "vitest";
import {
  LIST_OBJECTIVE_MAX_CHARS,
  parseTaskListView,
  projectTaskForList,
  projectTasksForList,
} from "../task-list-projection";

function fatTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Ship the thing",
    objective: "short objective",
    columnId: "dev",
    status: "IN_PROGRESS",
    comment: "a very long accumulated comment blob",
    comments: [{ body: "note one" }, { body: "note two" }],
    jitContextSnapshot: { generatedAt: "2026-01-01T00:00:00.000Z", analysis: { big: "payload" } },
    verificationReport: "pages of verification output",
    contextSearchSpec: { queries: ["a", "b"] },
    artifactSummary: { total: 2 },
    laneSessions: [
      {
        sessionId: "session-1",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        lastActivityAt: "2026-01-01T00:01:00.000Z",
        columnId: "dev",
        stepName: "Dev",
        provider: "dsh",
        // The per-run copy of the card objective: largest single contributor
        // to the old payload, read by nobody on the client.
        objective: "x".repeat(38_000),
      },
    ],
    ...overrides,
  };
}

describe("parseTaskListView", () => {
  it("defaults to the slim summary view", () => {
    expect(parseTaskListView(null)).toBe("summary");
    expect(parseTaskListView("")).toBe("summary");
    expect(parseTaskListView("nonsense")).toBe("summary");
  });

  it("honours an explicit full view", () => {
    expect(parseTaskListView("full")).toBe("full");
  });
});

describe("projectTaskForList", () => {
  it("drops detail-only fields the board never renders", () => {
    const projected = projectTaskForList(fatTask());

    expect(projected.comment).toBeUndefined();
    expect(projected.comments).toBeUndefined();
    expect(projected.jitContextSnapshot).toBeUndefined();
    expect(projected.verificationReport).toBeUndefined();
    expect(projected.contextSearchSpec).toBeUndefined();
  });

  it("keeps the fields the columns actually use", () => {
    const projected = projectTaskForList(fatTask());

    expect(projected).toMatchObject({
      id: "task-1",
      title: "Ship the thing",
      columnId: "dev",
      status: "IN_PROGRESS",
      artifactSummary: { total: 2 },
    });
  });

  it("strips the per-run objective from lane sessions but keeps run status fields", () => {
    const projected = projectTaskForList(fatTask());
    const lane = (projected.laneSessions as Array<Record<string, unknown>>)[0];

    expect(lane.objective).toBeUndefined();
    // Card run status derivation depends on exactly these.
    expect(lane).toMatchObject({
      sessionId: "session-1",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:01:00.000Z",
    });
  });

  it("leaves a short objective untouched and unflagged", () => {
    const projected = projectTaskForList(fatTask());

    expect(projected.objective).toBe("short objective");
    expect(projected.objectiveTruncated).toBeUndefined();
  });

  it("truncates a long objective and flags it so clients know to hydrate", () => {
    const projected = projectTaskForList(fatTask({ objective: "y".repeat(5_000) }));

    expect(projected.objectiveTruncated).toBe(true);
    expect((projected.objective as string).length).toBeLessThan(5_000);
    expect((projected.objective as string).startsWith("y".repeat(100))).toBe(true);
    expect(projected.objective).toContain("…");
  });

  it("keeps an objective exactly at the budget intact", () => {
    const projected = projectTaskForList(fatTask({ objective: "z".repeat(LIST_OBJECTIVE_MAX_CHARS) }));

    expect(projected.objectiveTruncated).toBeUndefined();
    expect((projected.objective as string).length).toBe(LIST_OBJECTIVE_MAX_CHARS);
  });

  it("does not mutate the input task", () => {
    const task = fatTask();
    projectTaskForList(task);

    expect(task.comment).toBeDefined();
    expect((task.laneSessions as Array<Record<string, unknown>>)[0].objective).toBeDefined();
  });

  it("shrinks a realistic payload by an order of magnitude", () => {
    const task = fatTask({ objective: "y".repeat(14_000) });
    const before = JSON.stringify(task).length;
    const after = JSON.stringify(projectTaskForList(task)).length;

    expect(after).toBeLessThan(before / 10);
  });
});

describe("projectTasksForList", () => {
  it("passes tasks through untouched for the full view", () => {
    const tasks = [fatTask()];
    const projected = projectTasksForList(tasks, "full");

    expect(projected[0].comment).toBeDefined();
    expect(projected[0].jitContextSnapshot).toBeDefined();
  });

  it("projects every task for the summary view", () => {
    const projected = projectTasksForList([fatTask(), fatTask({ id: "task-2" })], "summary");

    expect(projected).toHaveLength(2);
    expect(projected.every((task) => task.comments === undefined)).toBe(true);
  });
});
