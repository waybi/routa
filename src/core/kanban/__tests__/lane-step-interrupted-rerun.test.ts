// @vitest-environment node
/**
 * Card 5fdaa681: after a step was interrupted (turn cancelled, or Routa
 * restarted before the turn ended), "rerun" starts at that step, not at the
 * next one. Both rerun entries are covered: PATCH retryTrigger (resumeLane →
 * resolveLaneResumeStep) and POST revive (reviveMissingEntryAutomations).
 * The lane records come from the real code paths (orchestrator, startup
 * sweep, revive), never written by hand.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock, enqueueSpy, transitionSpy } = vi.hoisted(() => ({
  triggerAssignedTaskAgentMock: vi.fn(),
  enqueueSpy: vi.fn(),
  transitionSpy: vi.fn(),
}));

vi.mock("@/core/acp/session-prompt", () => ({
  dispatchSessionPrompt: vi.fn(),
}));

vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));

// Pass-through spies: revive's two ways of starting a step keep their real behavior.
vi.mock("../workflow-orchestrator-singleton", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../workflow-orchestrator-singleton")>();
  enqueueSpy.mockImplementation(actual.enqueueKanbanTaskSession);
  transitionSpy.mockImplementation(actual.processKanbanColumnTransition);
  return {
    ...actual,
    enqueueKanbanTaskSession: enqueueSpy,
    processKanbanColumnTransition: transitionSpy,
  };
});

import { resolveLaneResumeStep } from "../lane-automation-state";
import { endStaleRunningLaneSessions, reviveMissingEntryAutomations } from "../restart-recovery";
import {
  enqueueKanbanTaskSession,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";
import {
  cleanupSessionCwd,
  createLaneHarness,
  deadProcessOptions,
  INTERRUPTED_STEP,
  pushTurnComplete,
  runToInterruptedStep,
  settle,
  stepSpecialistId,
  waitForStepEnd,
  WORKSPACE_ID,
  type LaneHarness,
  type LaneShape,
} from "./lane-interrupt-harness";

type Interruption = "cancelled" | "sweep" | "revive";

/**
 * Run the lane to its interrupted step and interrupt it:
 * - cancelled: the turn ends with stopReason=cancelled (HttpSessionStore path);
 * - sweep: Routa restarts (orchestrator gone, process dead), startup sweep runs;
 * - revive: Routa restarts and revive's own clean-up ends the record.
 */
async function interrupt(h: LaneHarness, how: Interruption): Promise<string> {
  const sessionId = await runToInterruptedStep(h);
  if (how === "cancelled") {
    pushTurnComplete(h.system, sessionId, "cancelled");
    await waitForStepEnd(h, sessionId);
    return sessionId;
  }
  resetWorkflowOrchestrator();
  if (how === "sweep") {
    await endStaleRunningLaneSessions(h.system, deadProcessOptions);
  }
  startWorkflowOrchestrator(h.system);
  return sessionId;
}

const EXPECTED_RECORD: Record<Exclude<Interruption, "revive">, object> = {
  cancelled: { status: "failed", recoveryReason: "turn_cancelled" },
  sweep: { status: "timed_out", recoveryReason: "restart_interrupted" },
};

beforeEach(() => {
  resetWorkflowOrchestrator();
  triggerAssignedTaskAgentMock.mockReset();
  enqueueSpy.mockClear();
  transitionSpy.mockClear();
});

afterEach(() => {
  resetWorkflowOrchestrator();
});

afterAll(() => {
  cleanupSessionCwd();
});

const RESUME_CASES = (["done", "todo", "review"] as LaneShape[]).flatMap((shape) => (
  (["cancelled", "sweep"] as const).map((how) => ({ shape, how }))
));

