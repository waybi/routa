"use client";

import React from "react";

import { Badge } from "@/client/components/ui/badge";
import { filterSpecialistsByCategory } from "@/client/utils/specialist-categories";

import { avatarLetter, roleGroupOf, TEAM_LEAD_SPECIALIST_ID } from "./team-page-model";
import { fillTemplate, type TeamRedesignCopy } from "./team-status-labels";

export interface SpecialistSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
  defaultModelTier?: string;
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

export const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Team specialists only, in display order. Shared by the formation and the page stats. */
export function selectTeamSpecialists(items: SpecialistSummary[]): SpecialistSummary[] {
  return filterSpecialistsByCategory(items, "team").sort(compareTeamSpecialists);
}

/** Lead shows the lead label; others show their role, or the default label when blank. */
export function teamRoleLabel(specialist: SpecialistSummary, copy: TeamRedesignCopy): string {
  if (specialist.id === TEAM_LEAD_SPECIALIST_ID) return copy.roster.leadRole;
  return specialist.role?.trim() ? specialist.role : copy.roster.defaultRole;
}

/**
 * Main name from the locale dictionary for bundled specialists (the API
 * returns English names), else the API name. The small line keeps the API
 * name visible, so a user-overridden name is never hidden; when both match it shows the id.
 */
export function memberDisplayNames(specialist: SpecialistSummary, copy: TeamRedesignCopy): { primary: string; secondary: string } {
  const primary = copy.formation.memberNames[specialist.id] ?? specialist.name;
  return { primary, secondary: specialist.name !== primary ? specialist.name : specialist.id };
}

/** Group column title, e.g. "调研" for ROUTA. */
export function roleGroupLabel(role: string | undefined, copy: TeamRedesignCopy): string {
  switch (roleGroupOf(role)) {
    case "ROUTA": return copy.formation.groupRouta;
    case "CRAFTER": return copy.formation.groupCrafter;
    case "GATE": return copy.formation.groupGate;
    case "DEVELOPER": return copy.formation.groupDeveloper;
    default: return copy.formation.groupOther;
  }
}

const AVATAR_TONE: Record<string, string> = {
  LEAD: "bg-accent text-on-accent",
  ROUTA: "bg-accent-subtle text-information",
  CRAFTER: "bg-accent-subtle text-accent",
  GATE: "bg-attention-subtle text-attention",
  DEVELOPER: "bg-success-subtle text-success",
  OTHER: "bg-subtle text-secondary",
};

export function avatarToneClass(specialist: Pick<SpecialistSummary, "id" | "role">): string {
  if (specialist.id === TEAM_LEAD_SPECIALIST_ID) return AVATAR_TONE.LEAD;
  return AVATAR_TONE[roleGroupOf(specialist.role)];
}

const AVATAR_SIZE = {
  sm: "h-[22px] w-[22px] rounded-full text-[9.5px]",
  md: "h-9 w-9 rounded-[10px] text-sm",
  lg: "h-11 w-11 rounded-xl text-[17px]",
} as const;

export function MemberAvatar({ specialist, name, size = "md", className = "" }: {
  specialist: Pick<SpecialistSummary, "id" | "role">;
  name: string;
  size?: keyof typeof AVATAR_SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center font-semibold ${AVATAR_SIZE[size]} ${avatarToneClass(specialist)} ${className}`.trim()}
    >
      {avatarLetter(name)}
    </span>
  );
}

/** "空闲" or "工作中 · N 个运行"; N counts connecting/ready sessions of this specialist. */
export function MemberStatus({ count, copy }: { count: number; copy: TeamRedesignCopy }) {
  const working = count > 0;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] ${working ? "text-success" : "text-secondary"}`} data-testid="team-member-status">
      <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${working ? "bg-success motion-safe:animate-pulse" : "bg-secondary"}`} />
      {working ? fillTemplate(copy.formation.working, { count }) : copy.formation.idle}
    </span>
  );
}

export function RoleBadge({ specialist, copy }: { specialist: SpecialistSummary; copy: TeamRedesignCopy }) {
  const isLead = specialist.id === TEAM_LEAD_SPECIALIST_ID;
  return (
    <span data-testid="team-roster-role" className="shrink-0">
      <Badge tone={isLead ? "info" : "neutral"}>{teamRoleLabel(specialist, copy)}</Badge>
    </span>
  );
}

/** List view: one row per specialist (avatar, name, role badge, description, # mention). */
export function TeamRosterList({
  copy,
  specialists,
  activeCounts,
  onOpenMember,
  onMention,
}: {
  copy: TeamRedesignCopy;
  /** Team specialists without the lead (the lead card stays above the list). */
  specialists: SpecialistSummary[];
  activeCounts: Map<string, number>;
  onOpenMember: (specialist: SpecialistSummary, trigger: HTMLElement) => void;
  onMention: (specialist: SpecialistSummary) => void;
}) {
  if (specialists.length === 0) return null;
  return (
    <ul className="m-0 list-none rounded-[10px] border border-default bg-surface p-0" data-testid="team-roster-list">
      {specialists.map((specialist) => {
        const names = memberDisplayNames(specialist, copy);
        return (
          <li
            key={specialist.id}
            data-testid="team-roster-item"
            data-specialist-id={specialist.id}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-default px-3.5 py-2.5 first:border-t-0"
          >
            <button
              type="button"
              onClick={(event) => onOpenMember(specialist, event.currentTarget)}
              aria-label={fillTemplate(copy.formation.openMemberAria, { name: names.primary })}
              data-testid="team-member-open"
              className={`flex min-w-0 flex-[1_1_220px] items-center gap-3 rounded-control text-left ${FOCUS_RING}`}
            >
              <MemberAvatar specialist={specialist} name={names.primary} />
              <span className="flex min-w-0 flex-col">
                <span className="break-words text-[13px] font-semibold text-primary" data-testid="team-roster-name">{names.primary}</span>
                <span className="truncate font-mono text-[10.5px] text-secondary">{names.secondary}</span>
              </span>
            </button>
            <RoleBadge specialist={specialist} copy={copy} />
            <span className="min-w-0 flex-[2_1_240px] break-words text-xs text-secondary">{specialist.description ?? copy.roster.noDescription}</span>
            <MemberStatus count={activeCounts.get(specialist.id) ?? 0} copy={copy} />
            <button
              type="button"
              onClick={() => onMention(specialist)}
              aria-label={fillTemplate(copy.formation.mentionAria, { name: names.primary })}
              data-testid="team-member-mention"
              className={`min-h-6 rounded-control border border-default px-2 text-[11px] text-secondary hover:bg-hover hover:text-primary ${FOCUS_RING}`}
            >
              {copy.formation.mention}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
