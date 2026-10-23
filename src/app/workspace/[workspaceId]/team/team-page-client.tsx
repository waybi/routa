"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Plus, Settings2 } from "lucide-react";

import { useTranslation } from "@/i18n";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import type { InsertTextRequest } from "@/client/components/tiptap-input";
import { Button, buttonClassName } from "@/client/components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@/client/components/ui/states";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

import { matchesSessionQuery } from "../sessions-overview";
import {
  SearchField,
  focusFirstEditable,
  pickSessions,
  useListLoader,
} from "../sessions/sessions-redesign-parts";
import { TeamFormation } from "./team-formation";
import { TeamLaunchPanel } from "./team-launch-panel";
import { TeamMemberDrawer } from "./team-member-drawer";
import {
  countActiveSessionsBySpecialist,
  isLiveAcpStatus,
  pickAgents,
  recentRunsForSpecialist,
  sortTeamRuns,
  TEAM_LEAD_SPECIALIST_ID,
  type CoordinatorAgent,
  type SortDirection,
  type TeamRunSessionInfo,
} from "./team-page-model";
import { memberDisplayNames, pickSpecialists, selectTeamSpecialists, type SpecialistSummary } from "./team-roster";
import { buildTeamRunName } from "./team-run-name";
import { TeamRunRecordsTable } from "./team-run-records-table";
import { TeamPageHeaderBar, TeamStats } from "./team-stats";
import { useTeamShortcuts } from "./use-team-shortcuts";

const LAUNCH_PANEL_ID = "team-launch-panel";

