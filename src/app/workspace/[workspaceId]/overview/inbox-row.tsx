"use client";

/**
 * One "Needs you" row (design-spec §5 "提醒行"): level badge with text,
 * attention kind, full card title, workspace, reason, source, event time and
 * next step, plus two actions — open the card and hide locally. Below 801px
 * the actions move under the body. Interrupted rows on the active list also
 * get a selection checkbox, a visible "Rerun" button and their rerun result.
 * Every row also shows who handles it and how, and a "Hand to AI" button
 * (card 4877583c); the judging lives in inbox-rules (inboxRowView).
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n";
import { Badge, type Tone } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";
import { formatRelativeTime } from "@/client/components/home/relative-time";
import type { TaskAttentionResolutionCategory } from "@/core/models/task-attention-resolution";
import {
  inboxRowHref,
  inboxRowView,
  lastDoneRunStatus,
  type HandOffBlock,
  type InboxHandler,
  type InboxRow,
  type InboxRowView,
  type InboxSeverity,
} from "./inbox-rules";
import type { RetryRowState } from "./inbox-retry";
import { CATEGORY_TONE } from "./inbox-resolved-section";

/** Rerun controls; only passed for interrupted rows on the active list. */
export interface InboxRowRetry {
  selected: boolean;
  /** True while any rerun runs, or when this row's rerun was accepted. */
  disabled: boolean;
  state: RetryRowState | undefined;
  onToggleSelect: () => void;
  onRerun: () => void;
}

/** "Hand to AI" controls; without them the button renders disabled. */
export interface InboxRowHandOff {
  /** True while any rerun / hand-off runs, or when this row's request was accepted. */
  disabled: boolean;
  state: RetryRowState | undefined;
  onHandOff: () => void;
}

const HANDLER_TONE: Record<InboxHandler, Tone> = { owner: "attention", aiRunning: "info", aiQueued: "neutral" };

const RETRY_TONE: Record<RetryRowState["phase"], Tone> = {
  starting: "info",
  started: "success",
  queued: "info",
  skipped: "neutral",
  failed: "danger",
};

const SEVERITY_TONE: Record<InboxSeverity, Tone> = { 1: "danger", 2: "attention", 3: "attention" };
/** Longest lastSyncError shown inline; the full text is in the title. */
export const INBOX_SOURCE_MAX_CHARS = 160;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function useInboxRowCopy() {
  const { t } = useTranslation();
  const page = t.inboxPage;
  const severityLabel = (severity: InboxSeverity) => [page.severityP1, page.severityP2, page.severityP3][severity - 1];
  const kindLabel = (row: InboxRow) => (row.item.kind === "unmerged"
    ? t.kanbanAttention.unmerged.replace("{count}", String(row.item.ahead))
    : t.kanbanAttention[row.item.kind]);
  const reason = (row: InboxRow) => {
    switch (row.reason) {
      case "doneFailed": return page.reasonDoneFailed;
      case "blockedError": return page.reasonBlockedError.replace("{error}", row.task.lastSyncError?.trim() ?? "");
      case "noReport": return page.reasonNoReport;
      case "unmerged": return page.reasonUnmerged.replace("{count}", String(row.item.ahead));
      case "interrupted":
        return page.reasonInterrupted
          .replace("{column}", row.columnName ?? row.task.columnId ?? "")
          .replace("{status}", row.interruptedRun?.status === "timed_out" ? page.runTimedOut : page.runFailed);
      default: return page.reasonBlockedUnknown;
    }
  };
  /** Full source text (title attribute); equals source() unless truncated. */
  const sourceFull = (row: InboxRow) => (row.reason === "interrupted"
    ? row.task.lastSyncError?.trim() || page.sourceInterruptedNone
    : source(row));
  const source = (row: InboxRow) => {
    switch (row.reason) {
      case "doneFailed":
        return page.sourceDoneFailed.replace("{status}", lastDoneRunStatus(row.task) === "timed_out" ? page.runTimedOut : page.runFailed);
      case "blockedError": return page.sourceBlockedError;
      case "noReport": return page.sourceNoReport;
      case "unmerged": return page.sourceUnmerged.replace("{count}", String(row.item.ahead));
      case "interrupted": {
        const error = row.task.lastSyncError?.trim();
        return error ? truncate(error, INBOX_SOURCE_MAX_CHARS) : page.sourceInterruptedNone;
      }
      default: return page.sourceBlockedUnknown;
    }
  };
  const next = (row: InboxRow) => ({
    doneFailed: page.nextDoneFailed,
    blockedError: page.nextBlockedError,
    noReport: page.nextNoReport,
    unmerged: page.nextUnmerged,
    blockedUnknown: page.nextBlockedUnknown,
    interrupted: page.nextInterrupted,
  })[row.reason];
  const retryLabel = (state: RetryRowState) => {
    switch (state.phase) {
      case "starting": return page.rerunStarting;
      case "started": return page.rerunStarted;
      case "queued": return page.rerunQueued;
      case "skipped": return page.rerunSkipped;
      default: return page.rerunFailed.replace("{error}", state.error);
    }
  };
  const handlerLabel = (handler: InboxHandler) => ({
    owner: page.handlerOwner,
    aiRunning: page.handlerAiRunning,
    aiQueued: page.handlerAiQueued,
  })[handler];
  const handlingLabel = (category: TaskAttentionResolutionCategory) => ({
    landed: page.handlingCategoryLanded,
    superseded: page.handlingCategorySuperseded,
    handed_off: page.handlingCategoryHandedOff,
    waiting: page.handlingCategoryWaiting,
    needs_owner: page.handlingCategoryNeedsOwner,
  })[category];
  const handOffBlockedHint = (block: HandOffBlock) => ({
    notBlocked: page.handOffNotBlocked,
    noResolver: page.handOffNoResolver,
    running: page.handOffRunning,
  })[block];
  return { t, severityLabel, kindLabel, reason, source, sourceFull, next, retryLabel, handlerLabel, handlingLabel, handOffBlockedHint };
}

