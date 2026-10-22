"use client";

/**
 * Home page blocks besides the workspace cards: the needs-you banner, the
 * latest completion report, the create block and the setup reminder.
 */

import Link from "next/link";
import { Inbox, Plus } from "lucide-react";
import { useTranslation } from "@/i18n";
import { buttonClassName } from "@/client/components/ui/button";
import { EmptyState, Skeleton } from "@/client/components/ui/states";
import {
  completionReportHref,
  type LatestResult,
} from "@/app/workspace/[workspaceId]/overview/inbox-rules";
import { formatRelativeTime } from "./relative-time";

export function HomeAttentionBanner({ count, topTitle, href }: { count: number; topTitle: string | null; href: string }) {
  const { t } = useTranslation();
  const copy = t.homeRedesign;
  if (count <= 0) return null;
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-default border-l-4 border-l-attention bg-attention-subtle px-4 py-3 min-[801px]:flex-row min-[801px]:items-center"
      data-testid="home-attention-banner"
    >
      <Inbox className="hidden h-5 w-5 shrink-0 text-attention min-[801px]:block" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm font-semibold text-primary">{copy.bannerTitle.replace("{count}", String(count))}</p>
        {topTitle && <p className="m-0 mt-0.5 break-words text-xs text-secondary">{copy.bannerTop.replace("{title}", topTitle)}</p>}
      </div>
      <Link href={href} className={`${buttonClassName("secondary", "md")} self-start min-[801px]:self-auto`} data-testid="home-attention-open">
        {copy.openInbox}
      </Link>
    </section>
  );
}

export function HomeLatestResult({ result, loading, now }: { result: LatestResult | null; loading: boolean; now: number }) {
  const { t } = useTranslation();
  const copy = t.homeRedesign;
  let body: React.ReactNode;
  if (result) {
    body = (
      <>
        <h3 className="m-0 break-words text-sm font-semibold leading-snug text-primary">{result.task.title}</h3>
        {result.summary && <p className="m-0 mt-2 break-words text-[13px] leading-relaxed text-secondary">{result.summary}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link href={completionReportHref(result)} className={buttonClassName("secondary", "sm")} data-testid="home-read-report">
            {copy.readReport}
          </Link>
          {now > 0 && <span className="text-xs text-secondary">{formatRelativeTime(result.at, now, copy)}</span>}
        </div>
      </>
    );
  } else if (loading) {
    body = <Skeleton lines={3} label={copy.loading} />;
  } else {
    body = <EmptyState title={copy.noResultTitle} description={copy.noResultHint} className="py-8" />;
  }
  return (
    <section className="min-w-0 rounded-lg border border-default bg-surface p-5" data-testid="home-latest-result">
      <h2 className="m-0 mb-3 text-[15px] font-semibold text-primary">{copy.latestResult}</h2>
      {body}
    </section>
  );
}

export function HomeCreateSection({
  workspaceId,
  continueSession,
}: {
  workspaceId: string | null;
  continueSession: { href: string; label: string } | null;
}) {
  const { t } = useTranslation();
  const copy = t.homeRedesign;
  const id = workspaceId ? encodeURIComponent(workspaceId) : null;
  return (
    <section className="min-w-0 rounded-lg border border-default bg-surface p-5" data-testid="home-create">
      <h2 className="m-0 text-[15px] font-semibold text-primary">{copy.createSection}</h2>
      <p className="m-0 mt-2 text-[13px] text-secondary">{copy.createHint}</p>
      {id && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Link href={`/workspace/${id}/kanban`} className={buttonClassName("secondary", "sm")} data-testid="home-new-card">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {copy.newCard}
          </Link>
          <Link href={`/workspace/${id}/sessions`} className={buttonClassName("secondary", "sm")} data-testid="home-new-session">
            {copy.newSession}
          </Link>
        </div>
      )}
      {continueSession && (
        <Link
          href={continueSession.href}
          className="mt-3 block break-words text-[13px] text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          data-testid="home-continue-session"
        >
          {copy.continueSession.replace("{name}", continueSession.label)}
        </Link>
      )}
    </section>
  );
}

export function HomeReadinessNotice({
  missingModel,
  missingCodebase,
  onConfigureModel,
  onAddCodebase,
}: {
  missingModel: boolean;
  missingCodebase: boolean;
  onConfigureModel: () => void;
  onAddCodebase: () => void;
}) {
  const { t } = useTranslation();
  const copy = t.homeRedesign;
  if (!missingModel && !missingCodebase) return null;
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-default bg-surface px-4 py-3 min-[801px]:flex-row min-[801px]:items-center min-[801px]:justify-between"
      data-testid="home-readiness"
    >
      <div className="min-w-0">
        <p className="m-0 text-[13px] font-semibold text-attention">{copy.readinessTitle}</p>
        <ul className="m-0 mt-1 list-disc pl-5 text-xs text-secondary">
          {missingModel && <li>{copy.readinessModel}</li>}
          {missingCodebase && <li>{copy.readinessCodebase}</li>}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        {missingModel && (
          <button type="button" onClick={onConfigureModel} className={buttonClassName("secondary", "sm")} data-testid="home-readiness-configure">
            {copy.configure}
          </button>
        )}
        {missingCodebase && (
          <button type="button" onClick={onAddCodebase} className={buttonClassName("secondary", "sm")} data-testid="home-readiness-add-codebase">
            {copy.addCodebase}
          </button>
        )}
      </div>
    </section>
  );
}
