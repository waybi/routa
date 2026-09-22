"use client";

/**
 * The board-level "describe work to plan" input: owns the text and the
 * in-flight flag, and turns a submit into a planning session.
 *
 * Extracted from `kanban-tab.tsx` (docs/REFACTOR.md: orchestration shell +
 * domain hooks).
 */

import { useCallback, useState } from "react";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { toast } from "@/client/components/toast";
import { useTranslation } from "@/i18n";
import type { KanbanAgentPromptHandler } from "../types";
import { scheduleKanbanRefreshBurst } from "./kanban-agent-input";
import { buildKanbanTaskAgentPrompt } from "./i18n/kanban-task-agent";
import { buildKanbanTaskAdaptiveHarnessOptions } from "./kanban-task-adaptive";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";

export interface UseKanbanAgentInputOptions {
  workspaceId: string;
  selectedBoardId: string | null;
  defaultBoardId: string | null;
  defaultCodebase: CodebaseData | null | undefined;
  boardAutoProviderId: string | undefined;
  specialistLanguage: KanbanSpecialistLanguage;
  ensureBoardAutoProviderPersisted: () => Promise<void>;
  openAgentPanel: (sessionId: string) => void;
  onAgentPrompt?: KanbanAgentPromptHandler;
  onRefresh: () => void;
}

export function useKanbanAgentInput({
  workspaceId,
  selectedBoardId,
  defaultBoardId,
  defaultCodebase,
  boardAutoProviderId,
  specialistLanguage,
  ensureBoardAutoProviderPersisted,
  openAgentPanel,
  onAgentPrompt,
  onRefresh,
}: UseKanbanAgentInputOptions) {
  const { t } = useTranslation();
  const [agentInput, setAgentInput] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);

  const handleAgentSubmit = useCallback(async () => {
    if (!agentInput.trim() || !onAgentPrompt || agentLoading) return;

    setAgentLoading(true);
    try {
      // Best-effort: persisting the board provider must not block session
      // creation. A failure here only means lane automation may fall back to
      // the stored provider — losing the user's prompt would be worse.
      try {
        await ensureBoardAutoProviderPersisted();
      } catch (error) {
        console.error("[kanban] Failed to persist board provider before agent submit:", error);
      }
      const planningPrompt = buildKanbanTaskAgentPrompt({
        workspaceId,
        boardId: selectedBoardId ?? defaultBoardId ?? "default",
        repoPath: defaultCodebase?.repoPath,
        agentInput,
        language: specialistLanguage,
      });

      const sessionId = await onAgentPrompt(agentInput, {
        boardId: selectedBoardId ?? defaultBoardId ?? undefined,
        provider: boardAutoProviderId,
        role: "CRAFTER",
        toolMode: "full",
        allowedNativeTools: ["Read", "Grep", "Glob"],
        mcpProfile: "kanban-planning",
        systemPrompt: planningPrompt,
        taskAdaptiveHarness: buildKanbanTaskAdaptiveHarnessOptions(agentInput, {
          locale: specialistLanguage,
          role: "CRAFTER",
          taskType: "planning",
        }),
      });
      if (!sessionId) {
        toast.error(t.feedback.agentSessionCreateFailed);
        return;
      }
      openAgentPanel(sessionId);
      scheduleKanbanRefreshBurst(onRefresh);
      setAgentInput("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[kanban] Failed to submit Kanban agent prompt:", error);
      toast.error(t.feedback.agentSessionCreateFailed, { description: message });
    } finally {
      setAgentLoading(false);
    }
  }, [
    agentInput,
    agentLoading,
    boardAutoProviderId,
    defaultBoardId,
    defaultCodebase?.repoPath,
    ensureBoardAutoProviderPersisted,
    onAgentPrompt,
    onRefresh,
    openAgentPanel,
    selectedBoardId,
    specialistLanguage,
    t,
    workspaceId,
  ]);

  return { agentInput, setAgentInput, agentLoading, handleAgentSubmit };
}
