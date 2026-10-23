// @vitest-environment node
/**
 * Card 5fdaa681 (C5): a Done pusher interrupted by a Routa restart (startup
 * sweep) or by a cancelled turn shows up in "needs your attention" as a Done
 * step failure, on the board strip and in the overview inbox. The Done card
 * carries Review's verdict but no completion summary or report, like the
 * real cards a0b2b4fa / 6ad2df9d / 25afcd82. The lane records come from the
 * real sweep and orchestrator code, not written by hand.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock } = vi.hoisted(() => ({
  triggerAssignedTaskAgentMock: vi.fn(),
}));

vi.mock("@/core/acp/session-prompt", () => ({
  dispatchSessionPrompt: vi.fn(),
}));

vi.mock("@/core/kanban/agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));

import { endStaleRunningLaneSessions } from "@/core/kanban/restart-recovery";
import { resetWorkflowOrchestrator } from "@/core/kanban/workflow-orchestrator-singleton";
import {
  cleanupSessionCwd,
  createLaneHarness,
  deadProcessOptions,
  pushTurnComplete,
  runToInterruptedStep,
  waitForStepEnd,
} from "@/core/kanban/__tests__/lane-interrupt-harness";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import { buildWorkspaceInbox } from "../../overview/inbox-rules";
import { collectTaskAttentionItems } from "../kanban-attention-rules";

const MAIN_PUSHER_BOARD = {
  id: "board-done",
  name: "Board",
  isDefault: true,
  columns: [
    { id: "review", name: "Review", position: 0, stage: "review" },
    {
      id: "done",
      name: "Done",
      position: 1,
      stage: "done",
      automation: { enabled: true, steps: [{ id: "p", specialistId: "kanban-main-pusher" }, { id: "r", specialistId: "kanban-done-reporter" }] },
    },
  ],
} as unknown as KanbanBoardInfo;

/** The card as the board API serializes it. */
function asTaskInfo(task: unknown): TaskInfo {
  return JSON.parse(JSON.stringify(task)) as TaskInfo;
}

async function interruptedDoneCard(how: "sweep" | "cancelled", cardId: string, checkRecord = true): Promise<TaskInfo> {
  const h = await createLaneHarness("done", triggerAssignedTaskAgentMock, { cardId });
  const pusher = await runToInterruptedStep(h);
  if (how === "cancelled") {
    pushTurnComplete(h.system, pusher, "cancelled");
    await waitForStepEnd(h, pusher);
  } else {
    resetWorkflowOrchestrator();
    await endStaleRunningLaneSessions(h.system, deadProcessOptions);
  }
  const card = await h.card();
  expect(card.verificationVerdict).toBe("APPROVED");
  expect(card.completionSummary).toBeFalsy();
  if (checkRecord) expect(card.laneSessions?.at(-1)).toMatchObject(how === "cancelled"
    ? { sessionId: pusher, status: "failed", recoveryReason: "turn_cancelled" }
    : { sessionId: pusher, status: "timed_out", recoveryReason: "restart_interrupted" });
  return asTaskInfo(card);
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

describe("needs-attention for an interrupted Done pusher", () => {
  it("flags both the restart-swept and the cancelled pusher as doneFailed (strip and inbox)", async () => {
    const swept = await interruptedDoneCard("sweep", "card-swept");
    const cancelled = await interruptedDoneCard("cancelled", "card-cancelled");
    const now = Date.now();

    for (const task of [swept, cancelled]) {
      expect(collectTaskAttentionItems(task, { hasMainPusher: true, now }))
        .toEqual(expect.arrayContaining([expect.objectContaining({ taskId: task.id, kind: "doneFailed" })]));
    }

    const inbox = buildWorkspaceInbox({ id: "default", title: "Default" }, [swept, cancelled], [MAIN_PUSHER_BOARD], now, () => []);
    expect(inbox.active.filter((row) => row.reason === "doneFailed").map((row) => row.task.id).sort())
      .toEqual(["card-cancelled", "card-swept"]);
  });

  it("F2: a Done card that already has a completion summary is not flagged (rule unchanged)", async () => {
    const cancelled = await interruptedDoneCard("cancelled", "card-reported", false);
    const reported = { ...cancelled, completionSummary: "pushed and reported" };

    expect(collectTaskAttentionItems(reported, { hasMainPusher: false, now: Date.now() })
      .map((item) => item.kind)).not.toContain("doneFailed");
  });
});
