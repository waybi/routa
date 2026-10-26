// @vitest-environment node
/**
 * Card 14de4800: after a Routa restart the steps it interrupted
 * (failed + turn_cancelled, timed_out + restart_interrupted) are re-run at
 * the same step by the startup resume, without POST revive or PATCH
 * retryTrigger. A user's own cancel, the lane watchdog, environment and agent
 * failures, a tripped fuse and a finished Done lane are left alone; the
 * three rerun paths together start one session per card lane.
 * Real in-memory Routa system and orchestrator singleton; only the agent
 * launch and the process manager are mocked (routa:433).
 * Contract items: C1, C2②③, C4, C5, C6, C8, C9, C10, C12, C13, C14, F4.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { triggerAssignedTaskAgentMock, systemRef } = vi.hoisted(() => {
  // Before any import: no module may open the worktree's routa.db (routa:433).
  process.env.ROUTA_DB_DRIVER = "memory";
  return { triggerAssignedTaskAgentMock: vi.fn(), systemRef: { current: undefined as unknown } };
});

vi.mock("@/core/acp/session-prompt", () => ({ dispatchSessionPrompt: vi.fn() }));
vi.mock("../agent-trigger", () => ({
  triggerAssignedTaskAgent: triggerAssignedTaskAgentMock,
  getInternalApiOrigin: vi.fn(() => "http://localhost"),
}));
vi.mock("../../acp/processer", () => ({
  getAcpProcessManager: () => ({ killSession: vi.fn(async () => undefined), hasActiveSession: () => false }),
}));
vi.mock("../../routa-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../routa-system")>();
  return { ...actual, getRoutaSystem: () => systemRef.current };
});
vi.mock("../../db/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/index")>();
  return { ...actual, getDatabaseDriver: vi.fn(actual.getDatabaseDriver) };
});

import { getHttpSessionStore } from "../../acp/http-session-store";
import { getDatabaseDriver } from "../../db/index";
import { AgentEventType } from "../../events/event-bus";
import { createKanbanBoard, type KanbanColumn } from "../../models/kanban";
import { createTask, TaskStatus, VerificationVerdict, type Task, type TaskLaneSession } from "../../models/task";
import { createWorkspace } from "../../models/workspace";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import {
  hasPendingInterruptedLaneResume,
  resumeInterruptedLaneStep,
  resumeInterruptedLaneSteps,
  stopInterruptedLaneResumeTimers,
} from "../interrupted-lane-resume";
import { clearLaneRerunClaims } from "../lane-rerun-claim";
import { reviveMissingEntryAutomations } from "../restart-recovery";
import { endStaleRunningLaneSessionsOnStartup, getStartupLaneResume } from "../startup-lane-sweep";
import { getKanbanSessionQueue, resetWorkflowOrchestrator, startWorkflowOrchestrator } from "../workflow-orchestrator-singleton";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { GET as getBoards } from "@/app/api/kanban/boards/route";

const WS = "default";
const BOARD = "board-auto";
const YESTERDAY = "2026-10-25T17:57:00.000Z";

const STEPS: Record<string, string[]> = {
  todo: ["todo-orchestrator", "contract-setter"],
  dev: ["kanban-dev-crafter"],
  review: ["kanban-qa-frontend", "kanban-review-guard", "kanban-review-closer"],
  done: ["kanban-main-pusher", "kanban-done-reporter"],
  report: ["kanban-done-reporter"],
};

function column(id: string, position: number, stage: KanbanColumn["stage"], extra: Partial<KanbanColumn["automation"]> = {}): KanbanColumn {
  return {
    id,
    name: id,
    position,
    stage,
    automation: {
      enabled: true,
      transitionType: "entry",
      autoAdvanceOnSuccess: false,
      steps: STEPS[id].map((specialistId) => ({
        id: specialistId,
        providerId: "claude",
        role: "CRAFTER",
        specialistId,
        specialistName: specialistId,
        ...(specialistId === "kanban-review-guard" ? { model: "claude-sonnet-5-5", reasoningEffort: "medium" } : {}),
      })),
      ...extra,
    },
  };
}

const COLUMNS: KanbanColumn[] = [
  { id: "backlog", name: "backlog", position: 0, stage: "backlog" },
  column("todo", 1, "todo"),
  column("dev", 2, "dev"),
  column("review", 3, "review"),
  column("done", 4, "done"),
  { id: "blocked", name: "blocked", position: 5, stage: "blocked" },
];

let counter = 0;
let system: RoutaSystem;
/** Every agent launch: card, column, step. */
let launches: Array<{ cardId: string; columnId?: string; stepIndex?: number; specialistId?: string; sessionId: string; model?: string; effort?: string }>;

