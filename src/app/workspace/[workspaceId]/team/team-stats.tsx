"use client";

import React from "react";

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
}

const ITEM_CLASS = "inline-flex items-baseline gap-1.5 rounded-full border border-default bg-surface px-3 py-1.5";

function StatItem({ testId, value, label }: { testId: string; value: number; label: string }) {
  return (
    <div className={ITEM_CLASS} data-testid={testId}>
      <span data-stat-value className="text-sm font-semibold text-primary">{value}</span>
      <span className="text-xs text-secondary">{label}</span>
    </div>
  );
}

/** Run count, active runs and member count shown under the page header (restored from the legacy team page). */
export function TeamStats({ runs, active, members, labels }: TeamStatsProps) {
  return (
    <div className="flex min-w-0 flex-wrap gap-2" data-testid="team-stats">
      <StatItem testId="team-stat-runs" value={runs} label={labels.runs} />
      <StatItem testId="team-stat-active" value={active} label={labels.active} />
      <StatItem testId="team-stat-members" value={members} label={labels.members} />
    </div>
  );
}
