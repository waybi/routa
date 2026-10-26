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
/**
 * `kanban:changed` with `entity: "task"` only refetches tasks. Frames are
 * debounced: one refetch 400 ms after the last frame. While frames keep coming
 * (an agent writing a card in a loop), a refetch still fires at most 1500 ms
 * after the first unhandled frame, so the board never starves.
 */
export const TASK_INVALIDATE_DEBOUNCE_MS = 400;
export const TASK_INVALIDATE_MAX_WAIT_MS = 1500;
/** On a fresh page load, ask the server for this much recent history. */
export const FRESH_LOAD_REPLAY_WINDOW_MS = 60 * 60 * 1000;
/**
 * Reconnect backoff after an error: 3 s, doubling, capped at 60 s; reset on
 * open. No jitter on purpose: one browser tab talks to one local server, so
 * there is no herd to spread out.
 */
export const RECONNECT_BASE_MS = 3000;
export const RECONNECT_MAX_MS = 60_000;
/**
 * The server writes a `ping` event every 25 s. If nothing at all arrives for
 * this long, the connection died silently (sleep, proxy idle timeout) without
 * an onerror; close it and reconnect. Must stay above twice the ping interval.
 */
export const SSE_WATCHDOG_MS = 60_000;

/** EventSource.CLOSED; literal so test doubles without the static still work. */
const EVENT_SOURCE_CLOSED = 2;

/** Delay before reconnect attempt `attempt` (0-based). */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
}

/** Mirrors KanbanTaskLifecycleEvent from the server broadcaster. */
export interface KanbanTaskLifecyclePayload {
  type: "kanban:task-lifecycle";
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  sessionId?: string;
  phase: "started" | "completed" | "failed" | "blocked" | "rejected" | "needs_review";
  columnId?: string;
  boardId?: string;
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

/** Mirrors KanbanSessionActivityEvent from the server broadcaster. */
export interface KanbanSessionActivityPayload {
  type: "kanban:session-activity";
  workspaceId: string;
  sessionId: string;
  acpStatus?: "connecting" | "ready" | "error";
  acpError?: string;
  lastActivityAt?: string;
  lastEventType?: string;
  lastToolName?: string;
  lastToolStatus?: string;
  terminalState?: "completed" | "failed" | "timed_out";
  terminalReason?: string;
  timestamp?: string;
}

interface UseKanbanEventsOptions {
  workspaceId: string;
  onInvalidate: () => void;
  /**
   * Called for `kanban:changed` frames with `entity: "task"` (debounced, see
   * TASK_INVALIDATE_DEBOUNCE_MS). Should refetch tasks only. Receives the
   * `resourceId`s of the coalesced frames. When omitted, task frames fall back
   * to `onInvalidate`.
   */
  onTasksInvalidate?: (taskIds: string[]) => void;
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
  /**
   * Called on a live session's heartbeat (process status + last activity),
   * so cards can tell working from quiet from errored without a refetch.
   */
  onSessionActivity?: (event: KanbanSessionActivityPayload) => void;
}

export function useKanbanEvents({
  workspaceId,
  onInvalidate,
  onTasksInvalidate,
  onTaskLifecycle,
  onSessionTail,
  onSessionActivity,
  replayOnFreshLoad = true,
}: UseKanbanEventsOptions): void {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitnessInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFitnessInvalidateAtRef = useRef(0);
  const tearingDownRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);
  const onInvalidateRef = useRef(onInvalidate);
  const onTasksInvalidateRef = useRef(onTasksInvalidate);
  const onTaskLifecycleRef = useRef(onTaskLifecycle);
  const onSessionTailRef = useRef(onSessionTail);
  const onSessionActivityRef = useRef(onSessionActivity);
  const connectSseRef = useRef<() => void>(() => {});
  // Last `id:` we saw. Native EventSource reconnects send it as
  // Last-Event-ID automatically; our manual reconnect (after onerror) opens
  // a fresh EventSource, which does not, so we pass it as a query param.
  const lastEventIdRef = useRef<string | null>(null);
  const invalidateCoalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tasksInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the oldest task frame not yet refetched arrived; null when none is pending.
  const tasksFirstPendingAtRef = useRef<number | null>(null);
  const tasksPendingIdsRef = useRef<Set<string>>(new Set());

  const cancelTasksInvalidate = useCallback(() => {
    if (tasksInvalidateTimerRef.current) {
      clearTimeout(tasksInvalidateTimerRef.current);
      tasksInvalidateTimerRef.current = null;
    }
    tasksFirstPendingAtRef.current = null;
    tasksPendingIdsRef.current = new Set();
  }, []);

  const scheduleInvalidate = useCallback(() => {
    if (invalidateCoalesceTimerRef.current) return;
    invalidateCoalesceTimerRef.current = setTimeout(() => {
      invalidateCoalesceTimerRef.current = null;
      // A full refresh refetches tasks too; drop any pending tasks-only refetch.
      cancelTasksInvalidate();
      onInvalidateRef.current();
    }, INVALIDATE_COALESCE_MS);
  }, [cancelTasksInvalidate]);

