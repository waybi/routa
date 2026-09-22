"use client";

/**
 * Polls the one-line "what is the agent saying right now" caption for every
 * card with a live session.
 *
 * Uses `GET /api/sessions/:id/tail`, which returns a few hundred bytes. The
 * previous source (`history?consolidated=true`) shipped ~1 MB per session per
 * tick to render the same single line. Pauses while the tab is hidden.
 *
 * Extracted from `kanban-tab.tsx` (docs/REFACTOR.md: orchestration shell +
 * domain hooks).
 */

import { useEffect, useState } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

export const LIVE_SESSION_TAIL_POLL_MS = 10_000;

export interface UseKanbanLiveTailsOptions {
  activeLiveSessionIds: string[];
  isPageVisible: boolean;
}

export function useKanbanLiveTails({
  activeLiveSessionIds,
  isPageVisible,
}: UseKanbanLiveTailsOptions): Record<string, string> {
  const [liveSessionTails, setLiveSessionTails] = useState<Record<string, string>>({});

  useEffect(() => {
    if (activeLiveSessionIds.length === 0 || !isPageVisible) return;

    const activeIdSet = new Set(activeLiveSessionIds);
    let disposed = false;
    let inFlight = false;

    const pollLiveSessionTail = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (disposed || inFlight) return;
      inFlight = true;

      const updates = await Promise.all(activeLiveSessionIds.map(async (sessionId) => {
        try {
          const response = await desktopAwareFetch(
            `/api/sessions/${encodeURIComponent(sessionId)}/tail`,
            { cache: "no-store" },
          );
          if (!response.ok) return [sessionId, null] as const;
          const payload = await response.json();
          const tail = typeof payload?.tail === "string" && payload.tail.trim() ? payload.tail : null;
          return [sessionId, tail] as const;
        } catch {
          return [sessionId, null] as const;
        }
      })).finally(() => {
        inFlight = false;
      });

      if (disposed) return;

      setLiveSessionTails((previous) => {
        const next: Record<string, string> = {};
        let changed = false;

        for (const [sessionId, tail] of updates) {
          if (!activeIdSet.has(sessionId) || !tail) continue;
          next[sessionId] = tail;
          if (previous[sessionId] !== tail) changed = true;
        }

        for (const sessionId of Object.keys(previous)) {
          if (!activeIdSet.has(sessionId)) {
            changed = true;
            continue;
          }
          if (!next[sessionId] && previous[sessionId]) changed = true;
        }

        return changed ? next : previous;
      });
    };

    void pollLiveSessionTail();
    const timerId = window.setInterval(() => {
      void pollLiveSessionTail();
    }, LIVE_SESSION_TAIL_POLL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [activeLiveSessionIds, isPageVisible]);

  // With no live sessions the caption map is empty by definition; deriving it
  // here avoids a synchronous setState inside the effect just to clear it.
  return activeLiveSessionIds.length === 0 ? EMPTY_TAILS : liveSessionTails;
}

const EMPTY_TAILS: Record<string, string> = Object.freeze({}) as Record<string, string>;
