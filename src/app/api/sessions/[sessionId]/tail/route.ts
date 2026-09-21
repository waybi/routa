/**
 * Session Tail API Route - /api/sessions/[sessionId]/tail
 *
 * Returns only the newest message-shaped line of a session.
 *
 * Exists because the Kanban board needs one caption per running card and was
 * getting it from `history?consolidated=true`: ~1 MB and ~3 s per call, every
 * 10 s per live session, of which the client kept a single line. This route
 * does the same extraction server-side and returns a few hundred bytes.
 */

import { NextRequest, NextResponse } from "next/server";
import { loadSessionHistory } from "@/core/session-history";
import { extractSessionTail } from "@/core/session-tail";
import { proxyRunnerOwnedSessionRequest } from "@/core/acp/runner-routing";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const proxied = await proxyRunnerOwnedSessionRequest(request, {
    sessionId,
    path: `/api/sessions/${encodeURIComponent(sessionId)}/tail`,
    method: "GET",
  });
  if (proxied) return proxied;

  const history = await loadSessionHistory(sessionId, { consolidated: true });
  const tail = extractSessionTail(history);

  return NextResponse.json(
    {
      sessionId,
      tail: tail?.text ?? null,
      updateType: tail?.updateType ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
