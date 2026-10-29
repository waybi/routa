// @vitest-environment node
/**
 * Card dd65b565 (retro L279): when the end event of a step arrives and its lane
 * record is gone, the record written instead must carry columnId / stepIndex /
 * specialistId (stepId when the step has one) from the in-memory automation, so the
 * startup resume (decideInterruptedLaneResume) and the rate-limit rerun
 * (canRunRateLimitRetry) match it. Contract C4, C5, C6, C11, C7.
 * Real in-memory orchestrator; agent launch and process manager are mocked; memory driver.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock, enqueueSpy } = vi.hoisted(() => {
  process.env.ROUTA_DB_DRIVER = "memory";
  return { triggerAssignedTaskAgentMock: vi.fn(), enqueueSpy: vi.fn() };
});

vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));
vi.mock("../../acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: vi.fn(async () => undefined), hasActiveSession: () => false }),
}));
vi.mock("../workflow-orchestrator-singleton", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../workflow-orchestrator-singleton")>();
  return {
    ...actual,
    enqueueKanbanTaskSession: (...args: Parameters<typeof actual.enqueueKanbanTaskSession>) => {
      enqueueSpy(...args);
      return actual.enqueueKanbanTaskSession(...args);
    },
  };
});

import type { Task, TaskLaneSession } from "@/core/models/task";
import type { KanbanAutomationStep } from "@/core/models/kanban";
import { InMemoryTaskStore } from "@/core/store/task-store";
import { decideInterruptedLaneResume, resumeInterruptedLaneSteps } from "../interrupted-lane-resume";
import { buildLaneSessionBackfill } from "../lane-session-backfill";
import { planRateLimitRetry, canRunRateLimitRetry, RateLimitRetryScheduler, type RateLimitRetryEntry } from "../rate-limit-retry";
import { upsertTaskLaneSession } from "../task-lane-history";
import { resetWorkflowOrchestrator, startWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import { stopInterruptedLaneResumeTimers } from "../interrupted-lane-resume";
import { clearLaneRerunClaims } from "../lane-rerun-claim";
import {
  cleanupSessionCwd,
  createLaneHarness,
  pushTurnComplete,
  runToInterruptedStep,
  settle,
  stepSpecialistId,
} from "./lane-interrupt-harness";

beforeEach(() => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetWorkflowOrchestrator();
  stopInterruptedLaneResumeTimers();
  clearLaneRerunClaims();
  triggerAssignedTaskAgentMock.mockReset();
  enqueueSpy.mockClear();
});
afterEach(() => {
  resetWorkflowOrchestrator();
  stopInterruptedLaneResumeTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(() => cleanupSessionCwd());

/** Make the store forget a lane record, as a stale whole-card save used to (stores now merge, so reach in). */
function loseLaneRecord(store: unknown, cardId: string, sessionId: string): void {
  const row = (store as { tasks: Map<string, Task> }).tasks.get(cardId)!;
  row.laneSessions = (row.laneSessions ?? []).filter((entry) => entry.sessionId !== sessionId);
}

const doneAutomation = (steps: KanbanAutomationStep[], currentStepIndex = 0) => ({
  columnId: "done",
  columnName: "Done",
  currentStepIndex,
  steps,
});
const pusher: KanbanAutomationStep = { id: "main-pusher", role: "GATE", specialistId: "kanban-main-pusher", specialistName: "Main Pusher" };
const reporter: KanbanAutomationStep = { id: "done-reporter", role: "GATE", specialistId: "kanban-done-reporter", specialistName: "Done Reporter" };
const bareTask = (laneSessions: TaskLaneSession[] = []) => ({ laneSessions, laneHandoffs: [], triggerSessionId: undefined, columnId: "done" });

