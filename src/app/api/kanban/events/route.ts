import { NextRequest } from "next/server";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { KANBAN_EVENT_REPLAY_LIMIT } from "@/core/store/kanban-event-store";
import { resolveReplayCursor } from "./replay-cursor";
import { KANBAN_SSE_PING_FRAME, KANBAN_SSE_PING_INTERVAL_MS } from "./keep-alive";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId") ?? "*";
  const broadcaster = getKanbanEventBroadcaster();
  const cursor = resolveReplayCursor(request);
  const encoder = new TextEncoder();
  let connectionId: string | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let cleanedUp = false;

  // The stream can die three ways (cancel, enqueue on a closed stream,
  // request abort); each may fire, in any order. Stop and detach once.
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    request.signal?.removeEventListener("abort", cleanup);
    if (connectionId) {
      broadcaster.detach(connectionId);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      connectionId = broadcaster.attach(workspaceId, controller);

      if (request.signal?.aborted) {
        cleanup();
        return;
      }
      request.signal?.addEventListener("abort", cleanup);
      pingTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(KANBAN_SSE_PING_FRAME));
        } catch {
          cleanup();
        }
      }, KANBAN_SSE_PING_INTERVAL_MS);

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
      cleanup();
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
