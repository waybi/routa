import { getAcpRunnerUrl } from "../acp/execution-backend";
import { getHttpSessionStore } from "../acp/http-session-store";
import { getAcpProcessManager } from "../acp/processer";
import { getDatabaseDriver } from "../db/index";
import { getRoutaSystem, type RoutaSystem } from "../routa-system";
import {
  KANBAN_SERVER_RESTART_WORKSPACE_ID,
  type KanbanServerRestartEvent,
} from "./kanban-event-types";
import { resumeInterruptedLaneSteps } from "./interrupted-lane-resume";
import { readPersistedSessionEndHistory } from "./lane-session-settlement";
import { endStaleRunningLaneSessions } from "./restart-recovery";

/**
 * Run once when the server starts: end lane records left "running" by the
 * previous process, then (without holding up the start) re-run the steps the
 * restart interrupted (card 14de4800). Only for the local SQLite backend with
 * embedded agents, where a restart really ends every agent process. With an
 * ACP runner or a shared Postgres database another process may still run
 * those sessions. Skipped during `next build`: its workers can load
 * instrumentation while the live server still runs those sessions.
 */
export async function endStaleRunningLaneSessionsOnStartup(): Promise<void> {
  if (
    process.env.NEXT_PHASE === "phase-production-build"
    || getDatabaseDriver() !== "sqlite"
    || getAcpRunnerUrl()
  ) {
    return;
  }
  const bootAt = new Date().toISOString();
  const pid = process.pid;
  let system: RoutaSystem | undefined;
  let outcome: Pick<KanbanServerRestartEvent, "endedSessionIds" | "cards" | "error">;
  try {
    system = getRoutaSystem();
    const result = await endStaleRunningLaneSessions(system, {
      sessionStore: getHttpSessionStore(),
      processManager: getAcpProcessManager(),
      // The session store is not hydrated yet: read how each session ended from the database.
      readSessionEndHistory: readPersistedSessionEndHistory,
    });
    console.log(
      `[RestartRecovery] Startup sweep ended ${result.sessions.length} stale running lane session(s) on ${result.cards} card(s)`
        + (result.sessions.length > 0 ? `: ${result.sessions.join(", ")}` : ""),
    );
    outcome = { endedSessionIds: [...result.sessions], cards: result.cards };
  } catch (error) {
    console.warn("[RestartRecovery] Startup sweep of stale running lane sessions failed:", error);
    outcome = { error: error instanceof Error ? error.message : String(error) };
  }
  await recordServerRestart(system, { bootAt, pid, ...outcome });
  scheduleStartupLaneResume();
}

/**
 * Exactly one `kanban:server-restart` row per start, whether the sweep worked
 * or not. Never throws: a store failure must not hold up the resume.
 */
async function recordServerRestart(
  system: RoutaSystem | undefined,
  fields: Pick<KanbanServerRestartEvent, "bootAt" | "pid" | "endedSessionIds" | "cards" | "error">,
): Promise<void> {
  if (!system) {
    console.warn("[RestartRecovery] No system available: the kanban:server-restart event is not recorded");
    return;
  }
  try {
    const target = system;
    const event: KanbanServerRestartEvent = {
      type: "kanban:server-restart",
      workspaceId: KANBAN_SERVER_RESTART_WORKSPACE_ID,
      ...fields,
      timestamp: new Date().toISOString(),
    };
    await target.kanbanEventStore.append({
      id: crypto.randomUUID(),
      workspaceId: KANBAN_SERVER_RESTART_WORKSPACE_ID,
      type: event.type,
      resourceId: null,
      payload: event,
      createdAt: Date.now(),
    });
  } catch (error) {
    console.warn("[RestartRecovery] Could not record the kanban:server-restart event:", error);
  }
}

/** Resolves when the startup resume finished (tests). */
let startupResume: Promise<void> | undefined;

export function getStartupLaneResume(): Promise<void> | undefined {
  return startupResume;
}

/** After the sweep, off the start path: hydrate the session store, then re-run interrupted steps. */
function scheduleStartupLaneResume(): void {
  let done: () => void = () => {};
  startupResume = new Promise<void>((resolve) => { done = resolve; });
  const timer = setTimeout(() => {
    void (async () => {
      try {
        await getHttpSessionStore().hydrateFromDb();
        const { resumed, waiting } = await resumeInterruptedLaneSteps(getRoutaSystem());
        console.log(
          `[RestartRecovery] Startup resume enqueued ${resumed.length} interrupted lane step(s)`
            + (resumed.length > 0 ? `: ${resumed.join(", ")}` : "")
            + (waiting.length > 0 ? `; ${waiting.length} wait for their rerun time` : ""),
        );
      } catch (error) {
        console.warn("[RestartRecovery] Startup resume of interrupted lane steps failed:", error);
      } finally {
        done();
      }
    })();
  }, 0);
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}
