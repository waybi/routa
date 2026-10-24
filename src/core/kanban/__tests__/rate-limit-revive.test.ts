// @vitest-environment node
/**
 * Card 79804de2: revive and the session start path with rate-limited lanes.
 * Real in-memory Routa system, real revive and start path; only the agent
 * launch (triggerAssignedTaskAgent) is mocked.
 * Contract items: C6(d), C7, F4④, F4⑤.
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

import { createTask, TaskStatus, VerificationVerdict, type Task, type TaskLaneSession } from "../../models/task";
import { isAwaitingEnvironmentFix } from "../environment-failure";
import { reviveMissingEntryAutomations } from "../restart-recovery";
import { getNonDevAutomationRunCount } from "../workflow-orchestrator";
import { enqueueKanbanTaskSession, resetWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import {
  cleanupSessionCwd,
  createLaneHarness,
  deadProcessOptions,
  settle,
  WORKSPACE_ID,
  type LaneHarness,
} from "./lane-interrupt-harness";

const NOW = new Date("2026-10-23T10:00:00.000Z");
const RUNAI_429 = '{"type":"error","error":{"type":"rate_limit_error","message":"RunAI account rate limited (HTTP 429, rate_limit_error; upstream trial_rate_limited) resets_at=2026-10-23T09:56:07.846Z"}}';

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

function lane(sessionId: string, columnId: string, stepIndex: number, extra: Partial<TaskLaneSession>): TaskLaneSession {
  return {
    sessionId,
    columnId,
    stepIndex,
    status: "failed",
    startedAt: "2026-10-23T09:00:00.000Z",
    completedAt: "2026-10-23T09:01:00.000Z",
    ...extra,
  };
}

function rateLimited(sessionId: string, columnId: string, stepIndex: number, retryAfterAt: string): TaskLaneSession {
  return lane(sessionId, columnId, stepIndex, { recoveryReason: "rate_limited", retryAfterAt });
}

async function addCard(h: LaneHarness, id: string, laneSessions: TaskLaneSession[]): Promise<void> {
  await h.system.taskStore.save({
    ...createTask({ id, title: id, objective: id, workspaceId: WORKSPACE_ID, boardId: h.boardId, columnId: h.shape, status: TaskStatus.COMPLETED }),
    verificationVerdict: VerificationVerdict.APPROVED,
    laneSessions,
  } as Task);
}

function startsFor(cardId: string): Array<{ stepIndex?: number; specialistId?: string }> {
  return triggerAssignedTaskAgentMock.mock.calls
    .map(([params]) => params as { task: { id: string }; stepIndex?: number; step?: { specialistId?: string } })
    .filter((params) => params.task.id === cardId)
    .map((params) => ({ stepIndex: params.stepIndex, specialistId: params.step?.specialistId }));
}

describe("C7/AC7: revive honours retryAfterAt and the fuse", () => {
  it("six cards on one Done board: only B (rerun time passed) and E (agent_failed) start", async () => {
    const h = await createLaneHarness("done", triggerAssignedTaskAgentMock, {
      card: { laneSessions: [rateLimited("A-1", "done", 0, "2026-10-23T10:10:00.000Z")] },
      cardId: "A",
    });
    await addCard(h, "B", [lane("B-0", "done", 0, { status: "completed" }), rateLimited("B-1", "done", 1, "2026-10-23T09:59:59.000Z")]);
    await addCard(h, "C", Array.from({ length: 5 }, (_, index) => rateLimited(`C-${index}`, "done", 0, "2026-10-23T09:00:00.000Z")));
    await addCard(h, "D", [lane("D-1", "done", 0, { recoveryReason: "environment_failure" })]);
    await addCard(h, "E", [lane("E-1", "done", 0, { recoveryReason: "agent_failed" })]);
    await addCard(h, "F", [
      rateLimited("F-1", "done", 0, "2026-10-23T09:00:00.000Z"),
      lane("F-running", "done", 0, { status: "running", completedAt: undefined }),
    ]);

    await reviveMissingEntryAutomations(h.system, WORKSPACE_ID, h.boardId, {
      sessionStore: { getSession: () => undefined } as never,
      processManager: { hasActiveSession: (id: string) => id === "F-running" } as never,
      now: () => NOW,
    });
    await vi.waitFor(() => expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(2));
    await settle(50);

    expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(2);
    expect(startsFor("A")).toEqual([]);
    expect(startsFor("B")).toEqual([{ stepIndex: 1, specialistId: "kanban-done-reporter" }]);
    expect(startsFor("C")).toEqual([]);
    expect(startsFor("D")).toEqual([]);
    expect(startsFor("E")).toEqual([{ stepIndex: 0, specialistId: "kanban-main-pusher" }]);
    expect(startsFor("F")).toEqual([]);
  });

  it.each([
    { label: "before retryAfterAt", now: "2026-10-23T09:59:00.000Z", starts: 0 },
    { label: "after retryAfterAt", now: "2026-10-23T10:00:01.000Z", starts: 1 },
  ])("F4⑤ Done pusher (step 0), $label", async ({ now, starts }) => {
    const h = await createLaneHarness("done", triggerAssignedTaskAgentMock, {
      card: { laneSessions: [rateLimited("P-1", "done", 0, "2026-10-23T10:00:00.000Z")] },
    });
    await reviveMissingEntryAutomations(h.system, WORKSPACE_ID, h.boardId, { ...deadProcessOptions, now: () => new Date(now) });
    if (starts) await vi.waitFor(() => expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(1));
    await settle(50);
    expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(starts);
    if (starts) expect(startsFor(h.cardId)).toEqual([{ stepIndex: 0, specialistId: "kanban-main-pusher" }]);
  });

  it.each([
    { label: "before retryAfterAt", now: "2026-10-23T09:59:00.000Z", starts: 0 },
    { label: "after retryAfterAt", now: "2026-10-23T10:00:01.000Z", starts: 1 },
  ])("F4⑤ Dev crafter (step 0), $label", async ({ now, starts }) => {
    const h = await createLaneHarness("dev", triggerAssignedTaskAgentMock, {
      card: { laneSessions: [rateLimited("V-1", "dev", 0, "2026-10-23T10:00:00.000Z")] },
    });
    await reviveMissingEntryAutomations(h.system, WORKSPACE_ID, h.boardId, { ...deadProcessOptions, now: () => new Date(now) });
    if (starts) await vi.waitFor(() => expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(1));
    await settle(50);
    expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(starts);
    if (starts) expect(startsFor(h.cardId)).toEqual([{ stepIndex: 0, specialistId: "kanban-dev-crafter" }]);
  });

  it("C6(d): 3 rate limits + 2 restart interruptions trip the fuse; revive starts nothing", async () => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock, {
      card: {
        laneSessions: [
          lane("Q-0", "review", 0, { status: "completed" }),
          rateLimited("Q-1", "review", 1, "2026-10-23T09:00:00.000Z"),
          rateLimited("Q-2", "review", 1, "2026-10-23T09:10:00.000Z"),
          rateLimited("Q-3", "review", 1, "2026-10-23T09:20:00.000Z"),
          lane("Q-4", "review", 1, { status: "timed_out", recoveryReason: "restart_interrupted" }),
          lane("Q-5", "review", 1, { status: "timed_out", recoveryReason: "restart_interrupted" }),
        ],
      },
    });
    await reviveMissingEntryAutomations(h.system, WORKSPACE_ID, h.boardId, { ...deadProcessOptions, now: () => NOW });
    await settle(50);
    expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(0);
  });

  it("F2⑥: a restart-interrupted step below the fuse is still revived at that step", async () => {
    const h = await createLaneHarness("review", triggerAssignedTaskAgentMock, {
      card: {
        laneSessions: [
          lane("R-0", "review", 0, { status: "completed" }),
          lane("R-1", "review", 1, { status: "timed_out", recoveryReason: "restart_interrupted" }),
          lane("R-2", "review", 1, { status: "timed_out", recoveryReason: "restart_interrupted" }),
          lane("R-3", "review", 1, { status: "failed", recoveryReason: "turn_cancelled" }),
        ],
      },
    });
    await reviveMissingEntryAutomations(h.system, WORKSPACE_ID, h.boardId, { ...deadProcessOptions, now: () => NOW });
    await vi.waitFor(() => expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(1));
    expect(startsFor(h.cardId)).toEqual([{ stepIndex: 1, specialistId: "kanban-review-guard" }]);
  });
});

describe("F4④: rate limited while the session starts", () => {
  it.each(["todo", "done"] as const)("%s lane: recorded as a retryable failed run with its rerun time", async (shape) => {
    const h = await createLaneHarness(shape, triggerAssignedTaskAgentMock);
    triggerAssignedTaskAgentMock.mockReset();
    triggerAssignedTaskAgentMock.mockResolvedValue({ error: RUNAI_429 });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const card = await h.card();
    const countBefore = getNonDevAutomationRunCount(card, shape, shape);

    const result = await enqueueKanbanTaskSession(h.system, {
      task: card,
      expectedColumnId: shape,
      ignoreExistingTrigger: true,
      bypassQueue: true,
    });
    vi.restoreAllMocks();

    expect(result).toMatchObject({ queued: false, error: RUNAI_429 });
    const updated = await h.card();
    expect(updated.lastSyncError?.startsWith("[environment] rate_limited")).toBe(true);
    expect(isAwaitingEnvironmentFix(updated, shape)).toBe(false);
    expect(getNonDevAutomationRunCount(updated, shape, shape)).toBe(countBefore);
    const record = updated.laneSessions!.at(-1)!;
    expect(record).toMatchObject({ columnId: shape, status: "failed", recoveryReason: "rate_limited" });
    expect(record.sessionId.startsWith("rate-limited-")).toBe(true);
    // resets_at is in the past of the real clock: rerun from now, random=0 adds nothing.
    expect(Date.parse(record.retryAfterAt!)).toBeGreaterThanOrEqual(Date.parse("2026-10-23T09:56:07.846Z"));
  });
});
