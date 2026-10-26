/**
 * Shared setup for the "interrupted lane step" tests (card 5fdaa681): a real
 * in-memory Routa system with the workflow orchestrator singleton, a board
 * with one automated lane, and a card whose lane steps are started through
 * the real column-transition path. Only the agent launch
 * (triggerAssignedTaskAgent) is mocked by the calling test file.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { vi, type Mock } from "vitest";
import { getHttpSessionStore } from "../../acp/http-session-store";
import { AgentEventType } from "../../events/event-bus";
import { createKanbanBoard, type KanbanColumn } from "../../models/kanban";
import { createTask, TaskStatus, VerificationVerdict, type Task } from "../../models/task";
import { createWorkspace } from "../../models/workspace";
import { createInMemorySystem, type RoutaSystem } from "../../routa-system";
import {
  getWorkflowOrchestrator,
  processKanbanColumnTransition,
  startWorkflowOrchestrator,
} from "../workflow-orchestrator-singleton";

/**
 * done: Done lane, pusher (0) then reporter (1); interrupted at step 0.
 * todo: Todo lane, two steps; interrupted at step 1.
 * review: Review lane, two steps, the last one auto-advances to Done; interrupted at step 1.
 * dev: Dev lane, one step that auto-advances to Review (ralph_loop supervision); interrupted at step 0.
 */
export type LaneShape = "done" | "todo" | "review" | "dev";

export const INTERRUPTED_STEP: Record<LaneShape, number> = { done: 0, todo: 1, review: 1, dev: 0 };

const STEP_IDS: Record<LaneShape, string[]> = {
  done: ["kanban-main-pusher", "kanban-done-reporter"],
  todo: ["todo-orchestrator", "contract-setter"],
  review: ["kanban-qa-frontend", "kanban-review-guard"],
  dev: ["kanban-dev-crafter"],
};

const LANE_LAYOUT: Record<LaneShape, { before: string; after?: string }> = {
  done: { before: "review" },
  todo: { before: "backlog", after: "dev" },
  review: { before: "dev", after: "done" },
  dev: { before: "todo", after: "review" },
};

export const WORKSPACE_ID = "default";

/**
 * vi.waitFor's default 1 s timeout is too short under load: cold module
 * loads inside the orchestrator take 2.3-2.6 s on a busy machine.
 */
const WAIT_OPTS = { timeout: 10_000, interval: 50 };

export function stepSpecialistId(shape: LaneShape, stepIndex: number): string {
  return STEP_IDS[shape][stepIndex];
}

function buildColumns(shape: LaneShape): KanbanColumn[] {
  const layout = LANE_LAYOUT[shape];
  const columns: KanbanColumn[] = [
    { id: layout.before, name: layout.before, position: 0, stage: layout.before as KanbanColumn["stage"] },
    {
      id: shape,
      name: shape,
      position: 1,
      stage: shape,
      automation: {
        enabled: true,
        transitionType: "entry",
        autoAdvanceOnSuccess: shape !== "done",
        steps: STEP_IDS[shape].map((specialistId) => ({
          id: specialistId,
          providerId: "claude",
          role: shape === "dev" ? "CRAFTER" : "GATE",
          specialistId,
          specialistName: specialistId,
        })),
      },
    },
  ];
  if (layout.after) {
    columns.push({ id: layout.after, name: layout.after, position: 2, stage: layout.after as KanbanColumn["stage"] });
  }
  return columns;
}

export interface LaneHarness {
  system: RoutaSystem;
  shape: LaneShape;
  boardId: string;
  cardId: string;
  columns: KanbanColumn[];
  /** Session ids the mocked agent launch returned, by step index (latest last). */
  sessionsByStep: Map<number, string[]>;
  latestSession(stepIndex: number): string | undefined;
  card(): Promise<Task>;
  laneRecord(sessionId: string): Promise<NonNullable<Task["laneSessions"]>[number] | undefined>;
  waitForStep(stepIndex: number, count?: number): Promise<string>;
  /** Columns the orchestrator moved the card to (COLUMN_TRANSITION events). */
  transitions: Array<{ from?: string; to?: string }>;
}

let tmpRoot: string | undefined;

/** cwd for sessions registered in the HTTP session store (trace files land here). */
export function sessionCwd(): string {
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "routa-lane-interrupt-"));
  return tmpRoot;
}

export function cleanupSessionCwd(): void {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = undefined;
}

let sessionCounter = 0;

