"use client";

import React from "react";

import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/client/components/ui/states";

import type { ListLoadState } from "../sessions/sessions-redesign-parts";
import {
  avatarLetter,
  displayLabelOf,
  findCoordinatorSession,
  selectCoordinators,
  type CoordinatorAgent,
  type TeamRunSessionInfo,
} from "./team-page-model";
import { formatFullTime, useTeamRelativeTime } from "./team-relative-time";
import { agentStatusLabel, type TeamRedesignCopy } from "./team-status-labels";

export function TeamCoordinatorCards({
  copy,
  agents,
  teamRuns,
  allSessions,
  onOpen,
}: {
  copy: TeamRedesignCopy;
  agents: ListLoadState<CoordinatorAgent>;
  teamRuns: TeamRunSessionInfo[];
  allSessions: TeamRunSessionInfo[];
  onOpen: (sessionId: string) => void;
}) {
  const relativeTime = useTeamRelativeTime();
  const coordinators = selectCoordinators(agents.items);
  const firstLoad = agents.status === "loading" && !agents.loadedOnce;
  const failed = agents.status === "error";

  return (
    <section aria-label={copy.coordinators.sectionLabel} data-testid="team-coordinators" className="flex flex-col gap-3">
      {failed ? (
        <ErrorState
          title={copy.coordinators.loadErrorTitle}
          message={agents.loadedOnce ? copy.common.staleNote : agents.errorMessage ?? undefined}
          onRetry={agents.reload}
          retryLabel={copy.common.reload}
        />
      ) : null}

      {firstLoad ? (
        <div className="rounded-lg border border-default bg-surface p-4">
          <Skeleton lines={3} label={copy.coordinators.loading} />
        </div>
      ) : failed && !agents.loadedOnce ? null : coordinators.length === 0 ? (
        <EmptyState title={copy.coordinators.emptyTitle} description={copy.coordinators.emptyDescription} />
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2 xl:grid-cols-3">
          {coordinators.map((agent) => {
            const linked = findCoordinatorSession(agent.id, teamRuns, allSessions);
            const status = agentStatusLabel(copy, agent.status);
            const displayLabel = displayLabelOf(agent);
            return (
              <li
                key={agent.id}
                data-testid="team-coordinator-card"
                className="flex min-w-0 flex-col gap-3 rounded-lg border border-default bg-surface p-4"
              >
                <p className="m-0 text-xs font-semibold text-secondary">{copy.coordinators.cardTitle}</p>
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-accent-subtle text-[13px] font-semibold text-accent"
                  >
                    {avatarLetter(agent.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="m-0 break-words text-[13px] font-semibold text-primary [overflow-wrap:anywhere]">{agent.name}</h3>
                    <p className="m-0 mt-1 flex flex-wrap items-center gap-1.5 text-xs text-secondary">
                      <span>{agent.role}</span>
                      <span aria-hidden="true">·</span>
                      <Badge tone={status.tone}>
                        <span title={status.known ? undefined : status.raw} data-testid="team-coordinator-status">{status.label}</span>
                      </Badge>
                    </p>
                    {displayLabel ? (
                      <p className="m-0 mt-1 break-words text-xs text-primary">
                        <span className="text-secondary">{copy.coordinators.displayLabel}：</span>
                        {displayLabel}
                      </p>
                    ) : null}
                    <p className="m-0 mt-1 text-[11px] text-secondary">
                      {copy.coordinators.createdLabel}{" "}
                      <time dateTime={agent.createdAt} title={formatFullTime(agent.createdAt)}>{relativeTime(agent.createdAt)}</time>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!linked}
                    onClick={() => linked && onOpen(linked.sessionId)}
                    data-testid="team-coordinator-open"
                  >
                    {copy.coordinators.openTeamSession}
                  </Button>
                  {linked ? (
                    <code className="font-mono text-[11px] text-secondary" title={linked.sessionId} data-testid="team-coordinator-session-id">
                      <span className="sr-only">{copy.coordinators.linkedSessionLabel} </span>
                      {linked.sessionId.slice(0, 8)}
                    </code>
                  ) : (
                    <span className="text-[11px] text-secondary">{copy.coordinators.notLinked}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
