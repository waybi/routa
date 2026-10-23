// @vitest-environment node
/**
 * Card 5fdaa681: a lane step whose turn ends with stopReason=cancelled (Routa
 * restart, manual cancel) or whose agent process dies is a failed step. It is
 * recorded as failed, the lane does not advance (no next step, no fallback,
 * no recovery, no next column), and a rerun starts at that step.
 * 2026-10-23 20:25:46: the Done pusher of card a0b2b4fa (session 4a14cb98)
 * was cancelled mid-vitest; Routa recorded it completed and started the Done
 * Reporter, so the commit never reached main.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock } = vi.hoisted(() => ({
  triggerAssignedTaskAgentMock: vi.fn(),
}));

vi.mock("@/core/acp/session-prompt", () => ({
  dispatchSessionPrompt: vi.fn(),
}));

vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));

import { AgentEventType } from "../../events/event-bus";
import { resetWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import {
  cleanupSessionCwd,
  createLaneHarness,
  emitAgentEvent,
  INTERRUPTED_STEP,
  orchestratorOf,
  pushTurnComplete,
  runToInterruptedStep,
  settle,
  stepSpecialistId,
  waitForStepEnd,
  type LaneHarness,
  type LaneShape,
} from "./lane-interrupt-harness";

function spyOnLaneProgress(h: LaneHarness) {
  const orchestrator = orchestratorOf(h) as never as Record<string, (...args: unknown[]) => unknown>;
  return {
    nextStep: vi.spyOn(orchestrator, "startNextAutomationStep"),
    recover: vi.spyOn(orchestrator, "recoverAutomation"),
  };
}

beforeEach(() => {
  resetWorkflowOrchestrator();
  triggerAssignedTaskAgentMock.mockReset();
});

afterEach(() => {
  resetWorkflowOrchestrator();
});

afterAll(() => {
  cleanupSessionCwd();
});

const SHAPES: LaneShape[] = ["done", "review", "dev"];

describe("C2/F4①: a cancelled turn fails the step and stops the lane", () => {
  it.each(SHAPES.flatMap((shape) => [
    { shape, source: "store" as const },
    { shape, source: "bus" as const },
  ]))("$shape lane, cancelled via $source", async ({ shape, source }) => {
    const h = await createLaneHarness(shape, triggerAssignedTaskAgentMock, { fallback: true });
    const sessionId = await runToInterruptedStep(h);
    const spies = spyOnLaneProgress(h);
    const startsBefore = triggerAssignedTaskAgentMock.mock.calls.length;
    const transitionsBefore = h.transitions.length;

    if (source === "store") {
      // Real path: HttpSessionStore turn_complete → EventBus → orchestrator.
      pushTurnComplete(h.system, sessionId, "cancelled");
    } else {
      emitAgentEvent(h.system, AgentEventType.AGENT_COMPLETED, sessionId, { success: false, stopReason: "cancelled" });
    }
    await waitForStepEnd(h, sessionId);

    expect(await h.laneRecord(sessionId)).toMatchObject({
      status: "failed",
      recoveryReason: "turn_cancelled",
      stepIndex: INTERRUPTED_STEP[shape],
    });
    expect(spies.nextStep).toHaveBeenCalledTimes(0);
    expect(spies.recover).toHaveBeenCalledTimes(0);
    expect(triggerAssignedTaskAgentMock.mock.calls.length).toBe(startsBefore);
    expect((await h.card()).columnId).toBe(shape);
    expect(h.transitions.length).toBe(transitionsBefore);
    expect(orchestratorOf(h).getAutomationForCard(h.cardId)?.status).toBe("failed");
  });
});

describe("C3: an agent process that exits on its own fails the step", () => {
  it.each([
    { shape: "done" as const, exit: "code=1, signal=null" },
    { shape: "done" as const, exit: "code=null, signal=SIGKILL" },
    { shape: "review" as const, exit: "code=1, signal=null" },
    { shape: "review" as const, exit: "code=null, signal=SIGKILL" },
  ])("$shape lane, process exited ($exit)", async ({ shape, exit }) => {
    const h = await createLaneHarness(shape, triggerAssignedTaskAgentMock);
    const sessionId = await runToInterruptedStep(h);
    const spies = spyOnLaneProgress(h);
    const transitionsBefore = h.transitions.length;

    emitAgentEvent(h.system, AgentEventType.AGENT_FAILED, sessionId, {
      success: false,
      error: `DeepSeek Harness process exited unexpectedly (${exit})`,
    });
    await waitForStepEnd(h, sessionId);

    expect(await h.laneRecord(sessionId)).toMatchObject({ status: "failed", recoveryReason: "agent_failed" });
    expect(spies.nextStep).toHaveBeenCalledTimes(0);
    expect(triggerAssignedTaskAgentMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ stepIndex: INTERRUPTED_STEP[shape] + 1 }),
    );
    expect((await h.card()).columnId).toBe(shape);
    expect(h.transitions.length).toBe(transitionsBefore);
  });
});

describe("F2/F3: every stopReason × lane shape — only cancelled stops the lane", () => {
  const stopReasons = ["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"];
  const nextColumn: Record<LaneShape, string | undefined> = { done: undefined, todo: "dev", review: "done", dev: "review" };

  it.each(SHAPES.flatMap((shape) => stopReasons.map((stopReason) => ({ shape, stopReason }))))(
    "$shape lane, stopReason=$stopReason",
    async ({ shape, stopReason }) => {
      const h = await createLaneHarness(shape, triggerAssignedTaskAgentMock);
      const sessionId = await runToInterruptedStep(h);

      pushTurnComplete(h.system, sessionId, stopReason);
      await waitForStepEnd(h, sessionId);

      const record = await h.laneRecord(sessionId);
      const card = await h.card();
      if (stopReason === "cancelled") {
        expect(record).toMatchObject({ status: "failed", recoveryReason: "turn_cancelled" });
        expect(card.columnId).toBe(shape);
        expect(h.transitions).toEqual([]);
        return;
      }
      expect(record?.status).toBe("completed");
      expect(record?.recoveryReason).toBeUndefined();
      if (shape === "done") {
        // Done pusher finished: the Done Reporter (step 1) starts.
        expect(triggerAssignedTaskAgentMock).toHaveBeenLastCalledWith(expect.objectContaining({
          stepIndex: 1,
          step: expect.objectContaining({ specialistId: stepSpecialistId("done", 1) }),
        }));
        expect(card.columnId).toBe("done");
      } else {
        // Last step of the lane finished: the card auto-advances.
        await vi.waitFor(async () => expect((await h.card()).columnId).toBe(nextColumn[shape]));
        expect(h.transitions).toEqual([expect.objectContaining({ from: shape, to: nextColumn[shape] })]);
      }
    },
  );

  it("an exit after a completed Done step stays a completed step (teardown, 3054a54f)", async () => {
    const h = await createLaneHarness("done", triggerAssignedTaskAgentMock);
    const pusher = await runToInterruptedStep(h);
    pushTurnComplete(h.system, pusher, "end_turn");
    const reporter = await h.waitForStep(1);
    pushTurnComplete(h.system, reporter, "end_turn");
    await waitForStepEnd(h, reporter);
    const spies = spyOnLaneProgress(h);

    emitAgentEvent(h.system, AgentEventType.AGENT_FAILED, reporter, {
      success: false,
      error: "DeepSeek Harness process exited unexpectedly (code=130, signal=null)",
    });
    await settle();

    const record = await h.laneRecord(reporter);
    expect(record?.status).toBe("completed");
    expect(record?.recoveryReason).toBeUndefined();
    expect(spies.nextStep).toHaveBeenCalledTimes(0);
    expect(spies.recover).toHaveBeenCalledTimes(0);
  });
});
