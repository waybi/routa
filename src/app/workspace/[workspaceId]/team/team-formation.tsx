"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";

import type { ListLoadState } from "../sessions/sessions-redesign-parts";
import { TeamCoordinatorCards } from "./team-coordinator-cards";
import {
  groupSpecialistsByRole,
  type CoordinatorAgent,
  type RoleGroupKey,
  type TeamRunSessionInfo,
} from "./team-page-model";
import {
  FOCUS_RING,
  MemberAvatar,
  MemberStatus,
  memberDisplayNames,
  RoleBadge,
  roleGroupLabel,
  selectTeamSpecialists,
  TeamRosterList,
  type SpecialistSummary,
} from "./team-roster";
import { fillTemplate, type TeamRedesignCopy } from "./team-status-labels";

export type FormationView = "map" | "list";

export interface TeamFormationProps {
  copy: TeamRedesignCopy;
  specialists: ListLoadState<SpecialistSummary>;
  agents: ListLoadState<CoordinatorAgent>;
  teamRuns: TeamRunSessionInfo[];
  allSessions: TeamRunSessionInfo[];
  activeCounts: Map<string, number>;
  onOpenSession: (sessionId: string) => void;
  onOpenMember: (specialist: SpecialistSummary, trigger: HTMLElement) => void;
  onMention: (specialist: SpecialistSummary) => void;
}

const GROUP_ROLE_TONE: Record<RoleGroupKey, "info" | "neutral" | "attention" | "success"> = {
  ROUTA: "info",
  CRAFTER: "info",
  GATE: "attention",
  DEVELOPER: "success",
  OTHER: "neutral",
};

const SEGMENT_BUTTON = `min-h-[26px] rounded-[5px] px-2.5 py-0.5 text-xs ${FOCUS_RING}`;

/** Lead card: lead profile on top, "on duty" coordinator rows below (all former coordinator-card fields). */
function LeadCard({ copy, lead, onOpenMember, children }: {
  copy: TeamRedesignCopy;
  lead: SpecialistSummary | undefined;
  onOpenMember: TeamFormationProps["onOpenMember"];
  children: React.ReactNode;
}) {
  const names = lead ? memberDisplayNames(lead, copy) : null;
  return (
    <div
      className="relative mx-auto w-full max-w-[640px] rounded-[10px] border border-accent/40 bg-surface px-4 py-3.5 shadow-sm"
      data-testid="team-lead-card"
    >
      {lead && names ? (
        <div data-testid="team-roster-item" data-specialist-id={lead.id} className="flex min-w-0 items-center gap-3.5">
          <MemberAvatar specialist={lead} name={names.primary} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[13.5px] font-semibold text-primary" data-testid="team-roster-name">{names.primary}</span>
              <span className="font-mono text-[10.5px] text-secondary">{names.secondary}</span>
              <RoleBadge specialist={lead} copy={copy} />
            </p>
            <p className="m-0 mt-1 break-words text-xs leading-relaxed text-secondary">{lead.description ?? copy.roster.noDescription}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => onOpenMember(lead, event.currentTarget)}
            aria-label={fillTemplate(copy.formation.openMemberAria, { name: names.primary })}
            data-testid="team-member-open"
          >
            {copy.formation.details}
          </Button>
        </div>
      ) : null}
      <div className={`${lead ? "mt-2.5 border-t border-dashed border-default pt-2.5" : ""} flex min-w-0 flex-col gap-1.5`}>
        <span className="text-[11px] text-secondary">{copy.formation.instancesLabel}</span>
        {children}
      </div>
    </div>
  );
}