function ended(
  sessionId: string,
  columnId: string,
  stepIndex: number,
  status: TaskLaneSession["status"],
  recoveryReason?: TaskLaneSession["recoveryReason"],
  extra: Partial<TaskLaneSession> = {},
): TaskLaneSession {
  return {
    sessionId,
    columnId,
    stepIndex,
    stepId: STEPS[columnId]?.[stepIndex],
    specialistId: STEPS[columnId]?.[stepIndex],
    status,
    recoveryReason,
    startedAt: "2026-10-26T17:40:00.000Z",
    completedAt: "2026-10-26T17:57:00.000Z",
    ...extra,
  };
}

async function setup(limit = "10", columns: KanbanColumn[] = COLUMNS): Promise<void> {
  system = createInMemorySystem();
  systemRef.current = system;
  await system.workspaceStore.save(createWorkspace({
    id: WS,
    title: "Default",
    metadata: { [`kanbanSessionConcurrencyLimit:${BOARD}`]: limit },
  }));
  await system.kanbanBoardStore.save(createKanbanBoard({ id: BOARD, workspaceId: WS, name: "Board", isDefault: true, columns }));
  launches = [];
  triggerAssignedTaskAgentMock.mockImplementation(async (params: {
    task: { id: string; columnId?: string };
    stepIndex?: number;
    step?: { specialistId?: string };
    stepModel?: string;
    stepReasoningEffort?: string;
  }) => {
    counter += 1;
    const sessionId = `${params.task.id}:${params.task.columnId}:s${params.stepIndex ?? "x"}:${counter}`;
    launches.push({
      cardId: params.task.id,
      columnId: params.task.columnId,
      stepIndex: params.stepIndex,
      specialistId: params.step?.specialistId,
      sessionId,
      model: params.stepModel,
      effort: params.stepReasoningEffort,
    });
    return { sessionId, transport: "acp" };
  });
  startWorkflowOrchestrator(system);
}

async function addCard(id: string, columnId: string, laneSessions: TaskLaneSession[], extra: Partial<Task> = {}): Promise<Task> {
  const task: Task = {
    ...createTask({
      id,
      title: id,
      objective: `card ${id}`,
      workspaceId: WS,
      boardId: BOARD,
      columnId,
      status: columnId === "done" ? TaskStatus.COMPLETED : TaskStatus.PENDING,
    }),
    ...(columnId === "done" ? { verificationVerdict: VerificationVerdict.APPROVED } : {}),
    laneSessions,
    ...extra,
  };
  await system.taskStore.save(task);
  return task;
}

const card = async (id: string) => (await system.taskStore.get(id))!;
const launchesOf = (cardId: string) => launches.filter((entry) => entry.cardId === cardId);
const runningOf = async (cardId: string, columnId: string) => ((await card(cardId)).laneSessions ?? [])
  .filter((entry) => entry.columnId === columnId && entry.status === "running");

