// @vitest-environment node
/**
 * Card 5fdaa681 (F3): random cross-check of interrupted lane steps, judged by
 * an answer computed from the requirement (not "same as before"):
 * - current column, running record, Routa restart (startup sweep)
 *     → timed_out + restart_interrupted;
 * - current column, running record, turn ended with stopReason=cancelled
 *     → failed + turn_cancelled, no further step started, card stays;
 * - running record in an earlier column → transitioned, reason unchanged;
 * - every other record unchanged;
 * - afterwards the rerun step (resolveLaneResumeStep) is the interrupted step.
 *
 * Case counts: LANE_FUZZ_SWEEP_CASES (default 300) and LANE_FUZZ_CANCEL_CASES
 * (default 20); seed LANE_FUZZ_SEED. LANE_FUZZ_PLANT=1 plants a judge error
 * (expects the step after the interrupted one) to prove the judge catches it.
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

import { createKanbanBoard, type KanbanColumn } from "../../models/kanban";
import {
  createTask,
  TaskStatus,
  VerificationVerdict,
  type Task,
  type TaskLaneSession,
  type TaskLaneSessionStatus,
} from "../../models/task";
import { createWorkspace } from "../../models/workspace";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import { resolveLaneResumeStep } from "../lane-automation-state";
import { endStaleRunningLaneSessions } from "../restart-recovery";
import {
  processKanbanColumnTransition,
  resetWorkflowOrchestrator,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";
import { cleanupSessionCwd, deadProcessOptions, pushTurnComplete } from "./lane-interrupt-harness";

const SWEEP_CASES = Number(process.env.LANE_FUZZ_SWEEP_CASES ?? 300);
const CANCEL_CASES = Number(process.env.LANE_FUZZ_CANCEL_CASES ?? 20);
const SEED = Number(process.env.LANE_FUZZ_SEED ?? 5_0_2026);
const PLANT = process.env.LANE_FUZZ_PLANT === "1";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAGES = ["backlog", "todo", "dev", "review", "done"] as const;
const STATUSES: TaskLaneSessionStatus[] = ["running", "completed", "failed", "timed_out", "transitioned"];

interface FuzzCase {
  id: string;
  columns: KanbanColumn[];
  currentColumn: string;
  interruptedStep: number;
  conclusion: "verdict" | "summary" | "none";
  history: TaskLaneSession[];
}

function generateCase(rand: () => number, index: number, historyInCurrentColumn: boolean): FuzzCase {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
  const columns: KanbanColumn[] = STAGES.map((stage, position) => {
    let steps: string[];
    if (stage === "done") {
      steps = rand() < 0.5 ? ["kanban-main-pusher", "kanban-done-reporter"] : ["kanban-done-reporter"];
    } else {
      steps = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, step) => `${stage}-step-${step}`);
    }
    return {
      id: stage,
      name: stage,
      position,
      stage,
      automation: {
        enabled: true,
        transitionType: "entry" as const,
        autoAdvanceOnSuccess: stage !== "done",
        steps: steps.map((specialistId) => ({ id: specialistId, providerId: "claude", role: "GATE" as const, specialistId })),
      },
    };
  });
  const current = columns[1 + Math.floor(rand() * (columns.length - 1))];
  const stepCount = current.automation!.steps!.length;
  const interruptedStep = Math.floor(rand() * stepCount);
  const history: TaskLaneSession[] = [];
  let at = Date.UTC(2026, 9, 23, 8);
  for (const column of columns) {
    if (column.id === current.id && !historyInCurrentColumn) continue;
    const runs = Math.floor(rand() * 3);
    for (let run = 0; run < runs; run += 1) {
      const columnSteps = column.automation!.steps!.length;
      // Earlier current-column runs are older steps that finished; keep them
      // non-running so the interrupted step is the lane's latest run.
      const status = column.id === current.id ? pick(STATUSES.slice(1)) : pick(STATUSES);
      at += 60_000;
      history.push({
        sessionId: `${index}-${column.id}-${run}`,
        columnId: column.id,
        stepIndex: Math.floor(rand() * columnSteps),
        status,
        startedAt: new Date(at).toISOString(),
        ...(status === "running" ? {} : { completedAt: new Date(at + 30_000).toISOString() }),
        ...(status === "failed" && rand() < 0.5 ? { recoveryReason: "agent_failed" as const } : {}),
      });
    }
  }
  return {
    id: `fuzz-${index}`,
    columns,
    currentColumn: current.id,
    interruptedStep,
    conclusion: pick(["verdict", "summary", "none"] as const),
    history,
  };
}

function cardFields(c: FuzzCase): Partial<Task> {
  return c.conclusion === "verdict"
    ? { verificationVerdict: VerificationVerdict.APPROVED }
    : c.conclusion === "summary" ? { completionSummary: "summary" } : {};
}

/** Independent judge: the answer the requirement gives, computed from the case alone. */
function judge(
  c: FuzzCase,
  interruptedSessionId: string,
  how: "sweep" | "cancelled",
  after: Task,
  extraRecordsBefore: TaskLaneSession[],
): string[] {
  const problems: string[] = [];
  const lane = after.laneSessions ?? [];
  const before = [...c.history, ...extraRecordsBefore];
  for (const original of before) {
    const actual = lane.find((entry) => entry.sessionId === original.sessionId);
    if (!actual) {
      problems.push(`${original.sessionId} missing`);
      continue;
    }
    // Only the restart sweep ends running records left in earlier columns.
    if (how === "sweep" && original.status === "running" && original.columnId !== c.currentColumn) {
      if (actual.status !== "transitioned" || actual.recoveryReason !== original.recoveryReason) {
        problems.push(`${original.sessionId} earlier-column running → ${actual.status}/${actual.recoveryReason}`);
      }
    } else if (JSON.stringify(actual) !== JSON.stringify(original)) {
      problems.push(`${original.sessionId} changed: ${JSON.stringify(original)} → ${JSON.stringify(actual)}`);
    }
  }
  const interrupted = lane.find((entry) => entry.sessionId === interruptedSessionId);
  const expected = how === "sweep"
    ? { status: "timed_out", recoveryReason: "restart_interrupted" }
    : { status: "failed", recoveryReason: "turn_cancelled" };
  if (interrupted?.status !== expected.status || interrupted?.recoveryReason !== expected.recoveryReason) {
    problems.push(`interrupted ${interruptedSessionId} → ${interrupted?.status}/${interrupted?.recoveryReason}`);
  }
  if (after.columnId !== c.currentColumn) problems.push(`card moved to ${after.columnId}`);
  const expectedStep = c.interruptedStep + (PLANT ? 1 : 0);
  const resume = resolveLaneResumeStep(after, c.columns);
  if (resume?.stepIndex !== expectedStep) {
    problems.push(`resume step ${resume?.stepIndex}, expected ${expectedStep}`);
  }
  return problems;
}