describe("buildLaneSessionBackfill (C4, C11)", () => {
  it("(a) record missing: column, step index, specialist and step id come from the automation", () => {
    const fields = buildLaneSessionBackfill(bareTask(), doneAutomation([pusher, reporter], 1), "s1");
    expect(fields).toMatchObject({ columnId: "done", stepIndex: 1, specialistId: "kanban-done-reporter", stepId: "done-reporter" });
  });

  it("(b) a step without an id: stepId is absent, not an empty string", () => {
    const { id: _id, ...noId } = pusher;
    const fields = buildLaneSessionBackfill(bareTask(), doneAutomation([noId as KanbanAutomationStep]), "s1");
    expect(fields).toMatchObject({ columnId: "done", stepIndex: 0, specialistId: "kanban-main-pusher" });
    expect(fields).not.toHaveProperty("stepId");
  });

  it("(c) no automation in memory: no error, nothing invented", () => {
    expect(buildLaneSessionBackfill(bareTask(), undefined, "s1")).toEqual({});
    const task = bareTask();
    const record = upsertTaskLaneSession(task, { sessionId: "s1", ...buildLaneSessionBackfill(task, undefined, "s1") });
    expect(record.columnId).toBeUndefined();
  });

  it("an existing record is left alone", () => {
    const task = bareTask([{ sessionId: "s1", columnId: "review", stepIndex: 3, status: "running", startedAt: "2026-10-29T00:00:00.000Z" }]);
    expect(buildLaneSessionBackfill(task, doneAutomation([pusher]), "s1")).toEqual({});
  });

  it("C11 board whose Done step 0 is the reporter: specialistId, stepIndex, columnId follow that step", () => {
    const fields = buildLaneSessionBackfill(bareTask(), doneAutomation([reporter]), "s1");
    expect(fields).toMatchObject({ columnId: "done", stepIndex: 0, specialistId: "kanban-done-reporter" });
  });
});

describe("end handling with a lost Done first-step record (C4 real path, C5)", () => {
  it("backfills the skeleton, and a restart then resumes Done step 0 once with adoptLaneRun", async () => {
    const h = await createLaneHarness("done", triggerAssignedTaskAgentMock);
    const pusherSession = await runToInterruptedStep(h);
    loseLaneRecord(h.system.taskStore, h.cardId, pusherSession); // the start-time record was overwritten

    pushTurnComplete(h.system, pusherSession, "cancelled"); // the restart cancels the turn
    await vi.waitFor(async () => expect((await h.laneRecord(pusherSession))?.status).toBe("failed"));
    await settle();

    const record = (await h.laneRecord(pusherSession))!;
    expect(record).toMatchObject({
      columnId: "done",
      stepIndex: 0,
      specialistId: stepSpecialistId("done", 0),
      stepId: stepSpecialistId("done", 0),
      status: "failed",
      recoveryReason: "turn_cancelled",
    });

    // The next process: nothing in memory. The planned backoff is over.
    const stored = (h.system.taskStore as unknown as { tasks: Map<string, Task> }).tasks.get(h.cardId)!;
    for (const entry of stored.laneSessions ?? []) delete entry.retryAfterAt;
    const card = await h.card();
    const decision = decideInterruptedLaneResume(card, h.columns, new Date());
    expect(decision).toMatchObject({ kind: "resume", stepIndex: 0 });

    resetWorkflowOrchestrator();
    stopInterruptedLaneResumeTimers();
    startWorkflowOrchestrator(h.system);
    enqueueSpy.mockClear();
    triggerAssignedTaskAgentMock.mockClear();
    const result = await resumeInterruptedLaneSteps(h.system);
    await settle(100);

    expect(result.resumed).toEqual([`${h.cardId}:done:${stepSpecialistId("done", 0)}`]);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy.mock.calls[0][1]).toMatchObject({
      task: { id: h.cardId },
      expectedColumnId: "done",
      stepIndex: 0,
      adoptLaneRun: true,
    });
    expect(triggerAssignedTaskAgentMock).toHaveBeenCalledTimes(1);
    expect(triggerAssignedTaskAgentMock.mock.calls[0][0]).toMatchObject({ stepIndex: 0 });
  });

  it("the old skeleton shape (no columnId) is skipped by the resume — control", () => {
    const columns = [
      { id: "review", name: "Review", position: 0, stage: "review" as const },
      {
        id: "done", name: "Done", position: 1, stage: "done" as const,
        automation: { enabled: true, transitionType: "entry" as const, steps: [pusher, reporter] },
      },
    ];
    const skeleton: TaskLaneSession = {
      sessionId: "s1", status: "failed", recoveryReason: "turn_cancelled", startedAt: "2026-10-29T00:00:00.000Z",
    };
    const task = { columnId: "done", laneSessions: [skeleton], triggerSessionId: "s1" };
    expect(decideInterruptedLaneResume(task, columns, new Date())).toMatchObject({ kind: "skip" });
    const filled = { ...task, laneSessions: [{ ...skeleton, columnId: "done", stepIndex: 0 }] };
    expect(decideInterruptedLaneResume(filled, columns, new Date())).toMatchObject({ kind: "resume", stepIndex: 0 });
  });
});

