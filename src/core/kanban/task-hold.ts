/**
 * Card label "hold" (暂不派, card beb29624): a card that carries it stays on
 * the board as a tracking item and Routa never starts an agent session for
 * it, in any column and on any trigger path. Removing the label and clicking
 * Rerun starts the lane again.
 *
 * Pure and client-safe: the kanban card imports it for its badge. Every gate
 * must call isTaskOnHold instead of testing the labels by hand.
 */

export const HOLD_LABEL = "hold";

/** Error of a session start that was skipped because the card is on hold. Not a failure. */
export const ON_HOLD_ERROR = "on_hold";

/** Shown when a rerun or a PR run is asked for a card on hold. */
export const ON_HOLD_RETRY_MESSAGE = "卡片带 hold 标签（暂不派），去掉标签后再重跑";

/** Whether a label array holds the whole word "hold" (case-insensitive, trimmed). */
export function isTaskOnHold(task: { labels?: readonly unknown[] | null } | null | undefined): boolean {
  const labels = task?.labels;
  if (!Array.isArray(labels)) return false;
  return labels.some((label) => typeof label === "string" && label.trim().toLowerCase() === HOLD_LABEL);
}
