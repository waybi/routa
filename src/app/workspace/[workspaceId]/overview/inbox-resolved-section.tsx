"use client";

/**
 * "Handled by AI" section of the inbox (card 64f2e31c): cards the Blocked
 * resolver concluded as landed / superseded / handed off / waiting. Each row
 * shows the card title, the category, the one-sentence conclusion and when it
 * was concluded; "Show record" expands the full "## 自动处理记录" comment.
 * Read-only: no request is sent from here.
 */

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "@/i18n";
import { Badge, type Tone } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";
import { formatRelativeTime } from "@/client/components/home/relative-time";
import type { TaskAttentionResolutionCategory } from "@/core/models/task-attention-resolution";
import { overviewTaskHref } from "../kanban/kanban-overview-rules";
import type { InboxResolvedRow } from "./inbox-rules";

export const CATEGORY_TONE: Record<TaskAttentionResolutionCategory, Tone> = {
  landed: "success",
  superseded: "success",
  handed_off: "info",
  waiting: "attention",
  needs_owner: "danger",
};

function useCategoryLabel() {
  const { t } = useTranslation();
  const page = t.inboxPage;
  return (category: TaskAttentionResolutionCategory): string => {
    switch (category) {
      case "landed": return page.resolvedCategoryLanded;
      case "superseded": return page.resolvedCategorySuperseded;
      case "handed_off": return page.resolvedCategoryHandedOff;
      case "waiting": return page.resolvedCategoryWaiting;
      default: return page.needsOwnerBadge;
    }
  };
}

function ResolvedRowItem({ row, now }: { row: InboxResolvedRow; now: number }) {
  const { t } = useTranslation();
  const page = t.inboxPage;
  const categoryLabel = useCategoryLabel();
  const [open, setOpen] = useState(false);
  return (
    <article
      className="border-t border-default py-3 first:border-t-0"
      data-testid="inbox-resolved-row"
      data-task-id={row.task.id}
      data-category={row.category}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={CATEGORY_TONE[row.category]}>{categoryLabel(row.category)}</Badge>
            <span className="text-xs text-secondary" data-testid="inbox-resolved-time">
              {formatRelativeTime(row.resolvedAt || null, now, t.homeRedesign)}
            </span>
          </div>
          <h3 className="mb-1 mt-1.5 break-words text-sm font-semibold leading-snug text-primary">{row.task.title}</h3>
          <p className="m-0 text-[13px] text-primary" data-testid="inbox-resolved-conclusion">{row.conclusion}</p>
          {row.ref && <p className="m-0 mt-0.5 text-xs text-secondary">{page.resolvedRef.replace("{ref}", row.ref)}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClassName("secondary", "sm")}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            data-testid="inbox-resolved-toggle"
          >
            {open ? page.resolvedHideRecord : page.resolvedShowRecord}
          </button>
          <Link href={overviewTaskHref(row.task, row.workspaceId, row.fallbackBoardId)} className={buttonClassName("ghost", "sm")}>
            {page.openCard}
          </Link>
        </div>
      </div>
      {open && (
        <pre
          className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-default bg-canvas p-3 text-xs leading-relaxed text-primary"
          data-testid="inbox-resolved-record"
        >
          {row.record ?? page.resolvedNoRecord}
        </pre>
      )}
    </article>
  );
}

export function InboxResolvedSection({ rows, now }: { rows: InboxResolvedRow[]; now: number }) {
  const { t } = useTranslation();
  const page = t.inboxPage;
  if (rows.length === 0) return null;
  return (
    <section
      className="rounded-lg border border-emerald-300 bg-surface px-4 pb-2 pt-4 dark:border-emerald-800 min-[801px]:px-5"
      data-testid="inbox-resolved"
      aria-label={page.resolvedTitle.replace("{count}", String(rows.length))}
    >
      <h2 className="m-0 flex flex-wrap items-center gap-2 text-[15px] font-semibold text-primary">
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
        {page.resolvedTitle.replace("{count}", String(rows.length))}
      </h2>
      <p className="m-0 mt-1 text-xs text-secondary">{page.resolvedHint}</p>
      <div className="mt-2">
        {rows.map((row) => <ResolvedRowItem key={row.key} row={row} now={now} />)}
      </div>
    </section>
  );
}
