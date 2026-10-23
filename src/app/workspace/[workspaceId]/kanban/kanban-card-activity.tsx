"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  Braces,
  Check,
  CircleCheckBig,
  ClipboardList,
  Copy,
  GitPullRequest,
  Inbox,
  Layers3,
  PanelRightClose,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "@/i18n";
import type { AcpProviderInfo } from "@/client/acp-client";
import { resolveEffectiveTaskAutomation } from "@/core/kanban/effective-task-automation";
import type { KanbanColumnInfo } from "../types";
import type { SessionInfo, TaskInfo, TaskRunInfo } from "../types";
import {
  buildSessionDisplayLabel,
  createKanbanSpecialistResolver,
  formatSessionTimestamp,
  getLaneSessionStepLabel,
  getStableOrderedSessionIds,
  getSpecialistName,
  type KanbanSpecialistOption,
} from "./kanban-card-session-utils";
import { DETAIL_PANE_BUTTON_CLASS } from "./kanban-card-detail-toolbar";
import type { KanbanSpecialistLanguage } from "./kanban-specialist-language";
import { getKanbanSessionCopy } from "./i18n/kanban-session-copy";
import { useTaskRuns } from "./use-task-runs";
import { resolveSessionModelChips } from "./kanban-session-activity";
import { useModelEffortChoices } from "./kanban-model-effort-fields";
import { buildRunTabTooltip } from "./kanban-run-tab-tooltip";

function formatTaskRunKind(kind: TaskRunInfo["kind"] | undefined): string {
  switch (kind) {
    case "a2a_task":
      return "A2A";
    case "runner_acp":
      return "Runner ACP";
    case "embedded_acp":
      return "ACP";
    default:
      return "Run";
  }
}

function formatTaskRunStatus(status: TaskRunInfo["status"] | undefined, endedLabel: string): string {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
    case "transitioned":
      return endedLabel;
    case "failed":
      return "Failed";
    case "timed_out":
      return "Timed out";
    default:
      return "Unknown";
  }
}

function getTaskRunStatusClasses(status: TaskRunInfo["status"] | undefined): string {
  switch (status) {
    case "failed":
    case "timed_out":
      return "bg-danger-subtle text-danger";
    case "running":
      return "bg-accent-subtle text-information";
    // A lane session that ended normally is not an error: grey "Ended".
    case "completed":
    case "transitioned":
    default:
      return "bg-subtle text-secondary";
  }
}

function getLaneBadgeClasses(_laneLabel: string | undefined): string {
  return "bg-subtle text-secondary";
}

function getRunTabClasses(status: TaskRunInfo["status"] | undefined, active: boolean): string {
  const stateClasses = status === "failed" || status === "timed_out"
    ? (active ? "border-danger bg-danger-subtle text-primary" : "border-danger bg-surface text-secondary hover:bg-danger-subtle")
    : status === "running"
      ? (active ? "border-accent bg-accent-subtle text-primary" : "border-accent bg-surface text-secondary hover:bg-accent-subtle")
      : (active ? "border-accent bg-accent-subtle text-primary" : "border-default bg-surface text-secondary hover:bg-hover");

  return `inline-flex min-w-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${stateClasses}`;
}

function formatAgentCardTarget(agentCardUrl?: string): string | undefined {
  const trimmed = agentCardUrl?.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    return `${parsed.hostname}${parsed.pathname !== "/" ? parsed.pathname : ""}`;
  } catch {
    return trimmed.replace(/^https?:\/\//, "");
  }
}

