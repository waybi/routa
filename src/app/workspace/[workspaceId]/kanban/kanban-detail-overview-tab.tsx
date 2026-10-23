"use client";

import { useState } from "react";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";
import { KanbanDescriptionEditor } from "./kanban-description-editor";
import { ReviewFeedbackPanel } from "./kanban-detail-review-panels";
import { DetailSection, formatDetailTimestamp } from "./kanban-detail-section";

type Translate = ReturnType<typeof useTranslation>["t"];

export interface ProgressNote {
  id: string;
  body: string;
  createdAt?: string;
  source?: "legacy_import" | "update_card";
  agentId?: string;
  sessionId?: string;
}

function formatNoteSource(source: ProgressNote["source"], t: Translate): string | null {
  if (source === "legacy_import") return t.kanbanDetail.progressNoteSourceLegacy;
  if (source === "update_card") return t.kanbanDetail.progressNoteSourceUpdateCard;
  return null;
}

function formatNoteActor(entry: ProgressNote): string | null {
  if (entry.agentId && entry.sessionId) return `${entry.agentId} · ${entry.sessionId}`;
  return entry.agentId ?? entry.sessionId ?? null;
}

/**
 * Overview tab: description (Markdown + canonical YAML), review feedback,
 * progress notes (with a pointer to the Completion tab) and test cases.
 * Story readiness has its own tab.
 */
export function KanbanDetailOverviewTab({
  task,
  progressNotes,
  hasCompletionReport,
  compact,
  onPatchTask,
  onRefresh,
  onOpenCompletion,
}: {
  task: TaskInfo;
  progressNotes: ProgressNote[];
  hasCompletionReport: boolean;
  compact: boolean;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRefresh: () => void;
  onOpenCompletion: () => void;
}) {
  const { t } = useTranslation();
  const [isDescriptionEditing, setIsDescriptionEditing] = useState(false);
  const [editObjective, setEditObjective] = useState(task.objective ?? "");
  const [isTestCasesEditing, setIsTestCasesEditing] = useState(false);
  const [editTestCases, setEditTestCases] = useState((task.testCases ?? []).join("\n"));
  const displayedObjective = isDescriptionEditing ? editObjective : (task.objective ?? "");
  const savedTestCases = (task.testCases ?? []).join("\n");
  const testCaseLines = savedTestCases.split("\n").filter(Boolean);

  return (
    <div data-testid="kanban-detail-overview-tab">
      <section className="border-b border-default py-4" data-testid="kanban-detail-description">
        <KanbanDescriptionEditor
          value={displayedObjective}
          compact={compact}
          onEditingChange={(nextEditing) => {
            if (nextEditing) setEditObjective(task.objective ?? "");
            setIsDescriptionEditing(nextEditing);
          }}
          onSave={async (nextObjective) => {
            if (nextObjective !== (task.objective ?? "")) {
              setEditObjective(nextObjective);
              await onPatchTask(task.id, { objective: nextObjective });
              onRefresh();
            }
          }}
        />
      </section>

      <DetailSection
        title={t.kanbanDetail.reviewFeedback}
        description={compact ? undefined : t.kanbanDetail.evidenceBundleHint}
        compact={compact}
        testId="kanban-detail-review-section"
      >
        <ReviewFeedbackPanel task={task} compact={compact} />
      </DetailSection>

      <DetailSection
        title={t.kanbanDetail.progressNotes}
        description={compact ? undefined : t.kanbanDetail.progressNotesHint}
        compact={compact}
        testId="kanban-detail-progress-notes"
      >
        {progressNotes.length > 0 ? (
          <ol className="m-0 list-none space-y-2 p-0">
            {progressNotes.map((entry, index) => {
              const timestamp = formatDetailTimestamp(entry.createdAt);
              const sourceLabel = formatNoteSource(entry.source, t);
              const actorLabel = formatNoteActor(entry);
              return (
                <li key={entry.id} className="rounded-md border border-default bg-surface px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-secondary">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-primary">{`Note ${index + 1}`}</span>
                      {sourceLabel ? <Badge>{sourceLabel}</Badge> : null}
                      {actorLabel ? <Badge className="font-mono">{actorLabel}</Badge> : null}
                    </div>
                    {timestamp ? <span>{timestamp}</span> : null}
                  </div>
                  <div className="mt-2">
                    <MarkdownViewer content={entry.body} className="prose prose-sm max-w-none text-primary dark:prose-invert" />
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="m-0 text-sm text-secondary">{t.kanbanDetail.noProgressNotesYet}</p>
        )}
        {hasCompletionReport ? (
          <button
            type="button"
            onClick={onOpenCompletion}
            data-testid="kanban-completion-report-pointer"
            className="rounded text-left text-xs font-medium text-information underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t.kanbanDetail.completionReportMovedNote}
          </button>
        ) : null}
      </DetailSection>

      <DetailSection
        title={t.kanbanDetail.testCases}
        description={compact ? undefined : t.kanbanDetail.testCasesHint}
        compact={compact}
        testId="kanban-detail-test-cases"
        action={isTestCasesEditing ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="xs"
              onClick={() => {
                setEditTestCases(savedTestCases);
                setIsTestCasesEditing(false);
              }}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="primary"
              size="xs"
              onClick={async () => {
                if (editTestCases !== savedTestCases) {
                  await onPatchTask(task.id, {
                    testCases: editTestCases.split("\n").map((item) => item.trim()).filter(Boolean),
                  });
                  onRefresh();
                }
                setIsTestCasesEditing(false);
              }}
            >
              {t.common.save}
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            size="xs"
            data-testid="kanban-detail-test-cases-edit"
            onClick={() => {
              setEditTestCases(savedTestCases);
              setIsTestCasesEditing(true);
            }}
          >
            {t.common.edit}
          </Button>
        )}
      >
        {isTestCasesEditing ? (
          <textarea
            value={editTestCases}
            aria-label={t.kanbanDetail.testCases}
            onChange={(event) => setEditTestCases(event.target.value)}
            rows={compact ? 4 : 5}
            placeholder={t.kanbanDetail.testCasesPlaceholder}
            className="w-full rounded-control border border-default bg-surface px-3 py-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : testCaseLines.length > 0 ? (
          <div className="space-y-0.5 text-sm leading-6 text-primary">
            {testCaseLines.map((item, index) => <div key={`${index}:${item}`}>- {item}</div>)}
          </div>
        ) : (
          <p className="m-0 whitespace-pre-line text-sm text-secondary">{t.kanbanDetail.testCasesPlaceholder}</p>
        )}
      </DetailSection>
    </div>
  );
}
