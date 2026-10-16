/**
 * Keep the in-memory session store and acp_sessions in sync with the
 * model / reasoning effort an ACP agent actually runs.
 */

import { summarizeConfigOptions, type AcpConfigOption, type AcpConfigSummary } from "@/core/acp/config-options";
import { getHttpSessionStore } from "@/core/acp/http-session-store";
import { updateSessionConfigInDb } from "@/core/acp/session-db-persister";

export async function syncSessionConfigSummary(sessionId: string, summary: AcpConfigSummary): Promise<void> {
  if (summary.model === undefined && summary.reasoningEffort === undefined) return;

  const store = getHttpSessionStore();
  const existing = store.getSession(sessionId);
  if (existing) {
    store.upsertSession({
      ...existing,
      model: summary.model ?? existing.model,
      reasoningEffort: summary.reasoningEffort ?? existing.reasoningEffort,
    });
  }
  await updateSessionConfigInDb(sessionId, summary);
}

/** configOptions listener body: persist whatever the agent now reports. */
export function handleSessionConfigOptionsChanged(sessionId: string, options: AcpConfigOption[]): void {
  syncSessionConfigSummary(sessionId, summarizeConfigOptions(options)).catch((err) =>
    console.error(`[SessionConfig] Failed to persist config for ${sessionId}:`, err),
  );
}
