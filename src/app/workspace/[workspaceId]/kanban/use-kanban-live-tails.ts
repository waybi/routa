"use client";

/**
 * The one-line "what is the agent saying right now" caption for every card
 * with a live session.
 *
 * Two sources, merged:
 * - `pushedTails`: fed by `kanban:session-tail` over the board's SSE channel.
 *   The server debounces (300 ms trailing / 1 s max-wait) so a token stream
 *   arrives as one update. This is the steady state — zero polling.
 * - A one-shot `GET /api/sessions/:id/tail` per session the *first* time it
 *   becomes live, so a card does not sit blank until the agent says its next
 *   line. Sessions already seeded are never fetched again.
 *
 * History: this used to poll `history?consolidated=true` (~1 MB per session
 * per 10 s), then `/tail` every 10 s (~500 B), and now polls nothing while
 * connected. The seed fetch is the only request left.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

export interface UseKanbanLiveTailsOptions {
  activeLiveSessionIds: string[];
  isPageVisible: boolean;
  /** sessionId -> newest line, from the SSE channel. Wins over the seed. */
  pushedTails?: Record<string, string>;
}

export function useKanbanLiveTails({
  activeLiveSessionIds,
  isPageVisible,
  pushedTails,
}: UseKanbanLiveTailsOptions): Record<string, string> {
  const [seededTails, setSeededTails] = useState<Record<string, string>>({});
  const seededSessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isPageVisible) return;
    const toSeed = activeLiveSessionIds.filter((id) => !seededSessionIdsRef.current.has(id));
    if (toSeed.length === 0) return;

    // Mark before fetching so a re-render mid-flight does not double-fetch.
    for (const id of toSeed) seededSessionIdsRef.current.add(id);
    let disposed = false;

    void Promise.all(toSeed.map(async (sessionId) => {
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
    })).then((results) => {
      if (disposed) return;
      setSeededTails((previous) => {
        let next = previous;
        for (const [sessionId, tail] of results) {
          if (!tail || previous[sessionId] === tail) continue;
          if (next === previous) next = { ...previous };
          next[sessionId] = tail;
        }
        return next;
      });
    });

    return () => {
      disposed = true;
    };
  }, [activeLiveSessionIds, isPageVisible]);

  // Sessions that stop being live drop out of the seed set so they re-seed if
  // they come back (a resumed session may have said things in between).
  useEffect(() => {
    const live = new Set(activeLiveSessionIds);
    for (const id of Array.from(seededSessionIdsRef.current)) {
      if (!live.has(id)) seededSessionIdsRef.current.delete(id);
    }
  }, [activeLiveSessionIds]);

  return useMemo(() => {
    if (activeLiveSessionIds.length === 0) return EMPTY_TAILS;
    const merged: Record<string, string> = {};
    for (const sessionId of activeLiveSessionIds) {
      const pushed = pushedTails?.[sessionId];
      const seeded = seededTails[sessionId];
      const tail = pushed ?? seeded;
      if (tail) merged[sessionId] = tail;
    }
    return merged;
  }, [activeLiveSessionIds, pushedTails, seededTails]);
}

const EMPTY_TAILS: Record<string, string> = Object.freeze({}) as Record<string, string>;
