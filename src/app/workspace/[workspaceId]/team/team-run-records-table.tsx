"use client";

import React from "react";
import Link from "next/link";
import { AlertCircle, ArrowDown, ArrowUp, Check } from "lucide-react";

import { Badge } from "@/client/components/ui/badge";

import {
  memberSpecialistsOfRun,
  repoBranchParts,
  runFilterBucket,
  TEAM_LEAD_SPECIALIST_ID,
  type SortDirection,
  type TeamRunSessionInfo,
} from "./team-page-model";
import { formatFullTime, useTeamRelativeTime } from "./team-relative-time";
import { FOCUS_RING, MemberAvatar, memberDisplayNames, type SpecialistSummary } from "./team-roster";
import { fillTemplate, runStatusLabel, type TeamRedesignCopy } from "./team-status-labels";

/** Columns that give way on narrow screens; their content moves to the second line of the session cell. */
const REPO_COL = "hidden min-[1180px]:table-cell";
const NARROW_COL = "hidden min-[900px]:table-cell";
const MAX_AVATARS = 4;

function RunStatusIcon({ run }: { run: TeamRunSessionInfo }) {
  const bucket = runFilterBucket(run);
  if (bucket === "active") {
    return (
      <span aria-hidden="true" data-run-icon="active" className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-success-subtle">
        <span className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
      </span>
    );
  }
  if (bucket === "ended") {
    return (
      <span aria-hidden="true" data-run-icon="ended" className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-accent-subtle text-information">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (bucket === "error") {
    return (
      <span aria-hidden="true" data-run-icon="error" className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-danger-subtle text-danger">
        <AlertCircle className="h-3 w-3" />
      </span>
    );
  }
  return <span aria-hidden="true" data-run-icon="none" className="h-[18px] w-[18px] shrink-0 rounded-full border border-dashed border-default" />;
}

function isInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("a, button, input, select, textarea"));
}

