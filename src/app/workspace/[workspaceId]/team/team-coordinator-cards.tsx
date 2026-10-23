"use client";

import React from "react";
import { ArrowRight } from "lucide-react";

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

/**
 * "On duty" rows inside the lead card (team page v2): one row per ROUTA
 * coordinator with every field and button of the former coordinator cards.
 * Loading, error and empty states are independent of the rest of the page.
 */
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
    <section aria-label={copy.coordinators.sectionLabel} data-testid="team-coordinators" className="flex min-w-0 flex-col gap-2">
      {failed ? (
        <ErrorState
          title={copy.coordinators.loadErrorTitle}
          message={agents.loadedOnce ? copy.common.staleNote : agents.errorMessage ?? undefined}
          onRetry={agents.reload}
          retryLabel={copy.common.reload}
        />
      ) : null}

      {firstLoad ? (
        <Skeleton lines={2} label={copy.coordinators.loading} />
      ) : failed && !agents.loadedOnce ? null : coordinators.length === 0 ? (
        <EmptyState title={copy.coordinators.emptyTitle} description={copy.coordinators.emptyDescription} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {coordinators.map((agent) => {
            const linked = findCoordinatorSession(agent.id, teamRuns, allSessions);
            const status = agentStatusLabel(copy, agent.status);
            const displayLabel = displayLabelOf(agent);
            return (
              <li
                key={agent.id}
                data-testid="team-coordinator-card"
                className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs"
              >
                <span
                  aria-hidden="true"
                  className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md bg-accent-subtle text-[11px] font-semibold text-accent"
                >
                  {avatarLetter(agent.name)}
                </span>
                <h3 className="m-0 min-w-0 break-words text-[13px] font-semibold text-primary [overflow-wrap:anywhere]">{agent.name}</h3>
                <Badge>{copy.coordinators.cardTitle}</Badge>
                <span className="text-secondary">{agent.role}</span>
                <Badge tone={status.tone}>
                  <span title={status.known ? undefined : status.raw} data-testid="team-coordinator-status">{status.label}</span>
                </Badge>
                {displayLabel ? (
                  <span className="min-w-0 break-words text-primary">
                    <span className="text-secondary">{copy.coordinators.displayLabel}：</span>
                    {displayLabel}
                  </span>
                ) : null}
                <span className="text-[11px] text-secondary">
                  {copy.coordinators.createdLabel}{" "}
                  <time dateTime={agent.createdAt} title={formatFullTime(agent.createdAt)}>{relativeTime(agent.createdAt)}</time>
                </span>
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  {linked ? (
                    <code className="font-mono text-[11px] text-secondary" title={linked.sessionId} data-testid="team-coordinator-session-id">
                      <span className="sr-only">{copy.coordinators.linkedSessionLabel} </span>
                      {linked.sessionId.slice(0, 8)}
                    </code>
                  ) : (
                    <span className="text-[11px] text-secondary">{copy.coordinators.notLinked}</span>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!linked}
                    onClick={() => linked && onOpen(linked.sessionId)}
                    data-testid="team-coordinator-open"
                  >
                    {copy.coordinators.openTeamSession}
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
