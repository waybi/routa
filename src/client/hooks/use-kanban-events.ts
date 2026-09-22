"use client";

import { useCallback, useEffect, useRef } from "react";
import { getDesktopApiBaseUrl } from "../utils/diagnostics";
import { resolveApiPath } from "../config/backend";

const FITNESS_INVALIDATE_THROTTLE_MS = 750;
/**
 * A replay after reconnect can deliver dozens of kanban:changed frames in a
 * few ms. Each one used to trigger a full board refetch. Frames arriving
 * within this window collapse into a single onInvalidate.
 */
export const INVALIDATE_COALESCE_MS = 150;
/** On a fresh page load, ask the server for this much recent history. */
export const FRESH_LOAD_REPLAY_WINDOW_MS = 60 * 60 * 1000;

/** Mirrors KanbanTaskLifecycleEvent from the server broadcaster. */
export interface KanbanTaskLifecyclePayload {
  type: "kanban:task-lifecycle";
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  sessionId?: string;
  phase: "started" | "completed" | "failed" | "blocked" | "needs_review";
  columnId?: string;
  lastMessagePreview?: string;
  source?: "agent" | "user" | "system";
  timestamp?: string;
}

/** Mirrors KanbanSessionTailEvent from the server broadcaster. */
export interface KanbanSessionTailPayload {
  type: "kanban:session-tail";
  workspaceId: string;
  sessionId: string;
  tail: string;
  updateType?: string;
  timestamp?: string;
}

interface UseKanbanEventsOptions {
  workspaceId: string;
  onInvalidate: () => void;
  /**
   * On first connect, replay events from the last hour so the notification
   * bell can rebuild from server truth after a reload. Defaults to true.
   * Reconnects always resume from the last seen id regardless.
   */
  replayOnFreshLoad?: boolean;
  /** Called when an agent run attached to a card reaches a terminal phase. */
  onTaskLifecycle?: (event: KanbanTaskLifecyclePayload) => void;
  /**
   * Called when a live session's newest line changes. Replaces the 10 s
   * /tail poll; the server debounces so a token stream arrives as one update.
   */
  onSessionTail?: (event: KanbanSessionTailPayload) => void;
}

export function useKanbanEvents({
  workspaceId,
  onInvalidate,
  onTaskLifecycle,
  onSessionTail,
  replayOnFreshLoad = true,
}: UseKanbanEventsOptions): void {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitnessInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFitnessInvalidateAtRef = useRef(0);
  const tearingDownRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);
  const onInvalidateRef = useRef(onInvalidate);
  const onTaskLifecycleRef = useRef(onTaskLifecycle);
  const onSessionTailRef = useRef(onSessionTail);
  const connectSseRef = useRef<() => void>(() => {});
  // Last `id:` we saw. Native EventSource reconnects send it as
  // Last-Event-ID automatically; our manual reconnect (after onerror) opens
  // a fresh EventSource, which does not, so we pass it as a query param.
  const lastEventIdRef = useRef<string | null>(null);
  const invalidateCoalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleInvalidate = useCallback(() => {
    if (invalidateCoalesceTimerRef.current) return;
    invalidateCoalesceTimerRef.current = setTimeout(() => {
      invalidateCoalesceTimerRef.current = null;
      onInvalidateRef.current();
    }, INVALIDATE_COALESCE_MS);
  }, []);

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    onTaskLifecycleRef.current = onTaskLifecycle;
  }, [onTaskLifecycle]);

  useEffect(() => {
    onSessionTailRef.current = onSessionTail;
  }, [onSessionTail]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const base = getDesktopApiBaseUrl();
    const params = new URLSearchParams({ workspaceId });
    if (lastEventIdRef.current) {
      // Manual reconnect: resume where we left off.
      params.set("lastEventId", lastEventIdRef.current);
    } else if (replayOnFreshLoad && !hasConnectedOnceRef.current) {
      // Fresh load: pull the last hour so the bell has something to show.
      params.set("since", String(Date.now() - FRESH_LOAD_REPLAY_WINDOW_MS));
    }
    const es = new EventSource(resolveApiPath(`api/kanban/events?${params.toString()}`, base));
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      if (event.lastEventId) lastEventIdRef.current = event.lastEventId;
      try {
        const data = JSON.parse(event.data) as { type?: string };
        if (data.type === "connected") {
          if (hasConnectedOnceRef.current) {
            scheduleInvalidate();
          } else {
            hasConnectedOnceRef.current = true;
          }
          return;
        }
        if (data.type === "kanban:changed") {
          scheduleInvalidate();
          return;
        }
        if (data.type === "kanban:task-lifecycle") {
          const lifecycle = data as unknown as KanbanTaskLifecyclePayload;
          onTaskLifecycleRef.current?.(lifecycle);
          // A terminal phase also changed the card, so keep the board fresh.
          scheduleInvalidate();
          return;
        }
        if (data.type === "kanban:session-tail") {
          // Caption-only: no card data changed, so no invalidate.
          onSessionTailRef.current?.(data as unknown as KanbanSessionTailPayload);
          return;
        }
        if (data.type === "fitness:changed") {
          const now = Date.now();
          const elapsed = now - lastFitnessInvalidateAtRef.current;
          if (elapsed >= FITNESS_INVALIDATE_THROTTLE_MS) {
            lastFitnessInvalidateAtRef.current = now;
            onInvalidateRef.current();
            return;
          }
          if (fitnessInvalidateTimerRef.current) {
            return;
          }
          fitnessInvalidateTimerRef.current = setTimeout(() => {
            fitnessInvalidateTimerRef.current = null;
            lastFitnessInvalidateAtRef.current = Date.now();
            onInvalidateRef.current();
          }, FITNESS_INVALIDATE_THROTTLE_MS - elapsed);
        }
      } catch {
        // Ignore malformed payloads.
      }
    };

    es.onerror = () => {
      if (tearingDownRef.current || document.visibilityState === "hidden") {
        es.close();
        eventSourceRef.current = null;
        return;
      }
      es.close();
      eventSourceRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => connectSseRef.current(), 3000);
    };
  }, [workspaceId, replayOnFreshLoad, scheduleInvalidate]);

  useEffect(() => {
    connectSseRef.current = connectSSE;
  }, [connectSSE]);

  useEffect(() => {
    if (workspaceId === "__placeholder__") return;

    tearingDownRef.current = false;
    hasConnectedOnceRef.current = false;
    lastFitnessInvalidateAtRef.current = 0;
    lastEventIdRef.current = null;
    connectSSE();

    return () => {
      tearingDownRef.current = true;
      hasConnectedOnceRef.current = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (fitnessInvalidateTimerRef.current) {
        clearTimeout(fitnessInvalidateTimerRef.current);
        fitnessInvalidateTimerRef.current = null;
      }
      if (invalidateCoalesceTimerRef.current) {
        clearTimeout(invalidateCoalesceTimerRef.current);
        invalidateCoalesceTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connectSSE, workspaceId]);
}
