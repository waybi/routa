import { NextRequest } from "next/server";
import { getKanbanEventBroadcaster } from "@/core/kanban/kanban-event-broadcaster";
import { KANBAN_EVENT_REPLAY_LIMIT } from "@/core/store/kanban-event-store";
import { resolveReplayCursor } from "./replay-cursor";

export const dynamic = "force-dynamic";

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
