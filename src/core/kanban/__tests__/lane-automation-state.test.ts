/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_KANBAN_COLUMNS, type KanbanColumn, type KanbanColumnStage } from "../../models/kanban";
import { createTask, type Task } from "../../models/task";
import {
  isExemptFromRemainingLaneStepsGuard,
  resolveCurrentLaneAutomationState,
  resolveLaneResumeStep,
  resolveLaunchStepIndex,
  resolveRemainingLaneStepsMoveBlock,
} from "../lane-automation-state";

const reviewSteps = [
  { id: "qa-frontend", role: "GATE" as const, specialistId: "kanban-qa-frontend", specialistName: "QA Frontend" },
  { id: "review-guard", role: "GATE" as const, specialistId: "kanban-review-guard", specialistName: "Review Guard" },
];

const columns: KanbanColumn[] = [
  { id: "dev", name: "Dev", position: 0, stage: "dev" },
  {
    id: "review",
    name: "Review",
    position: 1,
    stage: "review",
    automation: { enabled: true, steps: reviewSteps },
  },
  { id: "done", name: "Done", position: 2, stage: "done" },
];

function buildTask(triggerSessionId: string): Task {
  const task = createTask({
    id: "task-1",
    title: "Two-step review",
    objective: "QA Frontend then Review Guard",
    workspaceId: "ws-1",
    boardId: "board-1",
    columnId: "review",
    triggerSessionId,
  });
  task.laneSessions = [
    { sessionId: "session-qa", columnId: "review", stepIndex: 0, role: "GATE", status: "completed", startedAt: "2026-10-15T00:00:00.000Z" },
    { sessionId: "session-guard", columnId: "review", stepIndex: 1, role: "GATE", status: "running", startedAt: "2026-10-15T00:10:00.000Z" },
  ];
  return task;
}

describe("resolveCurrentLaneAutomationState currentStepIndex", () => {
  it("prefers the explicit launching step over the previous triggerSessionId", () => {
    const task = { ...buildTask("session-qa"), laneSessions: buildTask("session-qa").laneSessions!.slice(0, 1) };

    const launching = resolveCurrentLaneAutomationState(task, columns, {
      currentSessionId: "session-guard-new",
      currentStepIndex: 1,
    });
    expect(launching.currentStepIndex).toBe(1);
    expect(launching.hasRemainingSteps).toBe(false);

    const legacy = resolveCurrentLaneAutomationState(task, columns, { currentSessionId: "session-guard-new" });
    expect(legacy.currentStepIndex).toBe(0);
    expect(legacy.hasRemainingSteps).toBe(true);
  });

  it("ignores an out-of-range step index and keeps the existing resolution", () => {
    const state = resolveCurrentLaneAutomationState(buildTask("session-qa"), columns, { currentStepIndex: 5 });
    expect(state.currentStepIndex).toBe(0);
    expect(state.hasRemainingSteps).toBe(true);
  });
});

describe("resolveLaunchStepIndex", () => {
  it("matches the launching step by id or specialist and validates an explicit index", () => {
    expect(resolveLaunchStepIndex(reviewSteps, reviewSteps[1], undefined)).toBe(1);
    expect(resolveLaunchStepIndex(reviewSteps, { specialistId: "kanban-review-guard" }, undefined)).toBe(1);
    expect(resolveLaunchStepIndex(reviewSteps, reviewSteps[1], 1)).toBe(1);
    // An index that points at a different step than the one being launched is not trusted.
    expect(resolveLaunchStepIndex(reviewSteps, reviewSteps[1], 0)).toBe(1);
    expect(resolveLaunchStepIndex(reviewSteps, undefined, 1)).toBe(1);
    expect(resolveLaunchStepIndex(reviewSteps, { specialistId: "unknown" }, undefined)).toBeUndefined();
    expect(resolveLaunchStepIndex(reviewSteps, undefined, 9)).toBeUndefined();
  });
});

describe("resolveRemainingLaneStepsMoveBlock", () => {
  it("does not block the last step's session and blocks an earlier step's session", () => {
    expect(resolveRemainingLaneStepsMoveBlock(buildTask("session-guard"), columns)).toBeUndefined();
    expect(resolveRemainingLaneStepsMoveBlock(buildTask("session-qa"), columns))
      .toContain("QA Frontend is still active and Review Guard must run next in the same lane");
  });

  it("does not block when no session triggered the lane", () => {
    const task = { ...buildTask("session-qa"), triggerSessionId: undefined };
    expect(resolveRemainingLaneStepsMoveBlock(task, columns)).toBeUndefined();
  });
});

