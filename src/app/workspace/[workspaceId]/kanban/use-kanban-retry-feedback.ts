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

import { useCallback, useEffect, useRef, useState } from "react";

export function useRetrySubmit(onRetryTrigger: (taskId: string) => Promise<void>) {
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

  const submit = useCallback(async (taskId: string) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      await onRetryTrigger(taskId);
    } catch {
      // The board already showed the error; the button just turns back on.
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }, [onRetryTrigger]);

  return { submitting, submit };
}
