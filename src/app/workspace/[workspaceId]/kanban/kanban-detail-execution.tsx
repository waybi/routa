"use client";

import { useMemo, type ReactNode } from "react";
import { X } from "lucide-react";
import type { AcpProviderInfo } from "@/client/acp-client";
import { useConfirm } from "@/client/components/confirm-dialog";
import { Select } from "@/client/components/select";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  type EffectiveTaskAutomation,
  resolveEffectiveTaskAutomation,
  resolveKanbanAutomationStep,
} from "@/core/kanban/effective-task-automation";
import { formatArtifactSummary, resolveKanbanTransitionArtifacts } from "@/core/kanban/transition-artifacts";
import { getKanbanAutomationSteps, type KanbanAutomationStep } from "@/core/models/kanban";
import type { FallbackAgent } from "@/core/models/task";
import { useTranslation } from "@/i18n";
import type { KanbanColumnInfo, SessionInfo, TaskInfo } from "../types";
import { KanbanCardModelEffortOverride, KanbanCardProviderOverrideDropdown } from "./kanban-card-provider-override-dropdown";
import {
  createKanbanSpecialistResolver,
  getOrderedSessionIds,
  getSpecialistName,
  type KanbanSpecialistOption as SpecialistOption,
} from "./kanban-card-session-utils";
import { DetailSection, InlineSummary } from "./kanban-detail-section";
import { getKanbanSessionCopy } from "./i18n/kanban-session-copy";
import { useRetrySubmit } from "./use-kanban-retry-feedback";
import {
  findSpecialistById,
  getLanguageSpecificSpecialistId,
  getSpecialistDisplayName,
  KANBAN_SPECIALIST_LANGUAGE_LABELS,
  type KanbanSpecialistLanguage,
} from "./kanban-specialist-language";

/**
 * Execution tab body: lane, pipeline, run target, artifact gates, the card
 * session override (its own disclosure, open when the card has an override),
 * the fallback agent chain and run / rerun / recover. Everything sits
 * directly in the section, as in the detail before the redesign.
 */

const ROLE_OPTIONS = ["CRAFTER", "ROUTA", "GATE", "DEVELOPER"];
const FIELD_CLASS = "w-full rounded-control border border-default bg-surface px-2.5 py-2 text-sm text-primary focus-visible:outline-2 focus-visible:outline-accent";