function formatExpectedRunTarget(
  task: TaskInfo,
  boardColumns: KanbanColumnInfo[],
  availableProviders: AcpProviderInfo[],
  specialists: KanbanSpecialistOption[],
  workspaceDefaultLabel: string,
  autoProviderId?: string,
): string {
  const resolveSpecialist = createKanbanSpecialistResolver(specialists);
  const effectiveAutomation = resolveEffectiveTaskAutomation(task, boardColumns, resolveSpecialist, {
    autoProviderId,
  });
  const specialistName = getSpecialistName(
    effectiveAutomation.specialistId,
    effectiveAutomation.specialistName,
    specialists,
  );

  if (effectiveAutomation.transport === "a2a") {
    return [
      "A2A",
      effectiveAutomation.role ?? "DEVELOPER",
      specialistName,
      formatAgentCardTarget(effectiveAutomation.agentCardUrl),
      effectiveAutomation.skillId ? `skill:${effectiveAutomation.skillId}` : undefined,
    ].filter(Boolean).join(" · ");
  }

  const providerName = effectiveAutomation.providerId
    ? availableProviders.find((provider) => provider.id === effectiveAutomation.providerId)?.name ?? effectiveAutomation.providerId
    : workspaceDefaultLabel;
  return [providerName, effectiveAutomation.role ?? "DEVELOPER", specialistName].join(" · ");
}

function formatLaneSessionHeading(
  laneSession: NonNullable<TaskInfo["laneSessions"]>[number] | undefined,
  session: SessionInfo | undefined,
): string {
  if (laneSession?.transport === "a2a") {
    return laneSession.externalTaskId
      ? `A2A Task · ${laneSession.externalTaskId}`
      : laneSession.contextId
        ? `A2A Context · ${laneSession.contextId}`
        : "A2A Task";
  }

  return session?.name ?? session?.provider ?? "Automation Run";
}

function renderLaneIcon(laneLabel: string | undefined) {
  const normalized = laneLabel?.trim().toLowerCase() ?? "";
  const iconClassName = "h-3.5 w-3.5";

  if (normalized.includes("backlog") || normalized.includes("梳理")) {
    return <Inbox className={iconClassName} aria-hidden="true" />;
  }
  if (normalized.includes("todo") || normalized.includes("编排")) {
    return <ClipboardList className={iconClassName} aria-hidden="true" />;
  }
  if (
    normalized.includes("dev")
    || normalized.includes("develop")
    || normalized.includes("开发")
    || normalized.includes("execute")
  ) {
    return <Braces className={iconClassName} aria-hidden="true" />;
  }
  if (normalized.includes("review") || normalized.includes("评审") || normalized.includes("gate")) {
    return <ShieldCheck className={iconClassName} aria-hidden="true" />;
  }
  if (normalized.includes("pr") || normalized.includes("publish")) {
    return <GitPullRequest className={iconClassName} aria-hidden="true" />;
  }
  if (normalized.includes("done") || normalized.includes("complete") || normalized.includes("completed")) {
    return <CircleCheckBig className={iconClassName} aria-hidden="true" />;
  }

  return <Layers3 className={iconClassName} aria-hidden="true" />;
}

