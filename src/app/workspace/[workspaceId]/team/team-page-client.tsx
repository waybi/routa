"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";

import { useTranslation } from "@/i18n";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { HomeInput } from "@/client/components/home-input";
import { Badge, type Tone } from "@/client/components/ui/badge";
import { Button, buttonClassName } from "@/client/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/client/components/ui/states";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { filterSpecialistsByCategory } from "@/client/utils/specialist-categories";

import { matchesSessionQuery } from "../sessions-overview";
import { PageHeader, SearchField, pickSessions, useListLoader } from "../sessions/sessions-redesign-parts";
import { formatRelativeTime } from "../ui-components";
import type { SessionInfo } from "../types";

const TEAM_LEAD_SPECIALIST_ID = "team-agent-lead";

interface SpecialistSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
}

interface TeamRunSessionInfo extends SessionInfo {
  descendants: number;
  directDelegates: number;
}

const TEAM_MEMBER_DISPLAY_ORDER = [
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

function compareTeamSpecialists(a: SpecialistSummary, b: SpecialistSummary): number {
  const aIndex = TEAM_MEMBER_DISPLAY_ORDER.indexOf(a.id as typeof TEAM_MEMBER_DISPLAY_ORDER[number]);
  const bIndex = TEAM_MEMBER_DISPLAY_ORDER.indexOf(b.id as typeof TEAM_MEMBER_DISPLAY_ORDER[number]);
  const normalizedA = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
  const normalizedB = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
  if (normalizedA !== normalizedB) return normalizedA - normalizedB;
  return a.name.localeCompare(b.name);
}

function buildTeamRunName(requirement: string): string {
  const normalized = requirement.replace(/\s+/g, " ").trim();
  if (!normalized) return "Team run";
  return normalized.length > 56 ? `Team - ${normalized.slice(0, 53)}...` : `Team - ${normalized}`;
}

export function TeamPageClient() {
  const { t } = useTranslation();
  const copy = t.sessionsRedesign;
  const params = useParams();
  const router = useRouter();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;

  const workspacesHook = useWorkspaces();
  const runs = useListLoader<TeamRunSessionInfo>(
    `/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&surface=team`,
    pickSessions,
  );
  const setTeamRuns = runs.setItems;
  const teamRuns = runs.items;
  const [specialists, setSpecialists] = useState<SpecialistSummary[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await desktopAwareFetch("/api/specialists", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (controller.signal.aborted) return;
        setSpecialists(Array.isArray(data?.specialists) ? data.specialists : []);
      } catch {
        // Keep the last known specialists; the grid simply stays as it was.
      }
    })();
    return () => controller.abort();
  }, []);

  const teamSpecialists = useMemo(
    () => filterSpecialistsByCategory(specialists, "team").sort(compareTeamSpecialists),
    [specialists],
  );
  const lead = teamSpecialists.find((specialist) => specialist.id === TEAM_LEAD_SPECIALIST_ID);
  const members = teamSpecialists.filter((specialist) => specialist.id !== TEAM_LEAD_SPECIALIST_ID);

  const filteredRuns = useMemo(
    () => teamRuns.filter((run) => matchesSessionQuery(run, query, t.team.unnamedRun)),
    [query, t.team.unnamedRun, teamRuns],
  );

  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId);
  const workspaceTitle = workspace?.title ?? (workspaceId === "default" ? "Default Workspace" : workspaceId);

  const handleWorkspaceSelect = useCallback((nextWorkspaceId: string) => {
    router.push(`/workspace/${nextWorkspaceId}/team`);
  }, [router]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspaceResult = await workspacesHook.createWorkspace(title);
    if (workspaceResult) {
      router.push(`/workspace/${workspaceResult.id}/team`);
    }
  }, [router, workspacesHook]);

  const handleTeamSessionCreated = useCallback((
    sessionId: string,
    promptText: string,
    sessionContext?: { cwd?: string; branch?: string; repoName?: string },
  ) => {
    const optimisticName = buildTeamRunName(promptText);
    setTeamRuns((current) => {
      if (current.some((run) => run.sessionId === sessionId)) {
        return current.map((run) => (
          run.sessionId === sessionId
            ? {
              ...run,
              name: optimisticName,
              cwd: run.cwd || sessionContext?.cwd || "",
              branch: run.branch ?? sessionContext?.branch,
              role: run.role ?? "ROUTA",
              specialistId: run.specialistId ?? TEAM_LEAD_SPECIALIST_ID,
            }
            : run
        ));
      }

      return [{
        sessionId,
        name: optimisticName,
        cwd: sessionContext?.cwd ?? "",
        branch: sessionContext?.branch,
        workspaceId,
        role: "ROUTA",
        specialistId: TEAM_LEAD_SPECIALIST_ID,
        createdAt: new Date().toISOString(),
        directDelegates: 0,
        descendants: 0,
      }, ...current];
    });

    void desktopAwareFetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: optimisticName }),
    }).catch(() => {});
    runs.reload();
  }, [runs, setTeamRuns, workspaceId]);

  const firstLoad = runs.status === "loading" && !runs.loadedOnce;

  return (
    <DesktopAppShell
      workspaceId={workspaceId}
      workspaceTitle={workspaceTitle}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspacesHook.workspaces}
          activeWorkspaceId={workspaceId}
          activeWorkspaceTitle={workspaceTitle}
          onSelect={handleWorkspaceSelect}
          onCreate={handleWorkspaceCreate}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
      <div className="h-full min-h-0 overflow-y-auto bg-canvas">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 py-6 md:px-[22px] xl:px-7">
          <PageHeader
            title={copy.teamTitle}
            description={copy.teamDescription}
            action={(
              <Link href="/settings/specialists" className={buttonClassName("primary", "md")} data-testid="team-configure-specialists">
                <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                {copy.configureSpecialists}
              </Link>
            )}
          />

          <section aria-label={t.team.teamBench} className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SpecialistCard
              label={copy.coordinatorLabel}
              name={lead?.name ?? t.home.modeTeamTitle}
              detail={lead?.description ?? t.team.launchTeamLead}
              tone="info"
            />
            {members.map((specialist) => (
              <SpecialistCard
                key={specialist.id}
                label={copy.teamMembersLabel}
                name={specialist.name}
                detail={specialist.description ?? specialist.role ?? specialist.id}
              />
            ))}
          </section>

          <section className="rounded-lg border border-default bg-surface p-4" aria-label={t.home.modeTeamTitle}>
            <div className="mb-3">
              <h2 className="m-0 text-[15px] font-semibold text-primary">{t.home.modeTeamTitle}</h2>
              <p className="m-0 mt-1 text-xs text-secondary">{t.team.reusesInput}</p>
            </div>
            <HomeInput
              workspaceId={workspaceId}
              variant="default"
              footerMetaMode="repo-only"
              initialLaunchModeId="team"
              launchModes={[{
                id: "team",
                label: t.home.modeTeamTitle,
                description: t.home.modeTeamDescription,
                placeholder: t.home.modeTeamPlaceholder,
                defaultAgentRole: "ROUTA",
                allowRoleSwitch: false,
                allowCustomSpecialist: false,
                lockedSpecialistId: TEAM_LEAD_SPECIALIST_ID,
                requireRepoSelection: true,
                dispatchMode: "pending-prompt",
                buildSessionUrl: (nextWorkspaceId, sessionId) =>
                  `/workspace/${nextWorkspaceId ?? workspaceId}/team/${sessionId}`,
              }]}
              onSessionCreated={handleTeamSessionCreated}
            />
          </section>

          <section className="flex flex-col gap-3" aria-label={copy.teamRunsTitle}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="m-0 text-[15px] font-semibold text-primary">{copy.teamRunsTitle}</h2>
              <Button variant="ghost" size="sm" onClick={runs.reload}>{t.common.refresh}</Button>
            </div>
            <SearchField
              value={query}
              onChange={setQuery}
              label={copy.searchTeamRuns}
              placeholder={copy.searchSessionsPlaceholder}
              testId="team-runs-search"
            />

            {runs.status === "error" ? (
              <ErrorState
                title={copy.loadErrorTitle}
                message={runs.loadedOnce ? `${copy.loadErrorMessage} ${copy.staleListNote}` : copy.loadErrorMessage}
                onRetry={runs.reload}
                retryLabel={copy.reload}
              />
            ) : null}

            {firstLoad ? (
              <div className="rounded-lg border border-default bg-surface p-4">
                <Skeleton lines={3} label={copy.loadingSessions} />
              </div>
            ) : runs.status === "error" && !runs.loadedOnce ? null : teamRuns.length === 0 ? (
              <EmptyState title={copy.teamRunsEmptyTitle} description={copy.teamRunsEmptyDescription} />
            ) : filteredRuns.length === 0 ? (
              <EmptyState title={copy.filterEmptyTitle} description={copy.filterEmptyDescription} />
            ) : (
              <ul className="m-0 list-none overflow-hidden rounded-lg border border-default bg-surface p-0">
                {filteredRuns.map((run) => (
                  <li key={run.sessionId} data-testid="team-run-row" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-default px-4 py-3 hover:bg-hover">
                    <div className="min-w-0 flex-1 basis-60">
                      <h3 className="m-0 break-words text-[13px] font-semibold text-primary">{run.name ?? t.team.unnamedRun}</h3>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-secondary">
                        <code className="font-mono" title={run.sessionId}>{run.sessionId.slice(0, 8)}</code>
                        {run.branch ? <Badge>{run.branch}</Badge> : null}
                        <StatusPill status={run.acpStatus} />
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-secondary">{formatRelativeTime(run.createdAt)}</span>
                    <Button variant="secondary" size="sm" onClick={() => router.push(`/workspace/${workspaceId}/team/${run.sessionId}`)}>
                      {copy.openSessionAction}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </DesktopAppShell>
  );
}

function SpecialistCard({ label, name, detail, tone = "neutral" }: { label: string; name: string; detail: string; tone?: Tone }) {
  return (
    <article className="flex min-w-0 items-start gap-3 rounded-lg border border-default bg-surface p-4">
      <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-accent-subtle text-[13px] font-semibold text-accent">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0">
        <Badge tone={tone}>{label}</Badge>
        <h3 className="m-0 mt-1 break-words text-[13px] font-semibold text-primary">{name}</h3>
        <p className="m-0 mt-0.5 line-clamp-2 text-xs text-secondary">{detail}</p>
      </div>
    </article>
  );
}

function StatusPill({ status }: { status?: SessionInfo["acpStatus"] }) {
  if (status === "error") return <Badge tone="danger">error</Badge>;
  if (status === "connecting") return <Badge tone="attention">connecting</Badge>;
  return <Badge tone="success">ready</Badge>;
}
