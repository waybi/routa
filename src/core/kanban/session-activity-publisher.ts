/**
 * Throttled publisher for `kanban:session-activity`.
 *
 * The card only needs to know *when* the agent last did something; it ages
 * that timestamp locally. So a session that streams a tool call every second
 * does not need a frame every second:
 *
 * - THROTTLE 10 s: at most one routine heartbeat per session per 10 s. The
 *   card's thresholds are measured in minutes (quiet ≥ 3 min = "may be
 *   stuck"), so 10 s of staleness is invisible.
 * - URGENT frames (process status change, error, turn end, terminal state)
 *   go out immediately — those are exactly the moments the badge must flip.
 * - TRAILING: a routine update suppressed by the throttle is not dropped; the
 *   newest snapshot goes out when the window closes, so the last activity
 *   time on the card is never older than the window.
 */

import type { KanbanEventBroadcaster } from "./kanban-event-broadcaster";
import type { KanbanSessionActivityEvent } from "./kanban-event-types";

export const SESSION_ACTIVITY_THROTTLE_MS = 10_000;

export type SessionActivitySnapshot = Omit<KanbanSessionActivityEvent, "type" | "timestamp">;

interface SessionState {
  lastPublishedAt: number;
  pending: SessionActivitySnapshot | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface SessionActivityPublisherOptions {
  throttleMs?: number;
  /** Injected for deterministic tests. */
  now?: () => number;
}

export class SessionActivityPublisher {
  private sessions = new Map<string, SessionState>();
  private readonly throttleMs: number;
  private readonly now: () => number;

  constructor(
    private readonly broadcaster: Pick<KanbanEventBroadcaster, "notifySessionActivity">,
    options: SessionActivityPublisherOptions = {},
  ) {
    this.throttleMs = options.throttleMs ?? SESSION_ACTIVITY_THROTTLE_MS;
    this.now = options.now ?? Date.now;
  }

  observe(snapshot: SessionActivitySnapshot, options: { urgent?: boolean } = {}): void {
    const state = this.sessions.get(snapshot.sessionId) ?? {
      lastPublishedAt: Number.NEGATIVE_INFINITY,
      pending: null,
      timer: null,
    };
    this.sessions.set(snapshot.sessionId, state);

    const elapsed = this.now() - state.lastPublishedAt;
    if (options.urgent || elapsed >= this.throttleMs) {
      this.publish(state, snapshot);
      return;
    }

    state.pending = snapshot;
    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = null;
        const pending = state.pending;
        if (pending) this.publish(state, pending);
      }, this.throttleMs - elapsed);
    }
  }

  forget(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state?.timer) clearTimeout(state.timer);
    this.sessions.delete(sessionId);
  }

  private publish(state: SessionState, snapshot: SessionActivitySnapshot): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.pending = null;
    state.lastPublishedAt = this.now();
    try {
      this.broadcaster.notifySessionActivity(snapshot);
    } catch {
      // A heartbeat must never break the notification pipeline.
    }
  }
}
