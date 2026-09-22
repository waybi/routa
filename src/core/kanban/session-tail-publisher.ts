/**
 * Debounced publisher for `kanban:session-tail`.
 *
 * Why the debounce exists, and why these numbers:
 *
 * Providers differ in how they deliver text. dsh emits `agent_message_chunk`
 * per paragraph — measured across 291 sessions / 2746 gaps in routa.db, the
 * median gap between chunks is 13.7 s and 0% fall under 750 ms. The Claude
 * SDK adapter (`claude-code-sdk-adapter.ts`, `text_delta` →
 * `agent_message_chunk`) streams per token. Pushing every chunk would be fine
 * for dsh and would flood the board for Claude.
 *
 * - TRAILING 300 ms: longer than a typical inter-token gap so a streaming
 *   sentence coalesces; short enough that a paragraph-at-a-time provider
 *   only pays 300 ms of latency instead of the 750 ms first proposed.
 * - MAX WAIT 1000 ms: a continuously streaming provider still refreshes the
 *   caption once a second rather than going dark until it stops.
 *
 * One timer pair per session; sessions are independent.
 */

import type { KanbanEventBroadcaster } from "./kanban-event-broadcaster";
import { extractSessionTail, type SessionTail } from "../session-tail";

export const SESSION_TAIL_DEBOUNCE_MS = 300;
export const SESSION_TAIL_MAX_WAIT_MS = 1000;

const TAIL_UPDATE_TYPES = new Set(["agent_message", "agent_message_chunk", "user_message"]);

interface PendingTail {
  workspaceId: string;
  /** Accumulated text since the last flush; chunks concatenate. */
  buffer: string;
  updateType: string;
  trailingTimer: ReturnType<typeof setTimeout> | null;
  maxWaitTimer: ReturnType<typeof setTimeout> | null;
}

export interface SessionTailPublisherOptions {
  debounceMs?: number;
  maxWaitMs?: number;
  /** Injected for deterministic tests. */
  now?: () => number;
}

export class SessionTailPublisher {
  private pending = new Map<string, PendingTail>();
  private lastPublished = new Map<string, string>();
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;

  constructor(
    private readonly broadcaster: KanbanEventBroadcaster,
    options: SessionTailPublisherOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? SESSION_TAIL_DEBOUNCE_MS;
    this.maxWaitMs = options.maxWaitMs ?? SESSION_TAIL_MAX_WAIT_MS;
  }

  /**
   * Feed one raw session notification. Non-message updates are ignored so
   * tool-call noise never resets the debounce window.
   */
  observe(sessionId: string, workspaceId: string, notification: unknown): void {
    const raw = extractRawTailText(notification);
    if (!raw) return;

    const existing = this.pending.get(sessionId);
    if (existing) {
      // Streaming chunks of one message concatenate byte-for-byte (a token's
      // leading space is significant); a whole message replaces.
      existing.buffer = raw.updateType === "agent_message_chunk"
        ? existing.buffer + raw.text
        : raw.text;
      existing.updateType = raw.updateType;
      this.armTrailing(sessionId, existing);
      return;
    }

    const entry: PendingTail = {
      workspaceId,
      buffer: raw.text,
      updateType: raw.updateType,
      trailingTimer: null,
      maxWaitTimer: null,
    };
    this.pending.set(sessionId, entry);
    this.armTrailing(sessionId, entry);
    this.armMaxWait(sessionId, entry);
  }

  /** Drops any pending state for a session (on session close / cleanup). */
  forget(sessionId: string): void {
    const entry = this.pending.get(sessionId);
    if (entry) {
      if (entry.trailingTimer) clearTimeout(entry.trailingTimer);
      if (entry.maxWaitTimer) clearTimeout(entry.maxWaitTimer);
      this.pending.delete(sessionId);
    }
    this.lastPublished.delete(sessionId);
  }

  /** Test/diagnostic hook: what would be published right now. */
  peek(sessionId: string): SessionTail | null {
    const entry = this.pending.get(sessionId);
    return entry ? { text: entry.buffer, updateType: entry.updateType } : null;
  }

  private armTrailing(sessionId: string, entry: PendingTail): void {
    if (entry.trailingTimer) clearTimeout(entry.trailingTimer);
    entry.trailingTimer = setTimeout(() => this.flush(sessionId, "trailing"), this.debounceMs);
  }

  private armMaxWait(sessionId: string, entry: PendingTail): void {
    if (entry.maxWaitTimer) clearTimeout(entry.maxWaitTimer);
    entry.maxWaitTimer = setTimeout(() => this.flush(sessionId, "max-wait"), this.maxWaitMs);
  }

  /**
   * `trailing`: the stream paused, so this message is done — publish and
   * clear. `max-wait`: the stream is still going — publish what we have so
   * far but keep the buffer so later tokens append to it, and re-arm so the
   * caption keeps refreshing at most once per max-wait.
   */
  private flush(sessionId: string, reason: "trailing" | "max-wait"): void {
    const entry = this.pending.get(sessionId);
    if (!entry) return;

    if (reason === "trailing") {
      if (entry.trailingTimer) clearTimeout(entry.trailingTimer);
      if (entry.maxWaitTimer) clearTimeout(entry.maxWaitTimer);
      this.pending.delete(sessionId);
    } else {
      this.armMaxWait(sessionId, entry);
    }

    // Normalize through the shared extractor so the published text obeys the
    // same whitespace collapse and 240-char cap as the /tail endpoint.
    const normalized = extractSessionTail([{
      update: { sessionUpdate: entry.updateType, content: { type: "text", text: entry.buffer } },
    }]);
    if (!normalized) return;

    // Suppress no-op republishes (a max-wait flush followed by a trailing
    // flush of an unchanged buffer).
    if (this.lastPublished.get(sessionId) === normalized.text) return;
    this.lastPublished.set(sessionId, normalized.text);

    this.broadcaster.notifySessionTail({
      workspaceId: entry.workspaceId,
      sessionId,
      tail: normalized.text,
      updateType: normalized.updateType,
    });
  }
}

/**
 * Pulls the text out of a message-shaped notification *without* trimming.
 * The shared extractor trims for display; here trimming would eat the
 * leading space on a streamed token and glue words together.
 */
function extractRawTailText(notification: unknown): { text: string; updateType: string } | null {
  const update = (notification as { update?: Record<string, unknown> } | null)?.update;
  if (!update || typeof update !== "object") return null;

  const updateType = update.sessionUpdate;
  if (typeof updateType !== "string" || !TAIL_UPDATE_TYPES.has(updateType)) return null;

  const content = update.content;
  if (typeof content === "string") return content ? { text: content, updateType } : null;
  if (!content || typeof content !== "object") return null;

  const record = content as Record<string, unknown>;
  if (typeof record.text === "string") return record.text ? { text: record.text, updateType } : null;

  if (Array.isArray(record.content)) {
    const joined = record.content
      .map((item) => (
        typeof item === "object" && item !== null && typeof (item as { text?: unknown }).text === "string"
          ? (item as { text: string }).text
          : ""
      ))
      .join("");
    return joined ? { text: joined, updateType } : null;
  }

  return null;
}

export function isTailBearingUpdate(notification: unknown): boolean {
  const update = (notification as { update?: { sessionUpdate?: unknown } } | null)?.update;
  return typeof update?.sessionUpdate === "string" && TAIL_UPDATE_TYPES.has(update.sessionUpdate);
}
