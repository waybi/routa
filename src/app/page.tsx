"use client";

/**
 * Home - /
 * Global home (design-spec §3): one card per workspace with in-progress and
 * needs-you counts and the newest activity, a needs-you banner, the latest
 * completion report and create shortcuts. Read-only: opening it issues GETs
 * only (workspaces, codebases, providers, tasks, boards, sessions) plus the
 * kanban SSE stream; ACP connects only when the user opens Settings.
 */

import { Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import type { RepoSelection } from "@/client/components/repo-picker";
import { RepoPicker } from "@/client/components/repo-picker";
import { OnboardingCard } from "@/client/components/home/onboarding-card";
import { HomeWorkspaceCard } from "@/client/components/home/home-workspace-card";
import {
  HomeAttentionBanner,
  HomeCreateSection,
  HomeLatestResult,
  HomeReadinessNotice,
} from "@/client/components/home/home-sections";
import { useHomeProviderReadiness } from "@/client/components/home/use-home-provider-readiness";
import { useMinuteClock } from "@/client/components/home/relative-time";
import { useHomeCodebases } from "@/client/components/home/use-home-codebases";
import {
  SettingsPanel,
  loadDefaultProviders,
  loadDockerOpencodeAuthJson,
  loadProviderConnections,
} from "@/client/components/settings-panel";
import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { WorkspaceSwitcher } from "@/client/components/workspace-switcher";
import { buttonClassName } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/states";
import { useAcp } from "@/client/hooks/use-acp";
import { useWorkspaces } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { loadCustomAcpProviders } from "@/client/utils/custom-acp-providers";
import {
  clearOnboardingState,
  ONBOARDING_COMPLETED_KEY,
  ONBOARDING_MODE_KEY,
  hasSavedProviderConfiguration,
  parseOnboardingMode,
  type OnboardingMode,
} from "@/client/utils/onboarding";
import { useTranslation } from "@/i18n";
import type { SessionInfo } from "@/app/workspace/[workspaceId]/types";
import { useKanbanOverviewData } from "@/app/workspace/[workspaceId]/kanban/use-kanban-overview-data";
import { readAttentionDismissals } from "@/app/workspace/[workspaceId]/kanban/use-kanban-attention-dismissals";
import {
  buildInboxRows,
  latestCompletionResult,
  summarizeWorkspace,
} from "@/app/workspace/[workspaceId]/overview/inbox-rules";

const LAST_WORKSPACE_KEY = "routa.desktop.last-workspace-id";

const noopSubscribe = () => () => {};

/** False on the server and during hydration, true afterwards. */
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function isTopLevelTeamRun(session: SessionInfo) {
  if (session.parentSessionId) return false;
  if (session.specialistId === "team-agent-lead") return true;
  if (session.role?.toUpperCase() !== "ROUTA") return false;

  const normalizedName = (session.name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalizedName) return false;

  return (
    normalizedName.startsWith("team -")
    || normalizedName.startsWith("team run")
    || normalizedName.includes("team lead")
  );
}

function HomePageContent() {
  const router = useRouter();
  const workspacesHook = useWorkspaces();
  const acp = useAcp();
  const readiness = useHomeProviderReadiness();
  const { t } = useTranslation();
  const copy = t.homeRedesign;
  const searchParams = useSearchParams();
  const now = useMinuteClock();

  // Last selection (restored from localStorage); the effective workspace is derived below.
  const [selectedWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return readStorage(LAST_WORKSPACE_KEY) || null;
  });
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"providers" | "roles" | "specialists" | undefined>(undefined);
  // Local overrides after the user acts; until then the stored values win.
  const [modeOverride, setPreferredMode] = useState<OnboardingMode | null | undefined>(undefined);
  const [completedOverride, setOnboardingCompleted] = useState<boolean | null>(null);
  const [sessionsByWorkspace, setSessionsByWorkspace] = useState<Record<string, SessionInfo[]>>({});
  const hydrated = useHydrated();
  const [showRepoPicker, setShowRepoPicker] = useState(false);

  const requestedWorkspaceId = searchParams.get("workspace");
  const workspaceList = workspacesHook.workspaces;
  // ?workspace=<id> wins; else the restored one; else (missing) the first.
  const activeWorkspaceId = requestedWorkspaceId && workspaceList.some((workspace) => workspace.id === requestedWorkspaceId)
    ? requestedWorkspaceId
    : selectedWorkspaceId && workspaceList.some((workspace) => workspace.id === selectedWorkspaceId)
      ? selectedWorkspaceId
      : (workspaceList[0]?.id ?? selectedWorkspaceId);
  const preferredMode = modeOverride !== undefined
    ? modeOverride
    : (hydrated ? parseOnboardingMode(readStorage(ONBOARDING_MODE_KEY)) : null);
  const onboardingCompleted = completedOverride ?? (hydrated && readStorage(ONBOARDING_COMPLETED_KEY) === "true");

  const { codebases, loaded: codebasesLoaded, refetch: fetchCodebases } = useHomeCodebases(activeWorkspaceId);
  const { data: overviewData, retry } = useKanbanOverviewData(workspacesHook.workspaces);

  useEffect(() => {
    if (!activeWorkspaceId || sessionsByWorkspace[activeWorkspaceId]) {
      return;
    }

    let cancelled = false;
    (async () => {
      let sessions: SessionInfo[] = [];
      try {
        const sessionsRes = await desktopAwareFetch(
          `/api/sessions?workspaceId=${encodeURIComponent(activeWorkspaceId)}&limit=6`,
          { cache: "no-store" },
        );
        const sessionsData = await sessionsRes.json().catch(() => ({}));
        sessions = Array.isArray(sessionsData?.sessions) ? sessionsData.sessions : [];
      } catch {
        sessions = [];
      }
      if (cancelled) return;
      setSessionsByWorkspace((current) => ({ ...current, [activeWorkspaceId]: sessions }));
    })();

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, sessionsByWorkspace]);

  const handleWorkspaceCreate = useCallback(async (title: string) => {
    const workspace = await workspacesHook.createWorkspace(title);
    if (workspace) {
      setActiveWorkspaceId(workspace.id);
      return true;
    }
    return false;
  }, [workspacesHook]);

  const handleOpenProviders = useCallback(() => {
    // Connecting ACP POSTs /api/acp; do it only on this explicit action.
    if (!acp.connected && !acp.loading) {
      void acp.connect();
    }
    setSettingsInitialTab("providers");
    setShowSettingsPanel(true);
  }, [acp]);

  const handleModeSelect = useCallback((mode: OnboardingMode) => {
    setPreferredMode(mode);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_MODE_KEY, mode);
    }
  }, []);

  const handleDismissOnboarding = useCallback(() => {
    setOnboardingCompleted(true);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, "true");
    }
  }, []);

  const handleResetOnboarding = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    clearOnboardingState(window.localStorage);
    setOnboardingCompleted(false);
    setPreferredMode(null);
  }, []);

  const handleAddCodebase = useCallback(async (selection: RepoSelection) => {
    const targetWorkspaceId = activeWorkspaceId ?? workspacesHook.workspaces[0]?.id;
    if (!targetWorkspaceId) {
      return false;
    }

    const response = await desktopAwareFetch(`/api/workspaces/${encodeURIComponent(targetWorkspaceId)}/codebases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repoPath: selection.path,
        branch: selection.branch || undefined,
        label: selection.name || undefined,
      }),
    });

    if (response.ok) {
      await fetchCodebases();
      return true;
    }

    return false;
  }, [activeWorkspaceId, fetchCodebases, workspacesHook.workspaces]);

  const workspaces = workspacesHook.workspaces;
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const requestedSurfaceId = searchParams.get("mode");
  const hasWorkspace = workspaces.length > 0;

  const availableProviders = readiness.providers.filter((provider) => provider.status === "available");
  const availableProviderNames = useMemo(
    () => availableProviders.map((provider) => provider.name).slice(0, 3),
    [availableProviders],
  );
  const hasProviderConfig =
    hydrated
      ? hasSavedProviderConfiguration(loadDefaultProviders(), loadProviderConnections(), {
        dockerOpencodeAuthJson: loadDockerOpencodeAuthJson(),
        customProviderCount: loadCustomAcpProviders().length,
        runtimeProviderCount: availableProviders.length,
      })
      : false;
  const hasCodebase = codebases.length > 0;
  // Show onboarding until the user explicitly dismisses it.
  const needsInlineOnboarding = hasWorkspace && !onboardingCompleted;
  const readinessReady = hydrated && readiness.loaded && codebasesLoaded;

  // Read dismissals on every render: the board strip may have changed them.
  const inbox = buildInboxRows(workspaces, overviewData, now, readAttentionDismissals);
  const latestResult = latestCompletionResult(workspaces, overviewData);
  const anyLoading = workspaces.some((workspace) => !overviewData[workspace.id]?.tasks.length && overviewData[workspace.id]?.status !== "ready");

  const latestSession = useMemo(() => {
    const sessions = activeWorkspaceId ? (sessionsByWorkspace[activeWorkspaceId] ?? []) : [];
    return [...sessions]
      .filter((session) => !isTopLevelTeamRun(session))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] ?? null;
  }, [activeWorkspaceId, sessionsByWorkspace]);
  const continueSession = latestSession
    ? {
      href: `/workspace/${encodeURIComponent(latestSession.workspaceId)}/sessions/${encodeURIComponent(latestSession.sessionId)}`,
      label: latestSession.name
        || (latestSession.provider && latestSession.role ? `${latestSession.provider} · ${latestSession.role.toLowerCase()}` : latestSession.provider)
        || copy.sessionFallback.replace("{id}", latestSession.sessionId.slice(0, 8)),
    }
    : null;

  useEffect(() => {
    if (!activeWorkspaceId || !requestedSurfaceId) return;

    if (requestedSurfaceId === "session") {
      router.replace(`/workspace/${activeWorkspaceId}/sessions`);
      return;
    }

    if (requestedSurfaceId === "team") {
      router.replace(`/workspace/${activeWorkspaceId}/team`);
      return;
    }

    if (requestedSurfaceId === "planning") {
      router.replace(`/workspace/${activeWorkspaceId}/kanban`);
    }
  }, [activeWorkspaceId, requestedSurfaceId, router]);

  // Links use the restored workspace only after hydration (SSR cannot read localStorage).
  const shownWorkspaceId = hydrated ? activeWorkspaceId : null;
  const activeId = shownWorkspaceId ? encodeURIComponent(shownWorkspaceId) : null;

  return (
    <DesktopAppShell
      // The restored workspace comes from localStorage, which the server
      // cannot see; wait for hydration so sidebar links match the SSR HTML.
      workspaceId={hydrated ? activeWorkspaceId : null}
      workspaceTitle={activeWorkspace?.title ?? undefined}
      workspaceSwitcher={(
        <WorkspaceSwitcher
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          activeWorkspaceTitle={activeWorkspace?.title ?? undefined}
          onSelect={setActiveWorkspaceId}
          onCreate={async (title) => {
            await handleWorkspaceCreate(title);
          }}
          loading={workspacesHook.loading}
          compact
          desktop
        />
      )}
    >
      <div className="flex h-full min-h-0 bg-canvas">
        <main className="flex min-w-0 flex-1 flex-col">
          {!hasWorkspace && !workspacesHook.loading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <OnboardingCard
                hasWorkspace={false}
                workspaceTitle={null}
                hasProviderConfig={hasProviderConfig}
                hasCodebase={false}
                availableProviderNames={availableProviderNames}
                preferredMode={preferredMode}
                onCreateWorkspace={handleWorkspaceCreate}
                onOpenProviders={handleOpenProviders}
                onAddCodebase={handleAddCodebase}
                onSelectMode={handleModeSelect}
              />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto" data-testid="home-page">
              <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-4 min-[801px]:p-[22px] min-[1101px]:p-7">
                <header className="flex min-h-12 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="m-0 text-[21px] font-[650] leading-tight text-primary">{copy.title}</h1>
                    <p className="m-0 mt-1 text-xs text-secondary">{copy.subtitle}</p>
                  </div>
                  {activeId && (
                    <Link href={`/workspace/${activeId}/kanban`} className={buttonClassName("primary", "md")} data-testid="home-enter-board">
                      {copy.enterBoard}
                    </Link>
                  )}
                </header>

                {needsInlineOnboarding && (
                  <OnboardingCard
                    hasWorkspace
                    workspaceTitle={activeWorkspace?.title ?? null}
                    hasProviderConfig={hasProviderConfig}
                    hasCodebase={hasCodebase}
                    availableProviderNames={availableProviderNames}
                    preferredMode={preferredMode}
                    onCreateWorkspace={handleWorkspaceCreate}
                    onOpenProviders={handleOpenProviders}
                    onAddCodebase={handleAddCodebase}
                    onSelectMode={handleModeSelect}
                    onDismiss={handleDismissOnboarding}
                  />
                )}

                {readinessReady && !needsInlineOnboarding && (
                  <HomeReadinessNotice
                    missingModel={!hasProviderConfig}
                    missingCodebase={!hasCodebase}
                    onConfigureModel={handleOpenProviders}
                    onAddCodebase={() => setShowRepoPicker(true)}
                  />
                )}
                {showRepoPicker && (
                  <section className="rounded-lg border border-default bg-surface p-4" data-testid="home-repo-picker">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-secondary">{copy.addCodebase}</span>
                      <button type="button" onClick={() => setShowRepoPicker(false)} className={buttonClassName("ghost", "xs")}>
                        {t.common.cancel}
                      </button>
                    </div>
                    <RepoPicker
                      value={null}
                      onChange={async (selection) => {
                        if (selection) {
                          await handleAddCodebase(selection);
                          setShowRepoPicker(false);
                        }
                      }}
                    />
                  </section>
                )}

                {activeId && (
                  <HomeAttentionBanner
                    count={now > 0 ? inbox.active.length : 0}
                    topTitle={inbox.active[0]?.task.title ?? null}
                    href={`/workspace/${activeId}/overview?view=all`}
                  />
                )}

                <section aria-labelledby="home-workspaces-heading">
                  <h2 id="home-workspaces-heading" className="m-0 mb-2.5 text-xs font-medium text-secondary">{copy.workspacesSection}</h2>
                  {workspacesHook.loading && !hasWorkspace ? (
                    <Skeleton lines={3} label={copy.loading} />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 min-[801px]:grid-cols-2 min-[1101px]:grid-cols-3" data-testid="home-workspace-grid">
                      {workspaces.map((workspace) => {
                        const entry = overviewData[workspace.id];
                        const tasks = entry?.tasks ?? [];
                        const boards = entry?.boards ?? [];
                        return (
                          <HomeWorkspaceCard
                            key={workspace.id}
                            workspace={workspace}
                            status={entry?.status ?? "loading"}
                            hasData={entry?.status === "ready" || tasks.length > 0 || boards.length > 0}
                            summary={summarizeWorkspace(workspace, tasks, boards, now, readAttentionDismissals)}
                            now={now}
                            onRetry={() => retry(workspace.id)}
                          />
                        );
                      })}
                    </div>
                  )}
                </section>

                <div className="grid grid-cols-1 gap-4 min-[801px]:grid-cols-2">
                  <HomeLatestResult result={latestResult} loading={anyLoading} now={now} />
                  <HomeCreateSection workspaceId={shownWorkspaceId} continueSession={continueSession} />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <SettingsPanel
        open={showSettingsPanel}
        onClose={() => setShowSettingsPanel(false)}
        providers={acp.connected ? acp.providers : readiness.providers}
        initialTab={settingsInitialTab}
        onResetOnboarding={handleResetOnboarding}
      />
    </DesktopAppShell>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={(
      <div className="desktop-theme flex h-screen items-center justify-center bg-canvas" aria-busy="true" />
    )}>
      <HomePageContent />
    </Suspense>
  );
}
