"use client";

import type { CodebaseData } from "@/client/hooks/use-workspaces";
import type { ArtifactType } from "@/core/models/artifact";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";
import { KanbanCardArtifacts } from "./kanban-card-artifacts";
import { EvidenceBundlePanel } from "./kanban-detail-review-panels";
import { DetailSection } from "./kanban-detail-section";
import { KanbanTaskChangesTab } from "./components/kanban-task-changes-tab";

/**
 * Changes & Evidence tab: the branch / commits / local diff block on top,
 * the evidence verdict and stored artifacts underneath.
 */
export function KanbanDetailChangesTab({
  task,
  codebases,
  workspaceId,
  refreshSignal,
  requiredArtifacts,
  compact,
  onRefresh,
  onRunPullRequest,
  onSelectSession,
}: {
  task: TaskInfo;
  codebases: CodebaseData[];
  workspaceId: string;
  refreshSignal?: number;
  requiredArtifacts: ArtifactType[];
  compact: boolean;
  onRefresh: () => void;
  onRunPullRequest?: (taskId: string) => Promise<string | null>;
  onSelectSession?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div data-testid="kanban-detail-changes-tab">
      <DetailSection
        title={t.kanbanDetail.changes}
        description={compact ? undefined : t.kanbanDetail.changesHint}
        compact={compact}
        testId="kanban-detail-changes-section"
      >
        <KanbanTaskChangesTab
          task={task}
          codebases={codebases}
          taskId={task.id}
          workspaceId={workspaceId}
          refreshSignal={refreshSignal}
          onRefresh={onRefresh}
          onRunPullRequest={onRunPullRequest}
          onSelectSession={onSelectSession}
        />
      </DetailSection>

      <DetailSection
        title={t.kanbanDetailRedesign.evidenceSection}
        description={compact ? undefined : t.kanbanDetailRedesign.evidenceSectionHint}
        compact={compact}
        testId="kanban-detail-evidence-section"
      >
        <EvidenceBundlePanel task={task} compact={compact} />
        <KanbanCardArtifacts
          taskId={task.id}
          compact={compact}
          requiredArtifacts={requiredArtifacts}
          refreshSignal={refreshSignal}
        />
      </DetailSection>
    </div>
  );
}
