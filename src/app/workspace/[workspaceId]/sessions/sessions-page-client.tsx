"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { HomeInput } from "@/client/components/home-input";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { Button } from "@/client/components/ui/button";
import { ErrorState, Skeleton } from "@/client/components/ui/states";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { useTranslation } from "@/i18n";

import { SessionsOverview } from "../sessions-overview";
import type { SessionInfo } from "../types";
import { PageHeader, SearchField, focusFirstEditable, pickSessions, useListLoader } from "./sessions-redesign-parts";
import { SessionsRecentButton, SessionsSummaryPills } from "./sessions-page-summary";

const TEAM_LEAD_SPECIALIST_ID = "team-agent-lead";

function isTopLevelTeamRun(session: SessionInfo): boolean {
  if (session.parentSessionId) return false;
  if (session.specialistId === TEAM_LEAD_SPECIALIST_ID) return true;
  if (session.role?.toUpperCase() !== "ROUTA") return false;

  const normalizedName = (session.name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedName) return false;

  return (
    normalizedName.startsWith("team -")
    || normalizedName.startsWith("team run")
    || normalizedName.includes("team lead")
  );
}

export function SessionsPageClient() {
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
  const list = useListLoader<SessionInfo>(
    `/api/sessions?workspaceId=${encodeURIComponent(workspaceId)}&limit=100`,
    pickSessions,
  );
  const [query, setQuery] = useState("");
  const composerRef = useRef<HTMLDivElement>(null);
  const shouldShowSession = useCallback((session: SessionInfo & { parentSessionId?: string }) => !isTopLevelTeamRun(session), []);

  const visibleSessions = useMemo(() => (
    [...list.items]
      .filter(shouldShowSession)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
  ), [list.items, shouldShowSession]);

  const workspace = workspacesHook.workspaces.find((item) => item.id === workspaceId);
  const workspaceTitle = workspace?.title ?? (workspaceId === "default" ? t.workspace.defaultWorkspace : workspaceId);

  const handleWorkspaceSelect = useCallback((nextWorkspaceId: string) => {
    router.push(`/workspace/${nextWorkspaceId}/sessions`);
  }, [router]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspaceResult = await workspacesHook.createWorkspace(title);
    if (workspaceResult) {
      router.push(`/workspace/${workspaceResult.id}/sessions`);
    }
  }, [router, workspacesHook]);

  const firstLoad = list.status === "loading" && !list.loadedOnce;
  const openSession = useCallback((targetSessionId: string) => {
    router.push(`/workspace/${workspaceId}/sessions/${targetSessionId}`);
  }, [router, workspaceId]);

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
            title={copy.sessionsTitle}
            description={copy.sessionsDescription}
            action={(
              <Button
                variant="primary"
                data-testid="sessions-new-session"
                onClick={() => focusFirstEditable(composerRef.current)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {copy.newSession}
              </Button>
            )}
          />

          <SessionsSummaryPills sessions={visibleSessions} />

          <SearchField
            value={query}
            onChange={setQuery}
            label={copy.searchSessions}
            placeholder={copy.searchSessionsPlaceholder}
            testId="sessions-search"
          />

          {list.status === "error" ? (
            <ErrorState
              title={copy.loadErrorTitle}
              message={list.loadedOnce ? `${copy.loadErrorMessage} ${copy.staleListNote}` : copy.loadErrorMessage}
              onRetry={list.reload}
              retryLabel={copy.reload}
            />
          ) : null}

          {firstLoad ? (
            <div className="rounded-lg border border-default bg-surface p-4">
              <Skeleton lines={4} label={copy.loadingSessions} />
            </div>
          ) : list.status === "error" && !list.loadedOnce ? null : (
            <SessionsOverview
              sessions={visibleSessions}
              workspaceId={workspaceId}
              onNavigate={openSession}
              onRefresh={list.reload}
              filterSession={shouldShowSession}
              searchQuery={query}
            />
          )}

          <section
            ref={composerRef}
            data-testid="sessions-composer"
            aria-label={t.home.modeSessionTitle}
            className="rounded-lg border border-default bg-surface p-4"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="m-0 text-[15px] font-semibold text-primary">{t.home.modeSessionTitle}</h2>
                <p className="m-0 mt-1 text-xs text-secondary">{t.home.modeSessionDescription}</p>
              </div>
              <SessionsRecentButton sessions={visibleSessions} onOpen={openSession} />
            </div>
            <HomeInput
              workspaceId={workspaceId}
              variant="default"
              displaySkills={[{
                name: "canvas",
                description: t.canvas.liveEntryLabel,
              }]}
              launchModes={[{
                id: "session",
                label: t.home.modeSessionTitle,
                description: t.home.modeSessionDescription,
                placeholder: t.home.modeSessionPlaceholder,
                defaultAgentRole: "ROUTA",
                allowRoleSwitch: true,
                allowCustomSpecialist: true,
                dispatchMode: "pending-prompt",
                buildSessionUrl: (nextWorkspaceId, sessionId) =>
                  `/workspace/${nextWorkspaceId ?? workspaceId}/sessions/${sessionId}`,
              }]}
            />
          </section>
        </div>
      </div>
    </DesktopAppShell>
  );
}