export function TeamRunRecordsTable({
  copy,
  runs,
  totalCount,
  allSessions,
  specialistsById,
  workspaceId,
  unnamedLabel,
  sortDirection,
  onToggleSort,
  onOpen,
}: {
  copy: TeamRedesignCopy;
  /** Already filtered and sorted. */
  runs: TeamRunSessionInfo[];
  /** All team runs before filtering, for the footer. */
  totalCount: number;
  allSessions: TeamRunSessionInfo[];
  specialistsById: Map<string, SpecialistSummary>;
  workspaceId: string;
  unnamedLabel: string;
  sortDirection: SortDirection;
  onToggleSort: () => void;
  onOpen: (sessionId: string) => void;
}) {
  const relativeTime = useTeamRelativeTime();
  const notRecorded = copy.common.notRecorded;
  const th = "px-3.5 py-2 font-medium whitespace-nowrap";

  return (
    <div className="overflow-hidden rounded-[10px] border border-default bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-default px-3.5 py-2">
        <h3 className="m-0 text-xs font-semibold text-primary">{copy.records.tableTitle}</h3>
      </div>
      <div className="overflow-x-auto" data-testid="team-run-records-scroll">
        <table className="w-full border-collapse text-left text-[12.5px]" data-testid="team-run-records">
          <thead>
            <tr className="border-b border-default text-[11px] text-secondary">
              <th scope="col" className={th}>{copy.records.colSession}</th>
              <th scope="col" className={`${th} ${REPO_COL}`}>{copy.records.colRepoBranch}</th>
              <th scope="col" className={`${th} ${NARROW_COL}`}>{copy.records.colRole}</th>
              <th scope="col" className={`${th} ${NARROW_COL}`}>{copy.records.colMembers}</th>
              <th scope="col" className={th}>{copy.records.colStatus}</th>
              <th scope="col" className={th} aria-sort={sortDirection === "desc" ? "descending" : "ascending"}>
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
              <th scope="col" className={th}>{copy.records.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const href = `/workspace/${workspaceId}/team/${run.sessionId}`;
              const repo = repoBranchParts(run);
              const status = runStatusLabel(copy, run);
              const memberIds = memberSpecialistsOfRun(run.sessionId, allSessions);
              const memberCount = typeof run.descendants === "number" ? run.descendants : memberIds.length > 0 ? memberIds.length : null;
              const isCoordinator = run.specialistId === TEAM_LEAD_SPECIALIST_ID;
              const repoText = repo ? [repo.repo, repo.branch].filter(Boolean).join(" · ") : notRecorded;
              return (
                <tr
                  key={run.sessionId}
                  data-testid="team-run-row"
                  onClick={(event) => { if (!isInteractive(event.target)) onOpen(run.sessionId); }}
                  className="group cursor-pointer border-b border-default align-middle transition-colors last:border-b-0 hover:bg-hover motion-reduce:transition-none"
                >
                  <td className="max-w-[360px] px-3.5 py-2.5" data-col="session">
                    <div className="flex min-w-0 items-center gap-2">
                      <RunStatusIcon run={run} />
                      <Link
                        href={href}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                          event.preventDefault();
                          onOpen(run.sessionId);
                        }}
                        className={`min-w-0 break-words text-[13px] font-semibold text-primary hover:underline ${FOCUS_RING}`}
                        data-testid="team-run-name-link"
                      >
                        {run.name ?? unnamedLabel}
                      </Link>
                      {isCoordinator ? <Badge tone="info">{copy.records.coordinatorBadge}</Badge> : null}
                    </div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 pl-[26px] text-[10.5px] text-secondary">
                      <code className="font-mono" title={run.sessionId}>{run.sessionId.slice(0, 8)}</code>
                      <span className="break-all font-mono min-[1180px]:hidden" data-testid="team-run-narrow-repo">{repoText}</span>
                      <span className="flex items-center gap-1.5 min-[900px]:hidden" data-testid="team-run-narrow-meta">
                        {run.role ? <Badge>{run.role}</Badge> : null}
                        <span>{memberCount === null ? notRecorded : fillTemplate(copy.runs.memberCount, { count: memberCount })}</span>
                      </span>
                    </div>
                  </td>
                  <td className={`px-3.5 py-2.5 text-primary ${REPO_COL}`} data-col="repo">
                    {repo ? (
                      <span className="flex flex-col gap-0.5 break-words font-mono text-[11.5px]">
                        {repo.repo ? <span>{repo.repo}</span> : null}
                        {repo.branch ? <span className="text-[10.5px] text-secondary">{repo.branch}</span> : null}
                      </span>
                    ) : (
                      <span className="text-secondary">{notRecorded}</span>
                    )}
                  </td>
                  <td className={`px-3.5 py-2.5 ${NARROW_COL}`} data-col="role">
                    <span className="flex flex-wrap gap-1">
                      {run.role ? <Badge>{run.role}</Badge> : <span className="text-secondary">{notRecorded}</span>}
                      {isCoordinator ? <Badge tone="info">{copy.records.coordinatorBadge}</Badge> : null}
                    </span>
                  </td>
                  <td className={`px-3.5 py-2.5 text-primary ${NARROW_COL}`} data-col="members">
                    <span className="flex items-center gap-1.5">
                      {memberIds.length > 0 ? (
                        <span className="flex items-center" data-testid="team-run-member-avatars">
                          {memberIds.slice(0, MAX_AVATARS).map((id, index) => {
                            const specialist = specialistsById.get(id) ?? { id, name: id };
                            const name = memberDisplayNames(specialist, copy).primary;
                            return (
                              <span key={id} title={name} className={index === 0 ? "" : "-ml-1.5"}>
                                <MemberAvatar specialist={specialist} name={name} size="sm" className="border-2 border-surface" />
                              </span>
                            );
                          })}
                        </span>
                      ) : null}
                      <span>{memberCount === null ? notRecorded : String(memberCount)}</span>
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5" data-col="status">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-secondary" data-col="started">
                    <time dateTime={run.createdAt} title={formatFullTime(run.createdAt)}>
                      {relativeTime(run.createdAt) || notRecorded}
                    </time>
                  </td>
                  <td className="px-3.5 py-2.5" data-col="actions">
                    <button
                      type="button"
                      onClick={() => onOpen(run.sessionId)}
                      aria-label={copy.records.openRecord}
                      title={copy.records.openRecord}
                      data-testid="team-run-open"
                      className={`whitespace-nowrap rounded-control px-2 py-1 text-xs text-accent opacity-70 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100 hover:bg-hover focus-visible:opacity-100 motion-reduce:transition-none ${FOCUS_RING}`}
                    >
                      {copy.runs.openArrow}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="m-0 border-t border-default px-3.5 py-2 text-[11px] text-secondary" data-testid="team-runs-footer">
        {fillTemplate(copy.runs.footer, { total: totalCount, shown: runs.length })}
      </p>
    </div>
  );
}
