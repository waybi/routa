// @vitest-environment node
/**
 * Card faca483f: the High-Risk Reviewer (last Review step) that cannot confirm
 * the Review Guard finished this round calls move_card into the card's own
 * Review column. Before this card that move did nothing: a same-column move
 * emitted no column transition, and the lane's three finished steps filled the
 * non-dev repeat limit (3), so the card sat in Review. Now it reruns the
 * Review lane from step 1, at most REVIEW_LANE_RERUN_LIMIT times.
 *
 * Memory stores only: no test here touches routa.db.
 */
import { describe, expect, it, vi } from "vitest";

import { AgentEventType, EventBus } from "../../events/event-bus";
import { createKanbanBoard, type KanbanColumn } from "../../models/kanban";
import { createTask, TaskStatus, type TaskLaneSession } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanTools } from "../../tools/kanban-tools";
import { resolveReviewLaneConvergenceTarget } from "../review-lane-convergence";
import { countLaneRerunRequests, REVIEW_LANE_RERUN_LIMIT } from "../review-lane-rerun";
import {
  getNonDevAutomationRunCount,
  hasExceededNonDevAutomationRepeatLimit,
  KanbanWorkflowOrchestrator,
} from "../workflow-orchestrator";

const gate = (id: string, name: string) => ({ id, role: "GATE" as const, specialistId: `kanban-${id}`, specialistName: name });
const REVIEW_3 = [gate("qa-frontend", "QA"), gate("flight-review-guard", "Review Guard"), gate("high-risk-reviewer", "High-Risk Reviewer")];
const REVIEW_2 = [gate("qa-frontend", "QA"), gate("review-guard", "Review Guard")];
const DONE = [gate("done-pusher", "Pusher"), gate("done-reporter", "Reporter")];

async function setup(reviewSteps = REVIEW_3) {
  const eventBus = new EventBus();
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const columns: KanbanColumn[] = [
    { id: "todo", name: "Todo", stage: "todo", position: 0 },
    { id: "dev", name: "Dev", stage: "dev", position: 1 },
    { id: "review", name: "Review", stage: "review", position: 2, automation: { enabled: true, steps: reviewSteps } },
    { id: "done", name: "Done", stage: "done", position: 3, automation: { enabled: true, transitionType: "entry", steps: DONE } },
    { id: "blocked", name: "Blocked", stage: "blocked", position: 4 },
  ];
  await boardStore.save(createKanbanBoard({ id: "board-1", workspaceId: "default", name: "Main", isDefault: true, columns }));
  const steps: Record<string, typeof REVIEW_3> = { review: reviewSteps, done: DONE };

  let counter = 0;
  const createSession = vi.fn(async (params: { cardId: string; columnId: string; stepIndex: number }) => {
    counter += 1;
    const sessionId = `${params.columnId}-${params.stepIndex}-#${counter}`;
    const task = await taskStore.get(params.cardId);
    if (task) {
      task.triggerSessionId = sessionId;
      task.sessionIds = [...(task.sessionIds ?? []), sessionId];
      task.laneSessions = [...(task.laneSessions ?? []), {
        sessionId,
        columnId: params.columnId,
        stepId: steps[params.columnId][params.stepIndex].id,
        stepIndex: params.stepIndex,
        role: "GATE",
        status: "running",
        startedAt: new Date().toISOString(),
      }];
      await taskStore.save(task);
    }
    return sessionId;
  });
  const killSession = vi.fn(async (_sessionId: string) => undefined);
  const orchestrator = new KanbanWorkflowOrchestrator(eventBus, boardStore, taskStore, createSession as never, killSession);
  orchestrator.start();
  const tools = new KanbanTools(boardStore, taskStore);
  tools.setEventBus(eventBus);
  const transitions: Array<Record<string, unknown>> = [];
  eventBus.on("test-transitions", (event) => {
    if (event.type === AgentEventType.COLUMN_TRANSITION) transitions.push(event.data);
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 30));
  const endSession = async (sessionId: string) => {
    eventBus.emit({ type: AgentEventType.AGENT_COMPLETED, agentId: sessionId, workspaceId: "default", data: { sessionId, success: true }, timestamp: new Date() });
    await flush();
  };
  const current = async () => (await taskStore.get("card"))!.triggerSessionId!;
  const starts = () => createSession.mock.calls.map(([params]) => `${params.columnId}:${params.stepIndex}`);

  const enter = async (columnId: "review" | "done", fromColumnId: string) => {
    await taskStore.save(createTask({
      id: "card",
      title: "Card",
      objective: "Rerun the Review lane",
      workspaceId: "default",
      boardId: "board-1",
      columnId,
      status: columnId === "done" ? TaskStatus.COMPLETED : TaskStatus.REVIEW_REQUIRED,
    }));
    await orchestrator.processColumnTransition({
      cardId: "card", cardTitle: "Card", boardId: "board-1", workspaceId: "default", fromColumnId, toColumnId: columnId,
    });
  };
  /** Finish every Review step but the last one; the last one stays running. */
  const runToLastReviewStep = async () => {
    for (let index = 0; index < reviewSteps.length - 1; index += 1) await endSession(await current());
  };

  return { orchestrator, tools, taskStore, columns, createSession, killSession, transitions, flush, endSession, current, starts, enter, runToLastReviewStep };
}