export function InboxRowItem({
  row,
  now,
  dismissed,
  showWorkspace,
  onToggleDismiss,
  retry,
  view: viewProp,
  handOff,
}: {
  row: InboxRow;
  now: number;
  dismissed: boolean;
  showWorkspace: boolean;
  onToggleDismiss: (row: InboxRow) => void;
  retry?: InboxRowRetry;
  /** Precomputed by the page with the row's board; defaults to "no board known". */
  view?: InboxRowView;
  handOff?: InboxRowHandOff;
}) {
  const copy = useInboxRowCopy();
  const page = copy.t.inboxPage;
  const view = viewProp ?? inboxRowView(row, undefined);
  const retryState = retry?.state ?? handOff?.state;
  const reasonText = view.reasonText;
  const handOffHint = view.handOffBlock ? copy.handOffBlockedHint(view.handOffBlock) : undefined;
  const meta = (label: string, value: ReactNode, testId?: string, title?: string) => (
    <div className="flex min-w-0 gap-2 text-xs leading-relaxed" data-testid={testId}>
      <dt className="shrink-0 text-secondary">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-primary" title={title}>{value}</dd>
    </div>
  );
  return (
    <article
      className="flex flex-col gap-3 border-b border-default py-4 last:border-b-0 min-[801px]:flex-row min-[801px]:items-start"
      data-testid="inbox-row"
      data-row-key={row.key}
      data-severity={row.severity}
      data-reason={row.reason}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {retry && (
          <input
            type="checkbox"
            className="mt-1 shrink-0 self-start"
            checked={retry.selected}
            disabled={retry.disabled}
            onChange={retry.onToggleSelect}
            aria-label={page.selectRow.replace("{title}", row.task.title)}
            data-testid="inbox-row-select"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {row.needsOwner && (
              <span data-testid="inbox-row-needs-owner"><Badge tone="danger">{page.needsOwnerBadge}</Badge></span>
            )}
            <Badge tone={SEVERITY_TONE[row.severity]}>{copy.severityLabel(row.severity)}</Badge>
            <Badge tone={row.reason === "interrupted" ? "danger" : "neutral"}>{copy.kindLabel(row)}</Badge>
            {retryState && (
              <span data-testid="inbox-row-retry-state" data-phase={retryState.phase}>
                <Badge tone={RETRY_TONE[retryState.phase]}>{copy.retryLabel(retryState)}</Badge>
              </span>
            )}
          </div>
          <h3 className="mb-2 mt-1.5 break-words text-sm font-semibold leading-snug text-primary">{row.task.title}</h3>
          <dl className="m-0 grid gap-0.5">
            {showWorkspace && meta(page.labelWorkspace, row.workspaceTitle)}
            {meta(page.labelHandler, (
              <span data-handler={view.handler}><Badge tone={HANDLER_TONE[view.handler]}>{copy.handlerLabel(view.handler)}</Badge></span>
            ), "inbox-row-handler")}
            {meta(page.labelHandling, view.handling ? (
              <span className="inline-flex flex-wrap items-center gap-1.5" data-category={view.handling.category}>
                {/* needs_owner: the same red badge already heads the row. */}
                {view.handling.category !== "needs_owner" && (
                  <Badge tone={CATEGORY_TONE[view.handling.category]}>{copy.handlingLabel(view.handling.category)}</Badge>
                )}
                <span className="text-primary" title={view.handling.conclusion}>{truncate(view.handling.conclusion, INBOX_SOURCE_MAX_CHARS)}</span>
                {view.handling.ref && <span className="text-secondary">{page.resolvedRef.replace("{ref}", view.handling.ref)}</span>}
              </span>
            ) : copy.next(row), "inbox-row-handling")}
            {reasonText
              ? meta(page.labelReason, truncate(reasonText.text, INBOX_SOURCE_MAX_CHARS), "inbox-row-reason", reasonText.full)
              : meta(page.labelReason, copy.reason(row), "inbox-row-reason")}
            {meta(page.labelSource, copy.source(row), "inbox-row-source", row.reason === "interrupted" ? copy.sourceFull(row) : undefined)}
            {meta(page.labelTime, formatRelativeTime(row.eventAt, now, copy.t.homeRedesign))}
            {meta(page.labelNext, copy.next(row), "inbox-row-next")}
          </dl>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {retry && (
          <button
            type="button"
            onClick={retry.onRerun}
            disabled={retry.disabled}
            className={buttonClassName("danger", "sm")}
            data-testid="inbox-row-rerun"
          >
            {page.rerun}
          </button>
        )}
        <button
          type="button"
          onClick={handOff?.onHandOff}
          disabled={Boolean(view.handOffBlock) || !handOff || handOff.disabled}
          title={handOffHint}
          className={buttonClassName("secondary", "sm")}
          data-testid="inbox-row-hand-off"
        >
          {page.handOff}
        </button>
        <Link href={inboxRowHref(row)} className={buttonClassName("primary", "sm")} data-testid="inbox-row-open">
          {page.openCard}
        </Link>
        <button
          type="button"
          onClick={() => onToggleDismiss(row)}
          className={buttonClassName("ghost", "sm")}
          data-testid={dismissed ? "inbox-row-restore" : "inbox-row-dismiss"}
        >
          {dismissed ? page.restore : page.dismiss}
        </button>
      </div>
    </article>
  );
}
