"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { DesktopAppShell } from "@/client/components/desktop-app-shell";
import { AcpProviderDropdown } from "@/client/components/acp-provider-dropdown";
import { SettingsPageHeader } from "@/client/components/settings-page-header";
import { useAcp } from "@/client/hooks/use-acp";
import { storePendingPrompt } from "@/client/utils/pending-prompt";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { useTranslation } from "@/i18n";

interface RepoSlideLaunchPoint {
  name: string;
  path: string;
  reason?: string;
}

interface RepoSlideFocusDirectory {
  name: string;
  path: string;
  fileCount: number;
  children: Array<{
    name: string;
    type: "file" | "directory";
    fileCount?: number;
  }>;
}

interface RepoSlideResponse {
  codebase: {
    id: string;
    label?: string;
    repoPath: string;
    sourceType: string;
    sourceUrl?: string;
    branch?: string;
  };
  summary: {
    totalFiles: number;
    totalDirectories: number;
    topLevelFolders: string[];
    sourceType: string;
    branch?: string;
  };
  context: {
    rootFiles: string[];
    entryPoints: RepoSlideLaunchPoint[];
    keyFiles: RepoSlideLaunchPoint[];
    focusDirectories: RepoSlideFocusDirectory[];
  };
  launch: {
    skillName: string;
    skillRepoPath?: string;
    skillAvailable: boolean;
    unavailableReason?: string;
    prompt: string;
  };
}

