"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useDraggable } from "@dnd-kit/core";
import { useTranslation } from "@/i18n";
import type { AcpProviderInfo } from "@/client/acp-client";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { resolveEffectiveTaskAutomation } from "@/core/kanban/effective-task-automation";
import { parseCanonicalStory } from "@/core/kanban/canonical-story";
import { formatArtifactLabel, resolveKanbanTransitionArtifacts } from "@/core/kanban/transition-artifacts";
import type { KanbanColumnInfo, SessionInfo, TaskInfo, WorktreeInfo } from "../types";
import { type KanbanSpecialistLanguage } from "./kanban-specialist-language";
import { createKanbanSpecialistResolver } from "./kanban-card-session-utils";
import {
  cardRunStatusLabelKey,
  describeCardActivity,
  type CardActivityDetail,
  type KanbanCardRunStatus,
  resolveCardMergeState,
} from "./kanban-card-status";
import { GripVertical, Trash2 } from "lucide-react";
import { Badge, type Tone } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { useRetrySubmit } from "./use-kanban-retry-feedback";


interface SpecialistOption {
  id: string;
  name: string;
  role: string;
  displayName?: string;
  defaultProvider?: string;
}

export interface KanbanCardProps {
  task: TaskInfo;
  boardColumns: KanbanColumnInfo[];
  linkedSession?: SessionInfo;
  liveMessageTail?: string;
  availableProviders: AcpProviderInfo[];
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  codebases: CodebaseData[];
  allCodebaseIds: string[];
  worktreeCache: Record<string, WorktreeInfo>;
  autoProviderId?: string;
  queuePosition?: number;
  /** A rerun was requested and its new run is not visible yet. */
  retryPending?: boolean;
  onOpenDetail: () => void;
  onDelete: () => void;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string) => Promise<void>;
  onRefresh: () => void;
  /** Optional title renderer, e.g. to highlight board-search hits. */
  renderTitle?: (title: string) => ReactNode;
  /** All-projects view: always show the workspace chip on the first row. */
  showWorkspace?: boolean;
  workspaceName?: string;
}

interface KanbanCardSurfaceProps extends KanbanCardProps {
  dragHandleProps?: Record<string, any>;
  dragOverlay?: boolean;
  isDragging?: boolean;
  style?: CSSProperties;
  wrapperRef?: (node: HTMLDivElement | null) => void;
}

function summarizeReviewFeedback(report: string | undefined, maxLength = 180): string | null {
  const normalized = report
    ?.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  if (!normalized) {
    return null;
  }

  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function getPriorityBadgeTone(priority?: string): Tone {
  switch ((priority ?? "medium").toLowerCase()) {
    case "high":
    case "urgent":
      return "danger";
    case "low":
      return "success";
    default:
      return "attention";
  }
}

/** Status dot tone per run status (design-spec §5: colour always paired with text). */
export const CARD_RUN_STATUS_TONE: Record<KanbanCardRunStatus, Tone> = {
  queued: "attention",
  starting: "info",
  working: "success",
  stalled: "attention",
  idle: "neutral",
  completed: "success",
  failed: "danger",
};

/** Left border token per run status; idle / queued keep the default border. */
export function cardStatusBorderClass(status: KanbanCardRunStatus): string {
  switch (status) {
    case "working":
      return "border-l-[3px] !border-l-success";
    case "stalled":
      return "border-l-[3px] !border-l-attention";
    case "failed":
      return "border-l-[3px] !border-l-danger";
    default:
      return "";
  }
}

/** Size badge for a priority; null (no badge) when the priority is unset. */
export function getPrioritySizeLabel(priority?: string | null): "S" | "M" | "L" | null {
  const normalized = priority?.trim().toLowerCase();
  if (!normalized) return null;
  switch (normalized) {
    case "high":
    case "urgent":
      return "L";
    case "low":
      return "S";
    case "medium":
    default:
      return "M";
  }
}

/**
 * The sync badge is about GitHub sync only. It used to also echo the process
 * state ("starting" / "queued"), which put two identical "starting" pills on
 * every running card; the run badge owns process state now.
 */
function getSyncBadgeTone(hasSyncError: boolean, githubSyncedAt?: string): Tone {
  if (hasSyncError) return "danger";
  if (githubSyncedAt) return "success";
  return "neutral";
}

function getSyncLabel(hasSyncError: boolean, githubSyncedAt?: string) {
  if (hasSyncError) return "syncIssue";
  if (githubSyncedAt) return "synced";
  return "notSynced";
}

function formatArtifactGateBadgeLabel(
  nextColumnName: string | undefined,
  missingArtifacts: string[],
) {
  if (missingArtifacts.length === 0) {
    return `${nextColumnName ?? "Next"} ready`;
  }

  if (missingArtifacts.length === 1) {
    return `Needs ${formatArtifactLabel(missingArtifacts[0])}`;
  }

  return `Needs ${formatArtifactLabel(missingArtifacts[0])} +${missingArtifacts.length - 1}`;
}

function formatArtifactCountTooltip(task: TaskInfo): string {
  const summary = task.artifactSummary;
  if (!summary || summary.total === 0) {
    return "noArtifactsAttached";
  }

  const parts = Object.entries(summary.byType)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([type, count]) => `${count} ${formatArtifactLabel(type)}${count === 1 ? "" : "s"}`);

  return parts.length > 0 ? parts.join(", ") : `${summary.total} artifacts`;
}

