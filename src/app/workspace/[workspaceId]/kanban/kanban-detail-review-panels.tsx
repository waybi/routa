"use client";

import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { Badge, type Tone } from "@/client/components/ui/badge";
import { useTranslation } from "@/i18n";
import type { TaskInfo } from "../types";
import { SummaryGridItem, formatCheckStatus } from "./kanban-detail-section";

/**
 * Story readiness, evidence summary and review feedback panels of the card
 * detail. Moved out of kanban-detail-panels.tsx (redesign card 3/6) and
 * restyled with the redesign tokens and the ui/ Badge.
 */

type Translate = ReturnType<typeof useTranslation>["t"];

function formatReadinessFieldLabel(field: string, t: Translate): string {
  switch (field) {
    case "scope":
      return t.kanbanDetail.scope;
    case "acceptance_criteria":
      return t.kanbanDetail.acceptanceCriteria;
    case "verification_commands":
      return t.kanbanDetail.verificationCommands;
    case "test_cases":
      return t.kanbanDetail.testCases;
    case "verification_plan":
      return t.kanbanDetail.verificationPlan;
    case "dependencies_declared":
      return t.kanbanDetail.dependenciesDeclared;
    default:
      return field;
  }
}

function formatAnalysisStatus(value: string | undefined, t: Translate): string {
  switch (value) {
    case "pass":
      return t.kanbanDetail.pass;
    case "warning":
      return t.kanbanDetail.warning;
    case "fail":
      return t.kanbanDetail.fail;
    case undefined:
      return t.kanbanDetailRedesign.pendingEvaluation;
    default:
      return value;
  }
}

function formatVerificationVerdictLabel(verdict: string | undefined, t: Translate): string {
  switch (verdict) {
    case "NOT_APPROVED":
      return t.kanbanDetail.reviewRequestedChanges;
    case "BLOCKED":
      return t.kanbanDetail.reviewBlockedVerdict;
    case "APPROVED":
      return t.kanbanDetail.reviewApprovedVerdict;
    default:
      return t.kanbanDetail.reviewFeedback;
  }
}

const READINESS_CHECKS = [
  ["scope", "scope"],
  ["acceptanceCriteria", "acceptanceCriteria"],
  ["verificationCommands", "verificationCommands"],
  ["testCases", "testCases"],
  ["verificationPlan", "verificationPlan"],
  ["dependenciesDeclared", "dependenciesDeclared"],
] as const;

const INVEST_CHECKS = [
  ["independent", "investIndependent"],
  ["negotiable", "investNegotiable"],
  ["valuable", "investValuable"],
  ["estimable", "investEstimable"],
  ["small", "investSmall"],
  ["testable", "investTestable"],
] as const;

