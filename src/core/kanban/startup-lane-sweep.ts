import { getAcpRunnerUrl } from "../acp/execution-backend";
import { getHttpSessionStore } from "../acp/http-session-store";
import { getAcpProcessManager } from "../acp/processer";
import { getDatabaseDriver } from "../db/index";
import { getRoutaSystem } from "../routa-system";
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
  scheduleStartupLaneResume();
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
