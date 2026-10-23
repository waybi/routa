"use client";

/**
 * Selection, per-row results and the single serial run queue for rerunning
 * interrupted cards on the "Needs you" page. A single "Rerun" and the bulk
 * "Rerun selected" share the queue, so only one run is ever in flight.
 * Row results are kept by card id and survive the reload after the run.
 */

import { useCallback, useRef, useState } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { resolveApiPath } from "@/client/config/backend";
import type { InboxRow } from "./inbox-rules";
import { runSerialRetries, type RetryBoard, type RetryRowState, type RetrySummary } from "./inbox-retry";

export interface InboxRetryTarget {
  row: InboxRow;
  board: RetryBoard | undefined;
}

/** Rows whose rerun is under way or accepted are not selectable again. */
export function isRetryLocked(state: RetryRowState | undefined): boolean {
  return state?.phase === "starting" || state?.phase === "started" || state?.phase === "queued";
}

export function useInboxRetry(onFinished: (workspaceIds: string[]) => void) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [rowStates, setRowStates] = useState<ReadonlyMap<string, RetryRowState>>(() => new Map());
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<RetrySummary | null>(null);
  const runningRef = useRef(false);

  const toggle = useCallback((taskId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const setAll = useCallback((taskIds: readonly string[], on: boolean) => {
    setSelected(on ? new Set(taskIds) : new Set());
  }, []);

  const run = useCallback(async (targets: readonly InboxRetryTarget[]) => {
    if (runningRef.current || targets.length === 0) return;
    runningRef.current = true;
    setRunning(true);
    setConfirming(false);
    setSummary(null);
    try {
      const result = await runSerialRetries(
        targets.map(({ row, board }) => ({ taskId: row.task.id, board })),
        {
          request: (path, init) => desktopAwareFetch(resolveApiPath(path), init),
          onRowState: (taskId, state) => setRowStates((current) => new Map(current).set(taskId, state)),
        },
      );
      setSummary(result);
    } finally {
      runningRef.current = false;
      setRunning(false);
      setSelected(new Set());
      onFinished([...new Set(targets.map(({ row }) => row.workspaceId))]);
    }
  }, [onFinished]);

  return { selected, rowStates, running, confirming, setConfirming, summary, toggle, setAll, run };
}