export function RepoSlidePageClient() {
  const { t } = useTranslation();
  const params = useParams<{ workspaceId: string; codebaseId: string }>();
  const router = useRouter();
  const workspaceId = params.workspaceId;
  const codebaseId = params.codebaseId;
  const acp = useAcp();

  const [data, setData] = useState<RepoSlideResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (acp.connected || acp.loading) return;
    void acp.connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acp.connected, acp.loading]);

  useEffect(() => {
    if (!workspaceId || !codebaseId) return;

    let cancelled = false;

    const fetchLaunchContext = async () => {
      try {
        const response = await desktopAwareFetch(
          `/api/workspaces/${workspaceId}/codebases/${codebaseId}/reposlide`,
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const nextData = await response.json() as RepoSlideResponse;
        if (!cancelled) {
          setData(nextData);
          setLoading(false);
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
          setLoading(false);
        }
      }
    };

    void fetchLaunchContext();

    return () => {
      cancelled = true;
    };
  }, [workspaceId, codebaseId]);

  const repoName = useMemo(() => {
    if (!data) return "RepoSlide";
    return data.codebase.label ?? data.codebase.repoPath.split("/").pop() ?? "RepoSlide";
  }, [data]);

  const selectableProvider = useMemo(() => {
    const preferredProvider = acp.providers.find(
      (provider) => provider.id === acp.selectedProvider && provider.status !== "unavailable",
    );
    if (preferredProvider) return preferredProvider.id;
    return acp.providers.find((provider) => provider.status !== "unavailable")?.id;
  }, [acp.providers, acp.selectedProvider]);

  const handleLaunch = useCallback(async () => {
    if (!data || !workspaceId) return;

    setLaunching(true);
    setError(null);

    try {
      if (!acp.connected) {
        await acp.connect();
      }

      const provider = selectableProvider;
      if (!provider) {
        throw new Error("No available ACP provider for RepoSlide launch.");
      }
      if (!data.launch.skillAvailable) {
        throw new Error(data.launch.unavailableReason ?? "slide-skill is not available for RepoSlide.");
      }
      if (provider !== acp.selectedProvider) {
        acp.setProvider(provider);
      }

      const result = await acp.createSession(
        data.codebase.repoPath,
        provider,
        undefined,
        "DEVELOPER",
        workspaceId,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        data.codebase.branch,
        "full",
      );

      if (!result?.sessionId) {
        throw new Error("RepoSlide session creation returned no session id.");
      }

      storePendingPrompt(result.sessionId, {
        text: data.launch.prompt,
        skillName: data.launch.skillName,
        skillRepoPath: data.launch.skillRepoPath,
      });

      router.push(
        `/workspace/${workspaceId}/sessions/${result.sessionId}?source=reposlide&codebaseId=${codebaseId}`,
      );
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : String(launchError));
      setLaunching(false);
    }
  }, [acp, codebaseId, data, router, selectableProvider, workspaceId]);

  const content = (
    <div className="flex h-full flex-col bg-canvas" data-testid="reposlide-root">
      <SettingsPageHeader
        title={t.pagesRedesign.headers.reposlide.title}
        description={t.pagesRedesign.headers.reposlide.description}
        actions={(
          <>
            <button
              type="button"
              onClick={() => router.back()}
              className="text-xs text-secondary hover:text-primary"
            >
              ← Back
            </button>
            <AcpProviderDropdown
              providers={acp.providers}
              selectedProvider={selectableProvider ?? acp.selectedProvider}
              onProviderChange={acp.setProvider}
              disabled={launching || acp.loading}
              ariaLabel="Select RepoSlide provider"
            />
            <button
              type="button"
              onClick={handleLaunch}
              disabled={loading || launching || !data || !selectableProvider || !data.launch.skillAvailable}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {launching ? "Launching…" : "Launch RepoSlide"}
            </button>
          </>
        )}
      />

      <div className="flex-1 overflow-auto px-5 py-5">
        {loading && (
          <div className="text-sm text-secondary">Loading RepoSlide context…</div>
        )}
        {error && (
          <div className="rounded-xl border border-danger bg-danger-subtle px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
        {!loading && !error && data && (
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
            <section className="grid gap-4 lg:grid-cols-[1.3fr_0.9fr]">
              <div className="rounded-2xl border border-default bg-surface p-5 shadow-sm">
                <div className="text-xs font-medium text-accent">
                  Target Repository
                </div>
                <h1 className="mt-2 text-2xl font-semibold text-primary">
                  {repoName}
                </h1>
                <div className="mt-2 font-mono text-xs text-secondary">
                  {data.codebase.repoPath}
                </div>
                {data.codebase.sourceUrl && (
                  <div className="mt-2 text-xs text-secondary">
                    Source URL: {data.codebase.sourceUrl}
                  </div>
                )}
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="Branch" value={data.codebase.branch ?? "unknown"} />
                  <StatCard label="Source" value={data.codebase.sourceType} />
                  <StatCard label="Files" value={String(data.summary.totalFiles)} />
                  <StatCard label="Directories" value={String(data.summary.totalDirectories)} />
                </div>
                <div className="mt-5 rounded-xl border border-default bg-subtle px-4 py-3 text-sm text-secondary">
                  This page no longer renders a hardcoded slide deck. It starts an ACP session in the selected repo,
                  injects `slide-skill`, and asks the agent to build a real deck artifact.
                </div>
                {!data.launch.skillAvailable && (
                  <div className="mt-4 rounded-xl border border-attention bg-attention-subtle px-4 py-3 text-sm text-attention">
                    RepoSlide launch is blocked because `slide-skill` is unavailable.
                    {data.launch.unavailableReason ? ` ${data.launch.unavailableReason}` : ""}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-default bg-surface p-5 shadow-sm">
                <div className="text-xs font-medium text-accent">
                  Launch Plan
                </div>
                <ul className="mt-3 space-y-3 text-sm text-secondary">
                  <li>1. Create a new `DEVELOPER` ACP session with the repo as `cwd`.</li>
                  <li>2. Load `slide-skill` from Routa&apos;s slide tooling when available.</li>
                  <li>3. Auto-send a structured prompt with repo context and orientation targets.</li>
                  <li>4. Continue in the session page and let the agent generate the PPTX deck.</li>
                </ul>
                <div className="mt-4 rounded-xl border border-default bg-subtle px-4 py-3 text-xs text-secondary">
                  Skill source: {data.launch.skillRepoPath ?? "global / installed skill resolution"}
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-3">
              <InfoCard title="Top-level folders" items={data.summary.topLevelFolders} emptyLabel="No folders detected" />
              <InfoCard title="Root files" items={data.context.rootFiles} emptyLabel="No root files detected" />
              <InfoCard
                title="Key files"
                items={data.context.keyFiles.map((file) => file.path)}
                emptyLabel="No key files detected"
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-2xl border border-default bg-surface p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-primary">
                  Entry Points & Anchors
                </h2>
                <div className="mt-4 space-y-3">
                  {data.context.entryPoints.length === 0 && (
                    <div className="text-sm text-secondary">
                      No entry points detected in the scanned tree.
                    </div>
                  )}
                  {data.context.entryPoints.map((item) => (
                    <div
                      key={`${item.path}-${item.reason ?? item.name}`}
                      className="rounded-xl border border-default px-3 py-3"
                    >
                      <div className="font-mono text-xs text-secondary">
                        {item.path}
                      </div>
                      <div className="mt-1 text-sm text-primary">
                        {item.reason ?? item.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-default bg-surface p-5 shadow-sm">
                <h2 className="text-sm font-semibold text-primary">
                  Largest Top-level Areas
                </h2>
                <div className="mt-4 space-y-3">
                  {data.context.focusDirectories.length === 0 && (
                    <div className="text-sm text-secondary">
                      No focus directories detected in the scanned tree.
                    </div>
                  )}
                  {data.context.focusDirectories.map((directory) => (
                    <div
                      key={directory.path}
                      className="rounded-xl border border-default px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-primary">
                            {directory.path}
                          </div>
                          <div className="text-xs text-secondary">
                            {directory.fileCount} files scanned
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {directory.children.slice(0, 10).map((child) => (
                          <span
                            key={`${directory.path}-${child.name}`}
                            className="rounded-full border border-default px-2 py-1 text-[11px] text-secondary"
                          >
                            {child.type === "directory" ? `${child.name}/` : child.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-default bg-surface p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-primary">
                    Prompt Preview
                  </h2>
                  <div className="text-xs text-secondary">
                    This is the first task the agent will receive.
                  </div>
                </div>
              </div>
              <pre className="mt-4 overflow-x-auto rounded-xl bg-subtle px-4 py-4 text-xs leading-6 text-primary">
                {data.launch.prompt}
              </pre>
            </section>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <DesktopAppShell workspaceId={workspaceId}>
      {content}
    </DesktopAppShell>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-default bg-subtle px-4 py-3">
      <div className="text-[11px] font-semibold text-secondary">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-primary">
        {value}
      </div>
    </div>
  );
}

function InfoCard({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: string[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-default bg-surface p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-primary">
        {title}
      </h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {items.length === 0 && (
          <div className="text-sm text-secondary">{emptyLabel}</div>
        )}
        {items.map((item) => (
          <span
            key={item}
            className="rounded-full border border-default px-2 py-1 text-[11px] text-secondary"
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
