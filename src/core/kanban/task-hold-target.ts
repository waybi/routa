/**
 * Server side of the role hold (card a00fb67b, L400): which role a start
 * path is about to run, and the lastSyncError of a role hold.
 *
 * Kept out of the orchestrator singleton so recovery modules and routes can
 * use it without pulling in (or being broken by test mocks of) the singleton.
 */

import type { KanbanAutomationStep, KanbanBoard } from "../models/kanban";
import type { Task } from "../models/task";
import type { RoutaSystem } from "../routa-system";
import { getSpecialistById } from "../orchestration/specialist-prompts";
import { getKanbanAutoProvider } from "./board-auto-provider";
import { resolveEffectiveTaskAutomation, type AutomationSpecialistSummary } from "./effective-task-automation";
import { resolveLaneResumeStep } from "./lane-automation-state";
import { formatRoleHoldSyncError, listHeldSpecialists } from "./task-hold";

type HoldStores = Pick<RoutaSystem, "kanbanBoardStore" | "workspaceStore">;

export function resolveKanbanSpecialist(
  specialistId: string,
  locale?: string,
): AutomationSpecialistSummary | undefined {
  const specialist = (locale ? getSpecialistById(specialistId, locale) : undefined)
    ?? getSpecialistById(specialistId);
  if (!specialist) return undefined;
  return {
    name: specialist.name,
    role: specialist.role,
    defaultProvider: specialist.defaultProvider,
  };
}

/** Whether the card has any "hold:<role>" label (cheap pre-check before store reads). */
export function hasRoleHoldLabels(task: Pick<Task, "labels"> | null | undefined): boolean {
  return listHeldSpecialists(task).length > 0;
}

/**
 * The role a start without an explicit step runs: the step, else the card's
 * effective automation in `columnId` (what startKanbanTaskSession starts).
 */
export async function resolveStartSpecialistId(
  stores: HoldStores,
  task: Task,
  options: { columnId?: string; step?: KanbanAutomationStep; board?: KanbanBoard } = {},
): Promise<string | undefined> {
  if (options.step?.specialistId) return options.step.specialistId;
  const board = options.board ?? (task.boardId ? await stores.kanbanBoardStore.get(task.boardId) : undefined);
  if (!board) return undefined;
  const workspace = await stores.workspaceStore.get(task.workspaceId);
  const laneTask = options.columnId ? { ...task, columnId: options.columnId } : task;
  return resolveEffectiveTaskAutomation(laneTask, board.columns, resolveKanbanSpecialist, {
    autoProviderId: getKanbanAutoProvider(workspace?.metadata, board.id),
  }).specialistId;
}

/**
 * The role a manual rerun starts: the lane step that still has to run
 * (resolveLaneResumeStep), else the card's effective automation.
 */
export async function resolveRerunSpecialistId(stores: HoldStores, task: Task): Promise<string | undefined> {
  const board = task.boardId ? await stores.kanbanBoardStore.get(task.boardId) : undefined;
  if (!board) return undefined;
  const workspace = await stores.workspaceStore.get(task.workspaceId);
  const effective = resolveEffectiveTaskAutomation(task, board.columns, resolveKanbanSpecialist, {
    autoProviderId: getKanbanAutoProvider(workspace?.metadata, board.id),
  });
  if (effective.source === "lane") {
    const resume = resolveLaneResumeStep(task, board.columns);
    if (resume?.step.specialistId) return resume.step.specialistId;
  }
  return effective.specialistId;
}

/**
 * Write why a role hold stopped a start into the card's lastSyncError. Re-reads
 * the card and changes only that field, so a concurrent write is kept. Never
 * throws: a failed write is logged and the start stays a hold, not a failure.
 */
export async function recordRoleHold(
  taskStore: Pick<RoutaSystem["taskStore"], "get" | "save">,
  cardId: string,
  specialistId: string,
): Promise<void> {
  try {
    const fresh = await taskStore.get(cardId);
    const text = formatRoleHoldSyncError(specialistId);
    if (!fresh || fresh.lastSyncError === text) return;
    await taskStore.save({ ...fresh, lastSyncError: text });
  } catch (error) {
    console.warn(`[KanbanHold] card ${cardId}: could not record hold:${specialistId}:`, error);
  }
}
