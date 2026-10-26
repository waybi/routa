/**
 * The Blocked resolver's conclusion about a card that needed attention
 * (card 64f2e31c). Written through PATCH /api/tasks/{id}; read by the
 * attention rules (resolved cards leave "Needs you"), the Done gate
 * (landed / superseded cards may enter Done without own commits) and the
 * inbox's "Handled by AI" section.
 */

export const TASK_ATTENTION_RESOLUTION_CATEGORIES = [
  "landed",
  "superseded",
  "handed_off",
  "waiting",
  "needs_owner",
] as const;

export type TaskAttentionResolutionCategory = typeof TASK_ATTENTION_RESOLUTION_CATEGORIES[number];

export interface TaskAttentionResolution {
  category: TaskAttentionResolutionCategory;
  /** One-sentence conclusion shown in the inbox. */
  conclusion: string;
  /** Related commit sha or card id (landed / superseded / handed_off / waiting). */
  ref?: string;
  /** ISO time the resolver concluded. */
  resolvedAt: string;
  /** Resolver session id. */
  sessionId?: string;
}

/** Categories that take a card out of "Needs you" (needs_owner stays). */
export const RESOLVED_ATTENTION_CATEGORIES: ReadonlySet<string> = new Set([
  "landed",
  "superseded",
  "handed_off",
  "waiting",
]);

/** Categories that let a card enter Done without commits of its own. */
export const DONE_WITHOUT_OWN_COMMITS_CATEGORIES: ReadonlySet<string> = new Set(["landed", "superseded"]);

export function isAttentionResolved(resolution: { category?: string } | null | undefined): boolean {
  return Boolean(resolution?.category && RESOLVED_ATTENTION_CATEGORIES.has(resolution.category));
}

const BLOCKED_COLUMN_ID = "blocked";
const DONE_COLUMN_ID = "done";

export interface AttentionResolutionScope {
  columnId?: string;
  laneSessions?: ReadonlyArray<{ startedAt?: string }>;
}

function parseIsoMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A conclusion only holds while the card is where the resolver left it, so a
 * card that leaves Blocked and fails again is reported and routed again:
 * - landed / superseded: while the card is in Blocked or Done;
 * - handed_off / waiting: while the card is in Blocked;
 * - needs_owner: while the card is in Blocked, or until a lane run starts
 *   after the conclusion (the escalation leaves the card in its column).
 */
export function isAttentionResolutionInEffect(
  resolution: { category?: string; resolvedAt?: string } | null | undefined,
  card: AttentionResolutionScope,
): boolean {
  const category = resolution?.category;
  if (!category) return false;
  const column = card.columnId;
  if (DONE_WITHOUT_OWN_COMMITS_CATEGORIES.has(category)) {
    return column === BLOCKED_COLUMN_ID || column === DONE_COLUMN_ID;
  }
  if (category === "handed_off" || category === "waiting") return column === BLOCKED_COLUMN_ID;
  if (category === "needs_owner") {
    if (column === BLOCKED_COLUMN_ID) return true;
    const resolvedAt = parseIsoMs(resolution?.resolvedAt);
    return !(card.laneSessions ?? []).some((session) => parseIsoMs(session.startedAt) > resolvedAt);
  }
  return false;
}

/**
 * The conclusion a card keeps after a column move (both move entries call
 * this, high-risk review 2nd rejection): kept when the card goes to Blocked,
 * and landed / superseded kept from Blocked (or Done) into Done, where the
 * Done gate and the main pusher read it. Every other move clears it, so a
 * card that fails again after leaving Blocked is reported and routed again.
 */
export function attentionResolutionAfterMove<T extends { category?: string }>(
  resolution: T | null | undefined,
  fromColumnId: string | undefined,
  toColumnId: string | undefined,
): T | undefined {
  if (!resolution) return undefined;
  if (fromColumnId === toColumnId) return resolution;
  if (toColumnId === BLOCKED_COLUMN_ID) return resolution;
  if (
    toColumnId === DONE_COLUMN_ID
    && (fromColumnId === BLOCKED_COLUMN_ID || fromColumnId === DONE_COLUMN_ID)
    && DONE_WITHOUT_OWN_COMMITS_CATEGORIES.has(resolution.category ?? "")
  ) {
    return resolution;
  }
  return undefined;
}

/** Resolved (out of "Needs you") and still in effect for the card's current column. */
export function isAttentionResolvedInEffect(
  resolution: { category?: string; resolvedAt?: string } | null | undefined,
  card: AttentionResolutionScope,
): boolean {
  return isAttentionResolved(resolution) && isAttentionResolutionInEffect(resolution, card);
}

export type ParsedTaskAttentionResolution =
  | { ok: true; value: TaskAttentionResolution | null }
  | { ok: false; error: string };

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Validates a PATCH value; `null` clears the field. */
export function parseTaskAttentionResolution(value: unknown): ParsedTaskAttentionResolution {
  if (value === null) return { ok: true, value: null };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "attentionResolution must be an object or null" };
  }
  const source = value as Record<string, unknown>;
  const category = source.category;
  if (typeof category !== "string" || !(TASK_ATTENTION_RESOLUTION_CATEGORIES as readonly string[]).includes(category)) {
    return {
      ok: false,
      error: `Invalid attentionResolution.category: ${String(category)} (expected one of ${TASK_ATTENTION_RESOLUTION_CATEGORIES.join(", ")})`,
    };
  }
  const conclusion = optionalString(source.conclusion);
  if (!conclusion) return { ok: false, error: "attentionResolution.conclusion is required" };
  const resolvedAt = optionalString(source.resolvedAt);
  if (!resolvedAt || !Number.isFinite(Date.parse(resolvedAt))) {
    return { ok: false, error: "attentionResolution.resolvedAt must be an ISO time" };
  }
  const ref = optionalString(source.ref);
  const sessionId = optionalString(source.sessionId);
  return {
    ok: true,
    value: {
      category: category as TaskAttentionResolutionCategory,
      conclusion,
      resolvedAt,
      ...(ref ? { ref } : {}),
      ...(sessionId ? { sessionId } : {}),
    },
  };
}