function MemberCard({ copy, specialist, count, onOpenMember, onMention, onHover }: {
  copy: TeamRedesignCopy;
  specialist: SpecialistSummary;
  count: number;
  onOpenMember: TeamFormationProps["onOpenMember"];
  onMention: TeamFormationProps["onMention"];
  onHover: (hovering: boolean) => void;
}) {
  const names = memberDisplayNames(specialist, copy);
  const working = count > 0;
  return (
    <li
      data-testid="team-roster-item"
      data-specialist-id={specialist.id}
      className="group relative min-w-0"
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      <button
        type="button"
        onClick={(event) => onOpenMember(specialist, event.currentTarget)}
        aria-label={fillTemplate(copy.formation.openMemberAria, { name: names.primary })}
        data-testid="team-member-open"
        className={`flex w-full min-w-0 flex-col gap-1.5 rounded-[10px] border bg-surface px-3 pb-2.5 pt-[11px] text-left transition-[translate,box-shadow,border-color] duration-150 hover:border-accent/50 hover:shadow-md motion-safe:hover:-translate-y-0.5 motion-safe:group-focus-within:-translate-y-0.5 motion-reduce:transition-none ${working ? "border-success/40" : "border-default"} ${FOCUS_RING}`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <MemberAvatar specialist={specialist} name={names.primary} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="break-words text-[13px] font-semibold text-primary" data-testid="team-roster-name">{names.primary}</span>
            <span className="truncate font-mono text-[10.5px] text-secondary">{names.secondary}</span>
          </span>
          <RoleBadge specialist={specialist} copy={copy} />
        </span>
        <span className="line-clamp-1 text-[11.5px] leading-relaxed text-secondary" title={specialist.description}>
          {specialist.description ?? copy.roster.noDescription}
        </span>
        <span className="flex min-h-[22px] items-center pr-16">
          <MemberStatus count={count} copy={copy} />
        </span>
      </button>
      <button
        type="button"
        onClick={() => onMention(specialist)}
        aria-label={fillTemplate(copy.formation.mentionAria, { name: names.primary })}
        data-testid="team-member-mention"
        className={`absolute bottom-2.5 right-3 min-h-[22px] rounded-[5px] border border-default bg-surface px-[7px] text-[11px] text-secondary opacity-0 transition-opacity duration-150 hover:text-primary focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none ${FOCUS_RING}`}
      >
        {copy.formation.mention}
      </button>
    </li>
  );
}

interface WireLayout { width: number; xs: Array<{ key: RoleGroupKey; x: number }> }

/**
 * Curves from the lead card to each group header. A callback ref attaches a
 * ResizeObserver when the grid mounts; state is only set in its callback.
 */
function useWireLayout() {
  const [layout, setLayout] = useState<WireLayout | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const gridRef = useCallback((grid: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const box = grid.getBoundingClientRect();
      const points = Array.from(grid.querySelectorAll<HTMLElement>("[data-group-key]")).map((element) => {
        const rect = element.getBoundingClientRect();
        return { key: element.dataset.groupKey as RoleGroupKey, x: rect.left - box.left + rect.width / 2, top: rect.top - box.top };
      });
      if (points.length === 0 || box.width === 0) {
        setLayout(null);
        return;
      }
      const firstRowTop = Math.min(...points.map((item) => item.top));
      setLayout({ width: box.width, xs: points.filter((item) => item.top - firstRowTop < 4).map(({ key, x }) => ({ key, x })) });
    });
    observer.observe(grid);
    observerRef.current = observer;
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return { gridRef, layout };
}

export function TeamFormation({
  copy,
  specialists,
  agents,
  teamRuns,
  allSessions,
  activeCounts,
  onOpenSession,
  onOpenMember,
  onMention,
}: TeamFormationProps) {
  const titleId = useId();
  const summaryId = useId();
  const [view, setView] = useState<FormationView>("map");
  const [hoveredGroup, setHoveredGroup] = useState<RoleGroupKey | null>(null);
  const teamSpecialists = useMemo(() => selectTeamSpecialists(specialists.items), [specialists.items]);
  const { lead, groups } = useMemo(() => groupSpecialistsByRole(teamSpecialists), [teamSpecialists]);
  const members = useMemo(() => groups.flatMap((group) => group.members), [groups]);
  const { gridRef, layout } = useWireLayout();
  const hover = useCallback((key: RoleGroupKey) => (hovering: boolean) => setHoveredGroup(hovering ? key : null), []);

  const coordinators = (
    <TeamCoordinatorCards copy={copy} agents={agents} teamRuns={teamRuns} allSessions={allSessions} onOpen={onOpenSession} />
  );

  return (
    <section className="flex min-w-0 flex-col gap-3" data-testid="team-formation" aria-labelledby={titleId}>
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <h2 id={titleId} className="m-0 text-[15px] font-semibold text-primary">{copy.formation.title}</h2>
        <span id={summaryId} data-testid="team-roster-summary" className="rounded-full bg-subtle px-2 text-[11px] text-secondary">
          {fillTemplate(copy.roster.summary, { count: teamSpecialists.length })}
        </span>
        <span className="flex-1" />
        <div role="group" aria-label={copy.formation.viewLabel} className="inline-flex rounded-[7px] border border-default bg-surface p-0.5" data-testid="team-formation-view">
          {(["map", "list"] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              data-testid={`team-formation-view-${key}`}
              className={`${SEGMENT_BUTTON} ${view === key ? "bg-subtle text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
            >
              {key === "map" ? copy.formation.viewMap : copy.formation.viewList}
            </button>
          ))}
        </div>
        <Link href="/settings/specialists" className={`text-xs text-accent hover:underline ${FOCUS_RING}`} data-testid="team-roster-manage-link">
          {copy.roster.manageLink} →
        </Link>
      </div>

      <div
        role="region"
        aria-labelledby={summaryId}
        data-testid="team-roster"
        data-view={view}
        className={view === "map"
          ? "relative min-w-0 rounded-xl border border-default bg-surface bg-[radial-gradient(var(--line)_1px,transparent_1px)] bg-[length:18px_18px] p-4 min-[600px]:p-5"
          : "flex min-w-0 flex-col gap-3"}
      >
        {specialists.status === "error" ? (
          <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-xs text-danger" data-testid="team-roster-error">
            <span>{copy.roster.loadError}</span>
            <Button variant="secondary" size="xs" onClick={specialists.reload}>{copy.common.reload}</Button>
          </div>
        ) : null}

        <LeadCard copy={copy} lead={lead} onOpenMember={onOpenMember}>{coordinators}</LeadCard>

        {teamSpecialists.length === 0 ? (
          <p className="m-0 mt-3 text-center text-xs text-secondary">{copy.roster.empty}</p>
        ) : null}

        {view === "map" && members.length > 0 ? (
          <>
            <div className="relative hidden h-[34px] min-[1180px]:block" aria-hidden="true" data-testid="team-formation-wire">
              {layout ? (
                <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${layout.width} 34`} preserveAspectRatio="none" fill="none">
                  {layout.xs.map(({ key, x }) => (
                    <path
                      key={key}
                      data-group={key}
                      d={`M${layout.width / 2} 0 C${layout.width / 2} 20, ${x} 14, ${x} 34`}
                      className={hoveredGroup === key ? "stroke-accent" : "stroke-default"}
                      strokeWidth={hoveredGroup === key ? 1.8 : 1.2}
                    />
                  ))}
                </svg>
              ) : null}
            </div>
            <div
              ref={gridRef}
              className={`mt-4 grid grid-cols-1 items-start gap-3.5 min-[600px]:grid-cols-2 min-[1180px]:mt-0 ${groups.length > 4 ? "min-[1180px]:grid-cols-5" : "min-[1180px]:grid-cols-4"}`}
            >
              {groups.map((group) => (
                <div key={group.key} data-group-key={group.key} data-testid={`team-formation-group-${group.key}`} className="min-w-0">
                  <p className="m-0 mx-0.5 mb-2 flex items-center gap-1.5 text-[11px] text-secondary">
                    {group.key !== "OTHER" ? <Badge tone={GROUP_ROLE_TONE[group.key]}>{group.key}</Badge> : null}
                    <b className="font-semibold text-primary">{roleGroupLabel(group.key, copy)}</b>
                    <span>· {fillTemplate(copy.formation.groupCount, { count: group.members.length })}</span>
                  </p>
                  <ul className="m-0 grid list-none gap-2.5 p-0">
                    {group.members.map((specialist) => (
                      <MemberCard
                        key={specialist.id}
                        copy={copy}
                        specialist={specialist}
                        count={activeCounts.get(specialist.id) ?? 0}
                        onOpenMember={onOpenMember}
                        onMention={onMention}
                        onHover={hover(group.key)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {view === "list" ? (
          <TeamRosterList copy={copy} specialists={members} activeCounts={activeCounts} onOpenMember={onOpenMember} onMention={onMention} />
        ) : null}
      </div>
    </section>
  );
}
