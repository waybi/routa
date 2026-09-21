/**
 * List-view projection for `GET /api/tasks`.
 *
 * The list endpoint used to return every field the detail panel needs. On a
 * real board (8 cards) that was 3.3 MB, of which the columns render almost
 * nothing: `laneSessions` carried a full per-run `objective` copy, and
 * `jitContextSnapshot` / `comments` / `comment` are detail-only. Every
 * `kanban:changed` SSE event refetched the whole thing, so the browser spent
 * its main thread parsing JSON instead of answering clicks.
 *
 * This module defines what the board actually needs. Callers that want the
 * full record ask for it explicitly (`?view=full`, or `GET /api/tasks/:id`).
 */

/** Detail-only fields removed from the list projection. */
const LIST_OMITTED_FIELDS = [
  "comment",
  "comments",
  "jitContextSnapshot",
  "verificationReport",
  "contextSearchSpec",
] as const;

/**
 * Lane-session fields the board columns keep.
 *
 * A card can accumulate a dozen runs, so every field here is paid for per
 * run per card. The columns need exactly two things: which session belongs
 * to the card (`sessionId`, plus `columnId` for lane chips) and whether it is
 * working right now (`status` / `startedAt` / `lastActivityAt` / `completedAt`,
 * consumed by resolveCardRunStatus).
 *
 * Everything else — `cwd`, `objective`, specialist/step labels, worktree and
 * transport identifiers — is rendered by the detail panel and the activity
 * bar, both of which read the hydrated task. `objective` alone was 1.4 MB of
 * the original 3.3 MB.
 */
const LIST_LANE_SESSION_FIELDS = [
  "sessionId",
  "columnId",
  "status",
  "startedAt",
  "completedAt",
  "lastActivityAt",
] as const;

/**
 * Objective budget for the list projection.
 *
 * Cards render `problem_statement` + `user_value` parsed out of the canonical
 * story, then clamp the result to two lines. Canonical stories run 3–14 KB
 * each, so the full text is pure transfer cost in a column. The detail panel
 * hydrates the untruncated value.
 */
export const LIST_OBJECTIVE_MAX_CHARS = 1200;

export type TaskListView = "summary" | "full";

export function parseTaskListView(raw: string | null): TaskListView {
  return raw === "full" ? "full" : "summary";
}

function truncateObjective(objective: unknown): unknown {
  if (typeof objective !== "string") return objective;
  if (objective.length <= LIST_OBJECTIVE_MAX_CHARS) return objective;
  return `${objective.slice(0, LIST_OBJECTIVE_MAX_CHARS)}\n…`;
}

function projectLaneSession(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return entry;
  const source = entry as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const field of LIST_LANE_SESSION_FIELDS) {
    if (source[field] !== undefined) {
      projected[field] = source[field];
    }
  }
  return projected;
}

/**
 * Strips detail-only fields from one serialized task.
 *
 * `objectiveTruncated` tells the client the value is clipped, so a consumer
 * that needs the whole story knows to fetch the task by id rather than
 * silently rendering a partial one.
 */
export function projectTaskForList<T extends Record<string, unknown>>(task: T): Record<string, unknown> {
  const projected: Record<string, unknown> = { ...task };

  for (const field of LIST_OMITTED_FIELDS) {
    delete projected[field];
  }

  if (Array.isArray(projected.laneSessions)) {
    projected.laneSessions = projected.laneSessions.map(projectLaneSession);
  }

  const originalObjective = task.objective;
  if (typeof originalObjective === "string" && originalObjective.length > LIST_OBJECTIVE_MAX_CHARS) {
    projected.objective = truncateObjective(originalObjective);
    projected.objectiveTruncated = true;
  }

  return projected;
}

export function projectTasksForList<T extends Record<string, unknown>>(
  tasks: T[],
  view: TaskListView,
): Array<Record<string, unknown>> {
  if (view === "full") return tasks;
  return tasks.map(projectTaskForList);
}
