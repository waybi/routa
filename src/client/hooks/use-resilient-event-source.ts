"use client";

/**
 * One self-healing EventSource, shared by the board page (use-kanban-events)
 * and the all-projects overview (use-kanban-overview-data):
 *
 * - onerror: reconnect with backoff 3 s, doubling, capped at 60 s; reset on open.
 * - watchdog: nothing at all (message or named `ping`) for 60 s means the
 *   connection died silently; close it and reconnect at once.
 * - visibilitychange: back in front with no live connection, reconnect at once.
 * - Every callback first checks it belongs to the current connection, so a late
 *   callback from a replaced connection never touches the new one.
 * - dispose() clears both timers and the listener; nothing reconnects after it.
 *
 * The URL is rebuilt on every (re)connect, so callers can resume from the last
 * seen event id.
 */

import { useEffect, useRef } from "react";

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

export interface ResilientEventSourceOptions {
  /** Called before every (re)connect. */
  buildUrl: () => string;
  /** Unnamed frames of the current connection only. Named pings never arrive here. */
  onMessage: (event: MessageEvent) => void;
}

export interface ResilientEventSource {
  dispose: () => void;
}

export function createResilientEventSource({ buildUrl, onMessage }: ResilientEventSourceOptions): ResilientEventSource {
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let disposed = false;

  const clearWatchdog = () => {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const connect = () => {
    if (disposed) return;
    clearReconnectTimer();
    clearWatchdog();
    source?.close();

    const es = new EventSource(buildUrl());
    source = es;
    const isCurrent = () => source === es && !disposed;

    const armWatchdog = () => {
      if (!isCurrent()) return;
      clearWatchdog();
      watchdogTimer = setTimeout(() => {
        watchdogTimer = null;
        if (!isCurrent()) return;
        // Silent death: no error, no data. Reconnect now, not via backoff.
        es.close();
        source = null;
        connect();
      }, SSE_WATCHDOG_MS);
    };
    armWatchdog();

    es.onopen = () => {
      if (!isCurrent()) return;
      attempt = 0;
      armWatchdog();
    };

    // Server keep-alive (named event, never reaches onmessage). Optional
    // call: minimal EventSource test doubles do not implement listeners.
    es.addEventListener?.("ping", armWatchdog);

    es.onmessage = (event) => {
      if (!isCurrent()) return;
      armWatchdog();
      onMessage(event);
    };

    es.onerror = () => {
      es.close();
      if (!isCurrent()) return;
      source = null;
      clearWatchdog();
      // Keep retrying while hidden too; the browser throttles timers, and
      // visibilitychange reconnects at once when the tab comes back.
      const delay = reconnectDelayMs(attempt);
      attempt += 1;
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
  };

  // Back in front: if the connection is gone, reconnect now instead of
  // waiting out the backoff. A live connection is left alone.
  const onVisibilityChange = () => {
    if (disposed || document.visibilityState !== "visible") return;
    if (source && source.readyState !== EVENT_SOURCE_CLOSED) return;
    connect();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  connect();

  return {
    dispose: () => {
      // Flag first: close() may fire onerror synchronously.
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearWatchdog();
      clearReconnectTimer();
      const current = source;
      source = null;
      current?.close();
    },
  };
}

interface UseResilientEventSourceOptions extends ResilientEventSourceOptions {
  /** Connection identity: a change opens a fresh connection; null keeps none open. */
  connectionKey: string | null;
}

/**
 * React wrapper: one resilient connection per `connectionKey`. The latest
 * buildUrl/onMessage are always used, so they need not be stable.
 */
export function useResilientEventSource({ connectionKey, buildUrl, onMessage }: UseResilientEventSourceOptions): void {
  const buildUrlRef = useRef(buildUrl);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    buildUrlRef.current = buildUrl;
    onMessageRef.current = onMessage;
  });

  useEffect(() => {
    if (connectionKey === null) return;
    const connection = createResilientEventSource({
      buildUrl: () => buildUrlRef.current(),
      onMessage: (event) => onMessageRef.current(event),
    });
    return () => connection.dispose();
  }, [connectionKey]);
}