function normalizeCardPreviewText(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function buildCardSummary(task: TaskInfo, fallback: string): string {
  const canonicalStory = parseCanonicalStory(task.objective);
  if (canonicalStory.story) {
    const summary = [
      canonicalStory.story.story.problem_statement,
      canonicalStory.story.story.user_value,
    ]
      .map((value) => normalizeCardPreviewText(value))
      .filter(Boolean)
      .join(" ");

    if (summary) {
      return summary;
    }
  }

  return normalizeCardPreviewText(fallback);
}

/** Re-render every `intervalMs` while enabled, so "quiet for N min" keeps aging. */
function useNowTick(enabled: boolean, intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}

type ActivityDict = Record<string, string>;

function formatActivityLine(activity: CardActivityDetail, dict: ActivityDict): string | null {
  const fill = (template: string | undefined, values: Record<string, string>) => {
    let out = template ?? "";
    for (const [key, value] of Object.entries(values)) out = out.replace(`{${key}}`, value);
    return out;
  };
  const age = (() => {
    if (activity.quietMs === undefined) return null;
    if (activity.quietMs < 10_000) return dict.justNow;
    if (activity.quietMs < 60_000) {
      return fill(dict.secondsAgo, { count: String(Math.floor(activity.quietMs / 1000)) });
    }
    return fill(dict.minutesAgo, { count: String(Math.floor(activity.quietMs / 60_000)) });
  })();

  switch (activity.status) {
    case "failed":
      return activity.failureReason
        ? fill(dict.error, { reason: activity.failureReason })
        : null;
    case "stalled":
      return fill(dict.quietFor, { count: String(Math.floor((activity.quietMs ?? 0) / 60_000)) })
        + (activity.runningTool ? ` · ${fill(dict.runningTool, { tool: activity.runningTool })}` : "");
    case "working": {
      const parts = [
        activity.runningTool ? fill(dict.runningTool, { tool: activity.runningTool }) : null,
        age,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : dict.waitingFirst;
    }
    case "idle":
      return activity.turnDone
        ? [dict.turnDone, age].filter(Boolean).join(" · ")
        : null;
    case "starting":
      return dict.waitingFirst;
    default:
      return null;
  }
}

const STATUS_DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-secondary",
  info: "bg-information",
  attention: "bg-attention",
  danger: "bg-danger",
  success: "bg-success",
};

type BoardPageCopy = Record<"laneActivity" | "noActivity" | "ageJustNow" | "ageMinutes" | "ageHours" | "ageDays", string>;

function formatAge(ms: number, copy: BoardPageCopy): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return copy.ageJustNow;
  if (minutes < 60) return copy.ageMinutes.replace("{count}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return copy.ageHours.replace("{count}", String(hours));
  return copy.ageDays.replace("{count}", String(Math.floor(hours / 24)));
}

/**
 * Fallback activity line when no live session is attached: the newest lane
 * run's specialist and how long ago it started ("Dev Crafter · 1 h ago").
 * Returns null when the card has never run, so the card does not invent one.
 */
export function formatLaneActivityLine(
  task: Pick<TaskInfo, "laneSessions" | "updatedAt">,
  now: number,
  copy: BoardPageCopy,
): string | null {
  const latest = [...(task.laneSessions ?? [])]
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];
  if (!latest?.specialistName) return null;
  const at = new Date(latest.completedAt ?? latest.lastActivityAt ?? latest.startedAt).getTime();
  if (!Number.isFinite(at)) return null;
  return copy.laneActivity
    .replace("{who}", latest.specialistName)
    .replace("{age}", formatAge(Math.max(0, now - at), copy));
}