export function StoryReadinessPanel({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const readiness = task.storyReadiness;
  const investValidation = task.investValidation;
  const requiredLabels = readiness?.requiredTaskFields.map((field) => formatReadinessFieldLabel(field, t)) ?? [];
  const missingLabels = readiness?.missing.map((field) => formatReadinessFieldLabel(field, t)) ?? [];
  const gridClass = `grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3"}`;

  return (
    <div className="space-y-3" data-testid="kanban-story-readiness">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={readiness ? (readiness.ready ? "success" : "attention") : "neutral"}>
            {readiness ? (readiness.ready ? t.kanbanDetail.readyForDev : t.kanbanDetail.blockedForDev) : t.kanbanDetailRedesign.pendingEvaluation}
          </Badge>
          <span className="text-xs text-secondary">
            {requiredLabels.length > 0
              ? `${t.kanbanDetail.requiredForNextMove}: ${requiredLabels.join(", ")}`
              : t.kanbanDetail.gateNotConfigured}
          </span>
        </div>
        {readiness ? (
          <div className="text-sm text-primary">
            {missingLabels.length > 0
              ? `${t.kanbanDetail.missingFields}: ${missingLabels.join(", ")}`
              : t.kanbanDetail.allRequiredFields}
          </div>
        ) : null}
      </div>

      <div className={gridClass}>
        {READINESS_CHECKS.map(([key, labelKey]) => (
          <SummaryGridItem
            key={key}
            label={t.kanbanDetail[labelKey]}
            value={formatCheckStatus(readiness?.checks[key], t)}
            compact={compact}
          />
        ))}
      </div>

      <div className="space-y-2 border-t border-default pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-secondary">
          <span className="font-semibold text-primary">{t.kanbanDetail.investSummary}</span>
          {investValidation ? (
            <>
              <span>
                {t.kanbanDetail.source}: {investValidation.source === "canonical_story"
                  ? t.kanbanDetail.sourceCanonicalStory
                  : t.kanbanDetail.sourceHeuristic}
              </span>
              <span>{t.kanbanDetail.overall}: {formatAnalysisStatus(investValidation.overallStatus, t)}</span>
            </>
          ) : null}
        </div>
        <div className={gridClass}>
          {INVEST_CHECKS.map(([key, labelKey]) => (
            <SummaryGridItem
              key={key}
              label={t.kanbanDetail[labelKey]}
              value={formatAnalysisStatus(investValidation?.checks[key].status, t)}
              detail={investValidation?.checks[key].reason}
              compact={compact}
            />
          ))}
        </div>
        {investValidation && investValidation.issues.length > 0 ? (
          <div className="rounded-md bg-attention-subtle px-3 py-2 text-xs leading-5 text-attention">
            {investValidation.issues.join(" ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function EvidenceBundlePanel({
  task,
  compact = false,
}: {
  task: TaskInfo;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const evidence = task.evidenceSummary;
  if (!evidence) {
    return <p className="m-0 text-sm text-secondary">{t.kanbanDetail.noEvidenceSummary}</p>;
  }

  const reviewable = evidence.artifact.requiredSatisfied
    && (evidence.verification.hasReport || evidence.verification.hasVerdict || evidence.completion.hasSummary);
  const missingRequiredArtifacts = evidence.artifact.missingRequired ?? [];
  const missingRequired = missingRequiredArtifacts.length > 0
    ? missingRequiredArtifacts.join(", ")
    : t.kanbanDetail.none;
  const artifactBreakdown = Object.entries(evidence.artifact.byType)
    .map(([type, count]) => `${type}: ${count}`)
    .join(", ") || t.kanbanDetail.none;

  return (
    <div className="space-y-3" data-testid="kanban-evidence-bundle">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={reviewable ? "success" : "attention"}>
          {reviewable ? t.kanbanDetail.reviewable : t.kanbanDetail.reviewBlocked}
        </Badge>
        <span className="text-xs text-secondary">
          {t.kanbanDetail.requiredArtifacts}: {missingRequired}
        </span>
      </div>
      <div className={`grid gap-2 ${compact ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
        <SummaryGridItem
          label={t.kanbanDetail.requiredArtifacts}
          value={`${evidence.artifact.total}`}
          detail={artifactBreakdown}
          compact={compact}
        />
        <SummaryGridItem
          label={t.kanbanDetail.verification}
          value={evidence.verification.verdict ?? formatCheckStatus(evidence.verification.hasVerdict, t)}
          detail={evidence.verification.hasReport ? t.kanbanDetail.reportPresent : t.kanbanDetail.reportMissing}
          compact={compact}
        />
        <SummaryGridItem
          label={t.kanbanDetail.completion}
          value={evidence.completion.hasSummary ? t.kanbanDetail.summaryPresent : t.kanbanDetail.summaryMissing}
          compact={compact}
        />
      </div>
    </div>
  );
}

export function ReviewFeedbackPanel({ task }: { task: TaskInfo; compact?: boolean }) {
  const { t } = useTranslation();
  const report = task.verificationReport?.trim();
  const verdict = task.verificationVerdict;

  if (!report && !verdict) {
    return <p className="m-0 text-sm text-secondary">{t.kanbanDetail.reportMissing}</p>;
  }

  const verdictLabel = formatVerificationVerdictLabel(verdict, t);
  const returnedToDev = task.columnId === "dev" && verdict !== "APPROVED";
  const tone: Tone = verdict === "BLOCKED"
    ? "danger"
    : verdict === "APPROVED"
      ? "success"
      : "attention";

  return (
    <div className="space-y-3" data-testid="kanban-review-feedback">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>
          <span data-testid="kanban-review-verdict">{returnedToDev ? t.kanbanDetail.reviewReturnedToDev : verdictLabel}</span>
        </Badge>
        {verdict ? (
          <span className="text-xs text-secondary">{t.kanbanDetail.verification}: {verdictLabel}</span>
        ) : null}
      </div>
      {report ? (
        <MarkdownViewer content={report} className="prose prose-sm max-w-none text-primary dark:prose-invert" />
      ) : (
        <p className="m-0 text-sm text-secondary">{t.kanbanDetail.reportMissing}</p>
      )}
    </div>
  );
}
