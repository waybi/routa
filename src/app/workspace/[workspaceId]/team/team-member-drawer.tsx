"use client";

import React, { useEffect, useId, useRef } from "react";
import Link from "next/link";
import { X } from "lucide-react";

import { Badge } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";

import { TEAM_LEAD_SPECIALIST_ID, type TeamRunSessionInfo } from "./team-page-model";
import { formatFullTime, useTeamRelativeTime } from "./team-relative-time";
import { FOCUS_RING, MemberAvatar, MemberStatus, memberDisplayNames, roleGroupLabel, teamRoleLabel, type SpecialistSummary } from "./team-roster";
import { runStatusLabel, type TeamRedesignCopy } from "./team-status-labels";

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Right-side member drawer (team page v2). Esc, the scrim and the close
 * button all call onClose; the page puts focus back on the trigger.
 * Tab stays inside the drawer while it is open.
 */
export function TeamMemberDrawer({
  copy,
  specialist,
  activeCount,
  recentRuns,
  unnamedLabel,
  onClose,
  onMention,
  onOpenRun,
}: {
  copy: TeamRedesignCopy;
  specialist: SpecialistSummary;
  activeCount: number;
  recentRuns: Array<{ targetId: string; session: TeamRunSessionInfo }>;
  unnamedLabel: string;
  onClose: () => void;
  onMention: (specialist: SpecialistSummary) => void;
  onOpenRun: (sessionId: string) => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const relativeTime = useTeamRelativeTime();
  const names = memberDisplayNames(specialist, copy);
  const isLead = specialist.id === TEAM_LEAD_SPECIALIST_ID;
  const roleText = specialist.role?.trim()
    ? `${teamRoleLabel(specialist, copy)} · ${roleGroupLabel(specialist.role, copy)}`
    : teamRoleLabel(specialist, copy);

  useEffect(() => {
    closeRef.current?.focus();
  }, [specialist.id]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusables.length === 0) return;
    const index = focusables.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (index <= 0 ? focusables.length - 1 : index - 1)
      : (index === -1 || index >= focusables.length - 1 ? 0 : index + 1);
    event.preventDefault();
    focusables[next].focus();
  };

  return (
    <div className="fixed inset-0 z-40" onKeyDown={onKeyDown}>
      <div
        className="absolute inset-0 bg-canvas/70 backdrop-blur-[2px] transition-opacity duration-200 starting:opacity-0 motion-reduce:transition-none"
        onClick={onClose}
        data-testid="team-member-drawer-scrim"
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="team-member-drawer"
        className="absolute right-0 top-0 flex h-full w-[min(420px,100vw)] flex-col border-l border-default bg-surface shadow-overlay transition-transform duration-200 ease-out starting:translate-x-full motion-reduce:transition-none"
      >
        <div className="flex items-start gap-3 border-b border-default px-5 py-[18px]">
          <MemberAvatar specialist={specialist} name={names.primary} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 break-words text-base font-semibold text-primary" data-testid="team-member-drawer-name">{names.primary}</h2>
            <p className="m-0 mt-0.5 font-mono text-[10.5px] text-secondary">{names.secondary}</p>
            <p className="m-0 mt-1.5"><Badge tone={isLead ? "info" : "neutral"}>{roleText}</Badge></p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={copy.drawer.close}
            title={copy.drawer.close}
            data-testid="team-member-drawer-close"
            className={`grid h-8 w-8 place-items-center rounded-control text-secondary hover:bg-hover hover:text-primary ${FOCUS_RING}`}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-auto px-5 py-[18px]">
          <p className="m-0 break-words text-[13px] leading-relaxed text-primary" data-testid="team-member-drawer-description">
            {specialist.description ?? copy.roster.noDescription}
          </p>
          <dl className="m-0 grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 text-xs">
            <dt className="text-secondary">{copy.drawer.specialistId}</dt>
            <dd className="m-0 break-all font-mono text-primary" data-testid="team-member-drawer-id">{specialist.id}</dd>
            <dt className="text-secondary">{copy.drawer.role}</dt>
            <dd className="m-0 text-primary" data-testid="team-member-drawer-role">{roleText}</dd>
            <dt className="text-secondary">{copy.drawer.modelTier}</dt>
            <dd className="m-0 text-primary" data-testid="team-member-drawer-tier">{specialist.defaultModelTier?.trim() || copy.common.notRecorded}</dd>
            <dt className="text-secondary">{copy.drawer.currentStatus}</dt>
            <dd className="m-0" data-testid="team-member-drawer-status"><MemberStatus count={activeCount} copy={copy} /></dd>
          </dl>
          <section className="flex flex-col gap-1">
            <h3 className="m-0 text-[11px] font-semibold text-secondary">{copy.drawer.recentRuns}</h3>
            {recentRuns.length === 0 ? (
              <p className="m-0 text-xs text-secondary">{copy.drawer.noRecentRuns}</p>
            ) : (
              <ul className="m-0 list-none p-0" data-testid="team-member-drawer-runs">
                {recentRuns.map(({ targetId, session }) => {
                  const status = runStatusLabel(copy, session);
                  return (
                    <li key={targetId} className="border-t border-default first:border-t-0">
                      <button
                        type="button"
                        onClick={() => onOpenRun(targetId)}
                        data-testid="team-member-drawer-run"
                        data-target-id={targetId}
                        className={`flex w-full min-w-0 items-center gap-2 py-2 text-left text-xs hover:bg-hover ${FOCUS_RING}`}
                      >
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <span className="min-w-0 flex-1 truncate text-primary">{session.name ?? unnamedLabel}</span>
                        <time className="shrink-0 text-secondary" dateTime={session.createdAt} title={formatFullTime(session.createdAt)}>
                          {relativeTime(session.createdAt)}
                        </time>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-default bg-sidebar px-5 py-3.5">
          {!isLead ? (
            <button
              type="button"
              onClick={() => onMention(specialist)}
              className={buttonClassName("primary", "md")}
              data-testid="team-member-drawer-mention"
            >
              {copy.drawer.mentionDispatch}
            </button>
          ) : null}
          <Link href="/settings/specialists" className={buttonClassName("secondary", "md")} data-testid="team-member-drawer-edit">
            {copy.drawer.editInSettings}
          </Link>
        </div>
      </div>
    </div>
  );
}
