"use client";

/**
 * One workspace card on the home page: name, open button, in-progress and
 * needs-you counts, and the newest authoritative activity (full title, no
 * ellipsis). Loading shows a skeleton in the final layout, never a 0; a
 * failed read keeps the last data and says it may be stale.
 */

import Link from "next/link";
import { useTranslation } from "@/i18n";
import { Badge } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";
import { ErrorState } from "@/client/components/ui/states";
import type { WorkspaceSummary } from "@/app/workspace/[workspaceId]/overview/inbox-rules";
import { formatRelativeTime } from "./relative-time";

export type HomeCardStatus = "loading" | "ready" | "error";

function Metric({ value, label, href, testId }: { value: number | null; label: string; href?: string; testId: string }) {
  const number = value === null
    ? <span aria-hidden="true" className="block h-7 w-8 animate-pulse rounded bg-subtle motion-reduce:animate-none" />
    : <span className="block text-[22px] font-semibold leading-tight text-primary" data-testid={`${testId}-value`}>{value}</span>;
  const body = (
    <>
      {number}
      <span className="mt-0.5 block text-xs text-secondary">{label}</span>
    </>
  );
  return href && value !== null ? (
    <Link href={href} className="block rounded-control px-1 py-0.5 hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent" data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className="px-1 py-0.5" data-testid={testId}>{body}</div>
  );
}

export function HomeWorkspaceCard({
  workspace,
  status,
  hasData,
  summary,
  now,
  onRetry,
}: {
  workspace: { id: string; title: string };
  status: HomeCardStatus;
  /** True when some data was read before (kept on error). */
  hasData: boolean;
  summary: WorkspaceSummary;
  now: number;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const copy = t.homeRedesign;
  const id = encodeURIComponent(workspace.id);
  const showNumbers = hasData && now > 0;
  return (
    <article
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-default bg-surface p-5"
      data-testid="home-workspace-card"
      data-workspace-id={workspace.id}
      data-status={status}
    >
      <header className="flex items-start justify-between gap-3">
        <h3 className="m-0 min-w-0 break-words text-[15px] font-semibold text-primary">{workspace.title}</h3>
        <Link href={`/workspace/${id}/kanban`} className={buttonClassName("secondary", "sm")} data-testid="home-workspace-open">
          {copy.open}
        </Link>
      </header>

      {status === "error" && (
        <ErrorState
          title={copy.loadFailed.replace("{workspace}", workspace.title)}
          message={copy.loadFailedHint}
          onRetry={onRetry}
          retryLabel={copy.reload}
          className="p-4"
        />
      )}

      <div className="flex gap-8">
        <Metric value={showNumbers ? summary.inProgress : null} label={copy.inProgress} testId="home-workspace-in-progress" />
        <Metric
          value={showNumbers ? summary.needsYou : null}
          label={copy.needsYou}
          href={`/workspace/${id}/overview`}
          testId="home-workspace-needs-you"
        />
      </div>

      <div className="border-t border-default pt-3" data-testid="home-workspace-activity">
        {!showNumbers ? (
          <div role="status" aria-busy="true" className="grid gap-2">
            <span className="sr-only">{copy.loading}</span>
            <span aria-hidden="true" className="h-3 w-24 animate-pulse rounded bg-subtle motion-reduce:animate-none" />
            <span aria-hidden="true" className="h-4 w-full animate-pulse rounded bg-subtle motion-reduce:animate-none" />
          </div>
        ) : summary.recent ? (
          <>
            <div className="text-xs text-secondary">
              {copy.recentActivity.replace("{time}", formatRelativeTime(summary.recent.at, now, copy))}
            </div>
            <p className="m-0 mt-1 break-words text-[13px] leading-snug text-primary">{summary.recent.task.title}</p>
          </>
        ) : (
          <div className="text-xs text-secondary">{copy.noActivity}</div>
        )}
        {status === "error" && hasData && <Badge tone="attention" className="mt-2">{copy.stale}</Badge>}
      </div>
    </article>
  );
}
