"use client";

import { useCallback, useEffect, useRef } from "react";
import { getDesktopApiBaseUrl } from "../utils/diagnostics";
import { resolveApiPath } from "../config/backend";

const FITNESS_INVALIDATE_THROTTLE_MS = 750;

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

interface UseKanbanEventsOptions {
  workspaceId: string;
  onInvalidate: () => void;
  /** Called when an agent run attached to a card reaches a terminal phase. */
  onTaskLifecycle?: (event: KanbanTaskLifecyclePayload) => void;
}

export function useKanbanEvents({
  workspaceId,
  onInvalidate,
  onTaskLifecycle,
}: UseKanbanEventsOptions): void {
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitnessInvalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFitnessInvalidateAtRef = useRef(0);
  const tearingDownRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);
  const onInvalidateRef = useRef(onInvalidate);
  const onTaskLifecycleRef = useRef(onTaskLifecycle);
  const connectSseRef = useRef<() => void>(() => {});

  useEffect(() => {
    onInvalidateRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    onTaskLifecycleRef.current = onTaskLifecycle;
  }, [onTaskLifecycle]);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const base = getDesktopApiBaseUrl();
    const es = new EventSource(
      resolveApiPath(`api/kanban/events?workspaceId=${encodeURIComponent(workspaceId)}`, base),
    );
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type?: string };
        if (data.type === "connected") {
          if (hasConnectedOnceRef.current) {
            onInvalidateRef.current();
          } else {
            hasConnectedOnceRef.current = true;
          }
          return;
        }
        if (data.type === "kanban:changed") {
          onInvalidateRef.current();
          return;
        }
        if (data.type === "kanban:task-lifecycle") {
          const lifecycle = data as unknown as KanbanTaskLifecyclePayload;
          onTaskLifecycleRef.current?.(lifecycle);
          // A terminal phase also changed the card, so keep the board fresh.
          onInvalidateRef.current();
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
  }, [workspaceId]);

  useEffect(() => {
    connectSseRef.current = connectSSE;
  }, [connectSSE]);

  useEffect(() => {
    if (workspaceId === "__placeholder__") return;

    tearingDownRef.current = false;
    hasConnectedOnceRef.current = false;
    lastFitnessInvalidateAtRef.current = 0;
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
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [connectSSE, workspaceId]);
}
