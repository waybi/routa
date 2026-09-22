import type { NextRequest } from "next/server";

export interface ReplayCursor {
  afterId?: string;
  since?: number;
}

/**
 * Resolves the replay cursor from a reconnecting client, in priority order:
 *
 * 1. `Last-Event-ID` header — what a native EventSource reconnect sends,
 *    set from the last `id:` line it saw.
 * 2. `?lastEventId=` — what our client sends on a *manual* reconnect (after
 *    onerror it opens a fresh EventSource, which does not carry the header).
 * 3. `?since=<epoch ms>` — a fresh page load asking for recent history so the
 *    notification bell can rebuild.
 * 4. None → live only.
 */
export function resolveReplayCursor(request: NextRequest): ReplayCursor | null {
  const header = request.headers.get("last-event-id")?.trim();
  if (header) return { afterId: header };

  const queryId = request.nextUrl.searchParams.get("lastEventId")?.trim();
  if (queryId) return { afterId: queryId };

  const sinceRaw = request.nextUrl.searchParams.get("since");
  if (sinceRaw) {
    const since = Number(sinceRaw);
    if (Number.isFinite(since) && since > 0) return { since };
  }

  return null;
}