/** Server start: the sweep, then the off-path resume (awaited here). */
async function startUp(driver: "sqlite" | "postgres" = "sqlite"): Promise<void> {
  vi.mocked(getDatabaseDriver).mockReturnValueOnce(driver);
  try {
    await endStaleRunningLaneSessionsOnStartup();
  } finally {
    // An unused "sqlite" answer (a gate returned first) must not reach a database open.
    vi.mocked(getDatabaseDriver).mockReset();
  }
  await getStartupLaneResume();
  await settle();
}

function completeTurn(sessionId: string): void {
  system.eventBus.emit({
    type: AgentEventType.AGENT_COMPLETED,
    agentId: sessionId,
    workspaceId: WS,
    data: { sessionId, success: true, stopReason: "end_turn" },
    timestamp: new Date(),
  });
}

async function settle(ms = 20): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const deadProcesses = {
  sessionStore: { getSession: () => undefined } as never,
  processManager: { hasActiveSession: () => false } as never,
};

beforeEach(() => {
  vi.stubEnv("ROUTA_DB_DRIVER", "memory");
  resetWorkflowOrchestrator();
  stopInterruptedLaneResumeTimers();
  clearLaneRerunClaims();
  triggerAssignedTaskAgentMock.mockReset();
  vi.spyOn(getHttpSessionStore(), "hydrateFromDb").mockResolvedValue();
});

