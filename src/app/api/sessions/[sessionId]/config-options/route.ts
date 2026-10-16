/**
 * GET  /api/sessions/{sessionId}/config-options → { configOptions, model, reasoningEffort }
 * POST /api/sessions/{sessionId}/config-options  body { configId, value } → new state
 *
 * Thin route: parsing + error mapping only; logic lives in session-config-service.
 */

import { NextRequest, NextResponse } from "next/server";
import { SessionProcessNotFoundError } from "@/core/acp/config-options";
import { getSessionConfig, setSessionConfig } from "@/core/acp/session-config-service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

function errorResponse(error: unknown, sessionId: string) {
  if (error instanceof SessionProcessNotFoundError) {
    return NextResponse.json(
      {
        error: "会话进程不在，需先恢复会话",
        code: error.code,
        sessionId,
      },
      { status: 404 },
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message, sessionId }, { status: 502 });
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { sessionId } = await params;
  try {
    return NextResponse.json(getSessionConfig(sessionId));
  } catch (error) {
    return errorResponse(error, sessionId);
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { sessionId } = await params;
  const body = (await request.json().catch(() => null)) as { configId?: unknown; value?: unknown } | null;
  if (!body || typeof body.configId !== "string" || !body.configId.trim() || typeof body.value !== "string") {
    return NextResponse.json(
      { error: "body 需要 { configId: string, value: string }" },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await setSessionConfig(sessionId, body.configId, body.value));
  } catch (error) {
    return errorResponse(error, sessionId);
  }
}
