import { NextRequest } from "next/server";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { KANBAN_EVENT_REPLAY_LIMIT } from "@/core/store/kanban-event-store";

export const dynamic = "force-dynamic";

/**
 * Resolves the replay cursor from a reconnecting client.
 *
 * - `Last-Event-ID` is what EventSource sends automatically after a drop,
 *   set from the last `id:` line it saw. Preferred.
 * - `?since=<epoch ms>` is for a fresh page load that wants recent history
 *   (the notification bell rebuilding after a reload).
 * - Neither → live only, exactly as before persistence existed.
 */
export function resolveReplayCursor(request: NextRequest): { afterId?: string; since?: number } | null {
  const lastEventId = request.headers.get("last-event-id")?.trim();
  if (lastEventId) return { afterId: lastEventId };

  const sinceRaw = request.nextUrl.searchParams.get("since");
  if (sinceRaw) {
    const since = Number(sinceRaw);
    if (Number.isFinite(since) && since > 0) return { since };
  }

  return null;
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "*";
  const broadcaster = getKanbanEventBroadcaster();
  const cursor = resolveReplayCursor(request);
  let connectionId: string | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      connectionId = broadcaster.attach(workspaceId, controller);

      // Replay before going live so the client sees history in order.
      // Anything broadcast while replay runs is already being fanned out to
      // this controller (attach ran first), so nothing is lost — a frame may
      // at worst arrive twice, which downstream dedupe handles.
      if (cursor && workspaceId !== "*") {
        try {
          await broadcaster.replay(controller, workspaceId, {
            ...cursor,
            limit: KANBAN_EVENT_REPLAY_LIMIT,
          });
        } catch (error) {
          console.error("[kanban-events] replay failed:", error);
        }
      }
    },
    cancel() {
      if (connectionId) {
        broadcaster.detach(connectionId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