afterEach(() => {
  resetWorkflowOrchestrator();
  stopInterruptedLaneResumeTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(() => {
  systemRef.current = undefined;
});

describe("C1/AC1/AC2: the startup resume re-runs interrupted steps at the same step", () => {
  it("Dev step 0 turn_cancelled, Review step 1 restart_interrupted, a Dev card stopped the day before", async () => {
    await setup();
    await addCard("dev-a", "dev", [ended("old-a", "dev", 0, "failed", "turn_cancelled")]);
    await addCard("rev-b", "review", [
      ended("old-b0", "review", 0, "completed"),
      ended("old-b1", "review", 1, "timed_out", "restart_interrupted"),
    ]);
    await addCard("dev-c", "dev", [ended("old-c", "dev", 0, "failed", "turn_cancelled", { startedAt: YESTERDAY, completedAt: YESTERDAY })]);
    const log = vi.spyOn(console, "log");

    await startUp();

    for (const [cardId, columnId, stepIndex] of [["dev-a", "dev", 0], ["rev-b", "review", 1], ["dev-c", "dev", 0]] as const) {
      expect(launchesOf(cardId)).toHaveLength(1);
      expect(launchesOf(cardId)[0]).toMatchObject({ columnId, stepIndex, specialistId: STEPS[columnId][stepIndex] });
      expect(await runningOf(cardId, columnId)).toHaveLength(1);
    }
    expect(log.mock.calls.some(([line]) => String(line).includes("Startup resume enqueued 3 interrupted lane step(s)"))).toBe(true);

    // Adopted by the orchestrator (adoptLaneRun): the resumed step's end is
    // recorded and the lane's next step starts (routa:274).
    const resumedReview = launchesOf("rev-b")[0].sessionId;
    completeTurn(resumedReview);
    await vi.waitFor(() => expect(launchesOf("rev-b")).toHaveLength(2));
    expect(launchesOf("rev-b")[1]).toMatchObject({ columnId: "review", stepIndex: 2, specialistId: "kanban-review-closer" });
    expect((await card("rev-b")).laneSessions?.find((entry) => entry.sessionId === resumedReview)?.status).toBe("completed");

    const resumedDev = launchesOf("dev-a")[0].sessionId;
    completeTurn(resumedDev);
    await vi.waitFor(async () => {
      expect((await card("dev-a")).laneSessions?.find((entry) => entry.sessionId === resumedDev)?.status).toBe("completed");
    });
  });

  it("C12: the resumed step keeps its column step model and effort", async () => {
    await setup();
    await addCard("rev-m", "review", [
      ended("m0", "review", 0, "completed"),
      ended("m1", "review", 1, "failed", "turn_cancelled"),
    ]);
    await startUp();
    expect(launchesOf("rev-m")).toEqual([expect.objectContaining({ stepIndex: 1, model: "claude-sonnet-5-5", effort: "medium" })]);
  });
});

describe("C5/AC7: Done lane pusher interrupted", () => {
  it.each([
    { label: "failed + turn_cancelled", record: ended("p", "done", 0, "failed", "turn_cancelled") },
    { label: "timed_out + restart_interrupted", record: ended("p", "done", 0, "timed_out", "restart_interrupted") },
  ])("re-runs kanban-main-pusher ($label), not the reporter", async ({ record }) => {
    await setup();
    await addCard("done-p", "done", [ended("g", "review", 1, "completed"), record]);
    await startUp();
    expect(launchesOf("done-p")).toEqual([expect.objectContaining({ columnId: "done", stepIndex: 0, specialistId: "kanban-main-pusher" })]);
    await settle(50);
    expect(launchesOf("done-p").filter((entry) => entry.specialistId === "kanban-done-reporter")).toHaveLength(0);

    completeTurn(launchesOf("done-p")[0].sessionId);
    await vi.waitFor(() => expect(launchesOf("done-p")).toHaveLength(2));
    expect(launchesOf("done-p")[1]).toMatchObject({ stepIndex: 1, specialistId: "kanban-done-reporter" });
  });

  it("C13: a Done lane without a pusher re-runs its reporter", async () => {
    await setup("10", [
      { id: "review", name: "review", position: 0, stage: "review" },
      { ...column("report", 1, "done"), id: "done" },
    ]);
    await addCard("done-r", "done", [ended("r", "done", 0, "failed", "turn_cancelled")]);
    await startUp();
    expect(launchesOf("done-r")).toEqual([expect.objectContaining({ stepIndex: 0, specialistId: "kanban-done-reporter" })]);
  });
});

describe("C4/AC5/AC6/C14: what the startup resume leaves alone", () => {
  const fuse = (n: number, last: TaskLaneSession["recoveryReason"] = "turn_cancelled") => [
    ...Array.from({ length: n - 1 }, (_, index) => ended(`f${index}`, "dev", 0, "failed", index % 2 ? "rate_limited" : "restart_interrupted")),
    ended(`f${n - 1}`, "dev", 0, "failed", last),
  ];

  it.each([
    { label: "watchdog_inactivity", lane: [ended("x", "dev", 0, "timed_out", "watchdog_inactivity")], starts: 0 },
    { label: "environment_failure", lane: [ended("x", "dev", 0, "failed", "environment_failure")], starts: 0 },
    { label: "agent_failed", lane: [ended("x", "dev", 0, "failed", "agent_failed")], starts: 0 },
    { label: "user_cancelled", lane: [ended("x", "dev", 0, "failed", "user_cancelled")], starts: 0 },
    { label: "rate_limited (revive's job)", lane: [ended("x", "dev", 0, "failed", "rate_limited")], starts: 0 },
    { label: "C14 recorded completed by the restart", lane: [ended("x", "dev", 0, "completed")], starts: 0 },
    { label: "5 retryable failures in a row (fuse)", lane: fuse(5), starts: 0 },
    { label: "4 retryable failures in a row", lane: fuse(4), starts: 1 },
    { label: "latest run in another column", lane: [ended("x", "dev", 0, "failed", "turn_cancelled"), ended("y", "todo", 1, "completed")], starts: 0 },
  ])("$label → $starts session(s)", async ({ lane, starts }) => {
    await setup();
    await addCard("c4", "dev", lane);
    await startUp();
    expect(launchesOf("c4")).toHaveLength(starts);
  });

  it("a card with a session assigned (triggerSessionId) is left alone", async () => {
    await setup();
    await addCard("c4t", "dev", [ended("x", "dev", 0, "failed", "turn_cancelled")], { triggerSessionId: "live-elsewhere" });
    const result = await resumeInterruptedLaneSteps(system);
    expect(result.resumed).toEqual([]);
    expect(launchesOf("c4t")).toHaveLength(0);
  });

  it("a Done card whose last step completed is left alone", async () => {
    await setup();
    await addCard("done-ok", "done", [
      ended("p", "done", 0, "failed", "turn_cancelled"),
      ended("p2", "done", 0, "completed"),
      ended("r", "done", 1, "completed"),
    ]);
    await startUp();
    expect(launchesOf("done-ok")).toHaveLength(0);
  });
});

describe("C8: start-up gates and order", () => {
  it.each([
    { label: "Postgres", arrange: () => "postgres" as const },
    { label: "an ACP runner", arrange: () => { vi.stubEnv("ROUTA_ACP_RUNNER_URL", "http://runner"); return "sqlite" as const; } },
    { label: "next build", arrange: () => { vi.stubEnv("NEXT_PHASE", "phase-production-build"); return "sqlite" as const; } },
  ])("does not resume under $label", async ({ arrange }) => {
    await setup();
    await addCard("gate", "dev", [ended("x", "dev", 0, "failed", "turn_cancelled")]);
    const before = getStartupLaneResume();
    await startUp(arrange());
    expect(getStartupLaneResume()).toBe(before);
    expect(launchesOf("gate")).toHaveLength(0);
  });

  it("the start returns before the resume runs; sweep, then hydrate, then resume", async () => {
    await setup();
    await addCard("order", "dev", [{ ...ended("run", "dev", 0, "running"), completedAt: undefined }]);
    const order: string[] = [];
    vi.mocked(getHttpSessionStore().hydrateFromDb).mockImplementation(async () => {
      order.push("hydrate");
      await settle(30);
    });
    vi.mocked(getDatabaseDriver).mockReturnValueOnce("sqlite");
    await endStaleRunningLaneSessionsOnStartup();
    vi.mocked(getDatabaseDriver).mockReset();
    order.push("start returned");
    // The sweep already ended the dead running record as interrupted.
    expect((await card("order")).laneSessions?.[0]).toMatchObject({ status: "timed_out", recoveryReason: "restart_interrupted" });
    expect(launchesOf("order")).toHaveLength(0);
    await getStartupLaneResume();
    await settle();
    expect(order).toEqual(["start returned", "hydrate"]);
    expect(launchesOf("order")).toEqual([expect.objectContaining({ stepIndex: 0 })]);
  });
});

describe("C2②③: a rerun planned before the restart (turn_cancelled + retryAfterAt)", () => {
  it("retryAfterAt not reached: 0 sessions at start, 1 at the planned time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-10-26T18:00:00.000Z"));
    await setup();
    await addCard("w", "review", [
      ended("w0", "review", 0, "completed"),
      ended("w1", "review", 1, "failed", "turn_cancelled", { retryAfterAt: "2026-10-26T18:01:30.000Z" }),
    ]);
    const result = await resumeInterruptedLaneSteps(system);
    expect(result.resumed).toEqual([]);
    expect(result.waiting).toEqual([{ cardId: "w", retryAt: new Date("2026-10-26T18:01:30.000Z") }]);
    expect(hasPendingInterruptedLaneResume("w")).toBe(true);
    await vi.advanceTimersByTimeAsync(89_000);
    expect(launchesOf("w")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    for (let index = 0; index < 5; index += 1) await vi.advanceTimersByTimeAsync(0);
    expect(launchesOf("w")).toEqual([expect.objectContaining({ stepIndex: 1, specialistId: "kanban-review-guard" })]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(launchesOf("w")).toHaveLength(1);
  });

  it("retryAfterAt already passed: resumed at once, once", async () => {
    await setup();
    await addCard("p", "dev", [ended("p0", "dev", 0, "failed", "turn_cancelled", { retryAfterAt: "2026-01-01T00:00:00.000Z" })]);
    await startUp();
    expect(launchesOf("p")).toEqual([expect.objectContaining({ stepIndex: 0 })]);
    await resumeInterruptedLaneSteps(system);
    expect(launchesOf("p")).toHaveLength(1);
  });
});

describe("C6/AC8: startup resume, retryTrigger and revive at the same time start one session", () => {
  const patchRetry = (cardId: string) => PATCH(
    new NextRequest(`http://localhost/api/tasks/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify({ retryTrigger: true }),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ taskId: cardId }) },
  );
  const revive = () => reviveMissingEntryAutomations(system, WS, BOARD, deadProcesses);
  const resume = (cardId: string) => resumeInterruptedLaneStep(system, cardId);

  it.each([
    { label: "all three", calls: ["resume", "patch", "revive"] },
    { label: "resume + patch", calls: ["resume", "patch"] },
    { label: "patch + resume", calls: ["patch", "resume"] },
    { label: "resume + revive", calls: ["resume", "revive"] },
    { label: "revive + patch", calls: ["revive", "patch"] },
  ])("$label", async ({ calls }) => {
    await setup();
    await addCard("race", "review", [
      ended("r0", "review", 0, "completed"),
      ended("r1", "review", 1, "failed", "turn_cancelled"),
    ]);
    const results = await Promise.all(calls.map((call) => (
      call === "resume" ? resume("race") : call === "patch" ? patchRetry("race") : revive()
    )));
    await settle(50);
    for (const result of results) {
      if (result instanceof Response) expect(result.status).toBe(200);
    }
    expect(launchesOf("race")).toHaveLength(1);
    expect(launchesOf("race")[0]).toMatchObject({ stepIndex: 1 });
    expect(await runningOf("race", "review")).toHaveLength(1);
  });

  it("F4: each path alone still starts the interrupted step", async () => {
    for (const call of ["resume", "patch", "revive"] as const) {
      resetWorkflowOrchestrator();
      await setup();
      await addCard("solo", "review", [
        ended("r0", "review", 0, "completed"),
        ended("r1", "review", 1, "timed_out", "restart_interrupted"),
      ]);
      if (call === "resume") await resume("solo");
      else if (call === "patch") expect((await patchRetry("solo")).status).toBe(200);
      else await revive();
      await settle();
      expect(launchesOf("solo"), call).toEqual([expect.objectContaining({ stepIndex: 1 })]);
    }
  });
});

describe("C9: a full board queues the resumed steps", () => {
  it("queued resumes are not failures and do not count toward the fuse", async () => {
    await setup("1");
    await addCard("q1", "dev", [ended("a", "dev", 0, "failed", "turn_cancelled")]);
    await addCard("q2", "dev", [ended("b", "dev", 0, "failed", "turn_cancelled")]);
    await startUp();
    expect(launches).toHaveLength(1);
    const queuedId = launches[0].cardId === "q1" ? "q2" : "q1";
    const queued = await card(queuedId);
    expect(queued.laneSessions).toHaveLength(1);
    expect(queued.lastSyncError).toBeFalsy();
    expect((await getKanbanSessionQueue(system).getBoardSnapshot(BOARD)).queuedCardIds).toEqual([queuedId]);

    completeTurn(launches[0].sessionId);
    await vi.waitFor(() => expect(launchesOf(queuedId)).toHaveLength(1));
    expect(launchesOf(queuedId)[0]).toMatchObject({ stepIndex: 0 });
  });
});

describe("C10: GET /api/kanban/boards starts nothing", () => {
  it("two reads of the boards leave the interrupted card as it is", async () => {
    await setup();
    await addCard("g", "dev", [ended("x", "dev", 0, "failed", "turn_cancelled")]);
    for (let index = 0; index < 2; index += 1) {
      const response = await getBoards(new NextRequest(`http://localhost/api/kanban/boards?workspaceId=${WS}`));
      expect(response.status).toBe(200);
    }
    await settle();
    expect(launchesOf("g")).toHaveLength(0);
    expect((await card("g")).laneSessions).toHaveLength(1);
  });
});