describe.each([
  ["3-step Review lane (QA, Review Guard, High-Risk Reviewer)", REVIEW_3],
  ["2-step Review lane (QA, Review Guard)", REVIEW_2],
])("move_card into the card's own Review column: %s", (_label, reviewSteps) => {
  const last = reviewSteps.length - 1;

  it("reruns the lane from step 1, and step 2 follows step 1", async () => {
    const h = await setup(reviewSteps);
    await h.enter("review", "dev");
    await h.runToLastReviewStep();
    const reviewer = await h.current();
    expect(reviewer).toBe(`review-${last}-#${reviewSteps.length}`);

    const result = await h.tools.moveCard({ cardId: "card", targetColumnId: "review" });
    await h.flush();

    expect(result.success).toBe(true);
    const task = (await h.taskStore.get("card"))!;
    expect(task.columnId).toBe("review");
    // Step 0 (QA) started again in a new session and the orchestrator follows it.
    expect(h.starts().slice(reviewSteps.length)).toEqual(["review:0"]);
    expect(task.triggerSessionId).toBe(`review-0-#${reviewSteps.length + 1}`);
    expect(h.orchestrator.getAutomationForCard("card")).toMatchObject({ columnId: "review", currentStepIndex: 0, status: "running" });
    // The reviewer's record closes the previous round; it is not a failure.
    const reviewerLane = task.laneSessions?.find((entry) => entry.sessionId === reviewer);
    expect(reviewerLane?.laneRerunRequestedAt).toBeTruthy();
    expect(reviewerLane?.status).toBe("completed");
    expect(reviewerLane?.recoveryReason).toBeUndefined();
    expect(h.transitions.at(-1)).toMatchObject({ fromColumnId: "review", toColumnId: "review", laneRerun: true });

    // The reviewer's turn ends after its move: no step starts, nothing fails.
    await h.endSession(reviewer);
    expect(h.starts().slice(reviewSteps.length)).toEqual(["review:0"]);
    expect(h.killSession).toHaveBeenCalledWith(reviewer);

    await h.endSession(await h.current());
    expect(h.starts().slice(reviewSteps.length)).toEqual(["review:0", "review:1"]);
    h.orchestrator.stop();
  });

  it("an old verdict cannot converge the card while the lane reruns", async () => {
    const h = await setup(reviewSteps);
    await h.enter("review", "dev");
    await h.runToLastReviewStep();
    const task = (await h.taskStore.get("card"))!;
    task.verificationVerdict = "APPROVED" as never;
    await h.taskStore.save(task);

    expect((await h.tools.moveCard({ cardId: "card", targetColumnId: "review" })).success).toBe(true);
    await h.flush();
    await h.endSession(await h.current()); // QA of the new round ends

    const after = (await h.taskStore.get("card"))!;
    expect(after.verificationVerdict).toBeUndefined();
    expect(after.columnId).toBe("review");
    expect(resolveReviewLaneConvergenceTarget(after, h.columns)).toBeUndefined();
    expect(h.transitions.some((data) => data.toColumnId === "done" || data.toColumnId === "blocked")).toBe(false);
    expect(h.starts().some((start) => start.startsWith("done:"))).toBe(false);
    h.orchestrator.stop();
  });
});

describe("Review lane rerun limit", () => {
  it(`stops after ${REVIEW_LANE_RERUN_LIMIT} reruns with a visible reason, over 10 tries`, async () => {
    const h = await setup();
    await h.enter("review", "dev");
    const results: boolean[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const automation = h.orchestrator.getAutomationForCard("card");
      if (automation?.status === "running" && automation.currentStepIndex === 0) await h.runToLastReviewStep();
      const result = await h.tools.moveCard({ cardId: "card", targetColumnId: "review" });
      await h.flush();
      results.push(result.success);
    }

    expect(results.filter(Boolean)).toHaveLength(REVIEW_LANE_RERUN_LIMIT);
    // First round plus one per rerun; each round runs the 3 steps.
    expect(h.createSession).toHaveBeenCalledTimes(3 * (REVIEW_LANE_RERUN_LIMIT + 1));
    const task = (await h.taskStore.get("card"))!;
    expect(countLaneRerunRequests(task, "review")).toBe(REVIEW_LANE_RERUN_LIMIT);
    expect(task.lastSyncError).toContain("Cannot rerun \"Review\"");
    expect(task.comments?.at(-1)?.body).toContain("move the card to \"blocked\"");
    // The refused move left the reviewer's session as it was.
    expect(task.laneSessions?.find((entry) => entry.sessionId === task.triggerSessionId)?.status).toBe("running");
    h.orchestrator.stop();
  });

  it("other lanes keep their repeat limit", async () => {
    const entries = (columnId: string, n: number): TaskLaneSession[] => Array.from({ length: n }, (_, i) => ({
      sessionId: `${columnId}-${i}`, columnId, status: "completed", startedAt: "2026-10-26T00:00:00.000Z",
    }));
    expect(hasExceededNonDevAutomationRepeatLimit({ laneSessions: entries("done", 3) }, "done", "done")).toBe(true);
    expect(hasExceededNonDevAutomationRepeatLimit({ laneSessions: entries("todo", 3) }, "todo", "todo")).toBe(true);
    expect(hasExceededNonDevAutomationRepeatLimit({ laneSessions: entries("review", 3) }, "review", "review")).toBe(true);
    // A rerun request ends the previous round of its own column only.
    const rerun = [...entries("review", 3)];
    rerun[2] = { ...rerun[2], laneRerunRequestedAt: "2026-10-26T00:01:00.000Z" };
    expect(getNonDevAutomationRunCount({ laneSessions: rerun }, "review", "review")).toBe(0);
    expect(getNonDevAutomationRunCount({ laneSessions: [...rerun, ...entries("review", 2)] }, "review", "review")).toBe(2);
  });
});

