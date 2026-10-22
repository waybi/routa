"use client";

import { CircleCheckBig } from "lucide-react";
import { MarkdownViewer } from "@/client/components/markdown/markdown-viewer";
import { EmptyState } from "@/client/components/ui/states";
import { useTranslation } from "@/i18n";
import { formatDetailTimestamp } from "./kanban-detail-section";

/**
 * Completion tab (read-only): the newest completion report on a success
 * tint, earlier ones folded under a native <details>. Reports are the
 * progress notes whose first line is "## 完成汇报" / "## Completion Summary".
 */
export function KanbanDetailCompletionTab({
  reports,
  fallbackSummary,
  compact,
}: {
  reports: Array<{ id: string; body: string; createdAt?: string }>;
  fallbackSummary?: string;
  compact: boolean;
}) {
  const { t } = useTranslation();
  const [latest, ...earlier] = reports;
  const fallback = fallbackSummary?.trim();

  if (!latest && !fallback) {
    return (
      <div className="py-4" data-testid="kanban-completion-report-empty">
        <EmptyState
          title={t.kanbanDetail.completionReport}
          description={t.kanbanDetail.noCompletionReportYet}
          icon={<CircleCheckBig className="h-8 w-8" strokeWidth={1.5} />}
        />
      </div>
    );
  }

  const latestTime = formatDetailTimestamp(latest?.createdAt);
  return (
    <div className={`space-y-3 ${compact ? "py-3" : "py-4"}`} data-testid="kanban-completion-report">
      <p className="m-0 text-xs text-secondary">{t.kanbanDetail.completionReportHint}</p>
      <article className="rounded-lg border border-success bg-success-subtle px-4 py-3">
        {latestTime ? <div className="mb-1 text-[11px] text-secondary">{latestTime}</div> : null}
        <MarkdownViewer
          content={latest ? latest.body : (fallback ?? "")}
          className="prose prose-sm max-w-none text-primary dark:prose-invert"
        />
      </article>
      {earlier.length > 0 ? (
        <details className="group rounded-md border border-default bg-surface">
          <summary className="cursor-pointer rounded-md px-3 py-2.5 text-xs font-medium text-primary hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent">
            {t.kanbanDetail.completionReportEarlier.replace("{count}", String(earlier.length))}
          </summary>
          <div className="space-y-3 border-t border-default px-3 py-3">
            {earlier.map((entry) => {
              const time = formatDetailTimestamp(entry.createdAt);
              return (
                <article key={entry.id} className="border-b border-default pb-3 last:border-b-0 last:pb-0">
                  {time ? <div className="mb-1 text-[11px] text-secondary">{time}</div> : null}
                  <MarkdownViewer content={entry.body} className="prose prose-sm max-w-none text-primary dark:prose-invert" />
                </article>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}