describe("C6/F4⑤: retryTrigger (resumeLane) reruns the interrupted step", () => {
  it.each(RESUME_CASES)("$shape lane, step interrupted by $how", async ({ shape, how }) => {
    const h = await createLaneHarness(shape, triggerAssignedTaskAgentMock);
    const sessionId = await interrupt(h, how);
    const interruptedStep = INTERRUPTED_STEP[shape];
    expect(await h.laneRecord(sessionId)).toMatchObject({ ...EXPECTED_RECORD[how], stepIndex: interruptedStep });

    const card = await h.card();
    expect(resolveLaneResumeStep(card, h.columns)).toMatchObject({
      stepIndex: interruptedStep,
      step: expect.objectContaining({ specialistId: stepSpecialistId(shape, interruptedStep) }),
    });

    // The PATCH retryTrigger path: resumeLane on the card's current column.
    triggerAssignedTaskAgentMock.mockClear();
    await enqueueKanbanTaskSession(h.system, {
      task: card,
      expectedColumnId: shape,
      ignoreExistingTrigger: true,
      resumeLane: true,
    });
    expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(1);
    expect(triggerAssignedTaskAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      stepIndex: interruptedStep,
      step: expect.objectContaining({ specialistId: stepSpecialistId(shape, interruptedStep) }),
    }));
  });
});

describe("C7/F4②③⑥: revive reruns the interrupted step", () => {
  it.each([
    { shape: "todo" as const, how: "sweep" as const },
    { shape: "todo" as const, how: "revive" as const },
    { shape: "review" as const, how: "cancelled" as const },
    { shape: "review" as const, how: "sweep" as const },
  ])("$shape lane, step 1 interrupted by $how: enqueue step 1 with adoptLaneRun", async ({ shape, how }) => {
    const h = await createLaneHarness(shape, triggerAssignedTaskAgentMock);
    const sessionId = await interrupt(h, how);
    enqueueSpy.mockClear();
    transitionSpy.mockClear();
    triggerAssignedTaskAgentMock.mockClear();

    await reviveMissingEntryAutomations(h.system, WORKSPACE_ID, h.boardId, deadProcessOptions);

    // revive's own clean-up (path ③) records the restart like the sweep does.
    const expected = how === "cancelled" ? EXPECTED_RECORD.cancelled : EXPECTED_RECORD.sweep;
    expect(await h.laneRecord(sessionId)).toMatchObject({ ...expected, stepIndex: 1 });
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(h.system, expect.objectContaining({
      expectedColumnId: shape,
      ignoreExistingTrigger: true,
      adoptLaneRun: true,
      stepIndex: 1,
      step: expect.objectContaining({ specialistId: stepSpecialistId(shape, 1) }),
    }));
    expect(transitionSpy).toHaveBeenCalledTimes(0);
    expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(1);

    // Adopted by the orchestrator: when the rerun ends, the lane goes on.
    const rerun = h.latestSession(1)!;
    pushTurnComplete(h.system, rerun, "end_turn");
    await waitForStepEnd(h, rerun);
    expect(await h.laneRecord(rerun)).toMatchObject({ status: "completed", stepIndex: 1 });
  });

  it.each([
    { how: "sweep" as const },
    { how: "revive" as const },
  ])("done lane, pusher (step 0) interrupted by $how: re-enter the lane at the pusher", async ({ how }) => {
    const h = await createLaneHarness("done", triggerAssignedTaskAgentMock);
    const sessionId = await interrupt(h, how);
    enqueueSpy.mockClear();
    transitionSpy.mockClear();
    triggerAssignedTaskAgentMock.mockClear();

    await reviveMissingEntryAutomations(h.system, WORKSPACE_ID, h.boardId, deadProcessOptions);

    expect(await h.laneRecord(sessionId)).toMatchObject({ ...EXPECTED_RECORD.sweep, stepIndex: 0 });
    // Not skipped as a lane-watchdog timeout: exactly one start, at the pusher.
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(transitionSpy).toHaveBeenCalledWith(h.system, expect.objectContaining({ fromColumnId: "__revive__", toColumnId: "done" }));
    expect(enqueueSpy).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ stepIndex: 1 }));
    await vi.waitFor(() => expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(1));
    expect(triggerAssignedTaskAgentMock).toHaveBeenCalledWith(expect.objectContaining({
      stepIndex: 0,
      step: expect.objectContaining({ specialistId: "kanban-main-pusher" }),
    }));
  });
});

