"use client";

import React, { type ReactNode } from "react";
import Link from "next/link";

import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { PropertyRow } from "@/client/components/ui/property-row";
import { EmptyState, ErrorState, Skeleton } from "@/client/components/ui/states";
import { Tabs } from "@/client/components/ui/tabs";

import type { SessionInfo } from "../../types";
import { formatFullTime, useTeamRelativeTime } from "../team-relative-time";
import { eventTypeLabel, runStatusLabel, type TeamRedesignCopy } from "../team-status-labels";
import type { CoordinationEvent } from "./team-run-events";

export type TeamRunTabId = "conversation" | "events" | "evidence";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/**
 * Unified session template for a team run (design-spec §3 row 8): a tabbed
 * main area (对话 / 事件 / 证据) with the composer underneath, and a right
 * column with session context, team members and related links. At 768px
 * the right column moves below the main area.
 */
export function TeamRunPageLayout({
  copy,
  activeTab,
  onTabChange,
  loading,
  error,
  onRetry,
  conversation,
  events,
  evidence,
  composer,
  context,
  members,
  links,
}: {
  copy: TeamRedesignCopy;
  activeTab: TeamRunTabId;
  onTabChange: (tab: TeamRunTabId) => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  conversation: ReactNode;
  events: ReactNode;
  evidence: ReactNode;
  composer: ReactNode;
  context: ReactNode;
  members: ReactNode;
  links: ReactNode;
}) {
  const s = copy.session;
  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_260px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_300px]"
      data-testid="team-run-layout"
    >
      <main className="flex min-h-[480px] min-w-0 flex-col lg:min-h-0">
        <div className="min-h-0 flex-1 px-4 py-3 md:px-[22px] lg:overflow-y-auto xl:px-7">
          {error ? (
            <ErrorState
              className="mb-3"
              title={s.loadErrorTitle}
              message={s.loadErrorMessage}
              onRetry={onRetry}
              retryLabel={copy.common.reload}
            />
          ) : null}
          {loading ? (
            <div className="rounded-lg border border-default bg-surface p-4">
              <Skeleton lines={4} label={s.loadingRun} />
            </div>
          ) : (
            <Tabs
              label={s.tabsLabel}
              value={activeTab}
              onChange={(id) => onTabChange(id as TeamRunTabId)}
              items={[
                { id: "conversation", label: s.tabConversation, content: conversation },
                { id: "events", label: s.tabEvents, content: events },
                { id: "evidence", label: s.tabEvidence, content: evidence },
              ]}
            />
          )}
        </div>
        <div className="shrink-0 border-t border-default bg-surface px-3 py-2">{composer}</div>
      </main>

      <aside
        className="flex min-w-0 flex-col gap-3 border-t border-default bg-canvas p-3 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0"
        data-testid="team-run-aside"
      >
        {context}
        {members}
        {links}
      </aside>
    </div>
  );
}

export function TeamRunEventsPanel({
  copy,
  events,
  onOpenMemberSession,
}: {
  copy: TeamRedesignCopy;
  events: CoordinationEvent[];
  onOpenMemberSession: (sessionId: string) => void;
}) {
  const relativeTime = useTeamRelativeTime();
  if (events.length === 0) {
    return <EmptyState title={copy.session.eventsEmptyTitle} description={copy.session.eventsEmptyDescription} />;
  }
  return (
    <ol className="m-0 flex list-none flex-col divide-y divide-default rounded-lg border border-default bg-surface p-0" data-testid="team-run-events">
      {events.map((event) => {
        const type = eventTypeLabel(copy, event.type);
        return (
          <li key={event.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-3" data-testid="team-run-event">
            <time
              className="w-20 shrink-0 text-[11px] text-secondary"
              dateTime={event.occurredAt}
              title={formatFullTime(event.occurredAt)}
            >
              {relativeTime(event.occurredAt)}
            </time>
            <Badge tone={type.tone}>{type.label}</Badge>
            <div className="min-w-0 flex-1 basis-60">
              <p className="m-0 break-words text-[13px] font-semibold text-primary" data-testid="team-run-event-title">{event.title}</p>
              {event.summary ? <p className="m-0 mt-0.5 break-words text-xs text-secondary">{event.summary}</p> : null}
            </div>
            {event.sessionId ? (
              <Button variant="ghost" size="xs" onClick={() => onOpenMemberSession(event.sessionId!)} data-testid="team-run-event-open">
                {copy.session.openMemberSession}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function TeamRunContextPanel({
  copy,
  session,
  workspaceTitle,
}: {
  copy: TeamRedesignCopy;
  session: SessionInfo | null;
  workspaceTitle: string;
}) {
  const relativeTime = useTeamRelativeTime();
  const s = copy.session;
  const missing = <span className="text-secondary">{copy.common.notRecorded}</span>;
  const status = runStatusLabel(copy, session);
  return (
    <section className="rounded-lg border border-default bg-surface p-3" aria-label={s.contextTitle} data-testid="team-run-context">
      <h2 className="m-0 mb-1 text-[12px] font-semibold text-primary">{s.contextTitle}</h2>
      <dl className="m-0">
        <PropertyRow label={s.workspace}>{workspaceTitle || missing}</PropertyRow>
        <PropertyRow label={s.provider} mono>{session?.provider || missing}</PropertyRow>
        <PropertyRow label={s.model} mono>{session?.model || missing}</PropertyRow>
        <PropertyRow label={s.cwd} mono>{session?.cwd || missing}</PropertyRow>
        <PropertyRow label={s.branch} mono>{session?.branch || missing}</PropertyRow>
        <PropertyRow label={s.status}><Badge tone={status.tone}>{status.label}</Badge></PropertyRow>
        <PropertyRow label={s.createdAt}>
          {session?.createdAt ? (
            <time dateTime={session.createdAt} title={formatFullTime(session.createdAt)}>{relativeTime(session.createdAt)}</time>
          ) : missing}
        </PropertyRow>
      </dl>
    </section>
  );
}

export function TeamRunLinksPanel({
  copy,
  sessionId,
  workspaceId,
}: {
  copy: TeamRedesignCopy;
  sessionId: string;
  workspaceId: string;
}) {
  const s = copy.session;
  const linkClass = `inline-flex min-h-7 items-center rounded-control border border-default bg-surface px-2.5 py-1 text-xs text-primary hover:bg-hover ${FOCUS_RING}`;
  return (
    <section className="rounded-lg border border-default bg-surface p-3" aria-label={s.linksTitle} data-testid="team-run-links">
      <h2 className="m-0 mb-2 text-[12px] font-semibold text-primary">{s.linksTitle}</h2>
      <div className="flex flex-wrap gap-2">
        <Link
          className={linkClass}
          href={`/traces?sessionId=${encodeURIComponent(sessionId)}&workspaceId=${encodeURIComponent(workspaceId)}`}
          data-testid="team-run-link-traces"
        >
          {s.traces}
        </Link>
        <Link
          className={linkClass}
          href={`/debug/acp-replay?sessionId=${encodeURIComponent(sessionId)}`}
          data-testid="team-run-link-replay"
        >
          {s.acpReplay}
        </Link>
      </div>
    </section>
  );
}
