import { getAcpRunnerUrl } from "../acp/execution-backend";
import { getHttpSessionStore } from "../acp/http-session-store";
import { getAcpProcessManager } from "../acp/processer";
import { getDatabaseDriver } from "../db/index";
import { getRoutaSystem } from "../routa-system";
import { readPersistedSessionEndHistory } from "./lane-session-settlement";
import { endStaleRunningLaneSessions } from "./restart-recovery";

/**
 * Run once when the server starts: end lane records left "running" by the
 * previous process. Only for the local SQLite backend with embedded agents,
 * where a restart really ends every agent process. With an ACP runner or a
 * shared Postgres database another process may still run those sessions.
 * Skipped during `next build`: its workers can load instrumentation while the
 * live server still runs those sessions on the same database.
 */
export async function endStaleRunningLaneSessionsOnStartup(): Promise<void> {
  if (
    process.env.NEXT_PHASE === "phase-production-build"
    || getDatabaseDriver() !== "sqlite"
    || getAcpRunnerUrl()
  ) {
    return;
  }
  try {
    const result = await endStaleRunningLaneSessions(getRoutaSystem(), {
      sessionStore: getHttpSessionStore(),
      processManager: getAcpProcessManager(),
      // The session store is not hydrated yet: read how each session ended from the database.
      readSessionEndHistory: readPersistedSessionEndHistory,
    });
    console.log(
      `[RestartRecovery] Startup sweep ended ${result.sessions.length} stale running lane session(s) on ${result.cards} card(s)`
        + (result.sessions.length > 0 ? `: ${result.sessions.join(", ")}` : ""),
    );
  } catch (error) {
    console.warn("[RestartRecovery] Startup sweep of stale running lane sessions failed:", error);
  }
}
