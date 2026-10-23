"use client";

import React, { type ReactNode } from "react";

export interface TeamStatsLabels {
  runs: string;
  active: string;
  members: string;
}

export interface TeamStatsProps {
  runs: number;
  active: number;
  members: number;
  labels: TeamStatsLabels;
  /** Accessible name of the stats block. */
  ariaLabel?: string;
  className?: string;
}

const ITEM_CLASS = "flex min-w-[88px] flex-1 flex-col justify-center px-4 py-[7px] border-l border-default first:border-l-0";

function StatItem({ testId, value, label, live = false }: { testId: string; value: number; label: string; live?: boolean }) {
  return (
    <div className={ITEM_CLASS} data-testid={testId}>
      <span className="flex items-center gap-1.5 text-[19px] font-semibold leading-tight text-primary tabular-nums">
        {live ? (
          <span
            aria-hidden="true"
            data-testid="team-stat-live-dot"
            className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-success motion-safe:animate-pulse"
          />
        ) : null}
        <span data-stat-value>{value}</span>
      </span>
      <span className="text-[11px] text-secondary">{label}</span>
    </div>
  );
}

/**
 * Runs, active runs and members as one segmented block (team page v2 header).
 * Counting rules are the legacy ones and live in the page; this only renders.
 */
export function TeamStats({ runs, active, members, labels, ariaLabel, className = "" }: TeamStatsProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex min-w-0 items-stretch overflow-hidden rounded-lg border border-default bg-surface ${className}`.trim()}
      data-testid="team-stats"
    >
      <StatItem testId="team-stat-runs" value={runs} label={labels.runs} />
      <StatItem testId="team-stat-active" value={active} label={labels.active} live={active > 0} />
      <StatItem testId="team-stat-members" value={members} label={labels.members} />
    </div>
  );
}

/** Page title and description on the left; stats block and the two header actions on the right. */
export function TeamPageHeaderBar({
  title,
  description,
  stats,
  actions,
}: {
  title: ReactNode;
  description: ReactNode;
  stats: ReactNode;
  actions: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end gap-x-5 gap-y-3">
      <div className="min-w-0 flex-[1_1_240px]">
        <h1 className="m-0 text-[22px] font-semibold leading-tight tracking-tight text-primary">{title}</h1>
        <p className="m-0 mt-1 text-[12.5px] text-secondary">{description}</p>
      </div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 min-[900px]:ml-auto min-[900px]:w-auto">
        <div className="min-w-0 flex-[1_1_100%] min-[900px]:flex-none">{stats}</div>
        {actions}
      </div>
    </header>
  );
}
