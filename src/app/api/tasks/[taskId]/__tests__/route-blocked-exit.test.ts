/**
 * Card 60f276e0: moving a card into a blocked lane is exempt from the
 * "later lane steps still have to run" guard on PATCH /api/tasks/{id};
 * every other move keeps the guard (contract C2, C3, C6, F2, F4).
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, TaskStatus, type Task, type TaskLaneSession } from "@/core/models/task";
import type { TaskDeliveryReadiness } from "@/core/kanban/task-delivery-readiness";

const prepareTaskForColumnChange = vi.fn<(fromColumnId?: string, task?: Task) => boolean>(() => false);

const taskStore = {
  get: vi.fn<(_: string) => Promise<Task | null>>(),
  save: vi.fn<(task: Task) => Promise<void>>(),
};

const system = {
  taskStore,
  kanbanBoardStore: { get: vi.fn() },
  workspaceStore: { get: vi.fn() },
  worktreeStore: { assignSession: vi.fn(), get: vi.fn() },
  codebaseStore: { findByRepoPath: vi.fn(), get: vi.fn(), getDefault: vi.fn() },
  eventBus: {},
  artifactStore: undefined,
};

vi.mock("@/core/routa-system", () => ({ getRoutaSystem: () => system }));
vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({ getKanbanEventBroadcaster: () => ({ notify: vi.fn() }) }));
vi.mock("@/core/kanban/task-board-context", () => ({ ensureTaskBoardContext: vi.fn(async () => ({})) }));
vi.mock("@/core/kanban/github-issues", () => ({ updateGitHubIssue: vi.fn() }));
vi.mock("@/core/git/git-worktree-service", () => ({ GitWorktreeService: vi.fn(class {}) }));
vi.mock("@/core/models/workspace", () => ({
  getDefaultWorkspaceWorktreeRoot: vi.fn(),
  getEffectiveWorkspaceMetadata: vi.fn(),
}));
vi.mock("@/core/kanban/column-transition", () => ({ emitColumnTransition: vi.fn() }));
vi.mock("@/core/kanban/task-session-transition", () => ({
  archiveActiveTaskSession: vi.fn(),
  prepareTaskForColumnChange: (fromColumnId?: string, task?: Task) => prepareTaskForColumnChange(fromColumnId, task),
}));
vi.mock("@/core/kanban/task-delivery-readiness", () => ({
  buildTaskDeliveryReadiness: vi.fn(async (): Promise<TaskDeliveryReadiness> => ({
    checked: false,
    modified: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    commitsSinceBase: 0,
    hasCommitsSinceBase: false,
    hasUncommittedChanges: false,
    isGitHubRepo: false,
    canCreatePullRequest: false,
    reason: "Task has no linked repository or worktree.",
  })),
  buildTaskDeliveryTransitionErrorFromRules: vi.fn(() => null),
}));
vi.mock("@/core/kanban/workflow-orchestrator-singleton", () => ({
  endKanbanTaskSessions: vi.fn(async () => undefined),
  forgetKanbanCard: vi.fn(),
  enqueueKanbanTaskSession: vi.fn(async () => ({})),
  getKanbanSessionQueue: () => ({ removeCardJob: vi.fn() }),
  processKanbanColumnTransition: vi.fn(),
}));

import { PATCH } from "../route";

type Step = { id: string; role: "CRAFTER" | "GATE"; specialistId: string; specialistName: string };
const step = (id: string, specialistName: string, role: Step["role"] = "CRAFTER"): Step => (
  { id, role, specialistId: `kanban-${id}`, specialistName }
);

const LANES: Record<string, Step[]> = {
  done: [step("done-pusher", "推送员"), step("done-reporter", "完成汇报员")],
  review: [step("qa-frontend", "QA Frontend", "GATE"), step("review-guard", "Review Guard", "GATE")],
  todo: [step("todo-orchestrator", "Todo Orchestrator"), step("contract-setter", "Contract Setter")],
};

const COLUMN_IDS = ["backlog", "todo", "dev", "review", "done", "blocked", "stuck"];

function seedCard(options: {
  columnId: string;
  steps: Step[];
  triggerStepIndex?: number | null;
  sessions?: TaskLaneSession[];
  verificationVerdict?: Task["verificationVerdict"];
}) {
  const { columnId, steps } = options;
  const triggerStepIndex = options.triggerStepIndex === undefined ? 0 : options.triggerStepIndex;
  const active = triggerStepIndex === null ? steps[0] : steps[triggerStepIndex];
  const task = createTask({
    id: "task-1",
    title: "Card with pending lane steps",
    objective: "Leave the lane",
    workspaceId: "workspace-1",
    boardId: "board-1",
    columnId,
    status: TaskStatus.PENDING,
    triggerSessionId: triggerStepIndex === null ? undefined : `session-${columnId}-${triggerStepIndex}`,
    assignedProvider: "codex",
    assignedRole: active.role,
    assignedSpecialistId: active.specialistId,
    assignedSpecialistName: active.specialistName,
  });
  task.verificationVerdict = options.verificationVerdict;
  task.laneSessions = options.sessions ?? (triggerStepIndex === null ? [] : steps.slice(0, triggerStepIndex + 1).map((s, i) => ({
    sessionId: `session-${columnId}-${i}`,
    columnId,
    stepId: s.id,
    stepIndex: i,
    role: s.role,
    specialistId: s.specialistId,
    specialistName: s.specialistName,
    status: i === triggerStepIndex ? "running" as const : "completed" as const,
    startedAt: `2026-10-24T00:0${i}:00.000Z`,
  })));
  taskStore.get.mockResolvedValue(task);
  system.kanbanBoardStore.get = vi.fn().mockResolvedValue({
    id: "board-1",
    columns: COLUMN_IDS.map((id, position) => ({
      id,
      name: id[0].toUpperCase() + id.slice(1),
      position,
      stage: id === "stuck" ? "blocked" : id,
      ...(id === columnId ? { automation: { enabled: true, steps } } : {}),
    })),
  });
  return task;
}

async function patch(body: Record<string, unknown>) {
  const response = await PATCH(new NextRequest("http://localhost/api/tasks/task-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ taskId: "task-1" }) });
  return { status: response.status, data: await response.json() };
}

describe("PATCH /api/tasks/[taskId] blocked exit from lanes with pending steps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskStore.save.mockImplementation(async (task: Task) => {
      taskStore.get.mockResolvedValue(structuredClone(task));
    });
  });

  describe("C2/F4: the new effect reaches every source lane and blocked target", () => {
    it.each(
      ["done", "review", "todo"].flatMap((source) => ["blocked", "stuck"].map((target) => [source, target])),
    )("%s -> %s is allowed while the first step is still active", async (source, target) => {
      seedCard({ columnId: source, steps: LANES[source] });

      const { status, data } = await patch({ columnId: target });

      expect(data.error).toBeUndefined();
      expect(status).toBe(200);
      expect(data.task.columnId).toBe(target);
    });
  });

  it("C3: moving a Done card to blocked runs the old lane's wrap-up from done", async () => {
    seedCard({ columnId: "done", steps: LANES.done });

    const { status } = await patch({ columnId: "blocked" });

    expect(status).toBe(200);
    expect(prepareTaskForColumnChange).toHaveBeenCalledTimes(1);
    expect(prepareTaskForColumnChange.mock.calls[0][0]).toBe("done");
    expect(taskStore.save).toHaveBeenCalledWith(expect.objectContaining({ columnId: "blocked" }));
  });

  describe("F2: every other move keeps the guard's old shape", () => {
    it.each([
      ["done", "todo"],
      ["review", "done"],
      ["todo", "dev"],
    ])("%s -> %s is still rejected while the first step is active", async (source, target) => {
      seedCard({ columnId: source, steps: LANES[source] });

      const { status, data } = await patch({ columnId: target });

      expect(status).toBe(400);
      expect(data.error).toContain("Cannot move");
      expect(taskStore.save).not.toHaveBeenCalled();
    });

    it("review -> dev uses the verdict from the request body", async () => {
      seedCard({ columnId: "review", steps: LANES.review });
      const withVerdict = await patch({ columnId: "dev", verificationVerdict: "NOT_APPROVED" });
      expect(withVerdict.status).toBe(200);
      expect(withVerdict.data.task.columnId).toBe("dev");

      vi.clearAllMocks();
      seedCard({ columnId: "review", steps: LANES.review, verificationVerdict: undefined });
      const withoutVerdict = await patch({ columnId: "dev" });
      expect(withoutVerdict.status).toBe(400);
      expect(withoutVerdict.data.error).toContain("Cannot move");
    });

    it.each([
      ["single-step Done lane", [LANES.done[1]], 0],
      ["trigger on the last Done step", LANES.done, 1],
      ["no trigger session", LANES.done, null],
    ] as const)("%s: done -> todo and done -> blocked are both allowed", async (_label, steps, triggerStepIndex) => {
      for (const target of ["todo", "blocked"]) {
        vi.clearAllMocks();
        seedCard({ columnId: "done", steps: [...steps], triggerStepIndex });
        const { status, data } = await patch({ columnId: target });
        expect(status).toBe(200);
        expect(data.task.columnId).toBe(target);
      }
    });
  });

  describe("C6: review convergence without columnId", () => {
    const threeSteps = [...LANES.review, step("high-risk-reviewer", "高风险复核员", "GATE")];

    it.each(["BLOCKED", "APPROVED"] as const)(
      "%s while step 3 never ran: convergence keeps the card in review",
      async (verdict) => {
        seedCard({ columnId: "review", steps: threeSteps, triggerStepIndex: 1, verificationVerdict: verdict as Task["verificationVerdict"] });

        const { status, data } = await patch({ retryTrigger: true });

        expect(status).toBe(200);
        expect(data.task.columnId).toBe("review");
      },
    );

    // Stale trigger: the guard still sees Review Guard (step 2) while the
    // convergence, after retryTrigger clears the trigger, sees step 3 as last.
    const staleSessions = (): TaskLaneSession[] => threeSteps.map((s, i) => ({
      sessionId: `session-review-${i}`,
      columnId: "review",
      stepId: s.id,
      stepIndex: i,
      role: s.role,
      specialistId: s.specialistId,
      status: i === 2 ? "running" as const : "completed" as const,
      startedAt: `2026-10-24T00:0${i}:00.000Z`,
    }));

    it("BLOCKED converges to blocked and passes the guard", async () => {
      seedCard({ columnId: "review", steps: threeSteps, triggerStepIndex: 1, sessions: staleSessions(), verificationVerdict: "BLOCKED" as Task["verificationVerdict"] });

      const { status, data } = await patch({ retryTrigger: true });

      expect(data.error).toBeUndefined();
      expect(status).toBe(200);
      expect(data.task.columnId).toBe("blocked");
    });

    it("APPROVED converges to done and is still stopped by the guard", async () => {
      seedCard({ columnId: "review", steps: threeSteps, triggerStepIndex: 1, sessions: staleSessions(), verificationVerdict: "APPROVED" as Task["verificationVerdict"] });

      const { status, data } = await patch({ retryTrigger: true });

      expect(status).toBe(400);
      expect(data.error).toContain("Cannot move");
    });
  });
});
