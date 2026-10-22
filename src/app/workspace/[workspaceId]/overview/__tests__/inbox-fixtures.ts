import type { KanbanBoardInfo, TaskInfo } from "../../../types";

export type LaneSession = NonNullable<TaskInfo["laneSessions"]>[number];

export const NOW = Date.UTC(2026, 9, 21, 12);
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function run(
  columnId: string,
  startedAt: number,
  status: LaneSession["status"],
  extra: Partial<LaneSession> = {},
): LaneSession {
  return { sessionId: `${columnId}-${startedAt}`, columnId, startedAt: iso(startedAt), status, ...extra };
}

export function card(id: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    id,
    title: `Card ${id}`,
    status: "COMPLETED",
    columnId: "done",
    boardId: "b1",
    createdAt: iso(NOW - 30 * DAY),
    updatedAt: iso(NOW - HOUR),
    ...overrides,
  } as TaskInfo;
}

export const report = { excerpt: "Shipped", commit: "abc1234", hasLeftover: false, createdAt: iso(NOW - 2 * HOUR) };

export function makeBoard(id: string, withPusher: boolean, isDefault = true): KanbanBoardInfo {
  const steps = [{ id: "s1", specialistId: "kanban-done-reporter" }];
  if (withPusher) steps.push({ id: "s2", specialistId: "kanban-main-pusher" });
  return {
    id,
    name: id,
    isDefault,
    columns: [
      { id: "dev", name: "Dev", position: 0, stage: "dev" },
      { id: "done", name: "Done", position: 1, stage: "done", automation: { enabled: true, steps } },
      { id: "blocked", name: "Blocked", position: 2, stage: "blocked" },
    ],
  } as unknown as KanbanBoardInfo;
}

/** Done card whose trailing Done run ended with `status`. */
export function doneCard(id: string, status: LaneSession["status"], overrides: Partial<TaskInfo> = {}, endedAt = NOW - 3 * HOUR): TaskInfo {
  return card(id, {
    laneSessions: [
      run("dev", NOW - 2 * DAY, "transitioned", { completedAt: iso(NOW - 2 * DAY + HOUR) }),
      run("done", endedAt - HOUR, status, { completedAt: iso(endedAt) }),
    ],
    ...overrides,
  });
}

/** Done card that is merged-unknown but ahead of base by `ahead` commits. */
export function unmergedCard(id: string, ahead: number, overrides: Partial<TaskInfo> = {}): TaskInfo {
  return doneCard(id, "completed", {
    completionReport: report,
    deliveryLanding: { landedOnBase: false, commitsSinceBase: ahead } as unknown as TaskInfo["deliveryLanding"],
    ...overrides,
  });
}
