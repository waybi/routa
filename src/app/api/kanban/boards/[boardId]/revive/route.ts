import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { reviveMissingEntryAutomations } from "@/core/kanban/restart-recovery";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { getAcpProcessManager } from "@/core/acp/processer";
import { readPersistedSessionEndHistory } from "@/core/kanban/lane-session-settlement";

export const dynamic = "force-dynamic";

/**
 * Explicitly re-run restart recovery for one board: clear stale lane sessions,
 * converge approved review cards and re-enqueue missing entry automations.
 * This used to run on every GET /api/kanban/boards; it is now an explicit write.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const { boardId } = await params;
  const system = getRoutaSystem();
  const board = await system.kanbanBoardStore.get(boardId);
  if (!board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  const sessionStore = getHttpSessionStore();
  const processManager = getAcpProcessManager();
  await sessionStore.hydrateFromDb();
  await reviveMissingEntryAutomations(system, board.workspaceId, board.id, {
    sessionStore,
    processManager,
    readSessionEndHistory: readPersistedSessionEndHistory,
  });

  return NextResponse.json({ boardId: board.id, workspaceId: board.workspaceId, revived: true });
}
