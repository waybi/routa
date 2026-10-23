"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ExternalLink, RefreshCw } from "lucide-react";
import { useTranslation } from "@/i18n";
import { Badge } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";
import type { SessionInfo } from "../../types";
import { runStatusLabel } from "../team-status-labels";

interface TeamRunPageHeaderProps {
  workspaceId: string;
  selectedSessionId: string;
  selectedSessionName: string;
  teamRuns: SessionInfo[];
  /** Current session metadata; model, role, branch and status badges read from it. */
  session?: SessionInfo | null;
  isSwitchingTeamRun: boolean;
  backLabel: string;
  refreshLabel: string;
  openLabel: string;
  activeLabel: string;
  waitingLabel: string;
  onRefresh: () => void;
  onSwitchTeamRun: (sessionId: string) => void;
}

export function TeamRunPageHeader({
  workspaceId,
  selectedSessionId,
  selectedSessionName,
  teamRuns,
  session,
  isSwitchingTeamRun,
  backLabel,
  refreshLabel,
  openLabel,
  activeLabel,
  waitingLabel,
  onRefresh,
  onSwitchTeamRun,
}: TeamRunPageHeaderProps) {
  const { t } = useTranslation();
  const copy = t.teamRedesign;
  const [showTeamRunMenu, setShowTeamRunMenu] = useState(false);
  const teamRunSwitcherRef = useRef<HTMLDivElement | null>(null);
  const selectedTeamRun = teamRuns.find((run) => run.sessionId === selectedSessionId) ?? teamRuns[0];
  const canSwitchTeamRun = teamRuns.length > 1;

  const normalizedTeamRunTitle = (selectedTeamRun?.name ?? selectedSessionName)
    .replace(/^\s*team\s*run\s*[-:：]?\s*/i, "")
    .replace(/^\s*team\s+[-:：]?\s*/i, "")
    .trim() || copy.session.unnamedRun;
  const current = session?.sessionId === selectedSessionId ? session : selectedTeamRun;
  const status = runStatusLabel(copy, current);

  useEffect(() => {
    if (!teamRunSwitcherRef.current) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!teamRunSwitcherRef.current?.contains(event.target as Node)) {
        setShowTeamRunMenu(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="shrink-0 border-b border-default bg-canvas px-4 py-3 md:px-[22px] xl:px-7" data-testid="team-run-page-header">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Link
            href={`/workspace/${workspaceId}/team`}
            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-default bg-surface text-secondary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            title={backLabel}
            aria-label={backLabel}
            data-testid="team-run-back"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">{backLabel}</span>
          </Link>
          <div ref={teamRunSwitcherRef} className="relative min-w-0 flex-1">
            <p className="m-0 text-xs text-secondary">{copy.session.eyebrow}</p>
            <button
              type="button"
              onClick={() => setShowTeamRunMenu((current) => canSwitchTeamRun ? !current : false)}
              aria-expanded={canSwitchTeamRun ? showTeamRunMenu : undefined}
              data-testid="team-run-switcher"
              className="mt-0.5 inline-flex max-w-full items-start gap-2 rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              title={t.team.teamRuns}
            >
              <span className="min-w-0 break-words text-[21px] font-semibold leading-tight text-primary">{normalizedTeamRunTitle}</span>
              {canSwitchTeamRun ? (
                <ChevronDown
                  className={`mt-1.5 h-4 w-4 shrink-0 text-secondary transition-transform ${showTeamRunMenu ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              ) : null}
              {isSwitchingTeamRun ? (
                <span className="mt-2.5 h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-information motion-reduce:animate-none" />
              ) : null}
            </button>
            <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="team-run-badges">
              <Badge className="font-mono">
                <span className="sr-only">{t.sessionsRedesign.sessionIdLabel} </span>
                <span title={selectedSessionId}>{selectedSessionId.slice(0, 8)}</span>
              </Badge>
              <Badge className="font-mono">
                <span data-testid="team-run-model">{current?.model || copy.session.modelNotRecorded}</span>
              </Badge>
              {current?.role ? <Badge tone="info">{current.role}</Badge> : null}
              {current?.branch ? <Badge>{current.branch}</Badge> : null}
              <Badge tone={status.tone}><span data-testid="team-run-status">{status.label}</span></Badge>
            </div>
            {showTeamRunMenu && canSwitchTeamRun ? (
              <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-80 max-w-[calc(100vw-32px)] overflow-y-auto rounded-lg border border-default bg-surface p-1 shadow-overlay">
                {teamRuns.map((run) => {
                  const isActive = run.sessionId === selectedSessionId;
                  return (
                    <button
                      key={run.sessionId}
                      type="button"
                      onClick={() => {
                        if (run.sessionId !== selectedSessionId) {
                          onSwitchTeamRun(run.sessionId);
                        }
                        setShowTeamRunMenu(false);
                      }}
                      data-testid="team-run-switch-option"
                      className={`mb-0.5 flex w-full items-center justify-between gap-2 rounded-control px-2.5 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-accent ${
                        isActive
                          ? "bg-accent-subtle text-accent"
                          : "text-secondary hover:bg-hover hover:text-primary"
                      }`}
                    >
                      <span className="break-words text-xs font-medium">{run.name ?? `${copy.session.unnamedRun} ${run.sessionId.slice(0, 8)}`}</span>
                      <span className="shrink-0 text-[10px]">
                        {isActive ? activeLabel : waitingLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onRefresh} className={buttonClassName("secondary", "sm")} data-testid="team-run-refresh">
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            {refreshLabel}
          </button>
          <Link href={`/workspace/${workspaceId}/sessions/${selectedSessionId}`} className={buttonClassName("primary", "sm")} data-testid="team-run-open-session">
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {openLabel}
          </Link>
        </div>
      </div>
    </header>
  );
}