export function TeamPageClient() {
  const { t } = useTranslation();
  const copy = t.sessionsRedesign;
  const teamCopy = t.teamRedesign;
  const params = useParams();
  const router = useRouter();
  const rawWorkspaceId = params.workspaceId as string;
  const workspaceId =
    rawWorkspaceId === "__placeholder__" && typeof window !== "undefined"
      ? (window.location.pathname.match(/^\/workspace\/([^/]+)/)?.[1] ?? rawWorkspaceId)
      : rawWorkspaceId;
  const encodedWorkspaceId = encodeURIComponent(workspaceId);

  const workspacesHook = useWorkspaces();
  const runs = useListLoader<TeamRunSessionInfo>(
    `/api/sessions?workspaceId=${encodedWorkspaceId}&surface=team`,
    pickSessions,
  );
  const allSessions = useListLoader<TeamRunSessionInfo>(`/api/sessions?workspaceId=${encodedWorkspaceId}`, pickSessions);
  const agents = useListLoader<CoordinatorAgent>(`/api/agents?workspaceId=${encodedWorkspaceId}`, pickAgents);
  const specialists = useListLoader<SpecialistSummary>("/api/specialists", pickSpecialists);
  const setTeamRuns = runs.setItems;
  const teamRuns = runs.items;
  const [query, setQuery] = useState("");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [insertTextRequest, setInsertTextRequest] = useState<InsertTextRequest | null>(null);
  const [drawerSpecialistId, setDrawerSpecialistId] = useState<string | null>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const launchPanelRef = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);

  const focusLaunch = useCallback(() => {
    focusFirstEditable(launchPanelRef.current);
  }, []);
  const focusSearch = useCallback(() => {
    pageRef.current?.querySelector<HTMLInputElement>('[data-testid="team-runs-search"]')?.focus();
  }, []);
  const requestInsert = useCallback((text: string, mode: InsertTextRequest["mode"]) => {
    setInsertTextRequest((current) => ({ text, mode, nonce: (current?.nonce ?? 0) + 1 }));
    focusLaunch();
  }, [focusLaunch]);

  useTeamShortcuts({ onLaunch: focusLaunch, onSearch: focusSearch, disabled: drawerSpecialistId !== null });

  const visibleRuns = useMemo(
    () => sortTeamRuns(
      teamRuns.filter((run) => matchesSessionQuery(run, query, t.team.unnamedRun)),
      sortDirection,
    ),
    [query, sortDirection, t.team.unnamedRun, teamRuns],
  );

  // Same counts as the legacy page: all team runs (search ignored), runs whose
  // acpStatus is connecting/ready, and team specialists minus the lead.
  const stats = useMemo(() => ({
    runs: teamRuns.length,
    active: teamRuns.filter((run) => isLiveAcpStatus(run.acpStatus)).length,
    members: Math.max(selectTeamSpecialists(specialists.items).length - 1, 0),
  }), [specialists.items, teamRuns]);

  const activeCounts = useMemo(() => countActiveSessionsBySpecialist(allSessions.items), [allSessions.items]);
  const specialistsById = useMemo(() => new Map(specialists.items.map((item) => [item.id, item])), [specialists.items]);
  const drawerSpecialist = drawerSpecialistId ? specialistsById.get(drawerSpecialistId) : undefined;
  const drawerRuns = useMemo(() => {
    if (!drawerSpecialistId) return [];
    const runsById = new Map(teamRuns.map((run) => [run.sessionId, run]));
    return recentRunsForSpecialist(allSessions.items, drawerSpecialistId)
      .map(({ targetId, session }) => ({ targetId, session: runsById.get(targetId) ?? session }));
  }, [allSessions.items, drawerSpecialistId, teamRuns]);

  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId);
  const workspaceTitle = workspace?.title ?? (workspaceId === "default" ? teamCopy.page.workspaceFallback : workspaceId);

  const openTeamSession = useCallback((sessionId: string) => {
    router.push(`/workspace/${workspaceId}/team/${sessionId}`);
  }, [router, workspaceId]);

  const openMember = useCallback((specialist: SpecialistSummary, trigger: HTMLElement) => {
    drawerTriggerRef.current = trigger;
    setDrawerSpecialistId(specialist.id);
  }, []);
  const closeDrawer = useCallback(() => {
    setDrawerSpecialistId(null);
    drawerTriggerRef.current?.focus();
  }, []);
  const mentionMember = useCallback((specialist: SpecialistSummary) => {
    setDrawerSpecialistId(null);
    requestInsert(`#${memberDisplayNames(specialist, teamCopy).primary} `, "append");
  }, [requestInsert, teamCopy]);

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

  const reloadAll = useCallback(() => {
    runs.reload();
    allSessions.reload();
    agents.reload();
    specialists.reload();
  }, [agents, allSessions, runs, specialists]);

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
      <div className="h-full min-h-0 overflow-y-auto bg-canvas" ref={pageRef}>
        <div className="mx-auto flex w-full min-w-0 max-w-[1240px] flex-col gap-[22px] px-4 py-6 md:px-[22px] xl:px-7" data-testid="team-page">
          <div data-testid="team-page-header">
            <TeamPageHeaderBar
              title={copy.teamTitle}
              description={copy.teamDescription}
              stats={(
                <TeamStats
                  runs={stats.runs}
                  active={stats.active}
                  members={stats.members}
                  ariaLabel={teamCopy.header.statsLabel}
                  labels={{ runs: t.team.runs, active: t.team.active, members: t.team.members }}
                />
              )}
              actions={(
                <>
                  <Link href="/settings/specialists" className={buttonClassName("secondary", "md")} data-testid="team-configure-specialists">
                    <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {copy.configureSpecialists}
                  </Link>
                  <Button
                    variant="primary"
                    size="md"
                    aria-controls={LAUNCH_PANEL_ID}
                    aria-keyshortcuts="N"
                    title={teamCopy.header.launchShortcutHint}
                    onClick={focusLaunch}
                    data-testid="team-launch-toggle"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {teamCopy.page.launchRun}
                    <kbd className="rounded border border-on-accent/40 px-1 font-mono text-[10px] leading-4">{teamCopy.header.launchShortcut}</kbd>
                  </Button>
                </>
              )}
            />
          </div>

          <TeamLaunchPanel
            id={LAUNCH_PANEL_ID}
            ref={launchPanelRef}
            copy={teamCopy}
            modeCopy={{
              label: t.home.modeTeamTitle,
              description: t.home.modeTeamDescription,
              placeholder: t.home.modeTeamPlaceholder,
            }}
            workspaceId={workspaceId}
            insertTextRequest={insertTextRequest}
            onTemplate={(text) => requestInsert(text, "replace")}
            onSessionCreated={handleTeamSessionCreated}
          />

          <TeamFormation
            copy={teamCopy}
            specialists={specialists}
            agents={agents}
            teamRuns={teamRuns}
            allSessions={allSessions.items}
            activeCounts={activeCounts}
            onOpenSession={openTeamSession}
            onOpenMember={openMember}
            onMention={mentionMember}
          />

          <section className="flex min-w-0 flex-col gap-3" aria-label={copy.teamRunsTitle} data-testid="team-runs-section">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="m-0 text-[15px] font-semibold text-primary">{copy.teamRunsTitle}</h2>
              <Button variant="ghost" size="sm" onClick={reloadAll}>{t.common.refresh}</Button>
            </div>

            <div className="flex min-w-0 items-center gap-1.5">
              <SearchField
                value={query}
                onChange={setQuery}
                label={teamCopy.page.runsSearchLabel}
                placeholder={copy.searchSessionsPlaceholder}
                testId="team-runs-search"
              />
              <kbd
                title={teamCopy.runs.searchShortcutHint}
                className="rounded border border-default px-1.5 font-mono text-[10.5px] leading-5 text-secondary"
              >
                {teamCopy.runs.searchShortcut}
              </kbd>
            </div>

            {runs.status === "error" ? (
              <ErrorState
                title={copy.loadErrorTitle}
                message={runs.loadedOnce ? `${copy.loadErrorMessage} ${teamCopy.common.staleNote}` : copy.loadErrorMessage}
                onRetry={runs.reload}
                retryLabel={teamCopy.common.reload}
              />
            ) : null}

            {firstLoad ? (
              <div className="rounded-lg border border-default bg-surface p-4">
                <Skeleton lines={3} label={copy.loadingSessions} />
              </div>
            ) : runs.status === "error" && !runs.loadedOnce ? null : teamRuns.length === 0 ? (
              <EmptyState title={copy.teamRunsEmptyTitle} description={copy.teamRunsEmptyDescription} />
            ) : visibleRuns.length === 0 ? (
              <EmptyState title={copy.filterEmptyTitle} description={copy.filterEmptyDescription} />
            ) : (
              <TeamRunRecordsTable
                copy={teamCopy}
                runs={visibleRuns}
                workspaceId={workspaceId}
                unnamedLabel={t.team.unnamedRun}
                sortDirection={sortDirection}
                onToggleSort={() => setSortDirection((current) => (current === "desc" ? "asc" : "desc"))}
                onOpen={openTeamSession}
              />
            )}
          </section>
        </div>
      </div>

      {drawerSpecialist ? (
        <TeamMemberDrawer
          copy={teamCopy}
          specialist={drawerSpecialist}
          activeCount={activeCounts.get(drawerSpecialist.id) ?? 0}
          recentRuns={drawerRuns}
          unnamedLabel={t.team.unnamedRun}
          onClose={closeDrawer}
          onMention={mentionMember}
          onOpenRun={openTeamSession}
        />
      ) : null}
    </DesktopAppShell>
  );
}
