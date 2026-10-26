"use client";

/**
 * Creates the KanbanTask Agent session for the side panel when none exists.
 * Extracted from kanban-tab.tsx (line budget; docs/REFACTOR.md).
 */

import { useCallback } from "react";
import type { UseAcpActions, UseAcpState } from "@/client/hooks/use-acp";

export interface UseEnsureKanbanAgentSessionOptions {
  acp: (UseAcpState & UseAcpActions) | undefined | null;
  agentSessionId: string | null;
  boardAutoProviderId: string | undefined;
  defaultRepoPath: string | undefined;
  workspaceId: string;
  openAgentPanel: (sessionId: string) => void;
}

export function useEnsureKanbanAgentSession({
  acp,
  agentSessionId,
  boardAutoProviderId,
  defaultRepoPath,
  workspaceId,
  openAgentPanel,
}: UseEnsureKanbanAgentSessionOptions) {
  return useCallback(async (
    cwd?: string,
    provider?: string,
    _modeId?: string,
    model?: string,
    reasoningEffort?: string,
  ) => {
    if (!acp) return null;
    if (agentSessionId) return agentSessionId;

    const result = await acp.createSession(
      cwd ?? defaultRepoPath,
      provider ?? boardAutoProviderId,
      undefined,
      "DEVELOPER",
      workspaceId,
      model,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "full",
      [],
      undefined,
      undefined,
      true,
      undefined,
      undefined,
      reasoningEffort || undefined,
    );
    if (!result?.sessionId) return null;

    openAgentPanel(result.sessionId);
    return result.sessionId;
  }, [acp, agentSessionId, boardAutoProviderId, defaultRepoPath, openAgentPanel, workspaceId]);
}