describe("moves that are not a Review lane rerun keep their old behaviour", () => {
  it("done→done keeps the running Done session and starts nothing", async () => {
    const h = await setup();
    await h.enter("done", "review");
    const before = h.createSession.mock.calls.length;

    expect((await h.tools.moveCard({ cardId: "card", targetColumnId: "done" })).success).toBe(true);
    await h.flush();

    expect(h.createSession.mock.calls.length).toBe(before);
    expect(h.orchestrator.getAutomationForCard("card")).toMatchObject({ columnId: "done", sessionId: "done-0-#1" });
    expect((await h.taskStore.get("card"))?.triggerSessionId).toBe("done-0-#1");
    expect(h.transitions.some((data) => data.fromColumnId === data.toColumnId)).toBe(false);
    h.orchestrator.stop();
  });

  it("dev→review still starts QA, review→done still starts the pusher", async () => {
    const h = await setup();
    await h.taskStore.save(createTask({
      id: "card", title: "Card", objective: "o", workspaceId: "default", boardId: "board-1", columnId: "dev", status: TaskStatus.IN_PROGRESS,
    }));
    expect((await h.tools.moveCard({ cardId: "card", targetColumnId: "review" })).success).toBe(true);
    await h.flush();
    expect(h.starts()).toEqual(["review:0"]);
    expect(h.transitions.at(-1)).not.toHaveProperty("laneRerun");
    await h.runToLastReviewStep();
    expect((await h.tools.moveCard({ cardId: "card", targetColumnId: "done" })).success).toBe(true);
    await h.flush();
    expect(h.starts().at(-1)).toBe("done:0");
    h.orchestrator.stop();
  });
});

// F3: random lane histories, counted by a reference written from the rule
// ("count this column's trailing runs since the last rerun request; environment
// failures, retryable failures and user cancels do not count"), not by calling
// the code under test.
function referenceRunCount(laneSessions: TaskLaneSession[], columnId: string, stage: string, limitShift = 0): number {
  if (stage === "dev") return 0;
  let n = 0;
  for (let i = laneSessions.length - 1; i >= 0; i -= 1) {
    const e = laneSessions[i];
    if (e.columnId !== columnId || e.laneRerunRequestedAt) break;
    const skipped = e.recoveryReason === "environment_failure"
      || e.recoveryReason === "user_cancelled"
      || ((e.recoveryReason === "rate_limited" || e.recoveryReason === "turn_cancelled" || e.recoveryReason === "restart_interrupted")
        && (e.status === "failed" || e.status === "timed_out"));
    if (!skipped) n += 1;
  }
  return n + limitShift;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("F3 random cross-check of the repeat count", () => {
  it("matches the reference on 10,000 random lane histories", () => {
    const rnd = seeded(20261026);
    const pick = <T,>(items: readonly T[]) => items[Math.floor(rnd() * items.length)];
    const columns = ["todo", "review", "done"] as const;
    const reasons = [undefined, undefined, "agent_failed", "environment_failure", "user_cancelled", "rate_limited", "turn_cancelled", "restart_interrupted"] as const;
    const statuses = ["completed", "failed", "timed_out", "transitioned"] as const;
    const shift = Number(process.env.F3_PLANT_SHIFT ?? 0);
    const mismatches: string[] = [];
    for (let round = 0; round < 10_000; round += 1) {
      const laneSessions: TaskLaneSession[] = Array.from({ length: Math.floor(rnd() * 9) }, (_, i) => ({
        sessionId: `s${i}`,
        columnId: pick(columns),
        status: pick(statuses),
        recoveryReason: pick(reasons),
        startedAt: "2026-10-26T00:00:00.000Z",
        ...(rnd() < 0.2 ? { laneRerunRequestedAt: "2026-10-26T00:01:00.000Z" } : {}),
      }));
      const columnId = pick(columns);
      const expected = referenceRunCount(laneSessions, columnId, columnId, shift);
      const actual = getNonDevAutomationRunCount({ laneSessions }, columnId, columnId);
      if (expected !== actual) mismatches.push(`round ${round}: expected ${expected}, got ${actual}`);
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
  });
});