function ActivitySection({
  title,
  description,
  children,
  compact = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`border-b border-default last:border-b-0 ${compact ? "space-y-2 py-3" : "space-y-3 py-4"}`} data-testid="kanban-detail-run-records">
      <div>
        <h3 className="m-0 text-[13px] font-semibold text-primary">{title}</h3>
        {description && (
          <p className="m-0 mt-1 text-xs text-secondary">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function handleSessionRowKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  onSelectSession: ((sessionId: string) => void) | undefined,
  sessionId: string,
) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  event.preventDefault();
  onSelectSession?.(sessionId);
}

function SessionIdChip({
  sessionId,
  compact = false,
}: {
  sessionId: string;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard.writeText(sessionId).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      setCopied(false);
    });
  };

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${compact ? "max-w-[13rem]" : "max-w-[18rem]"}`}>
      <span
        className={`min-w-0 break-all rounded-lg bg-subtle font-mono text-[10px] text-secondary ${compact ? "px-1.5 py-0.5" : "px-2 py-1"}`}
        title={sessionId}
      >
        {sessionId}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 rounded p-0.5 text-secondary transition-colors hover:bg-hover hover:text-secondary focus-visible:outline-2 focus-visible:outline-accent"
        title={t.common.copyToClipboard}
        aria-label={t.common.copyToClipboard}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  );
}

export function KanbanCardActivityPanel({
  task,
  sessions,
  specialists,
  specialistLanguage = "en",
  autoProviderId: _autoProviderId,
  currentSessionId,
  onSelectSession,
  refreshSignal,
  compact = false,
}: {
  task: TaskInfo;
  sessions: SessionInfo[];
  specialists: KanbanSpecialistOption[];
  specialistLanguage?: KanbanSpecialistLanguage;
  autoProviderId?: string;
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  refreshSignal?: number;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const copy = getKanbanSessionCopy(specialistLanguage);
  const { runs, error } = useTaskRuns(
    task.id,
    `${refreshSignal ?? ""}:${task.updatedAt ?? ""}:${task.triggerSessionId ?? ""}:${task.laneSessions?.length ?? 0}`,
  );

  return (
    <ActivitySection
      title={t.kanbanDetailRedesign.runRecords}
      description={compact ? undefined : copy.activityDescription}
      compact={compact}
    >
      {error && (
        <div className="rounded-md border-l-2 border-attention bg-attention-subtle px-3 py-2 text-xs text-attention">
          {t.kanbanDetailRedesign.runLedgerUnavailable} {error}
        </div>
      )}
      <SessionHistoryPanel
        task={task}
        runs={runs ?? undefined}
        specialists={specialists}
        sessions={sessions}
        specialistLanguage={specialistLanguage}
        currentSessionId={currentSessionId}
        onSelectSession={onSelectSession}
        compact={compact}
      />
    </ActivitySection>
  );
}

export function KanbanCardActivityBar({
  task,
  sessions = [],
  specialistLanguage = "en",
  currentSessionId,
  onSelectSession,
  onCloseSession,
}: {
  task: TaskInfo;
  sessions?: SessionInfo[];
  specialistLanguage?: KanbanSpecialistLanguage;
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  onCloseSession?: () => void;
}) {
  const { t } = useTranslation();
  const copy = getKanbanSessionCopy(specialistLanguage);
  const sessionTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const { runs, error } = useTaskRuns(
    task.id,
    `${task.updatedAt ?? ""}:${task.triggerSessionId ?? ""}:${task.laneSessions?.length ?? 0}`,
  );
  const orderedSessionIds = getStableOrderedSessionIds(task, runs);
  const laneSessions = task.laneSessions ?? [];
  const laneSessionMap = new Map(laneSessions.map((entry) => [entry.sessionId, entry]));
  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const runMap = new Map((runs ?? []).map((run) => [run.sessionId ?? run.id, run]));
  const selectedRunId = currentSessionId && orderedSessionIds.includes(currentSessionId)
    ? currentSessionId
    : orderedSessionIds[orderedSessionIds.length - 1];
  const selectedLaneSession = selectedRunId ? laneSessionMap.get(selectedRunId) : undefined;
  const selectedRun = selectedRunId ? runMap.get(selectedRunId) : undefined;
  const selectedStepLabel = getLaneSessionStepLabel(selectedLaneSession);
  const hideSessionPaneButton = onCloseSession ? (
    <button
      type="button"
      onClick={onCloseSession}
      className={DETAIL_PANE_BUTTON_CLASS}
      aria-label={copy.closeSessionPane}
      title={copy.closeSessionPane}
    >
      <PanelRightClose className="h-4 w-4" aria-hidden="true" />
      <span>{copy.closeSessionPane}</span>
    </button>
  ) : null;

  useEffect(() => {
    if (!selectedRunId) return;
    sessionTabRefs.current[selectedRunId]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedRunId]);

  if (orderedSessionIds.length === 0) {
    return (
      <div className="flex items-center justify-between gap-3 border-b border-dashed border-default px-3 py-2 text-[11px] text-secondary">
        <span>{copy.noRunsInline}</span>
        {hideSessionPaneButton}
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1 py-1">
      {error && (
        <div className="border-l-2 border-attention px-3 py-2 text-[11px] text-attention">
          {t.kanbanDetailRedesign.runLedgerUnavailable}
        </div>
      )}
      <div className="flex items-start gap-2 border-b border-default pb-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-end gap-1.5 border-default pr-1 pb-1">
          {orderedSessionIds.map((sessionId, index) => {
            const active = sessionId === selectedRunId;
            const laneSession = laneSessionMap.get(sessionId);
            const run = runMap.get(sessionId);
            const laneLabel = laneSession?.columnName ?? laneSession?.columnId ?? t.kanban.runLabel;
            const runLabel = buildSessionDisplayLabel(sessionId, index, sessionMap);
            const fullTabLabel = laneSession?.stepName?.trim() || runLabel;
            const runTabTooltip = buildRunTabTooltip({
              index,
              columnId: laneSession?.columnId ?? run?.columnId,
              columnName: laneSession?.columnName,
              status: run?.status ?? laneSession?.status,
              startedAt: laneSession?.startedAt || run?.startedAt,
              completedAt: laneSession?.completedAt || run?.completedAt,
              stepLabel: fullTabLabel,
              now: new Date(),
              copy: t.kanbanDetailRedesign.runTabTooltip,
            });

            return (
              <button
                key={sessionId}
                type="button"
                ref={(node) => {
                  sessionTabRefs.current[sessionId] = node;
                }}
                onClick={() => onSelectSession?.(sessionId)}
                className={getRunTabClasses(run?.status ?? laneSession?.status, active)}
                aria-pressed={active}
                title={runTabTooltip}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${getLaneBadgeClasses(laneLabel)}`}
                  aria-label={laneLabel}
                >
                  {renderLaneIcon(laneLabel)}
                </span>
                <span className={`px-0.5 text-[10px] font-semibold tabular-nums ${
                  active
                    ? "text-primary"
                    : "text-secondary"
                }`}>
                  {index + 1}
                </span>
              </button>
            );
          })}
        </div>
        {hideSessionPaneButton}
      </div>
      {(selectedLaneSession?.columnName || selectedStepLabel || selectedLaneSession?.status) && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-default pb-1 text-[10px]">
          {selectedLaneSession?.columnName && (
            <span className="rounded-full bg-accent-subtle px-2 py-0.5 font-semibold text-information">
              {selectedLaneSession.columnName}
            </span>
          )}
          {selectedLaneSession?.transport && (
            <span className="rounded-full bg-accent-subtle px-2 py-0.5 font-semibold text-information">
              {selectedLaneSession.transport}
            </span>
          )}
          {selectedRun && (
            <span className={`rounded-full px-2 py-0.5 font-semibold ${getTaskRunStatusClasses(selectedRun.status)}`}>
              {formatTaskRunStatus(selectedRun.status, t.kanbanDetailRedesign.runEnded)}
            </span>
          )}
          {selectedStepLabel && (
            <span className="rounded-full bg-accent-subtle px-2 py-0.5 font-semibold text-information">
              {selectedStepLabel}
            </span>
          )}
          {selectedLaneSession?.status && !selectedRun && (
            <span className={`rounded-full px-2 py-0.5 font-semibold ${getTaskRunStatusClasses(selectedLaneSession.status)}`}>
              {formatTaskRunStatus(selectedLaneSession.status, t.kanbanDetailRedesign.runEnded)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function SessionHistoryPanel({
  task,
  runs,
  specialists,
  sessions,
  specialistLanguage = "en",
  currentSessionId,
  onSelectSession,
  compact = false,
}: {
  task: TaskInfo;
  runs?: TaskRunInfo[];
  specialists: KanbanSpecialistOption[];
  sessions: SessionInfo[];
  specialistLanguage?: KanbanSpecialistLanguage;
  currentSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const copy = getKanbanSessionCopy(specialistLanguage);
  const laneSessions = task.laneSessions ?? [];
  const orderedSessionIds = getStableOrderedSessionIds(task, runs);
  // Display names for the model / effort chips; a provider without options
  // (or still loading) just shows the raw ids.
  const chipProviderIds = orderedSessionIds.map((sessionId) => (
    sessions.find((session) => session.sessionId === sessionId)?.provider
      ?? laneSessions.find((entry) => entry.sessionId === sessionId)?.provider
      ?? ""
  ));
  const chipChoicesByProvider = useModelEffortChoices(chipProviderIds);

  if (orderedSessionIds.length === 0) {
    return (
      <div className={`border-b border-dashed border-default text-sm text-secondary ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
        <div className="text-[11px] font-semibold text-secondary">{copy.runHistoryTitle}</div>
        <div className="mt-2">{copy.noRunsHistory} {copy.noRunsHistoryHint}</div>
      </div>
    );
  }

  const sessionMap = new Map(sessions.map((session) => [session.sessionId, session]));
  const laneSessionMap = new Map(laneSessions.map((entry) => [entry.sessionId, entry]));
  const runMap = new Map((runs ?? []).map((run) => [run.sessionId ?? run.id, run]));

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold text-secondary">{copy.runHistoryTitle}</div>
          <div className="mt-1 text-xs text-secondary">
            {copy.runHistoryCount(orderedSessionIds.length)}
          </div>
        </div>
        <div className="border border-default px-2.5 py-1 text-[10px] font-semibold text-secondary">
          {t.kanban.currentLane}: {task.columnId ?? t.kanban.backlog}
        </div>
      </div>
      <div className={`overflow-y-auto pr-1 ${compact ? "mt-3 max-h-80 space-y-1.5" : "mt-4 max-h-[34rem] space-y-2"}`}>
        {orderedSessionIds.map((sessionId, index) => {
          const session = sessionMap.get(sessionId);
          const isCurrent = sessionId === currentSessionId;
          const laneSession = laneSessionMap.get(sessionId);
          const run = runMap.get(sessionId);
          const selectedSessionId = run?.sessionId ?? sessionId;
          const laneSpecialist = getSpecialistName(
            laneSession?.specialistId,
            run?.specialistName ?? laneSession?.specialistName,
            specialists,
          );
          const stepLabel = getLaneSessionStepLabel(laneSession);
          const isA2ARun = laneSession?.transport === "a2a";
          const modelChips = isA2ARun
            ? undefined
            : resolveSessionModelChips(
              session,
              laneSession,
              chipChoicesByProvider[session?.provider ?? laneSession?.provider ?? ""],
            );
          const reconnectLabel = run?.resumeTarget?.type === "external_task" ? t.kanban.inspectLabel : t.kanban.openLabel;

          return (
            <div
              key={sessionId}
              role="button"
              tabIndex={0}
              onClick={() => onSelectSession?.(selectedSessionId)}
              onKeyDown={(event) => handleSessionRowKeyDown(event, onSelectSession, selectedSessionId)}
              className={`w-full cursor-pointer rounded-md border text-left text-primary transition-colors ${compact ? "px-2.5 py-2" : "px-3 py-2.5"} ${
                isCurrent
                  ? "border-accent bg-accent-subtle"
                  : "border-default bg-surface hover:bg-hover"
              } focus-visible:outline-2 focus-visible:outline-accent`}
              aria-pressed={isCurrent}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {t.kanban.runLabel} {index + 1}
                </span>
                {run && (
                  <span className="rounded-full border border-default px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {formatTaskRunKind(run.kind)}
                  </span>
                )}
                {laneSession?.columnName && (
                  <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-information">
                    {laneSession.columnName}
                  </span>
                )}
                {laneSession?.transport && (
                  <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-information">
                    {laneSession.transport}
                  </span>
                )}
                {stepLabel && (
                  <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-information">
                    {stepLabel}
                  </span>
                )}
                {isCurrent && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-on-accent">
                    {t.common.active}
                  </span>
                )}
                {(run?.status ?? laneSession?.status) && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${getTaskRunStatusClasses(run?.status ?? laneSession?.status)}`}>
                    {formatTaskRunStatus(run?.status ?? laneSession?.status, t.kanbanDetailRedesign.runEnded)}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={`truncate font-medium text-primary ${compact ? "text-[13px]" : "text-sm"}`}>
                    {laneSession ? formatLaneSessionHeading(laneSession, session) : (session?.name ?? session?.provider ?? t.kanban.acpSession)}
                  </div>
                  <div className="mt-0.5 text-xs text-secondary">
                    {isA2ARun
                      ? [
                        t.kanbanDetailRedesign.remoteTask,
                        laneSession?.role ?? t.kanban.unknownRole,
                        laneSpecialist,
                      ].filter(Boolean).join(" · ")
                      : [
                        laneSession?.provider ?? session?.provider ?? t.kanban.unknownProvider,
                        laneSession?.role ?? session?.role ?? t.kanban.unknownRole,
                        laneSpecialist,
                      ].filter(Boolean).join(" · ")}
                  </div>
                  {!isA2ARun && (
                    <div className="mt-1 flex flex-wrap items-center gap-1" data-testid="kanban-run-model">
                      <span
                        className={`max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-semibold ${modelChips?.model ? "bg-accent-subtle text-information" : "bg-subtle text-secondary"}`}
                        title={`${t.kanbanModelSelection.model}: ${modelChips?.model?.id ?? t.kanbanDetailRedesign.runModelNotRecorded}`}
                        aria-label={`${t.kanbanModelSelection.model}: ${modelChips?.model?.label ?? t.kanbanDetailRedesign.runModelNotRecorded}`}
                        data-testid="kanban-run-model-chip"
                      >
                        {modelChips?.model?.label ?? t.kanbanDetailRedesign.runModelNotRecorded}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${modelChips?.effort ? "bg-success-subtle text-success" : "bg-subtle text-secondary"}`}
                        title={`${t.kanbanModelSelection.reasoningEffort}: ${modelChips?.effort?.id ?? t.kanbanDetailRedesign.runEffortNotRecorded}`}
                        aria-label={`${t.kanbanModelSelection.reasoningEffort}: ${modelChips?.effort?.label ?? t.kanbanDetailRedesign.runEffortNotRecorded}`}
                        data-testid="kanban-run-effort-chip"
                      >
                        {modelChips?.effort?.label ?? t.kanbanDetailRedesign.runEffortNotRecorded}
                      </span>
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-secondary">
                    {formatSessionTimestamp(run?.startedAt ?? session?.createdAt ?? laneSession?.startedAt)}
                  </div>
                </div>
                <SessionIdChip
                  sessionId={run?.externalTaskId ?? laneSession?.externalTaskId ?? sessionId}
                  compact={compact}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-secondary">
                <span className="truncate">
                  {isA2ARun
                    ? (run?.contextId ?? laneSession?.contextId) ? `Context ${run?.contextId ?? laneSession?.contextId}` : t.kanbanDetailRedesign.remoteTaskMetadata
                    : session?.cwd ?? t.kanban.workingDirUnavailable}
                </span>
                <span className="font-medium text-information">{reconnectLabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function KanbanEmptySessionPane({
  task,
  boardColumns,
  availableProviders,
  specialists,
  specialistLanguage = "en",
  autoProviderId,
  onCloseSession,
}: {
  task: TaskInfo;
  boardColumns: KanbanColumnInfo[];
  availableProviders: AcpProviderInfo[];
  specialists: KanbanSpecialistOption[];
  specialistLanguage?: KanbanSpecialistLanguage;
  autoProviderId?: string;
  onCloseSession?: () => void;
}) {
  const { t } = useTranslation();
  const copy = getKanbanSessionCopy(specialistLanguage);
  const target = formatExpectedRunTarget(
    task,
    boardColumns,
    availableProviders,
    specialists,
    t.kanban.workspaceDefault,
    autoProviderId,
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-default py-2 pl-2 pr-2" data-testid="kanban-session-pane-top-row">
        <KanbanCardActivityBar
          task={task}
          specialistLanguage={specialistLanguage}
          onCloseSession={onCloseSession}
        />
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="w-full max-w-lg border border-default p-4">
          <div className="text-[11px] font-semibold text-information">{copy.emptyPaneEyebrow}</div>
          <div className="mt-1 text-lg font-semibold text-primary">{copy.emptyPaneTitle}</div>
          <p className="mt-2 text-sm leading-6 text-secondary">{copy.emptyPaneDescription}</p>
          <p className="mt-2 text-sm leading-6 text-secondary">{copy.emptyPaneHint}</p>
          <div className="mt-3 border-l-2 border-accent bg-accent-subtle px-3 py-2.5 text-sm font-medium text-information">
            {copy.expectedTarget(target)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HandoffPanel({ task, compact = false }: { task: TaskInfo; compact?: boolean }) {
  const { t } = useTranslation();
  const handoffs = task.laneHandoffs ?? [];
  if (handoffs.length === 0) {
    return (
      <div className={`border-b border-dashed border-default text-sm text-secondary ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
        <div className="text-[11px] font-semibold text-secondary">{t.kanban.laneHandoffs}</div>
        <div className="mt-2">{t.kanban.noLaneHandoffsYet}</div>
      </div>
    );
  }

  const orderedHandoffs = handoffs.slice().sort((left, right) => (
    new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime()
  ));

  return (
    <>
      <div>
        <div className="text-[11px] font-semibold text-secondary">{t.kanban.laneHandoffs}</div>
        <div className="mt-1 text-xs text-secondary">
          {t.kanban.laneHandoffsDescription}
        </div>
      </div>
      <div className={`space-y-2 ${compact ? "mt-3" : "mt-4"}`}>
        {orderedHandoffs.map((handoff) => (
          <div
            key={handoff.id}
            className="border-b border-default px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-information">
                {handoff.requestType.replace(/_/g, " ")}
              </span>
              <span className="rounded-full bg-attention-subtle px-2 py-0.5 text-[10px] font-semibold text-attention">
                {handoff.status}
              </span>
            </div>
            <div className="mt-2 text-sm text-primary">{handoff.request}</div>
            {handoff.responseSummary && (
              <div className="mt-2 border-l-2 border-success px-3 py-2 text-xs text-success">
                {handoff.responseSummary}
              </div>
            )}
            <div className="mt-2 text-[11px] text-secondary">
              {t.kanban.requested} {formatSessionTimestamp(handoff.requestedAt)}{handoff.respondedAt ? ` · ${t.kanban.responded} ${formatSessionTimestamp(handoff.respondedAt)}` : ""}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function GitHubPanel({ task, compact = false }: { task: TaskInfo; compact?: boolean }) {
  const { t } = useTranslation();
  if (!task.githubNumber) {
    return (
      <div className={`text-sm text-secondary ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
        <div className="text-xs font-semibold text-primary">GitHub</div>
        <div className="mt-2">{t.kanbanDetailRedesign.noGithubLink}</div>
      </div>
    );
  }

  return (
    <div className={`border-b border-default ${compact ? "px-3 py-3" : "px-4 py-4"}`}>
      <div className="text-[11px] font-semibold text-secondary">GitHub</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-[10px] font-semibold text-information">
          {task.githubState ?? t.kanban.linkedLabel}
        </span>
        {task.githubRepo && (
          <span className="text-xs text-secondary">{task.githubRepo}</span>
        )}
      </div>
      <a
        href={task.githubUrl}
        target="_blank"
        rel="noreferrer"
        className={`mt-3 inline-flex text-attention hover:underline ${compact ? "text-[13px]" : "text-sm"}`}
      >
        #{task.githubNumber}
      </a>
      {task.githubSyncedAt && (
        <div className="mt-2 text-[11px] text-secondary">
          {t.kanban.syncedAt} {formatSessionTimestamp(task.githubSyncedAt)}
        </div>
      )}
    </div>
  );
}