describe("F2: rerun behavior that must not change", () => {
  it("revive after a completed step starts the step after it (review-guard stepIndex 1)", async () => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock);
    await processEntryOnly(h);
    const qa = h.latestSession(0)!;
    // The step finished, then Routa restarted before step 1 was recorded.
    pushTurnComplete(h.system, qa, "end_turn");
    await waitForStepEnd(h, qa);
    resetWorkflowOrchestrator();
    const card = await h.card();
    await h.system.taskStore.save({
      ...card,
      triggerSessionId: undefined,
      laneSessions: (card.laneSessions ?? []).filter((entry) => entry.sessionId === qa),
    });
    startWorkflowOrchestrator(h.system);
    enqueueSpy.mockClear();
    transitionSpy.mockClear();

    await reviveMissingEntryAutomations(h.system, WORKSPACE_ID, h.boardId, deadProcessOptions);

    expect(enqueueSpy).toHaveBeenCalledWith(h.system, expect.objectContaining({
      stepIndex: 1,
      adoptLaneRun: true,
      step: expect.objectContaining({ specialistId: "kanban-review-guard" }),
    }));
    expect(transitionSpy).toHaveBeenCalledTimes(0);
    expect(resolveLaneResumeStep(card, h.columns)?.stepIndex).toBe(1);
  });

  it("a non-Dev lane that already ran 3 times is not revived even after a restart interruption", async () => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock, {
      card: {
        laneSessions: [
          { sessionId: "old-qa", columnId: "review", stepIndex: 0, status: "completed", startedAt: "2026-10-23T08:00:00.000Z" },
        ],
      },
    });
    const sessionId = await interrupt(h, "sweep");
    // old-qa + qa + guard = 3 runs in Review.
    expect((await h.card()).laneSessions?.filter((entry) => entry.columnId === "review")).toHaveLength(3);
    expect((await h.laneRecord(sessionId))?.status).toBe("timed_out");
    enqueueSpy.mockClear();
    transitionSpy.mockClear();

    await reviveMissingEntryAutomations(h.system, WORKSPACE_ID, h.boardId, deadProcessOptions);

    expect(enqueueSpy).toHaveBeenCalledTimes(0);
    expect(transitionSpy).toHaveBeenCalledTimes(0);
  });

  it("a step the lane watchdog timed out keeps its record and is still not revived", async () => {
    const h = await createLaneHarness("done", triggerAssignedTaskAgentMock, {
      card: {
        laneSessions: [{
          sessionId: "silent-pusher",
          columnId: "done",
          stepIndex: 0,
          status: "timed_out",
          recoveryReason: "watchdog_inactivity",
          startedAt: "2026-10-23T08:00:00.000Z",
          completedAt: "2026-10-23T08:20:00.000Z",
        }],
      },
    });
    const before = JSON.stringify((await h.card()).laneSessions);

    await endStaleRunningLaneSessions(h.system, deadProcessOptions);
    await reviveMissingEntryAutomations(h.system, WORKSPACE_ID, h.boardId, deadProcessOptions);
    await settle();

    expect(JSON.stringify((await h.card()).laneSessions)).toBe(before);
    expect(enqueueSpy).toHaveBeenCalledTimes(0);
    expect(transitionSpy).toHaveBeenCalledTimes(0);
    expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(0);
  });
});

async function processEntryOnly(h: LaneHarness): Promise<void> {
  const { processKanbanColumnTransition } = await import("../workflow-orchestrator-singleton");
  await processKanbanColumnTransition(h.system, {
    cardId: h.cardId,
    cardTitle: `Card ${h.shape}`,
    boardId: h.boardId,
    workspaceId: WORKSPACE_ID,
    fromColumnId: "dev",
    toColumnId: h.shape,
  });
  await h.waitForStep(0);
}
