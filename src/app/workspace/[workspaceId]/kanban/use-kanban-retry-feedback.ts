"use client";

/**
 * Feedback for the card's run / rerun action (card 1e7dd356).
 *
 * - useRetrySubmit: the button turns "Starting…" and disabled the moment it is
 *   clicked, ignores repeat clicks until the request settles, and turns back
 *   on failure (the board shows the error toast).
 * - useKanbanRetryPending: after the request succeeded, the new run is not
 *   visible yet (its session is not in the session list, or it waits in the
 *   board queue). Until it is, the card reads "starting" instead of falling
 *   back to the previous failed lane run.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/client/components/toast";
import { useTranslation } from "@/i18n";
import type { SessionInfo, TaskInfo } from "../types";

export function useRetrySubmit(onRetryTrigger: (taskId: string, options?: { force?: boolean }) => Promise<void>) {
  const [submitting, setSubmitting] = useState(false);
  // A ref, not the state: two clicks in one tick both see the old state.
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = useCallback(async (taskId: string, options?: { force?: boolean }) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      await (options ? onRetryTrigger(taskId, options) : onRetryTrigger(taskId));
    } catch {
      // The board already showed the error; the button just turns back on.
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }, [onRetryTrigger]);

  return { submitting, submit };
}

export interface RetryPendingEntry {
  startedAt: number;
  columnId?: string;
  sessionId?: string;
}

/** Longest time a card shows "starting" without its new run becoming visible. */
export const RETRY_PENDING_TIMEOUT_MS = 3 * 60_000;

/**
 * Drop the entries whose run is visible (its session is in the session list),
 * whose card is gone or left the column, or that waited too long. Returns the
 * same object when nothing changed.
 */
export function settleRetryPending(
  pending: Record<string, RetryPendingEntry>,
  tasks: Pick<TaskInfo, "id" | "columnId" | "triggerSessionId">[],
  sessionMap: Map<string, SessionInfo>,
  now: number,
): Record<string, RetryPendingEntry> {
  let next = pending;
  for (const [taskId, entry] of Object.entries(pending)) {
    const task = tasks.find((item) => item.id === taskId);
    const sessionId = task?.triggerSessionId ?? entry.sessionId;
    const settled = !task
      || (entry.columnId !== undefined && task.columnId !== entry.columnId)
      || (sessionId !== undefined && sessionMap.has(sessionId))
      || now - entry.startedAt >= RETRY_PENDING_TIMEOUT_MS;
    if (!settled) continue;
    if (next === pending) next = { ...pending };
    delete next[taskId];
  }
  return next;
}

export function useKanbanRetryPending({
  tasks,
  sessionMap,
}: {
  tasks: Pick<TaskInfo, "id" | "columnId" | "triggerSessionId">[];
  sessionMap: Map<string, SessionInfo>;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Record<string, RetryPendingEntry>>({});
  const [now, setNow] = useState(() => Date.now());

  // Settled entries stop counting at once (derived during render); the timer
  // advances the clock for the timeout and prunes them from state.
  const hasPending = Object.keys(pending).length > 0;
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      setPending((current) => settleRetryPending(current, tasks, sessionMap, tick));
    }, 15_000);
    return () => clearInterval(timer);
  }, [hasPending, tasks, sessionMap]);

  /** Runs the rerun request; marks the card pending on success, toasts on failure. */
  const trackRetry = useCallback(async (taskId: string, request: () => Promise<TaskInfo>) => {
    try {
      const updated = await request();
      const startedAt = Date.now();
      setNow(startedAt);
      setPending((current) => ({
        ...current,
        [taskId]: { startedAt, columnId: updated.columnId, sessionId: updated.triggerSessionId },
      }));
      return updated;
    } catch (error) {
      setPending((current) => {
        if (!(taskId in current)) return current;
        const next = { ...current };
        delete next[taskId];
        return next;
      });
      if ((error as { reason?: unknown } | null)?.reason === "step_running") {
        // A live builder already runs this lane: tell the user, offer "End & rerun".
        toast.info(t.feedback.retryStepRunningTitle, { description: t.feedback.retryStepRunningHint });
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      toast.error(t.feedback.retryTriggerFailed, { description: message });
      throw error;
    }
  }, [t]);

  const retryPendingTaskIds = useMemo(
    () => new Set(Object.keys(settleRetryPending(pending, tasks, sessionMap, now))),
    [pending, tasks, sessionMap, now],
  );
  return { retryPendingTaskIds, trackRetry };
}