async function newSystem(): Promise<RoutaSystem> {
  const system = createInMemorySystem();
  await system.workspaceStore.save(createWorkspace({ id: "default", title: "Default" }));
  return system;
}

async function saveCase(system: RoutaSystem, c: FuzzCase, laneSessions: TaskLaneSession[], triggerSessionId?: string) {
  const boardId = `board-${c.id}`;
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: boardId,
    workspaceId: "default",
    name: boardId,
    isDefault: false,
    columns: c.columns,
  }));
  await system.workspaceStore.save(createWorkspace({
    id: "default",
    title: "Default",
    metadata: { [`kanbanSessionConcurrencyLimit:${boardId}`]: "10" },
  }));
  await system.taskStore.save({
    ...createTask({
      id: c.id,
      title: c.id,
      objective: c.id,
      workspaceId: "default",
      boardId,
      columnId: c.currentColumn,
      status: c.currentColumn === "done" ? TaskStatus.COMPLETED : TaskStatus.PENDING,
    }),
    ...cardFields(c),
    triggerSessionId,
    laneSessions,
  });
}

function report(label: string, failures: Array<{ id: string; problems: string[] }>, total: number) {
  console.log(`[lane-fuzz] ${label}: ${total} cases, ${failures.length} mismatches${PLANT ? " (planted judge error)" : ""}`);
  for (const failure of failures.slice(0, 5)) {
    console.log(`[lane-fuzz]   ${failure.id}: ${failure.problems.join("; ")}`);
  }
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

describe("F3: random cross-check of interrupted lane steps", () => {
  it(`restart sweep, ${SWEEP_CASES} random cases`, async () => {
    const rand = mulberry32(SEED);
    const system = await newSystem();
    const cases: Array<{ c: FuzzCase; interrupted: TaskLaneSession }> = [];
    for (let index = 0; index < SWEEP_CASES; index += 1) {
      const c = generateCase(rand, index, true);
      const interrupted: TaskLaneSession = {
        sessionId: `${index}-interrupted`,
        columnId: c.currentColumn,
        stepIndex: c.interruptedStep,
        status: "running",
        startedAt: new Date(Date.UTC(2026, 9, 23, 20, 23)).toISOString(),
      };
      await saveCase(system, c, [...c.history, interrupted], interrupted.sessionId);
      cases.push({ c, interrupted });
    }

    await endStaleRunningLaneSessions(system, deadProcessOptions);

    const failures: Array<{ id: string; problems: string[] }> = [];
    for (const { c, interrupted } of cases) {
      const after = (await system.taskStore.get(c.id))!;
      const problems = judge(c, interrupted.sessionId, "sweep", after, []);
      if (after.triggerSessionId) problems.push("triggerSessionId kept");
      if (problems.length > 0) failures.push({ id: c.id, problems });
    }
    report("sweep", failures, cases.length);
    expect(failures).toEqual([]);
  }, 600_000);

  it(`cancelled turn, ${CANCEL_CASES} random cases`, async () => {
    const rand = mulberry32(SEED + 1);
    const failures: Array<{ id: string; problems: string[] }> = [];
    for (let index = 0; index < CANCEL_CASES; index += 1) {
      resetWorkflowOrchestrator();
      triggerAssignedTaskAgentMock.mockReset();
      const c = generateCase(rand, index, false);
      const system = await newSystem();
      await saveCase(system, c, c.history);
      const started: Array<{ sessionId: string; stepIndex: number }> = [];
      triggerAssignedTaskAgentMock.mockImplementation(async (params: { task: { id: string }; stepIndex?: number }) => {
        const sessionId = `${params.task.id}:s${params.stepIndex ?? 0}:${started.length}`;
        started.push({ sessionId, stepIndex: params.stepIndex ?? 0 });
        return { sessionId, transport: "acp" };
      });
      startWorkflowOrchestrator(system);
      const waitStarted = (count: number) => vi.waitFor(() => {
        if (started.length < count) throw new Error("step not started");
      }, { interval: 5 });
      await processKanbanColumnTransition(system, {
        cardId: c.id,
        cardTitle: c.id,
        boardId: `board-${c.id}`,
        workspaceId: "default",
        fromColumnId: "backlog",
        toColumnId: c.currentColumn,
      });
      await waitStarted(1);
      for (let step = 1; step <= c.interruptedStep; step += 1) {
        pushTurnComplete(system, started.at(-1)!.sessionId, "end_turn");
        await waitStarted(step + 1);
      }
      const interruptedSessionId = started.at(-1)!.sessionId;
      const before = (await system.taskStore.get(c.id))!.laneSessions ?? [];
      const ownRuns = before.filter((entry) => !c.history.some((item) => item.sessionId === entry.sessionId));
      const startsBefore = started.length;

      pushTurnComplete(system, interruptedSessionId, "cancelled");
      await vi.waitFor(async () => {
        const record = (await system.taskStore.get(c.id))?.laneSessions?.find((entry) => entry.sessionId === interruptedSessionId);
        if (!record || record.status === "running") throw new Error("still running");
      }, { interval: 5 });
      await new Promise((resolve) => setTimeout(resolve, 10));

      const after = (await system.taskStore.get(c.id))!;
      const problems = judge(c, interruptedSessionId, "cancelled", after, ownRuns.filter((entry) => entry.sessionId !== interruptedSessionId));
      if (started.length !== startsBefore) problems.push(`${started.length - startsBefore} step(s) started after the cancel`);
      if (problems.length > 0) failures.push({ id: c.id, problems });
    }
    report("cancelled", failures, CANCEL_CASES);
    expect(failures).toEqual([]);
  }, 1_800_000);
});