function getProviderName(providerId: string | undefined, availableProviders: AcpProviderInfo[], defaultLabel: string): string {
  if (!providerId) return defaultLabel;
  return availableProviders.find((provider) => provider.id === providerId)?.name ?? providerId;
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

function formatTarget(
  automation: Pick<EffectiveTaskAutomation, "transport" | "providerId" | "role" | "specialistId" | "specialistName" | "agentCardUrl" | "skillId">,
  availableProviders: AcpProviderInfo[],
  specialists: SpecialistOption[],
  defaultLabel: string,
): string {
  const specialist = getSpecialistName(automation.specialistId, automation.specialistName, specialists);
  if (automation.transport === "a2a") {
    return [
      "A2A",
      automation.role ?? "DEVELOPER",
      specialist,
      formatAgentCardTarget(automation.agentCardUrl),
      automation.skillId ? `skill:${automation.skillId}` : undefined,
    ].filter(Boolean).join(" · ");
  }
  return [getProviderName(automation.providerId, availableProviders, defaultLabel), automation.role ?? "DEVELOPER", specialist].join(" · ");
}

function formatAutomationStepSummary(
  step: KanbanAutomationStep,
  availableProviders: AcpProviderInfo[],
  specialists: SpecialistOption[],
  autoProviderId: string | null | undefined,
  defaultLabel: string,
): string {
  const resolvedStep = resolveKanbanAutomationStep(
    step,
    createKanbanSpecialistResolver(specialists),
    { autoProviderId: autoProviderId ?? undefined },
  ) ?? step;
  return formatTarget({ ...resolvedStep, transport: resolvedStep.transport ?? "acp" }, availableProviders, specialists, defaultLabel);
}

function getPromptFailureMessage(task: TaskInfo, sessionInfo: SessionInfo | null | undefined): string | null {
  if (sessionInfo?.acpStatus === "error" && sessionInfo.acpError) return sessionInfo.acpError;
  return task.lastSyncError ?? null;
}

function isExpiredEmbeddedSessionFailure(message: string | null | undefined): boolean {
  if (!message) return false;
  return message.includes("embedded ACP processes cannot be resumed on a different instance");
}

function Callout({ tone, children }: { tone: "info" | "attention" | "danger"; children: ReactNode }) {
  const toneClass = tone === "danger"
    ? "border-danger bg-danger-subtle text-danger"
    : tone === "attention"
      ? "border-attention bg-attention-subtle text-attention"
      : "border-accent bg-accent-subtle text-primary";
  return <div className={`rounded-md border-l-2 px-3 py-2 text-xs leading-5 ${toneClass}`}>{children}</div>;
}

export interface KanbanDetailExecutionProps {
  task: TaskInfo;
  lane?: KanbanColumnInfo;
  boardColumns: KanbanColumnInfo[];
  availableProviders: AcpProviderInfo[];
  sessionInfo?: SessionInfo | null;
  specialists: SpecialistOption[];
  specialistLanguage: KanbanSpecialistLanguage;
  selectedProvider?: string | null;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
  onRetryTrigger: (taskId: string, options?: { force?: boolean }) => Promise<void>;
  onProviderChange?: (providerId: string | null) => void;
  compact?: boolean;
}

export function KanbanDetailExecution({
  task,
  lane,
  boardColumns,
  availableProviders,
  sessionInfo,
  specialists,
  specialistLanguage,
  selectedProvider,
  onPatchTask,
  onRetryTrigger,
  onProviderChange,
  compact = false,
}: KanbanDetailExecutionProps) {
  const { t } = useTranslation();
  const sessionCopy = getKanbanSessionCopy(specialistLanguage);
  const defaultLabel = t.kanban.workspaceDefault;
  const resolveSpecialist = useMemo(() => createKanbanSpecialistResolver(specialists), [specialists]);
  const effectiveAutomation = resolveEffectiveTaskAutomation(task, boardColumns, resolveSpecialist, {
    autoProviderId: selectedProvider ?? undefined,
  });
  const canRunTask = effectiveAutomation.canRun && task.columnId !== "done";
  const hasCardOverride = effectiveAutomation.source === "card";
  const overrideProviderValue = hasCardOverride ? task.assignedProvider ?? "" : "";
  const overrideRoleValue = hasCardOverride ? task.assignedRole ?? "DEVELOPER" : "DEVELOPER";
  const overrideSpecialistValue = hasCardOverride
    ? getLanguageSpecificSpecialistId(task.assignedSpecialistId, specialistLanguage) ?? ""
    : "";
  const usesSelectedProvider = Boolean(
    !hasCardOverride
    && selectedProvider
    && effectiveAutomation.transport !== "a2a"
    && effectiveAutomation.providerSource === "auto",
  );
  const manualRunTarget = formatTarget(
    usesSelectedProvider ? { ...effectiveAutomation, providerId: selectedProvider ?? undefined } : effectiveAutomation,
    availableProviders,
    specialists,
    defaultLabel,
  );
  const manualRunSource = hasCardOverride
    ? (usesSelectedProvider ? t.kanbanDetailRedesign.manualRunSourceOverrideWithProvider : t.kanbanDetailRedesign.manualRunSourceOverride)
    : (usesSelectedProvider ? t.kanbanDetailRedesign.manualRunSourceLaneWithProvider : t.kanbanDetailRedesign.manualRunSourceLane);
  const laneName = lane?.name ?? task.columnId ?? "backlog";
  const laneSteps = lane?.automation ? getKanbanAutomationSteps(lane.automation) : [];
  const cardSpecialist = getSpecialistName(task.assignedSpecialistId, task.assignedSpecialistName, specialists);
  const failureMessage = getPromptFailureMessage(task, sessionInfo);
  const activeRunSessionId = task.triggerSessionId
    ?? (task.laneSessions && task.laneSessions.length > 0 ? task.laneSessions[task.laneSessions.length - 1]?.sessionId : undefined);
  const activeLaneSession = activeRunSessionId
    ? task.laneSessions?.find((entry) => entry.sessionId === activeRunSessionId)
    : undefined;
  const fallbackProviderId = (hasCardOverride ? task.assignedProvider : undefined)
    ?? (usesSelectedProvider ? selectedProvider ?? undefined : effectiveAutomation.providerId);
  const failedRunProviderId = task.triggerSessionId
    ? (sessionInfo?.sessionId === task.triggerSessionId ? sessionInfo.provider : activeLaneSession?.provider ?? fallbackProviderId)
    : fallbackProviderId;
  const failedRunLabel = activeLaneSession?.transport === "a2a" || effectiveAutomation.transport === "a2a"
    ? t.kanbanDetailRedesign.currentA2ARun
    : getProviderName(failedRunProviderId, availableProviders, defaultLabel);
  const effectiveRunTarget = activeLaneSession
    ? formatTarget(
        {
          ...effectiveAutomation,
          transport: activeLaneSession.transport === "a2a" ? "a2a" : "acp",
          providerId: activeLaneSession.provider ?? effectiveAutomation.providerId,
          role: activeLaneSession.role ?? effectiveAutomation.role,
          specialistId: activeLaneSession.specialistId ?? effectiveAutomation.specialistId,
          specialistName: activeLaneSession.specialistName ?? effectiveAutomation.specialistName,
        },
        availableProviders,
        specialists,
        defaultLabel,
      )
    : manualRunTarget;
  const lanePipeline = laneSteps.length > 0
    ? laneSteps.map((step) => formatAutomationStepSummary(step, availableProviders, specialists, selectedProvider, defaultLabel)).join(" -> ")
    : t.kanbanDetail.noLaneAutomation;
  const hasRecordedRuns = getOrderedSessionIds(task).length > 0;
  const transitionArtifacts = resolveKanbanTransitionArtifacts(boardColumns, task.columnId);
  const overrideKey = `${task.id}:${task.assignedProvider ?? ""}:${task.assignedRole ?? ""}:${task.assignedSpecialistId ?? ""}:${task.assignedSpecialistName ?? ""}`;
  const needsLiveRunRecovery = isExpiredEmbeddedSessionFailure(failureMessage);
  const retrySubmit = useRetrySubmit(onRetryTrigger);
  const confirm = useConfirm();
  const hasRunningStep = useMemo(
    () => (task.laneSessions ?? []).some((entry) => entry.columnId === task.columnId && entry.status === "running"),
    [task.laneSessions, task.columnId],
  );
  const runActionLabel = hasRunningStep
    ? t.kanbanRerunGuard.endAndRerun
    : needsLiveRunRecovery
      ? t.kanbanDetail.recoverLiveRun
      : hasRecordedRuns ? t.kanban.rerun : t.kanban.run;
  const showCurrentRunSeparately = laneSteps.length > 1 || hasCardOverride || effectiveRunTarget !== lanePipeline;
  const nextLaneName = transitionArtifacts.nextColumn?.name;

  return (
    <>
      <DetailSection
        title={t.kanbanDetail.execution}
        description={compact ? undefined : t.kanbanDetail.executionHint}
        compact={compact}
        testId="kanban-detail-execution-settings"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-primary">{laneName}</div>
            <div className="mt-0.5 text-xs text-secondary">
              {lane ? t.kanbanDetail.inheritedFromLane : t.kanbanDetail.laneMetadataUnavailable}
            </div>
          </div>
          <Badge tone={lane?.automation?.enabled ? "success" : "neutral"}>
            {lane?.automation?.enabled ? t.kanbanDetail.automationOn : t.kanbanDetail.manual}
          </Badge>
        </div>
        <div className="space-y-1">
          <InlineSummary label={t.kanbanDetail.lanePipeline} value={lanePipeline} compact={compact} />
          {showCurrentRunSeparately ? (
            <InlineSummary label={t.kanbanDetail.currentRun} value={effectiveRunTarget} compact={compact} />
          ) : null}
          {transitionArtifacts.currentRequiredArtifacts.length > 0 ? (
            <InlineSummary
              label={t.kanbanDetailRedesign.enterLaneArtifacts.replace("{lane}", laneName)}
              value={formatArtifactSummary(transitionArtifacts.currentRequiredArtifacts)}
              compact={compact}
            />
          ) : null}
          {transitionArtifacts.nextRequiredArtifacts.length > 0 ? (
            <InlineSummary
              label={nextLaneName ? t.kanbanDetailRedesign.beforeLaneArtifacts.replace("{lane}", nextLaneName) : t.kanbanDetail.nextMove}
              value={formatArtifactSummary(transitionArtifacts.nextRequiredArtifacts)}
              compact={compact}
            />
          ) : null}
        </div>
        <details key={overrideKey} open={hasCardOverride || undefined} className="rounded-md border border-default">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <span>
              <span className="block text-xs font-semibold text-primary">{t.kanbanDetail.cardSessionOverride}</span>
              <span className="mt-0.5 block text-xs text-secondary">{t.kanbanDetail.keepCardSessionOverride}</span>
            </span>
            <span className="rounded-control border border-default px-2.5 py-1 text-[11px] text-secondary">
              {hasCardOverride ? t.kanbanDetail.editOverride : t.kanbanDetail.overrideCard}
            </span>
          </summary>
          <div className="space-y-2.5 border-t border-default px-3 py-3">
            {hasCardOverride ? (
              <Callout tone="attention">
                {overrideProviderValue
                  ? `${t.kanbanDetail.cardHasExplicitOverride} ${getProviderName(task.assignedProvider, availableProviders, defaultLabel)} · ${task.assignedRole ?? "DEVELOPER"} · ${cardSpecialist}`
                  : t.kanbanDetail.noCardOverride}
              </Callout>
            ) : null}
            <KanbanCardProviderOverrideDropdown
              task={task}
              hasCardOverride={hasCardOverride}
              availableProviders={availableProviders}
              overrideProviderValue={overrideProviderValue}
              compact={compact}
              onPatchTask={onPatchTask}
              onProviderChange={onProviderChange}
            />
            <KanbanCardModelEffortOverride task={task} providerIds={[effectiveAutomation.providerId, selectedProvider]} compact={compact} onPatchTask={onPatchTask} />
            {hasCardOverride ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Select
                  value={overrideRoleValue}
                  aria-label={t.kanbanDetail.cardSessionOverride}
                  onChange={async (event) => {
                    await onPatchTask(task.id, { assignedRole: event.target.value });
                  }}
                  className={FIELD_CLASS}
                >
                  {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                </Select>
                <Select
                  value={overrideSpecialistValue}
                  onChange={async (event) => {
                    const specialist = findSpecialistById(specialists, event.target.value);
                    await onPatchTask(task.id, {
                      assignedSpecialistId: event.target.value || undefined,
                      assignedSpecialistName: specialist?.name,
                      assignedRole: specialist?.role ?? (hasCardOverride ? task.assignedRole : undefined),
                    });
                  }}
                  className={FIELD_CLASS}
                >
                  <option value="">{KANBAN_SPECIALIST_LANGUAGE_LABELS[specialistLanguage].noSpecialist}</option>
                  {specialists.map((specialist) => <option key={specialist.id} value={specialist.id}>{getSpecialistDisplayName(specialist)}</option>)}
                </Select>
              </div>
            ) : null}
          </div>
        </details>
        <FallbackAgentChainEditor
          task={task}
          specialists={specialists}
          availableProviders={availableProviders}
          specialistLanguage={specialistLanguage}
          onPatchTask={onPatchTask}
        />
        {canRunTask && !hasRecordedRuns ? (
          <Callout tone="info">
            {sessionCopy.emptyPaneDescription} {sessionCopy.emptyPaneHint}
            {effectiveRunTarget !== lanePipeline ? <> {sessionCopy.expectedTarget(effectiveRunTarget)}</> : null}
          </Callout>
        ) : null}
        {canRunTask && (usesSelectedProvider || manualRunTarget !== lanePipeline || hasCardOverride) ? (
          <Callout tone="info">
            {t.kanbanDetailRedesign.manualRunTarget
              .replace("{mode}", hasRecordedRuns ? t.kanbanDetailRedesign.manualRunModeRerun : t.kanbanDetailRedesign.manualRunModeRun)
              .replace("{source}", manualRunSource)
              .replace("{target}", manualRunTarget)}
          </Callout>
        ) : null}
        {failureMessage ? (
          <Callout tone="danger">
            {t.kanbanDetailRedesign.currentRunFailed.replace("{target}", failedRunLabel).replace("{message}", failureMessage)}{" "}
            {effectiveAutomation.transport === "a2a"
              ? t.kanbanDetailRedesign.a2aFailureHint
              : needsLiveRunRecovery ? t.kanbanDetail.recoverLiveRunHint : t.kanbanDetailRedesign.providerFailureHint}
          </Callout>
        ) : null}
        {transitionArtifacts.nextRequiredArtifacts.length > 0 ? (
          <Callout tone="attention">
            {t.kanbanDetailRedesign.nextLaneGate
              .replace("{lane}", nextLaneName ?? t.kanbanDetailRedesign.theNextStage)
              .replace("{artifacts}", formatArtifactSummary(transitionArtifacts.nextRequiredArtifacts))}{" "}
            {t.kanbanDetailRedesign.nextLaneGateHint}
          </Callout>
        ) : null}
        {(hasCardOverride || canRunTask) ? (
          <div className="flex flex-wrap items-center gap-2">
            {hasCardOverride ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  await onPatchTask(task.id, {
                    assignedProvider: undefined,
                    assignedRole: undefined,
                    assignedSpecialistId: undefined,
                    assignedSpecialistName: undefined,
                  });
                  onProviderChange?.(null);
                }}
              >
                {t.kanbanDetail.resetOverride}
              </Button>
            ) : null}
            {canRunTask ? (
              <Button
                variant="primary"
                size="sm"
                className={hasCardOverride ? "ml-auto" : ""}
                data-testid="kanban-detail-run"
                disabled={retrySubmit.submitting}
                aria-busy={retrySubmit.submitting}
                onClick={async () => {
                  if (!hasRunningStep) {
                    void retrySubmit.submit(task.id);
                    return;
                  }
                  const confirmed = await confirm({
                    title: t.kanbanRerunGuard.endAndRerunTitle,
                    message: t.kanbanRerunGuard.endAndRerunMessage,
                    confirmLabel: t.kanbanRerunGuard.endAndRerun,
                  });
                  if (confirmed) void retrySubmit.submit(task.id, { force: true });
                }}
              >
                {retrySubmit.submitting ? t.kanban.retryStarting : runActionLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </DetailSection>

    </>
  );
}

function FallbackAgentChainEditor({
  task,
  specialists,
  availableProviders,
  specialistLanguage,
  onPatchTask,
}: {
  task: TaskInfo;
  specialists: SpecialistOption[];
  availableProviders: AcpProviderInfo[];
  specialistLanguage: KanbanSpecialistLanguage;
  onPatchTask: (taskId: string, payload: Record<string, unknown>) => Promise<TaskInfo>;
}) {
  const { t } = useTranslation();
  const chain: FallbackAgent[] = (task as TaskInfo & { fallbackAgentChain?: FallbackAgent[] }).fallbackAgentChain ?? [];
  const enableFallback = (task as TaskInfo & { enableAutomaticFallback?: boolean }).enableAutomaticFallback ?? false;

  const addFallbackAgent = async () => {
    const next = [...chain, { providerId: undefined, role: "DEVELOPER", specialistId: undefined }];
    await onPatchTask(task.id, { fallbackAgentChain: next, enableAutomaticFallback: true });
  };

  const removeFallbackAgent = async (index: number) => {
    const next = chain.filter((_, i) => i !== index);
    await onPatchTask(task.id, {
      fallbackAgentChain: next.length > 0 ? next : undefined,
      enableAutomaticFallback: next.length > 0,
    });
  };

  const updateFallbackAgent = async (index: number, patch: Partial<FallbackAgent>) => {
    const next = chain.map((agent, i) => (i === index ? { ...agent, ...patch } : agent));
    await onPatchTask(task.id, { fallbackAgentChain: next });
  };

  return (
    <details className="rounded-md border border-default" data-testid="kanban-detail-fallback-chain">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-xs font-semibold text-primary">{t.kanbanDetail.fallbackAgentChain}</span>
          <span className="mt-0.5 block text-xs text-secondary">{t.kanbanDetail.fallbackAgentChainHint}</span>
        </span>
        <span className="rounded-control border border-default px-2.5 py-1 text-[11px] text-secondary">
          {chain.length > 0 ? `${chain.length} ${t.kanbanDetail.fallbackAgentsConfigured}` : t.kanbanDetail.addFallbackAgent}
        </span>
      </summary>
      <div className="space-y-2 border-t border-default px-3 py-3">
        <label className="flex items-center gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            checked={enableFallback}
            onChange={async () => {
              await onPatchTask(task.id, { enableAutomaticFallback: !enableFallback });
            }}
            className="rounded border-default accent-accent"
          />
          {t.kanbanDetail.enableAutomaticFallback}
        </label>
        {chain.map((agent, index) => (
          <div key={index} className="flex items-center gap-2 rounded-md border border-default p-2">
            <span className="shrink-0 text-[10px] font-semibold text-secondary">#{index + 1}</span>
            <Select
              value={agent.providerId ?? ""}
              onChange={async (event) => {
                await updateFallbackAgent(index, { providerId: event.target.value || undefined });
              }}
              className={`min-w-0 flex-1 ${FIELD_CLASS} text-xs`}
            >
              <option value="">{t.kanbanDetail.fallbackProviderDefault}</option>
              {availableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name ?? provider.id}</option>
              ))}
            </Select>
            <Select
              value={agent.role ?? "DEVELOPER"}
              onChange={async (event) => {
                await updateFallbackAgent(index, { role: event.target.value });
              }}
              className={`min-w-0 flex-1 ${FIELD_CLASS} text-xs`}
            >
              {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
            </Select>
            <Select
              value={agent.specialistId ?? ""}
              onChange={async (event) => {
                const specialist = findSpecialistById(specialists, event.target.value);
                await updateFallbackAgent(index, {
                  specialistId: event.target.value || undefined,
                  specialistName: specialist?.name,
                });
              }}
              className={`min-w-0 flex-1 ${FIELD_CLASS} text-xs`}
            >
              <option value="">{KANBAN_SPECIALIST_LANGUAGE_LABELS[specialistLanguage].noSpecialist}</option>
              {specialists.map((specialist) => (
                <option key={specialist.id} value={specialist.id}>{getSpecialistDisplayName(specialist)}</option>
              ))}
            </Select>
            <button
              type="button"
              aria-label={t.common.delete}
              onClick={() => void removeFallbackAgent(index)}
              className="shrink-0 rounded px-1.5 py-1 text-xs text-danger transition-colors hover:bg-danger-subtle focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <Button variant="ghost" size="xs" onClick={() => void addFallbackAgent()} className="border-dashed border-default">
          + {t.kanbanDetail.addFallbackAgent}
        </Button>
      </div>
    </details>
  );
}
