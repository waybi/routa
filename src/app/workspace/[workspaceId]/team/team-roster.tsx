"use client";

import React, { useId, useMemo } from "react";
import Link from "next/link";

import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { filterSpecialistsByCategory } from "@/client/utils/specialist-categories";

import type { ListLoadState } from "../sessions/sessions-redesign-parts";
import { TEAM_LEAD_SPECIALIST_ID } from "./team-page-model";
import { fillTemplate, type TeamRedesignCopy } from "./team-status-labels";

export interface SpecialistSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
}

export const TEAM_MEMBER_DISPLAY_ORDER = [
  TEAM_LEAD_SPECIALIST_ID,
  "team-researcher",
  "team-frontend-dev",
  "team-backend-dev",
  "team-qa",
  "team-code-reviewer",
  "team-ux-designer",
  "team-operations",
  "team-general-engineer",
] as const;

export function compareTeamSpecialists(a: SpecialistSummary, b: SpecialistSummary): number {
  const aIndex = TEAM_MEMBER_DISPLAY_ORDER.indexOf(a.id as typeof TEAM_MEMBER_DISPLAY_ORDER[number]);
  const bIndex = TEAM_MEMBER_DISPLAY_ORDER.indexOf(b.id as typeof TEAM_MEMBER_DISPLAY_ORDER[number]);
  const normalizedA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
  const normalizedB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
  if (normalizedA !== normalizedB) return normalizedA - normalizedB;
  return a.name.localeCompare(b.name);
}

export function pickSpecialists(data: unknown): SpecialistSummary[] {
  const specialists = (data as { specialists?: unknown } | null)?.specialists;
  return Array.isArray(specialists) ? (specialists as SpecialistSummary[]) : [];
}

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Team specialists only, in display order. Shared by the roster and the page stats. */
export function selectTeamSpecialists(items: SpecialistSummary[]): SpecialistSummary[] {
  return filterSpecialistsByCategory(items, "team").sort(compareTeamSpecialists);
}

/** Lead shows the lead label; others show their role, or the default label when blank. */
export function teamRoleLabel(specialist: SpecialistSummary, copy: TeamRedesignCopy): string {
  if (specialist.id === TEAM_LEAD_SPECIALIST_ID) return copy.roster.leadRole;
  return specialist.role?.trim() ? specialist.role : copy.roster.defaultRole;
}

/** Always-visible list of team specialists (AC7). A failed read keeps the last list. */
export function TeamRoster({ copy, specialists }: { copy: TeamRedesignCopy; specialists: ListLoadState<SpecialistSummary> }) {
  const headingId = useId();
  const teamSpecialists = useMemo(() => selectTeamSpecialists(specialists.items), [specialists.items]);

  return (
    <section className="rounded-lg border border-default bg-surface" data-testid="team-roster" aria-labelledby={headingId}>
      <h2 id={headingId} className="m-0 px-4 py-3 text-[13px] font-semibold text-primary" data-testid="team-roster-summary">
        {fillTemplate(copy.roster.summary, { count: teamSpecialists.length })}
      </h2>
      <div className="border-t border-default px-4 py-3">
        {specialists.status === "error" ? (
          <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-xs text-danger" data-testid="team-roster-error">
            <span>{copy.roster.loadError}</span>
            <Button variant="secondary" size="xs" onClick={specialists.reload}>{copy.common.reload}</Button>
          </div>
        ) : null}
        {teamSpecialists.length === 0 ? (
          <p className="m-0 text-xs text-secondary">{copy.roster.empty}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {teamSpecialists.map((specialist) => {
              const isLead = specialist.id === TEAM_LEAD_SPECIALIST_ID;
              return (
                <li key={specialist.id} data-testid="team-roster-item" className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="break-words text-xs font-semibold text-primary">{specialist.name}</span>
                  <span data-testid="team-roster-role" className="shrink-0">
                    <Badge tone={isLead ? "info" : "neutral"}>{teamRoleLabel(specialist, copy)}</Badge>
                  </span>
                  <span className="min-w-0 break-words text-xs text-secondary">{specialist.description ?? copy.roster.noDescription}</span>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/settings/specialists"
          className={`mt-3 inline-block text-xs text-accent hover:underline ${FOCUS_RING}`}
          data-testid="team-roster-manage-link"
        >
          {copy.roster.manageLink}
        </Link>
      </div>
    </section>
  );
}
