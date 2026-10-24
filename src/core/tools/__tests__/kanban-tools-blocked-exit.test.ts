/**
 * Card 60f276e0: move_card into a blocked lane is exempt from the "later lane
 * steps still have to run" guard; every other move keeps the guard
 * (contract C2, C3, F2, F4).
 */
import { describe, expect, it } from "vitest";
import { createKanbanBoard, type KanbanColumnStage } from "../../models/kanban";
import { createTask, type Task } from "../../models/task";
import { InMemoryKanbanBoardStore } from "../../store/kanban-board-store";
import { InMemoryTaskStore } from "../../store/task-store";
import { KanbanTools } from "../kanban-tools";

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

async function seedCard(options: {
  columnId: string;
  steps: Step[];
  triggerStepIndex?: number | null;
  verificationVerdict?: Task["verificationVerdict"];
}) {
  const { columnId, steps } = options;
  const triggerStepIndex = options.triggerStepIndex === undefined ? 0 : options.triggerStepIndex;
  const boardStore = new InMemoryKanbanBoardStore();
  const taskStore = new InMemoryTaskStore();
  const tools = new KanbanTools(boardStore, taskStore);
  const board = createKanbanBoard({
    id: "board-blocked-exit",
    workspaceId: "default",
    name: "Board",
    isDefault: true,
    columns: COLUMN_IDS.map((id, position) => ({
      id,
      name: id[0].toUpperCase() + id.slice(1),
      position,
      stage: (id === "stuck" ? "blocked" : id) as KanbanColumnStage,
      ...(id === columnId ? { automation: { enabled: true, steps } } : {}),
    })),
  });
  await boardStore.save(board);
  const active = triggerStepIndex === null ? steps[0] : steps[triggerStepIndex];
  const triggerSessionId = triggerStepIndex === null ? undefined : `session-${columnId}-${triggerStepIndex}`;
  const task = createTask({
    id: "card-1",
    title: "Card with pending lane steps",
    objective: "Leave the lane",
    workspaceId: "default",
    boardId: board.id,
    columnId,
    triggerSessionId,
    assignedProvider: "codex",
    assignedRole: active.role,
    assignedSpecialistId: active.specialistId,
    assignedSpecialistName: active.specialistName,
  });
  task.verificationVerdict = options.verificationVerdict;
  task.laneSessions = triggerStepIndex === null ? [] : steps.slice(0, triggerStepIndex + 1).map((s, i) => ({
    sessionId: `session-${columnId}-${i}`,
    columnId,
    stepId: s.id,
    stepIndex: i,
    role: s.role,
    specialistId: s.specialistId,
    specialistName: s.specialistName,
    status: i === triggerStepIndex ? "running" as const : "completed" as const,
    startedAt: `2026-10-24T00:0${i}:00.000Z`,
  }));
  await taskStore.save(task);
  return { tools, taskStore, triggerSessionId };
}

describe("move_card blocked exit from lanes with pending steps", () => {
  describe("C2/F4: the new effect reaches every source lane and blocked target", () => {
    it.each(
      ["done", "review", "todo"].flatMap((source) => ["blocked", "stuck"].map((target) => [source, target])),
    )("%s -> %s is allowed while the first step is still active", async (source, target) => {
      const { tools, taskStore } = await seedCard({ columnId: source, steps: LANES[source] });

      const result = await tools.moveCard({ cardId: "card-1", targetColumnId: target });

      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
      expect((await taskStore.get("card-1"))?.columnId).toBe(target);
    });
  });

  it("C3: moving a Done card to blocked clears the pusher's trigger session", async () => {
    const { tools, taskStore, triggerSessionId } = await seedCard({ columnId: "done", steps: LANES.done });
    expect(triggerSessionId).toBe("session-done-0");

    const result = await tools.moveCard({ cardId: "card-1", targetColumnId: "blocked" });

    expect(result.success).toBe(true);
    const saved = await taskStore.get("card-1");
    expect(saved?.columnId).toBe("blocked");
    expect(saved?.triggerSessionId).toBeUndefined();
  });

  describe("F2: every other move keeps the guard's old shape", () => {
    it.each([
      ["done", "todo"],
      ["review", "done"],
      ["todo", "dev"],
    ])("%s -> %s is still rejected while the first step is active", async (source, target) => {
      const { tools, taskStore } = await seedCard({ columnId: source, steps: LANES[source] });

      const result = await tools.moveCard({ cardId: "card-1", targetColumnId: target });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot move");
      expect((await taskStore.get("card-1"))?.columnId).toBe(source);
    });

    it("review -> dev uses the stored verdict", async () => {
      const stored = await seedCard({
        columnId: "review",
        steps: LANES.review,
        verificationVerdict: "NOT_APPROVED" as Task["verificationVerdict"],
      });
      const withVerdict = await stored.tools.moveCard({ cardId: "card-1", targetColumnId: "dev" });
      expect(withVerdict.success).toBe(true);
      expect((await stored.taskStore.get("card-1"))?.columnId).toBe("dev");

      const empty = await seedCard({ columnId: "review", steps: LANES.review });
      const withoutVerdict = await empty.tools.moveCard({ cardId: "card-1", targetColumnId: "dev" });
      expect(withoutVerdict.success).toBe(false);
      expect(withoutVerdict.error).toContain("Cannot move");
      expect((await empty.taskStore.get("card-1"))?.columnId).toBe("review");
    });

    it.each([
      ["single-step Done lane", [LANES.done[1]], 0],
      ["trigger on the last Done step", LANES.done, 1],
      ["no trigger session", LANES.done, null],
    ] as const)("%s: done -> todo and done -> blocked are both allowed", async (_label, steps, triggerStepIndex) => {
      for (const target of ["todo", "blocked"]) {
        const { tools, taskStore } = await seedCard({ columnId: "done", steps: [...steps], triggerStepIndex });
        const result = await tools.moveCard({ cardId: "card-1", targetColumnId: target });
        expect(result.success).toBe(true);
        expect((await taskStore.get("card-1"))?.columnId).toBe(target);
      }
    });
  });
});
