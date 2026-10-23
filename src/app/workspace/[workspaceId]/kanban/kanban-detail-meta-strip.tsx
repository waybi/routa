"use client";

import type { ReactNode } from "react";
import { Badge } from "@/client/components/ui/badge";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";
import { resolveCardMergeState, type KanbanCardMergeState } from "./kanban-card-status";

type Translate = ReturnType<typeof useTranslation>["t"];

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

/** The optional items of the meta strip; priority and column always show. */
export type KanbanDetailMetaItem = "runs" | "readiness" | "evidence" | "github" | "commits" | "merge" | "labels";

export interface KanbanDetailMetaFacts {
  runCount: number;
  readiness: "ready" | "blocked" | null;
  evidence: "reviewable" | "blocked" | null;
  githubNumber: number | null;
  commits: number;
  merge: KanbanCardMergeState;
  labels: string[];
}

export function readKanbanDetailMetaFacts(task: TaskInfo, runCount: number): KanbanDetailMetaFacts {
  const evidence = task.evidenceSummary;
  const reviewable = evidence
    ? evidence.artifact.requiredSatisfied
      && (evidence.verification.hasReport || evidence.verification.hasVerdict || evidence.completion.hasSummary)
    : false;
  return {
    runCount,
    readiness: task.storyReadiness ? (task.storyReadiness.ready ? "ready" : "blocked") : null,
    evidence: evidence ? (reviewable ? "reviewable" : "blocked") : null,
    githubNumber: task.githubNumber ?? null,
    commits: task.deliveryReadiness?.hasCommitsSinceBase ? task.deliveryReadiness.commitsSinceBase : 0,
    merge: resolveCardMergeState(task),
    labels: task.labels ?? [],
  };
}

/**
 * Which optional items the strip shows, in display order (same conditions
 * as the meta row under the title before the redesign): runs only when the
 * card ran, readiness only with a verdict, evidence only with data, GitHub
 * only with a number, commits only when there are commits after the base,
 * the merge state only when it is known, labels when there are any.
 */
export function resolveKanbanDetailMetaItems(facts: KanbanDetailMetaFacts): KanbanDetailMetaItem[] {
  const items: KanbanDetailMetaItem[] = [];
  if (facts.runCount > 0) items.push("runs");
  if (facts.readiness) items.push("readiness");
  if (facts.evidence) items.push("evidence");
  if (facts.githubNumber) items.push("github");
  if (facts.commits > 0) items.push("commits");
  if (facts.merge !== "unknown") items.push("merge");
  if (facts.labels.length > 0) items.push("labels");
  return items;
}

function MetaChip({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-control border border-default bg-surface px-2 py-1 text-[11px]"
      data-testid={testId}
    >
      <span className="shrink-0 text-secondary">{label}</span>
      <span className="min-w-0 truncate font-medium text-primary">{children}</span>
    </span>
  );
}

function renderItem(item: KanbanDetailMetaItem, facts: KanbanDetailMetaFacts, task: TaskInfo, t: Translate): ReactNode {
  switch (item) {
    case "runs":
      return <MetaChip key={item} label={t.kanbanDetailRedesign.runCount} testId="kanban-detail-meta-runs">{facts.runCount}</MetaChip>;
    case "readiness":
      return (
        <MetaChip key={item} label={t.kanbanDetail.storyReadiness} testId="kanban-detail-meta-readiness">
          {facts.readiness === "ready" ? t.kanbanDetail.readyForDev : t.kanbanDetail.blockedForDev}
        </MetaChip>
      );
    case "evidence":
      return (
        <MetaChip key={item} label={t.kanbanDetail.evidenceBundle} testId="kanban-detail-meta-evidence">
          {facts.evidence === "reviewable" ? t.kanbanDetail.reviewable : t.kanbanDetail.reviewBlocked}
        </MetaChip>
      );
    case "github":
      return (
        <MetaChip key={item} label="GitHub" testId="kanban-detail-meta-github">
          {task.githubUrl ? (
            <a href={task.githubUrl} target="_blank" rel="noreferrer" className="font-mono text-information hover:underline focus-visible:outline-2 focus-visible:outline-accent">
              #{facts.githubNumber}
            </a>
          ) : <span className="font-mono">#{facts.githubNumber}</span>}
        </MetaChip>
      );
    case "commits":
      return <MetaChip key={item} label={t.kanbanDetail.commits} testId="kanban-detail-meta-commits">{facts.commits}</MetaChip>;
    case "merge":
      return facts.merge === "unmerged" ? (
        <Badge key={item} tone="attention" className="font-medium">
          <span data-testid="kanban-detail-unmerged-badge">{t.kanbanDetail.unmerged}</span>
        </Badge>
      ) : (
        <MetaChip key={item} label={t.kanbanModals.branch} testId="kanban-detail-meta-merged">{t.kanbanDetail.merged}</MetaChip>
      );
    case "labels":
      return facts.labels.map((label) => (
        <span
          key={`label:${label}`}
          className="inline-flex max-w-full items-center break-all rounded-full bg-subtle px-2 py-0.5 font-mono text-[10px] text-secondary"
          data-testid="kanban-detail-meta-label"
        >
          {label}
        </span>
      ));
  }
}

/**
 * One wrapping row of card properties under the title (restored from the
 * detail before the redesign; it replaces the right-hand property rail so
 * the session pane gets that width back).
 */
export function KanbanDetailMetaStrip({
  task,
  runCount,
  priority,
  onPriorityChange,
}: {
  task: TaskInfo;
  runCount: number;
  priority: string;
  onPriorityChange: (priority: string) => void;
}) {
  const { t } = useTranslation();
  const facts = readKanbanDetailMetaFacts(task, runCount);
  const items = resolveKanbanDetailMetaItems(facts);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="kanban-detail-meta-strip">
      <label className="inline-flex items-center gap-1.5 rounded-control border border-default bg-surface py-0.5 pl-2 pr-1 text-[11px]">
        <span className="text-secondary">{t.kanbanDetail.priority}</span>
        <select
          aria-label={t.kanbanDetail.priority}
          value={priority}
          onChange={(event) => onPriorityChange(event.target.value)}
          className="h-6 rounded bg-transparent px-1 text-[11px] font-medium text-primary focus-visible:outline-2 focus-visible:outline-accent"
          data-testid="kanban-detail-meta-priority"
        >
          {PRIORITIES.map((value) => (
            <option key={value} value={value}>{t.kanbanDetail[value]}</option>
          ))}
        </select>
      </label>
      <MetaChip label={t.kanbanDetail.column} testId="kanban-detail-meta-column">{task.columnId ?? "backlog"}</MetaChip>
      {items.map((item) => renderItem(item, facts, task, t))}
    </div>
  );
}
