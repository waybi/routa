/**
 * Session live-tail extraction.
 *
 * The board shows one line per running card ("what is the agent saying right
 * now"). It used to get that by polling
 * `GET /api/sessions/:id/history?consolidated=true` every 10 s — a 1 MB,
 * ~3 s response (515 events on a real session) from which the client kept the
 * last line and discarded the rest.
 *
 * This module is the shared extraction used by the dedicated `/tail`
 * endpoint, so the same rule decides "last meaningful message" on the server
 * and in tests.
 */

/** Keeps the tail a caption, not a transcript. */
export const SESSION_TAIL_MAX_CHARS = 240;

const TAIL_UPDATE_TYPES = new Set(["agent_message", "agent_message_chunk", "user_message"]);

export interface SessionTail {
  text: string;
  /** Which update produced the tail, useful for debugging a stuck caption. */
  updateType: string;
}

function extractText(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (!content || typeof content !== "object") return null;

  const record = content as Record<string, unknown>;
  if (typeof record.text === "string" && record.text.trim()) return record.text.trim();

  if (Array.isArray(record.content)) {
    const parts = record.content
      .map((item) => (
        typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text
          : ""
      ))
      .filter(Boolean);
    if (parts.length > 0) return parts.join("").trim() || null;
  }

  return null;
}

export function truncateSessionTail(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= SESSION_TAIL_MAX_CHARS) return normalized;
  return `${normalized.slice(0, SESSION_TAIL_MAX_CHARS - 1)}…`;
}

/**
 * Walks the history backwards and returns the newest message-shaped entry.
 * Tool calls and status updates are skipped: they are noise in a one-line
 * caption.
 */
export function extractSessionTail(history: unknown): SessionTail | null {
  if (!Array.isArray(history) || history.length === 0) return null;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry || typeof entry !== "object") continue;

    const update = (entry as { update?: unknown }).update;
    if (!update || typeof update !== "object") continue;

    const updateRecord = update as Record<string, unknown>;
    const updateType = updateRecord.sessionUpdate;
    if (typeof updateType !== "string" || !TAIL_UPDATE_TYPES.has(updateType)) continue;

    const text = extractText(updateRecord.content);
    if (text) {
      return { text: truncateSessionTail(text), updateType };
    }
  }

  return null;
}