export async function createLaneHarness(
  shape: LaneShape,
  trigger: Mock,
  options: { card?: Partial<Task>; fallback?: boolean; cardId?: string } = {},
): Promise<LaneHarness> {
  const system = createInMemorySystem();
  const boardId = `board-${shape}`;
  const metadata: Record<string, string> = { [`kanbanSessionConcurrencyLimit:${boardId}`]: "10" };
  if (shape === "dev") {
    // ralph_loop recovers a step whose completion is not satisfied: an
    // interrupted step must not be "recovered" either.
    metadata[`kanbanDevSessionSupervision:${boardId}`] = JSON.stringify({ mode: "ralph_loop", maxRecoveryAttempts: 2 });
  }
  await system.workspaceStore.save(createWorkspace({ id: WORKSPACE_ID, title: "Default", metadata }));
  const columns = buildColumns(shape);
  await system.kanbanBoardStore.save(createKanbanBoard({
    id: boardId,
    workspaceId: WORKSPACE_ID,
    name: "Board",
    isDefault: true,
    columns,
  }));
  const cardId = options.cardId ?? `card-${shape}`;
  const card: Task = {
    ...createTask({
      id: cardId,
      title: `Card ${shape}`,
      objective: `Lane ${shape} interrupted`,
      workspaceId: WORKSPACE_ID,
      boardId,
      columnId: shape,
      status: shape === "done" ? TaskStatus.COMPLETED : TaskStatus.PENDING,
    }),
    ...(shape === "done" ? { verificationVerdict: VerificationVerdict.APPROVED } : {}),
    ...(options.fallback
      ? {
        enableAutomaticFallback: true,
        fallbackAgentChain: [{ providerId: "claude", role: "CRAFTER", specialistId: "fallback-agent" }],
      }
      : {}),
    ...options.card,
  } as Task;
  await system.taskStore.save(card);

  const sessionsByStep = new Map<number, string[]>();
  trigger.mockImplementation(async (params: { task: { id: string }; stepIndex?: number }) => {
    const stepIndex = params.stepIndex ?? 0;
    sessionCounter += 1;
    const sessionId = `${params.task.id}:s${stepIndex}:${sessionCounter}`;
    sessionsByStep.set(stepIndex, [...(sessionsByStep.get(stepIndex) ?? []), sessionId]);
    return { sessionId, transport: "acp" };
  });

  const transitions: LaneHarness["transitions"] = [];
  system.eventBus.on(`lane-interrupt-transitions-${cardId}`, (event) => {
    if (event.type === AgentEventType.COLUMN_TRANSITION && event.data?.cardId === cardId) {
      transitions.push({ from: event.data.fromColumnId as string, to: event.data.toColumnId as string });
    }
  });

  startWorkflowOrchestrator(system);
  const harness: LaneHarness = {
    system,
    shape,
    boardId,
    cardId,
    columns,
    sessionsByStep,
    transitions,
    latestSession: (stepIndex) => sessionsByStep.get(stepIndex)?.at(-1),
    card: async () => (await system.taskStore.get(cardId))!,
    laneRecord: async (sessionId) => (await system.taskStore.get(cardId))?.laneSessions?.find((entry) => entry.sessionId === sessionId),
    waitForStep: async (stepIndex, count = 1) => {
      await vi.waitFor(() => {
        if ((sessionsByStep.get(stepIndex)?.length ?? 0) < count) throw new Error(`step ${stepIndex} not started`);
      }, WAIT_OPTS);
      return sessionsByStep.get(stepIndex)!.at(-1)!;
    },
  };
  return harness;
}

/** Enter the lane and run it up to the step this shape interrupts; returns that step's session. */
export async function runToInterruptedStep(h: LaneHarness): Promise<string> {
  await processKanbanColumnTransition(h.system, {
    cardId: h.cardId,
    cardTitle: `Card ${h.shape}`,
    boardId: h.boardId,
    workspaceId: WORKSPACE_ID,
    fromColumnId: LANE_LAYOUT[h.shape].before,
    toColumnId: h.shape,
    fromColumnName: LANE_LAYOUT[h.shape].before,
    toColumnName: h.shape,
  });
  let sessionId = await h.waitForStep(0);
  for (let step = 1; step <= INTERRUPTED_STEP[h.shape]; step += 1) {
    pushTurnComplete(h.system, sessionId, "end_turn");
    sessionId = await h.waitForStep(step);
  }
  await settle();
  return sessionId;
}

/**
 * A turn end coming from the agent, through the real path:
 * HttpSessionStore.pushNotification → EventBus → orchestrator.
 */
export function pushTurnComplete(system: RoutaSystem, sessionId: string, stopReason: string): void {
  const store = getHttpSessionStore();
  if (!store.getSession(sessionId)) {
    store.upsertSession({
      sessionId,
      cwd: sessionCwd(),
      workspaceId: WORKSPACE_ID,
      provider: "opencode",
      createdAt: new Date().toISOString(),
    });
  }
  store.setEventBus(system.eventBus);
  store.pushNotification({ sessionId, update: { sessionUpdate: "turn_complete", stopReason } } as never);
}

export function emitAgentEvent(
  system: RoutaSystem,
  type: AgentEventType,
  sessionId: string,
  data: Record<string, unknown>,
): void {
  system.eventBus.emit({
    type,
    agentId: sessionId,
    workspaceId: WORKSPACE_ID,
    data: { sessionId, ...data },
    timestamp: new Date(),
  });
}

/** Wait until the step's lane record is no longer running, then let follow-up work settle. */
export async function waitForStepEnd(h: LaneHarness, sessionId: string): Promise<void> {
  await vi.waitFor(async () => {
    const record = await h.laneRecord(sessionId);
    if (!record || record.status === "running") throw new Error(`${sessionId} still running`);
  }, WAIT_OPTS);
  await settle();
}

export async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function orchestratorOf(h: LaneHarness) {
  return getWorkflowOrchestrator(h.system);
}

/** Process-death options for the restart sweep / revive: nothing is alive. */
export const deadProcessOptions = {
  sessionStore: { getSession: () => undefined } as never,
  processManager: { hasActiveSession: () => false } as never,
};
