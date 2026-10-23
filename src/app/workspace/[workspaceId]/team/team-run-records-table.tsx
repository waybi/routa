"use client";

import React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";

import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";

import {
  repoBranchParts,
  TEAM_LEAD_SPECIALIST_ID,
  type SortDirection,
  type TeamRunSessionInfo,
} from "./team-page-model";
import { formatFullTime, useTeamRelativeTime } from "./team-relative-time";
import { runStatusLabel, type TeamRedesignCopy } from "./team-status-labels";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function TeamRunRecordsTable({
  copy,
  runs,
  workspaceId,
  unnamedLabel,
  sortDirection,
  onToggleSort,
  onOpen,
}: {
  copy: TeamRedesignCopy;
  /** Already filtered and sorted. */
  runs: TeamRunSessionInfo[];
  workspaceId: string;
  unnamedLabel: string;
  sortDirection: SortDirection;
  onToggleSort: () => void;
  onOpen: (sessionId: string) => void;
}) {
  const relativeTime = useTeamRelativeTime();
  const notRecorded = copy.common.notRecorded;
  const headers = [
    copy.records.colSession,
    copy.records.colRepoBranch,
    copy.records.colRole,
    copy.records.colMembers,
    copy.records.colStatus,
  ];

  return (
    <div className="rounded-lg border border-default bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default px-4 py-3">
        <h3 className="m-0 text-[13px] font-semibold text-primary">{copy.records.tableTitle}</h3>
        <span className="text-[11px] text-secondary md:hidden">{copy.records.scrollHint}</span>
      </div>
      <div className="overflow-x-auto" data-testid="team-run-records-scroll">
        <table className="w-full min-w-[760px] border-collapse text-left text-xs" data-testid="team-run-records">
          <thead>
            <tr className="border-b border-default text-[11px] text-secondary">
              {headers.map((label) => (
                <th key={label} scope="col" className="px-4 py-2 font-medium">{label}</th>
              ))}
              <th
                scope="col"
                className="px-4 py-2 font-medium"
                aria-sort={sortDirection === "desc" ? "descending" : "ascending"}
              >
                <button
                  type="button"
                  onClick={onToggleSort}
                  title={copy.records.sortHint}
                  data-testid="team-run-sort"
                  className={`inline-flex items-center gap-1 rounded-control text-secondary hover:text-primary ${FOCUS_RING}`}
                >
                  {copy.records.colStartedAt}
                  {sortDirection === "desc"
                    ? <ArrowDown className="h-3 w-3" aria-hidden="true" />
                    : <ArrowUp className="h-3 w-3" aria-hidden="true" />}
                </button>
              </th>
              <th scope="col" className="px-4 py-2 font-medium">{copy.records.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const href = `/workspace/${workspaceId}/team/${run.sessionId}`;
              const repo = repoBranchParts(run);
              const status = runStatusLabel(copy, run);
              const members = typeof run.descendants === "number" ? String(run.descendants) : notRecorded;
              return (
                <tr key={run.sessionId} data-testid="team-run-row" className="border-b border-default align-top last:border-b-0 hover:bg-hover">
                  <td className="max-w-[320px] px-4 py-3" data-col="session">
                    <Link href={href} className={`break-words text-[13px] font-semibold text-primary hover:underline ${FOCUS_RING}`} data-testid="team-run-name-link">
                      {run.name ?? unnamedLabel}
                    </Link>
                    <div>
                      <code className="font-mono text-[11px] text-secondary" title={run.sessionId}>{run.sessionId.slice(0, 8)}</code>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-primary" data-col="repo">
                    {repo ? (
                      <span className="flex flex-col gap-0.5 break-words">
                        {repo.repo ? <span>{repo.repo}</span> : null}
                        {repo.branch ? <span className="font-mono text-[11px] text-secondary">{repo.branch}</span> : null}
                      </span>
                    ) : (
                      <span className="text-secondary">{notRecorded}</span>
                    )}
                  </td>
                  <td className="px-4 py-3" data-col="role">
                    <span className="flex flex-wrap gap-1">
                      {run.role ? <Badge>{run.role}</Badge> : <span className="text-secondary">{notRecorded}</span>}
                      {run.specialistId === TEAM_LEAD_SPECIALIST_ID ? <Badge tone="info">{copy.records.coordinatorBadge}</Badge> : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-primary" data-col="members">{members}</td>
                  <td className="px-4 py-3" data-col="status">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-secondary" data-col="started">
                    <time dateTime={run.createdAt} title={formatFullTime(run.createdAt)}>
                      {relativeTime(run.createdAt) || notRecorded}
                    </time>
                  </td>
                  <td className="px-4 py-3" data-col="actions">
                    <Button variant="secondary" size="sm" onClick={() => onOpen(run.sessionId)} data-testid="team-run-open">
                      {copy.records.openRecord}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
