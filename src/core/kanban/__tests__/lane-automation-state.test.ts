/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import type { KanbanColumn } from "../../models/kanban";
import { createTask, type Task } from "../../models/task";
import {
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