  const scheduleTasksInvalidate = useCallback((taskId?: string) => {
    // A full refresh is already queued and will include tasks.
    if (invalidateCoalesceTimerRef.current) return;
    if (taskId) tasksPendingIdsRef.current.add(taskId);
    const now = Date.now();
    if (tasksFirstPendingAtRef.current === null) tasksFirstPendingAtRef.current = now;
    const remainingMaxWait = TASK_INVALIDATE_MAX_WAIT_MS - (now - tasksFirstPendingAtRef.current);
    const delay = Math.max(0, Math.min(TASK_INVALIDATE_DEBOUNCE_MS, remainingMaxWait));
    if (tasksInvalidateTimerRef.current) clearTimeout(tasksInvalidateTimerRef.current);
    tasksInvalidateTimerRef.current = setTimeout(() => {
      tasksInvalidateTimerRef.current = null;
      tasksFirstPendingAtRef.current = null;
      const taskIds = [...tasksPendingIdsRef.current];
      tasksPendingIdsRef.current = new Set();
      onTasksInvalidateRef.current?.(taskIds);
    }, delay);
  }, []);

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    onTasksInvalidateRef.current = onTasksInvalidate;
  }, [onTasksInvalidate]);

  useEffect(() => {
    onTaskLifecycleRef.current = onTaskLifecycle;
  }, [onTaskLifecycle]);

  useEffect(() => {
    onSessionTailRef.current = onSessionTail;
  }, [onSessionTail]);

  useEffect(() => {
    onSessionActivityRef.current = onSessionActivity;
  }, [onSessionActivity]);

  const clearWatchdog = useCallback(() => {
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (tearingDownRef.current) return;
    clearReconnectTimer();
    clearWatchdog();
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

    // Every callback first checks it still belongs to the current connection:
    // a late callback from a replaced connection must not touch the new one.
    const isCurrent = () => eventSourceRef.current === es && !tearingDownRef.current;

    const armWatchdog = () => {
      if (!isCurrent()) return;
      clearWatchdog();
      watchdogTimerRef.current = setTimeout(() => {
        watchdogTimerRef.current = null;
        if (!isCurrent()) return;
        // Silent death: no error, no data. Reconnect now, not via backoff.
        es.close();
        eventSourceRef.current = null;
        connectSseRef.current();
      }, SSE_WATCHDOG_MS);
    };
    armWatchdog();

    es.onopen = () => {
      if (!isCurrent()) return;
      reconnectAttemptRef.current = 0;
      armWatchdog();
    };

    // Server keep-alive (named event, never reaches onmessage). Optional
    // call: minimal EventSource test doubles do not implement listeners.
    es.addEventListener?.("ping", armWatchdog);

    es.onmessage = (event) => {
      armWatchdog();
      if (event.lastEventId) lastEventIdRef.current = event.lastEventId;
      try {
        const data = JSON.parse(event.data) as { type?: string; entity?: string; resourceId?: string };
        if (data.type === "connected") {
          if (hasConnectedOnceRef.current) {
            scheduleInvalidate();
          } else {
            hasConnectedOnceRef.current = true;
          }
          return;
        }
        if (data.type === "kanban:changed") {
          if (data.entity === "task" && onTasksInvalidateRef.current) {
            scheduleTasksInvalidate(typeof data.resourceId === "string" ? data.resourceId : undefined);
          } else {
            scheduleInvalidate();
          }
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
        if (data.type === "kanban:session-activity") {
          // Heartbeat only: patches the session in place, no board refetch.
          onSessionActivityRef.current?.(data as unknown as KanbanSessionActivityPayload);
          return;
        }
        if (data.type === "fitness:changed") {
          const now = Date.now();
          const elapsed = now - lastFitnessInvalidateAtRef.current;
          if (elapsed >= FITNESS_INVALIDATE_THROTTLE_MS) {
            lastFitnessInvalidateAtRef.current = now;
            cancelTasksInvalidate();
            onInvalidateRef.current();
            return;
          }
          if (fitnessInvalidateTimerRef.current) {
            return;
          }
          fitnessInvalidateTimerRef.current = setTimeout(() => {
            fitnessInvalidateTimerRef.current = null;
            lastFitnessInvalidateAtRef.current = Date.now();
            cancelTasksInvalidate();
            onInvalidateRef.current();
          }, FITNESS_INVALIDATE_THROTTLE_MS - elapsed);
        }
      } catch {
        // Ignore malformed payloads.
      }
    };

    es.onerror = () => {
      es.close();
      if (!isCurrent()) return;
      eventSourceRef.current = null;
      clearWatchdog();
      // Keep retrying while hidden too; the browser throttles timers, and
      // visibilitychange reconnects at once when the tab comes back.
      const delay = reconnectDelayMs(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connectSseRef.current();
      }, delay);
    };
  }, [
    workspaceId,
    replayOnFreshLoad,
    scheduleInvalidate,
    scheduleTasksInvalidate,
    cancelTasksInvalidate,
    clearWatchdog,
    clearReconnectTimer,
  ]);

  useEffect(() => {
    connectSseRef.current = connectSSE;
  }, [connectSSE]);

  useEffect(() => {
    if (workspaceId === "__placeholder__") return;

    tearingDownRef.current = false;
    hasConnectedOnceRef.current = false;
    lastFitnessInvalidateAtRef.current = 0;
    lastEventIdRef.current = null;
    reconnectAttemptRef.current = 0;
    connectSSE();

    // Back in front: if the connection is gone, reconnect now instead of
    // waiting out the backoff. A live connection is left alone.
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || tearingDownRef.current) return;
      const current = eventSourceRef.current;
      if (current && current.readyState !== EVENT_SOURCE_CLOSED) return;
      connectSseRef.current();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      tearingDownRef.current = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearWatchdog();
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
      cancelTasksInvalidate();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connectSSE, workspaceId, cancelTasksInvalidate, clearWatchdog]);
}
