"use client";

import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { useTranslation } from "@/i18n";
import type { KanbanColumnInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import { GitHubPanel, HandoffPanel, KanbanCardActivityPanel } from "./kanban-card-activity";
import type { KanbanSpecialistOption } from "./kanban-card-session-utils";
import { JitContextPanel } from "./kanban-detail-panels";
import { KanbanDetailExecution } from "./kanban-detail-execution";
import { KanbanDetailRepositories } from "./kanban-detail-repositories";
import { DetailSection } from "./kanban-detail-section";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";

/**
 * Construction tab: stage progress and run controls, run records, linked
 * repositories / worktree, history memory (collapsible) and the collapsed
 * Advanced area (card override, fallback chain, handoffs, GitHub).
 */
export interface KanbanDetailConstructionTabProps {
  task: TaskInfo;
  lane?: KanbanColumnInfo;
  boardColumns: KanbanColumnInfo[];
  availableProviders: AcpProviderInfo[];
  specialists: KanbanSpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  sessionInfo?: SessionInfo | null;
  sessions: SessionInfo[];
  selectedProvider?: string | null;
  activeRunSessionId?: string;
  sessionCwdMismatch?: boolean;
  workspaceId?: string;
  historyRepoPath: string | null;
  refreshSignal?: number;
  compact: boolean;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onRefresh: () => void;
  onProviderChange?: (providerId: string | null) => void;
  onRepositoryChange?: (codebaseIds: string[]) => void;
  onSelectSession?: (sessionId: string) => void;
  jitContextSessionId?: string | null;
  onLoadJitContextIntoSession?: (sessionId: string, prompt: string) => Promise<void>;
  onOpenJitContextHistoryAnalysis?: (prompt: string, targetWindow: Window | null) => Promise<void>;
}

export function KanbanDetailConstructionTab(props: KanbanDetailConstructionTabProps) {
  const { t } = useTranslation();
  const { task, compact } = props;

  return (
    <div data-testid="kanban-detail-construction-tab">
      <KanbanDetailExecution
        task={task}
        lane={props.lane}
        boardColumns={props.boardColumns}
        availableProviders={props.availableProviders}
        sessionInfo={props.sessionInfo}
        specialists={props.specialists}
        specialistLanguage={props.specialistLanguage}
        selectedProvider={props.selectedProvider}
        onPatchTask={props.onPatchTask}
        onRetryTrigger={props.onRetryTrigger}
        onProviderChange={props.onProviderChange}
        compact={compact}
        advancedExtras={(
          <>
            <div className="rounded-md border border-default px-3 py-3" data-testid="kanban-detail-handoffs">
              <HandoffPanel task={task} compact />
            </div>
            <div className="rounded-md border border-default" data-testid="kanban-detail-github">
              <GitHubPanel task={task} compact />
            </div>
          </>
        )}
      />

      <KanbanCardActivityPanel
        task={task}
        refreshSignal={props.refreshSignal}
        sessions={props.sessions}
        specialists={props.specialists}
        specialistLanguage={props.specialistLanguage}
        autoProviderId={props.selectedProvider ?? undefined}
        currentSessionId={props.activeRunSessionId}
        onSelectSession={props.onSelectSession}
        compact={compact}
      />

      <KanbanDetailRepositories
        task={task}
        codebases={props.codebases}
        allCodebaseIds={props.allCodebaseIds}
        worktreeCache={props.worktreeCache}
        sessionInfo={props.sessionInfo}
        sessionCwdMismatch={props.sessionCwdMismatch}
        onPatchTask={props.onPatchTask}
        onRefresh={props.onRefresh}
        onRepositoryChange={props.onRepositoryChange}
        onSelectSession={props.onSelectSession}
        compact={compact}
      />

      <DetailSection title={t.kanbanDetail.jitContext} compact={compact} testId="kanban-detail-history-memory">
        <JitContextPanel
          task={task}
          workspaceId={props.workspaceId}
          repoPath={props.historyRepoPath}
          specialistLanguage={props.specialistLanguage}
          activeSessionId={props.jitContextSessionId}
          onPatchTask={props.onPatchTask}
          onLoadIntoSession={props.onLoadJitContextIntoSession}
          onOpenHistoryAnalysis={props.onOpenJitContextHistoryAnalysis}
          compact={compact}
        />
      </DetailSection>
    </div>
  );
}
