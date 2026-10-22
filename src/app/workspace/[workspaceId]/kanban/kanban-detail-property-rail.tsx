"use client";

import { Trash2 } from "lucide-react";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { PropertyRow } from "@/client/components/ui/property-row";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";
import { resolveCardMergeState } from "./kanban-card-status";

type Translate = ReturnType<typeof useTranslation>["t"];

function getEvidenceStatus(task: TaskInfo, t: Translate): string | null {
  const evidence = task.evidenceSummary;
  if (!evidence) return null;
  const reviewable = evidence.artifact.requiredSatisfied
    && (evidence.verification.hasReport || evidence.verification.hasVerdict || evidence.completion.hasSummary);
  return reviewable ? t.kanbanDetail.reviewable : t.kanbanDetail.reviewBlocked;
}

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

/**
 * Right-hand property rail of the card detail (design-spec §10). On narrow
 * screens the shell stacks it under the detail body. Delete lives at the
 * bottom and only asks the board to open the in-app confirm dialog
 * (KanbanDeleteTaskModal), which owns the in-flight and failure states.
 */
export function KanbanDetailPropertyRail({
  task,
  runCount,
  priority,
  onPriorityChange,
  onDelete,
}: {
  task: TaskInfo;
  runCount: number;
  priority: string;
  onPriorityChange: (priority: string) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const storyReadiness = task.storyReadiness
    ? (task.storyReadiness.ready ? t.kanbanDetail.readyForDev : t.kanbanDetail.blockedForDev)
    : t.kanbanDetailRedesign.pendingEvaluation;
  const evidence = getEvidenceStatus(task, t);
  const mergeState = resolveCardMergeState(task);
  const commits = task.deliveryReadiness?.hasCommitsSinceBase ? task.deliveryReadiness.commitsSinceBase : 0;
  const labels = task.labels ?? [];

  return (
    <aside
      aria-label={t.kanbanDetailRedesign.properties}
      data-testid="kanban-detail-property-rail"
      className="flex flex-col gap-4 bg-canvas px-4 py-4"
    >
      <label className="grid gap-1.5">
        <span className="text-[11px] text-secondary">{t.kanbanDetail.priority}</span>
        <select
          aria-label={t.kanbanDetail.priority}
          value={priority}
          onChange={(event) => onPriorityChange(event.target.value)}
          className="min-h-[34px] w-full rounded-control border border-default bg-surface px-2.5 text-xs text-primary focus-visible:outline-2 focus-visible:outline-accent"
        >
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>{t.kanbanDetail[value]}</option>
          ))}
        </select>
      </label>

      <dl className="m-0">
        <PropertyRow label={t.kanbanDetail.column}>{task.columnId ?? "backlog"}</PropertyRow>
        <PropertyRow label={t.kanbanDetailRedesign.runCount}>{runCount}</PropertyRow>
        <PropertyRow label={t.kanbanDetail.storyReadiness}>{storyReadiness}</PropertyRow>
        {evidence ? <PropertyRow label={t.kanbanDetail.evidenceBundle}>{evidence}</PropertyRow> : null}
        {task.githubNumber ? (
          <PropertyRow label="GitHub" mono>
            {task.githubUrl ? (
              <a href={task.githubUrl} target="_blank" rel="noreferrer" className="text-information hover:underline focus-visible:outline-2 focus-visible:outline-accent">
                #{task.githubNumber}
              </a>
            ) : `#${task.githubNumber}`}
          </PropertyRow>
        ) : null}
        {commits > 0 ? <PropertyRow label={t.kanbanDetail.commits}>{commits}</PropertyRow> : null}
        {mergeState !== "unknown" ? (
          <PropertyRow label={t.kanbanModals.branch}>
            {mergeState === "unmerged" ? (
              <Badge tone="attention" className="font-medium">
                <span data-testid="kanban-detail-unmerged-badge">{t.kanbanDetail.unmerged}</span>
              </Badge>
            ) : (
              <span>{t.kanbanDetail.merged}</span>
            )}
          </PropertyRow>
        ) : null}
      </dl>

      {labels.length > 0 ? (
        <div className="grid gap-2">
          <span className="text-[11px] text-secondary">{t.kanbanDetailRedesign.labels}</span>
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {labels.map((label) => (
              <li key={label} className="max-w-full break-all rounded bg-subtle px-1.5 py-1 font-mono text-[10px] text-secondary">
                {label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-auto pt-2">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={onDelete}
          data-testid="kanban-detail-delete"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t.kanbanModals.deleteTaskTitle}
        </Button>
      </div>
    </aside>
  );
}