describe("resolveLaneResumeStep after a finished step (unchanged by card 5fdaa681)", () => {
  it("runs the step after the lane's latest completed step", () => {
    const task = buildTask("session-qa");
    task.laneSessions = task.laneSessions!.slice(0, 1);
    expect(resolveLaneResumeStep(task, columns)).toMatchObject({
      stepIndex: 1,
      step: expect.objectContaining({ specialistId: "kanban-review-guard" }),
    });
  });
});

describe("isExemptFromRemainingLaneStepsGuard (card 60f276e0)", () => {
  const stuck = (stage: KanbanColumnStage): KanbanColumn[] => [
    ...DEFAULT_KANBAN_COLUMNS,
    { id: "stuck", name: "Stuck", position: 6, stage },
  ];
  const D = DEFAULT_KANBAN_COLUMNS;

  it.each([
    ["done", "blocked", undefined, D, true],
    ["dev", "blocked", undefined, D, true],
    ["review", "blocked", undefined, D, true],
    ["done", "stuck", undefined, stuck("blocked"), true],
    ["review", "dev", "NOT_APPROVED", D, true],
    ["review", "dev", undefined, D, false],
    ["review", "dev", "APPROVED", D, false],
    ["review", "dev", "BLOCKED", D, false],
    ["dev", "todo", "NOT_APPROVED", D, false],
    ["done", "todo", undefined, D, false],
    ["done", "review", undefined, D, false],
    ["todo", "dev", undefined, D, false],
    ["done", "stuck", undefined, stuck("done"), false],
    ["done", "unknown", undefined, D, false],
  ] as const)("%s -> %s (verdict %s) is exempt: %#", (fromColumnId, targetColumnId, verificationVerdict, boardColumns, expected) => {
    expect(isExemptFromRemainingLaneStepsGuard({
      fromColumnId,
      targetColumnId,
      verificationVerdict,
      boardColumns: [...boardColumns],
    })).toBe(expected);
  });

  // F3 cross-check: an independent judge written from AC1, compared on the full
  // enumeration plus 10,000 seeded random inputs.
  function judge(from: string, to: string, verdict: string | undefined, columns: KanbanColumn[]): boolean {
    if (from === "review" && to === "dev" && verdict === "NOT_APPROVED") return true;
    if (to === "blocked") return true;
    return columns.some((column) => column.id === to && column.stage === "blocked");
  }

  it("matches the AC1 judge on every enumerated and random input", () => {
    const ids = ["backlog", "todo", "dev", "review", "done", "blocked", "stuck", "unknown"];
    const verdicts = [undefined, "APPROVED", "NOT_APPROVED", "BLOCKED"];
    const boards: KanbanColumn[][] = [
      D,
      stuck("blocked"),
      stuck("done"),
      D.filter((column) => column.stage !== "blocked"),
    ];
    const stages: KanbanColumnStage[] = ["backlog", "todo", "dev", "review", "blocked", "done"];
    let seed = 0x60f276e0;
    const rand = (n: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return Math.floor((seed / 2 ** 32) * n);
    };
    const cases: Array<[string, string, string | undefined, KanbanColumn[]]> = [];
    for (const from of ids) for (const to of ids) for (const verdict of verdicts) for (const board of boards) {
      cases.push([from, to, verdict, board]);
    }
    const pool = [...ids, "col-a", "col-b", "BLOCKED", "Blocked"];
    for (let i = 0; i < 10_000; i += 1) {
      const board = Array.from({ length: 1 + rand(6) }, (_, position) => ({
        id: pool[rand(pool.length)], name: "c", position, stage: stages[rand(stages.length)],
      })).filter((column, index, all) => all.findIndex((other) => other.id === column.id) === index);
      cases.push([pool[rand(pool.length)], pool[rand(pool.length)], verdicts[rand(verdicts.length)], board]);
    }
    const mismatches = cases.filter(([from, to, verdict, board]) => (
      isExemptFromRemainingLaneStepsGuard({
        fromColumnId: from, targetColumnId: to, verificationVerdict: verdict, boardColumns: board,
      }) !== judge(from, to, verdict, board)
    ));
    console.info(`[F3] cases=${cases.length} mismatches=${mismatches.length}`);
    expect(mismatches.slice(0, 3)).toEqual([]);
  });
});
