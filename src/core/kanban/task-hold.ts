/**
 * Card label "hold" (暂不派, card beb29624): a card that carries it stays on
 * the board as a tracking item and Routa never starts an agent session for
 * it, in any column and on any trigger path. Removing the label and clicking
 * Rerun starts the lane again.
 *
 * Card a00fb67b (L400): a label "hold:<specialistId>" holds only that role
 * (for example hold:kanban-main-pusher stops the Done pusher while Review
 * still runs). Several role labels may be set; "hold:" with no role holds
 * nothing.
 *
 * Pure and client-safe: the kanban card imports it for its badge. Every gate
 * must call getTaskHold / isTaskHeldFor instead of testing the labels by hand.
 */

export const HOLD_LABEL = "hold";
/** Prefix of a role hold label: "hold:<specialistId>". */
export const ROLE_HOLD_PREFIX = "hold:";

/**
 * Error of a session start that was skipped because the card is on hold
 * (whole card or the started role). Not a failure.
 */
export const ON_HOLD_ERROR = "on_hold";

/** Shown when a rerun or a PR run is asked for a card on hold. */
export const ON_HOLD_RETRY_MESSAGE = "卡片带 hold 标签（暂不派），去掉标签后再重跑";

/** Marker every role-hold lastSyncError contains. */
const ROLE_HOLD_SYNC_MARKER = " 拦下：";

export type TaskHold =
  | { held: false }
  | { held: true; scope: "card" }
  | { held: true; scope: "role"; specialistId: string };

type LabelledTask = { labels?: readonly unknown[] | null } | null | undefined;

function normalizedLabels(task: LabelledTask): string[] {
  const labels = task?.labels;
  if (!Array.isArray(labels)) return [];
  return labels
    .filter((label): label is string => typeof label === "string")
    .map((label) => label.trim().toLowerCase());
}

/** The roles named by the card's "hold:<role>" labels (trimmed, lower case, no duplicates). */
export function listHeldSpecialists(task: LabelledTask): string[] {
  const roles: string[] = [];
  for (const label of normalizedLabels(task)) {
    if (!label.startsWith(ROLE_HOLD_PREFIX)) continue;
    const role = label.slice(ROLE_HOLD_PREFIX.length).trim();
    if (role && !roles.includes(role)) roles.push(role);
  }
  return roles;
}

/**
 * Whether a session of `specialistId` may start on this card, and why not.
 * The whole-card "hold" stops every role (also an unknown one); a role hold
 * only stops the role it names. Without a specialistId only "hold" counts.
 */
export function getTaskHold(task: LabelledTask, specialistId?: string | null): TaskHold {
  if (normalizedLabels(task).includes(HOLD_LABEL)) return { held: true, scope: "card" };
  const role = specialistId?.trim().toLowerCase();
  if (!role) return { held: false };
  return listHeldSpecialists(task).includes(role)
    ? { held: true, scope: "role", specialistId: role }
    : { held: false };
}

export function isTaskHeldFor(task: LabelledTask, specialistId?: string | null): boolean {
  return getTaskHold(task, specialistId).held;
}

/** Whether the card carries the whole-card "hold" (role holds do not count). Badge only; gates use getTaskHold. */
export function isTaskOnHold(task: LabelledTask): boolean {
  return getTaskHold(task).held;
}

/** lastSyncError written when a role hold stopped a session start. */
export function formatRoleHoldSyncError(specialistId: string): string {
  return `hold:${specialistId}${ROLE_HOLD_SYNC_MARKER}Routa 不派这个岗位，其他岗位照常；去掉标签后点重跑`;
}

export function isRoleHoldSyncError(text: string | null | undefined): boolean {
  return typeof text === "string" && text.startsWith(ROLE_HOLD_PREFIX) && text.includes(ROLE_HOLD_SYNC_MARKER);
}

/** The 409 message of a rerun or PR run the hold stopped. */
export function formatHoldRetryMessage(hold: TaskHold): string {
  if (hold.held && hold.scope === "role") {
    return `卡片带 hold:${hold.specialistId} 标签（暂不派这个岗位），去掉标签后再重跑`;
  }
  return ON_HOLD_RETRY_MESSAGE;
}
