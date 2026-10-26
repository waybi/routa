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
