/**
 * Read / change a live session's ACP configOptions (model, reasoning effort…).
 * Backs GET/POST /api/sessions/{sessionId}/config-options; routes stay thin.
 *
 * Callers changing both model and reasoning effort must send model first:
 * changing `model` resets `reasoning_effort` to "" on DSH.
 */

import { summarizeConfigOptions, type AcpConfigOption } from "@/core/acp/config-options";
import { getAcpProcessManager } from "@/core/acp/processer";
import { syncSessionConfigSummary } from "@/core/acp/session-config-sync";

export interface SessionConfigState {
  sessionId: string;
  configOptions: AcpConfigOption[];
  /** Current model id parsed from the model option (e.g. `claude-opus-4-6`). */
  model?: string;
  /** Current reasoning effort; `""` = provider default. */
  reasoningEffort?: string;
}

function toState(sessionId: string, configOptions: AcpConfigOption[]): SessionConfigState {
  return { sessionId, configOptions, ...summarizeConfigOptions(configOptions) };
}

/** Throws SessionProcessNotFoundError when the session has no live ACP process. */
export function getSessionConfig(sessionId: string): SessionConfigState {
  return toState(sessionId, getAcpProcessManager().getConfigOptions(sessionId));
}

/**
 * Forward session/set_config_option, persist the resulting model/effort to
 * the session store and acp_sessions, and return the new state.
 * Throws SessionProcessNotFoundError when the session has no live ACP process.
 */
export async function setSessionConfig(
  sessionId: string,
  configId: string,
  value: string,
): Promise<SessionConfigState> {
  const options = await getAcpProcessManager().setConfigOption(sessionId, configId, value);
  const state = toState(sessionId, options);
  await syncSessionConfigSummary(sessionId, state);
  return state;
}