function KanbanCardSurface({
  task,
  boardColumns,
  linkedSession,
  liveMessageTail,
  availableProviders,
  specialists,
  specialistLanguage,
  codebases,
  allCodebaseIds,
  worktreeCache,
  autoProviderId,
  queuePosition,
  retryPending = false,
  onOpenDetail,
  onDelete,
  onPatchTask,
  onRetryTrigger,
  onRefresh,
  renderTitle,
  showWorkspace = false,
  workspaceName,
  dragHandleProps = {},
  dragOverlay = false,
  isDragging = false,
  style,
  wrapperRef,
}: KanbanCardSurfaceProps) {
  const { t } = useTranslation();
  const sessionStatus = linkedSession?.acpStatus;
  const isTerminalCard = task.columnId === "done" || task.columnId === "blocked";
  const now = useNowTick(!isTerminalCard && Boolean(linkedSession) && !dragOverlay);
  const resolveSpecialist = createKanbanSpecialistResolver(specialists);
  const effectiveAutomation = resolveEffectiveTaskAutomation(task, boardColumns, resolveSpecialist, {
    autoProviderId,
  });
  const prioritySizeLabel = getPrioritySizeLabel(task.priority);
  const mergeState = resolveCardMergeState(task);
  // Folds acpStatus, the live activity heartbeat and the lane-session record
  // so the badge can say working / may be stuck / parked / failed.
  const activity = describeCardActivity({
    task,
    acpStatus: sessionStatus,
    session: linkedSession,
    queuePosition,
    retryPending,
    now,
  });
  const runStatus = activity.status;
  const retrySubmit = useRetrySubmit(onRetryTrigger);
  const retryBusy = retrySubmit.submitting || retryPending;
  const canRetry = effectiveAutomation.canRun && (
    sessionStatus === "error"
    || (!isTerminalCard && activity.status === "failed")
    || (!task.triggerSessionId && task.columnId === "dev")
  ) && !queuePosition;
  const canRun = effectiveAutomation.canRun && !task.triggerSessionId && task.columnId !== "done" && !queuePosition;
  const pageCopy = t.kanbanBoardPage;
  const liveActivityLine = isTerminalCard ? null : formatActivityLine(activity, t.kanbanCardActivity as unknown as ActivityDict);
  const laneActivityLine = isTerminalCard ? null : formatLaneActivityLine(task, now, pageCopy);
  const activityLine = liveActivityLine ?? laneActivityLine;
  const lastActivityTitle = linkedSession?.lastActivityAt
    ? new Date(linkedSession.lastActivityAt).toLocaleString()
    : undefined;
  const statusLabel = cardRunStatusLabelKey(runStatus);
  const statusTone: Tone = isTerminalCard ? "success" : CARD_RUN_STATUS_TONE[runStatus];
  const resolvedStatusLabel = isTerminalCard
    ? t.kanban.done
    : queuePosition
      ? `${t.kanban.queued} #${queuePosition}`
      : statusLabel === "stalled"
        ? t.kanbanCardActivity.stalled
        : (t.kanban as Record<string, string>)[statusLabel] ?? statusLabel;
  const visibleLabels = (task.labels ?? []).slice(0, 2);
  const remainingLabelCount = Math.max((task.labels?.length ?? 0) - visibleLabels.length, 0);
  const visibleCodebaseIds = (task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds : allCodebaseIds).slice(0, 1);
  const remainingCodebaseCount = Math.max(
    (task.codebaseIds && task.codebaseIds.length > 0 ? task.codebaseIds.length : allCodebaseIds.length) - visibleCodebaseIds.length,
    0,
  );
  const syncLabelKey = getSyncLabel(Boolean(task.lastSyncError), task.githubSyncedAt);
  const resolvedSyncLabel = (t.kanban as Record<string, string>)[syncLabelKey] ?? syncLabelKey;
  const syncTone = getSyncBadgeTone(Boolean(task.lastSyncError), task.githubSyncedAt);
  const objectiveText = buildCardSummary(task, task.objective?.trim() || t.kanban.noObjective);
  const transitionArtifacts = resolveKanbanTransitionArtifacts(boardColumns, task.columnId);
  const missingNextArtifacts = transitionArtifacts.nextRequiredArtifacts.filter(
    (artifactType) => (task.artifactSummary?.byType?.[artifactType] ?? 0) === 0,
  );
  const artifactCount = task.artifactSummary?.total ?? 0;
  const artifactCountLabel = `${artifactCount} artifact${artifactCount === 1 ? "" : "s"}`;
  const artifactCountTooltip = formatArtifactCountTooltip(task);
  const artifactGateTooltip = transitionArtifacts.nextRequiredArtifacts.length > 0
    ? missingNextArtifacts.length === 0
      ? `Ready for ${transitionArtifacts.nextColumn?.name ?? "the next lane"}: ${transitionArtifacts.nextRequiredArtifacts.map((artifact) => formatArtifactLabel(artifact)).join(", ")} present.`
      : `Before ${transitionArtifacts.nextColumn?.name ?? "the next lane"}: missing ${missingNextArtifacts.map((artifact) => formatArtifactLabel(artifact)).join(", ")}.`
    : undefined;
  const hasReviewFeedback = Boolean(task.verificationReport?.trim())
    || (task.verificationVerdict != null && task.verificationVerdict !== "APPROVED");
  const reviewFeedbackPreview = summarizeReviewFeedback(task.verificationReport, 160);
  const reviewVerdictLabel = task.verificationVerdict === "NOT_APPROVED"
    ? t.kanbanDetail.reviewRequestedChanges
    : task.verificationVerdict === "BLOCKED"
      ? t.kanbanDetail.reviewBlockedVerdict
      : task.verificationVerdict === "APPROVED"
        ? t.kanbanDetail.reviewApprovedVerdict
        : t.kanbanDetail.reviewFeedback;
  const reviewFeedbackTone = task.verificationVerdict === "BLOCKED"
    ? "border-danger bg-danger-subtle text-danger"
    : task.verificationVerdict === "APPROVED"
      ? "border-success bg-success-subtle text-success"
      : "border-attention bg-attention-subtle text-attention";
  const borderClass = isTerminalCard || dragOverlay ? "" : cardStatusBorderClass(runStatus);
  const cardClassName = `group relative flex flex-col gap-1.5 rounded-md border border-default bg-surface py-2.5 pl-7 pr-2.5 ${borderClass} transition-[background-color,border-color,box-shadow,opacity] duration-150 motion-reduce:transition-none hover:bg-hover focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${dragOverlay
    ? "pointer-events-none shadow-overlay ring-2 ring-accent will-change-transform"
    : isDragging
      ? "opacity-15"
      : ""}`.trim();
  const workspaceLabel = showWorkspace ? (workspaceName ?? pageCopy.unknownWorkspace) : null;

  void availableProviders;
  void specialistLanguage;
  void onPatchTask;
  void onRefresh;

  const stopCardInteraction = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  return (
    <div
      ref={wrapperRef}
      style={style}
      onClick={dragOverlay ? undefined : onOpenDetail}
      onKeyDown={dragOverlay ? undefined : (event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetail();
        }
      }}
      role={dragOverlay ? undefined : "button"}
      tabIndex={dragOverlay ? -1 : 0}
      aria-label={dragOverlay ? undefined : `${t.kanban.openCard} ${task.title}`}
      className={cardClassName}
      data-testid={dragOverlay ? "kanban-card-overlay" : "kanban-card"}
      data-card-id={dragOverlay ? undefined : task.id}
      data-column-id={dragOverlay ? undefined : task.columnId}
    >
      <button
        type="button"
        {...dragHandleProps}
        onClickCapture={stopCardInteraction}
        className="absolute left-1.5 top-2.5 rounded p-0.5 text-secondary transition hover:bg-hover hover:text-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
        aria-label={`${t.kanban.dragCard} ${task.title}`}
        title={t.kanban.dragCard}
        style={{ touchAction: "none" }}
        data-testid="kanban-card-drag-handle"
      >
        <GripVertical className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" />
      </button>

      <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-secondary" data-testid="kanban-card-meta">
        {workspaceLabel && (
          <span className="min-w-0 truncate rounded bg-subtle px-1.5 py-0.5 text-[11px] text-secondary" data-testid="kanban-card-workspace">
            {workspaceLabel}
          </span>
        )}
        {task.githubNumber ? (
          <a
            href={task.githubUrl}
            target="_blank"
            rel="noreferrer"
            onClick={stopCardInteraction}
            className="shrink-0 rounded hover:opacity-80"
          >
            <Badge tone={task.isPullRequest ? "info" : "attention"}>
              {task.isPullRequest ? `PR #${task.githubNumber}` : `Issue #${task.githubNumber}`}
            </Badge>
          </a>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[11px] text-secondary" data-testid="kanban-card-id">
          {task.id.slice(0, 8)}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="shrink-0 rounded p-0.5 text-danger opacity-0 transition hover:bg-danger-subtle focus-visible:opacity-100 group-hover:opacity-100"
          title={t.kanban.deleteTask}
          aria-label={`${t.kanban.deleteTask} ${task.title}`}
          data-testid="kanban-card-delete"
        >
          <Trash2 className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"/>
        </button>
      </div>

      <div className="text-[13px] font-[550] leading-[1.45] text-primary [overflow-wrap:anywhere]" data-testid="kanban-card-title">
        {renderTitle ? renderTitle(task.title) : task.title}
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span
          className="inline-flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-primary"
          data-testid="kanban-card-run-status"
          data-run-status={isTerminalCard ? "done" : runStatus}
          data-tone={statusTone}
        >
          <span
            aria-hidden="true"
            data-testid="kanban-card-status-dot"
            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[statusTone]}${!isTerminalCard && (runStatus === "working" || runStatus === "starting") ? " motion-safe:animate-pulse" : ""}`}
          />
          {resolvedStatusLabel}
        </span>
        <Badge tone={syncTone}>{resolvedSyncLabel}</Badge>
        {mergeState !== "unknown" && (
          <span data-testid={`kanban-card-merge-state-${mergeState}`} className="inline-flex">
            <Badge tone={mergeState === "unmerged" ? "attention" : "neutral"}>
              {mergeState === "unmerged" ? t.kanbanDetail.unmerged : t.kanbanDetail.merged}
            </Badge>
          </span>
        )}
        {prioritySizeLabel && (
          <span data-testid="kanban-card-priority-size" className="inline-flex">
            <Badge tone={getPriorityBadgeTone(task.priority)}>{prioritySizeLabel}</Badge>
          </span>
        )}
        {(canRun || canRetry || retrySubmit.submitting) && (
          <Button
            variant={canRetry ? "secondary" : "ghost"}
            size="xs"
            className="ml-auto"
            disabled={retryBusy}
            aria-busy={retryBusy}
            data-testid="kanban-card-run"
            onClick={(event) => {
              event.stopPropagation();
              void retrySubmit.submit(task.id);
            }}
          >
            {retryBusy ? t.kanban.retryStarting : canRetry ? t.kanban.rerun : t.kanban.run}
          </Button>
        )}
      </div>

      {activityLine && (
        <div
          className={`text-[11px] leading-[1.4] [overflow-wrap:anywhere] ${runStatus === "failed"
            ? "text-danger"
            : runStatus === "stalled"
              ? "font-medium text-attention"
              : "text-secondary"}`}
          title={[activityLine, lastActivityTitle].filter(Boolean).join(" · ")}
          data-testid="kanban-card-activity"
        >
          {activityLine}
        </div>
      )}

      {(transitionArtifacts.nextRequiredArtifacts.length > 0 || artifactCount > 0) && (
        <div className="flex flex-wrap items-center gap-1">
          {transitionArtifacts.nextRequiredArtifacts.length > 0 && (
            <span title={artifactGateTooltip} data-testid="kanban-card-artifact-gate" className="inline-flex">
              <Badge tone={missingNextArtifacts.length === 0 ? "success" : "attention"}>
                {formatArtifactGateBadgeLabel(transitionArtifacts.nextColumn?.name, missingNextArtifacts)}
              </Badge>
            </span>
          )}
          {artifactCount > 0 && (
            <span title={artifactCountTooltip} data-testid="kanban-card-artifact-count" className="inline-flex">
              <Badge>{artifactCountLabel}</Badge>
            </span>
          )}
        </div>
      )}

      <p className="line-clamp-3 text-[11px] leading-[1.45] text-secondary">{objectiveText}</p>
      {hasReviewFeedback && (
        <div
          className={`rounded border px-2 py-1.5 ${reviewFeedbackTone}`}
          data-testid="kanban-card-review-feedback"
        >
          <div className="flex flex-wrap items-center gap-1 text-[11px] font-semibold">
            <span>{t.kanbanDetail.reviewFeedback}</span>
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium">
              {task.columnId === "dev" && task.verificationVerdict !== "APPROVED"
                ? t.kanbanDetail.reviewReturnedToDev
                : reviewVerdictLabel}
            </span>
          </div>
          {(reviewFeedbackPreview || task.verificationVerdict) && (
            <div
              className="mt-1 line-clamp-2 text-[11px] leading-[1.4]"
              title={task.verificationReport ?? reviewVerdictLabel}
            >
              {reviewFeedbackPreview ?? reviewVerdictLabel}
            </div>
          )}
        </div>
      )}
      {!isTerminalCard && liveMessageTail && (
        <div className="rounded border border-default bg-subtle px-2 py-1.5">
          <div className="text-[11px] font-semibold text-information">
            {t.kanban.liveSession}
          </div>
          <div
            className="mt-1 line-clamp-2 font-mono text-[11px] leading-[1.4] text-primary"
            title={liveMessageTail}
            data-testid="kanban-card-live-tail"
          >
            {liveMessageTail}
          </div>
        </div>
      )}

      {(visibleLabels.length > 0
        || ((task.codebaseIds && task.codebaseIds.length > 0) || allCodebaseIds.length > 0)
        || task.worktreeId) && (
        <div className="flex flex-wrap items-center gap-1">
          {visibleLabels.map((label) => (
            <Badge key={label}>{label}</Badge>
          ))}
          {remainingLabelCount > 0 && <Badge>+{remainingLabelCount}</Badge>}
          {visibleCodebaseIds.map((cbId) => {
            const cb = codebases.find((c) => c.id === cbId);
            return cb ? (
              <span key={cbId} data-testid="repo-badge" className="inline-flex">
                <Badge tone="info">{cb.label ?? cb.repoPath.split("/").pop() ?? cb.repoPath}</Badge>
              </span>
            ) : (
              <span key={cbId} title={t.kanban.repoMissing} className="inline-flex">
                <Badge tone="danger">{t.kanban.repoMissing}</Badge>
              </span>
            );
          })}
          {remainingCodebaseCount > 0 && (
            <Badge>+{remainingCodebaseCount} repo{remainingCodebaseCount > 1 ? "s" : ""}</Badge>
          )}
          <WorktreeBadge task={task} worktreeCache={worktreeCache} onOpenDetail={onOpenDetail} stopCardInteraction={stopCardInteraction} />
        </div>
      )}
    </div>
  );
}

export function KanbanCard({
  ...props
}: KanbanCardProps) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
  } = useDraggable({
    id: props.task.id,
    data: {
      taskId: props.task.id,
      columnId: props.task.columnId,
    },
  });

  return (
    <KanbanCardSurface
      {...props}
      wrapperRef={setNodeRef}
      dragHandleProps={{ ...attributes, ...listeners }}
      isDragging={isDragging}
      style={isDragging ? { opacity: 0.16 } : undefined}
    />
  );
}

export function KanbanCardOverlay(props: KanbanCardProps) {
  return <KanbanCardSurface {...props} dragOverlay />;
}

interface WorktreeBadgeProps {
  task: TaskInfo;
  worktreeCache: Record<string, WorktreeInfo>;
  onOpenDetail: () => void;
  stopCardInteraction: (event: { stopPropagation: () => void }) => void;
}

function WorktreeBadge({ task, worktreeCache, onOpenDetail, stopCardInteraction }: WorktreeBadgeProps) {
  const { t } = useTranslation();
  if (!task.worktreeId) return null;

  const wt = worktreeCache[task.worktreeId];
  if (!wt) {
    return (
      <div className="inline-flex items-center text-[10px] text-secondary">
        worktree {t.common.loading}...
      </div>
    );
  }

  const wtDotColor = wt.status === "active"
    ? STATUS_DOT_CLASS.success
    : wt.status === "creating"
      ? STATUS_DOT_CLASS.attention
      : STATUS_DOT_CLASS.danger;

  return (
    <button
      type="button"
      onClick={(event) => {
        stopCardInteraction(event);
        onOpenDetail();
      }}
      className="inline-flex max-w-full items-center gap-1 text-[10px] text-secondary transition hover:text-primary"
      title={t.kanban.worktreeLoading}
      data-testid="worktree-badge"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${wtDotColor}`} />
      <span className="truncate">
        worktree {wt.status} · {wt.branch}
      </span>
    </button>
  );
}