describe("rate-limited backfilled record is re-run when its time comes (C6)", () => {
  const NOW = new Date("2026-10-29T03:00:00.000Z");

  function rateLimitedTask(withBackfill: boolean): Task {
    const task = {
      id: "card-rl", columnId: "done", laneSessions: [], laneHandoffs: [], triggerSessionId: undefined,
    } as unknown as Task;
    upsertTaskLaneSession(task, {
      sessionId: "rl-1",
      ...(withBackfill ? buildLaneSessionBackfill(task, doneAutomation([pusher, reporter]), "rl-1") : {}),
      status: "failed",
      recoveryReason: "rate_limited",
    });
    return task;
  }

  async function runScheduled(task: Task, retryAt: Date): Promise<boolean[]> {
    const seen: boolean[] = [];
    const entryOf = (): RateLimitRetryEntry => ({
      cardId: "card-rl", columnId: "done", stepIndex: 0, retryAt, failedSessionId: "rl-1", attempt: 1, recoveryAttempts: 0,
    });
    const scheduler = new RateLimitRetryScheduler(async (entry) => { seen.push(canRunRateLimitRetry(task, entry)); });
    scheduler.schedule(entryOf());
    await vi.advanceTimersByTimeAsync(59_000);
    const beforeDue = seen.length;
    await vi.advanceTimersByTimeAsync(2_000);
    scheduler.stopAll();
    return [beforeDue === 0, ...seen];
  }

  it("due in 60 s: nothing runs before, then canRunRateLimitRetry is true", async () => {
    vi.useFakeTimers({ now: NOW });
    const task = rateLimitedTask(true);
    const plan = planRateLimitRetry({ task, columnId: "done", sessionId: "rl-1", evidence: "429 usage_limit_reached", now: NOW, random: () => 0 });
    expect(task.laneSessions?.[0].retryAfterAt).toBe(plan.retryAt!.toISOString());
    expect(await runScheduled(task, new Date(NOW.getTime() + 60_000))).toEqual([true, true]);
  });

  it("already due 1 s ago: runs at once and canRunRateLimitRetry is true", async () => {
    vi.useFakeTimers({ now: NOW });
    expect(await runScheduled(rateLimitedTask(true), new Date(NOW.getTime() - 1_000))).toEqual([false, true]);
  });

  it("control: the old skeleton without columnId is never re-run", async () => {
    vi.useFakeTimers({ now: NOW });
    expect(await runScheduled(rateLimitedTask(false), new Date(NOW.getTime() - 1_000))).toEqual([false, false]);
  });
});

describe("store used here is the in-memory one (C7 isolation)", () => {
  it("no database file is opened", () => {
    expect(process.env.ROUTA_DB_DRIVER).toBe("memory");
    expect(new InMemoryTaskStore()).toBeDefined();
  });
});
