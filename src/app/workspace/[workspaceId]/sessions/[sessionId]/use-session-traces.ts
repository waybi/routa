"use client";

import { useCallback, useEffect, useState } from "react";

import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { TraceEventType, TraceFile } from "@/core/trace/types";

/** Request cap for the events / evidence tabs. */
export const SESSION_TRACE_LIMIT = 200;
/** File paths shown per event row before collapsing into "N more". */
export const EVENT_FILES_SHOWN = 3;

/** The subset of a trace record the session detail tabs read. */
export interface SessionTrace {
  id: string;
  timestamp: string;
  eventType: TraceEventType;
  tool?: { name?: string; status?: string };
  files?: Array<Pick<TraceFile, "path" | "operation">>;
}

export type SessionTracesStatus = "idle" | "loading" | "ready" | "error";

export interface SessionTracesState {
  /** idle = never requested; loading / ready / error describe the last request. */
  status: SessionTracesStatus;
  /** Last successfully read list; kept on error so a failed reload never wipes it. */
  traces: SessionTrace[] | null;
  error: string | null;
  reload: () => void;
}

interface InternalState {
  sessionId: string;
  status: SessionTracesStatus;
  traces: SessionTrace[] | null;
  error: string | null;
}

/** Split an event's files into the paths to list and how many are left over. */
export function summarizeEventFiles(files: SessionTrace["files"]): { shown: string[]; more: number } {
  const paths = (files ?? []).map((file) => file.path).filter(Boolean);
  return { shown: paths.slice(0, EVENT_FILES_SHOWN), more: Math.max(0, paths.length - EVENT_FILES_SHOWN) };
}

/** Unique file paths touched in the given traces, in first-seen order. */
export function collectChangedFiles(traces: SessionTrace[] | null): string[] {
  const seen = new Set<string>();
  for (const trace of traces ?? []) {
    for (const file of trace.files ?? []) {
      if (file.path && !seen.has(file.path)) seen.add(file.path);
    }
  }
  return Array.from(seen);
}

/** True when the list hit the request cap (more records may exist). */
export function isTraceListTruncated(traces: SessionTrace[] | null): boolean {
  return (traces?.length ?? 0) >= SESSION_TRACE_LIMIT;
}

/**
 * Lazily reads `GET /api/traces?sessionId=…&limit=200`. Nothing is requested
 * until `enabled` turns true (first time the events or evidence tab opens);
 * switching session drops the cached list so a new session is read fresh.
 */
export function useSessionTraces(sessionId: string, enabled: boolean): SessionTracesState {
  const [state, setState] = useState<InternalState>({ sessionId, status: "idle", traces: null, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled || !sessionId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state for a request started by this effect
    setState((prev) => ({
      sessionId,
      status: "loading",
      traces: prev.sessionId === sessionId ? prev.traces : null,
      error: null,
    }));
    const url = `/api/traces?sessionId=${encodeURIComponent(sessionId)}&limit=${SESSION_TRACE_LIMIT}`;
    desktopAwareFetch(url, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof data?.message === "string" ? data.message : `HTTP ${response.status}`);
        }
        return Array.isArray(data?.traces) ? (data.traces as SessionTrace[]) : [];
      })
      .then((traces) => {
        if (!cancelled) setState({ sessionId, status: "ready", traces, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState((prev) => ({
          sessionId,
          status: "error",
          traces: prev.sessionId === sessionId ? prev.traces : null,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, nonce, sessionId]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  if (state.sessionId !== sessionId) {
    return { status: "idle", traces: null, error: null, reload };
  }
  return { status: state.status, traces: state.traces, error: state.error, reload };
}
