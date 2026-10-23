"use client";

/**
 * One "Needs you" row (design-spec §5 "提醒行"): level badge with text,
 * attention kind, full card title, workspace, reason, source, event time and
 * next step, plus two actions — open the card and hide locally. Below 801px
 * the actions move under the body.
 */

import Link from "next/link";
import { useTranslation } from "@/i18n";
import { Badge, type Tone } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";
import { formatRelativeTime } from "@/client/components/home/relative-time";
import { inboxRowHref, lastDoneRunStatus, type InboxRow, type InboxSeverity } from "./inbox-rules";

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
  return { t, severityLabel, kindLabel, reason, source, sourceFull, next };
}

export function InboxRowItem({
  row,
  now,
  dismissed,
  showWorkspace,
  onToggleDismiss,
}: {
  row: InboxRow;
  now: number;
  dismissed: boolean;
  showWorkspace: boolean;
  onToggleDismiss: (row: InboxRow) => void;
}) {
  const copy = useInboxRowCopy();
  const page = copy.t.inboxPage;
  const meta = (label: string, value: string, testId?: string, title?: string) => (
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
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={SEVERITY_TONE[row.severity]}>{copy.severityLabel(row.severity)}</Badge>
          <Badge tone="neutral">{copy.kindLabel(row)}</Badge>
        </div>
        <h3 className="mb-2 mt-1.5 break-words text-sm font-semibold leading-snug text-primary">{row.task.title}</h3>
        <dl className="m-0 grid gap-0.5">
          {showWorkspace && meta(page.labelWorkspace, row.workspaceTitle)}
          {meta(page.labelReason, copy.reason(row), "inbox-row-reason")}
          {meta(page.labelSource, copy.source(row), "inbox-row-source", row.reason === "interrupted" ? copy.sourceFull(row) : undefined)}
          {meta(page.labelTime, formatRelativeTime(row.eventAt, now, copy.t.homeRedesign))}
          {meta(page.labelNext, copy.next(row), "inbox-row-next")}
        </dl>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
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
