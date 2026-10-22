"use client";

/**
 * First-run onboarding. Full-page form when there is no workspace yet; inline
 * three-step checklist (provider, codebase, preferred mode) until the user
 * dismisses it. Moved out of the old home-page-sections.tsx and restyled with
 * the redesign tokens; behavior is unchanged.
 */

import { useState } from "react";
import { Folder } from "lucide-react";
import { RepoPicker, type RepoSelection } from "@/client/components/repo-picker";
import type { OnboardingMode } from "@/client/utils/onboarding";
import { Badge } from "@/client/components/ui/badge";
import { buttonClassName } from "@/client/components/ui/button";
import { useTranslation } from "@/i18n";

const ONBOARDING_GITHUB_PLACEHOLDER = "https://github.com/phodal/routa";

export interface OnboardingCardProps {
  hasWorkspace: boolean;
  workspaceTitle?: string | null;
  hasProviderConfig: boolean;
  hasCodebase: boolean;
  availableProviderNames: string[];
  preferredMode: OnboardingMode | null;
  onCreateWorkspace: (title: string) => Promise<boolean>;
  onOpenProviders: () => void;
  onAddCodebase: (selection: RepoSelection) => Promise<boolean>;
  onSelectMode: (mode: OnboardingMode) => void;
  onDismiss?: () => void;
}

const panel = "rounded-lg border border-default bg-surface p-4";
const muted = "text-[13px] leading-relaxed text-secondary";
const sectionLabel = "text-xs font-semibold text-secondary";

export function OnboardingCard({
  hasWorkspace,
  workspaceTitle,
  hasProviderConfig,
  hasCodebase,
  availableProviderNames,
  preferredMode,
  onCreateWorkspace,
  onOpenProviders,
  onAddCodebase,
  onSelectMode,
  onDismiss,
}: OnboardingCardProps) {
  const { t } = useTranslation();
  const [workspaceName, setWorkspaceName] = useState(() => t.common.workspace);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [repoSelection, setRepoSelection] = useState<RepoSelection | null>(null);
  const [codebaseBusy, setCodebaseBusy] = useState(false);
  const [codebaseError, setCodebaseError] = useState<string | null>(null);

  const completeCount = Number(hasProviderConfig) + Number(hasCodebase) + Number(preferredMode !== null);
  const modeTitles: Record<OnboardingMode, string> = {
    SESSION: t.onboarding.modeSessionTitle,
    KANBAN: t.onboarding.modeKanbanTitle,
    TEAM: t.onboarding.modeTeamTitle,
  };
  const status = (done: boolean) => (
    <Badge tone={done ? "success" : "attention"} className="shrink-0">
      {done ? t.onboarding.completed : t.onboarding.pending}
    </Badge>
  );

  const handleWorkspaceCreate = async () => {
    const title = workspaceName.trim();
    if (!title || workspaceBusy) return;
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    const created = await onCreateWorkspace(title);
    if (!created) setWorkspaceError(t.errors.saveFailed);
    setWorkspaceBusy(false);
  };

  const handleAddCodebase = async () => {
    if (!repoSelection || codebaseBusy) return;
    setCodebaseBusy(true);
    setCodebaseError(null);
    const created = await onAddCodebase(repoSelection);
    if (!created) setCodebaseError(t.errors.saveFailed);
    else setRepoSelection(null);
    setCodebaseBusy(false);
  };

  if (!hasWorkspace) {
    return (
      <div className="w-full max-w-xl rounded-lg border border-default bg-surface px-6 py-8 min-[801px]:px-8" data-testid="onboarding-full">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-accent-subtle text-accent">
          <Folder className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="mb-1.5 text-center text-[21px] font-[650] text-primary">{t.onboarding.title}</h2>
        <p className={`mb-6 text-center ${muted}`}>{t.onboarding.description}</p>
        <label htmlFor="onboarding-workspace-name" className={`mb-2 block ${sectionLabel}`}>{t.onboarding.workspaceNameLabel}</label>
        <input
          id="onboarding-workspace-name"
          type="text"
          value={workspaceName}
          onChange={(event) => setWorkspaceName(event.target.value)}
          placeholder={t.onboarding.workspaceNamePlaceholder}
          className="w-full rounded-control border border-default bg-canvas px-3 py-2 text-sm text-primary outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
        {workspaceError && <p role="alert" className="mt-2 text-sm text-danger">{workspaceError}</p>}
        <div className="mt-5 flex flex-col gap-3 min-[601px]:flex-row">
          <button
            type="button"
            onClick={() => void handleWorkspaceCreate()}
            disabled={workspaceBusy || !workspaceName.trim()}
            className={buttonClassName("primary", "md")}
          >
            {workspaceBusy ? t.common.loading : t.onboarding.getStarted}
          </button>
          <button type="button" onClick={onOpenProviders} className={buttonClassName("secondary", "md")}>
            {t.onboarding.openProviders}
          </button>
        </div>
        <div className={`mt-6 ${panel} bg-subtle`}>
          <div className={sectionLabel}>{t.onboarding.nextSteps}</div>
          <ol className={`mb-0 mt-3 grid list-decimal gap-2 pl-5 ${muted}`}>
            <li>{t.onboarding.providerDescription}</li>
            <li>{t.onboarding.codebaseDescription}</li>
            <li>{t.onboarding.modeDescription}</li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-default bg-surface p-5" data-testid="onboarding-inline">
      <div className="flex flex-col gap-3 min-[1101px]:flex-row min-[1101px]:items-start min-[1101px]:justify-between">
        <div className="min-w-0">
          <div className={sectionLabel}>{t.onboarding.checklistTitle}</div>
          <h2 className="mt-1.5 text-[17px] font-semibold text-primary">{workspaceTitle ?? t.onboarding.createWorkspace}</h2>
          <p className={`mt-1 max-w-2xl ${muted}`}>{t.onboarding.checklistDescription}</p>
        </div>
        <Badge tone="neutral" className="self-start">{completeCount}/3 {t.onboarding.completed}</Badge>
      </div>

      <div className="mt-4 grid gap-3 min-[1101px]:grid-cols-3">
        <div className={panel}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-primary">{t.onboarding.providerTitle}</div>
              <p className={`mt-1 ${muted}`}>{t.onboarding.providerDescription}</p>
            </div>
            {status(hasProviderConfig)}
          </div>
          {hasProviderConfig ? (
            <div className="mt-4">
              {availableProviderNames.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableProviderNames.map((name) => <Badge key={name} tone="success">{name}</Badge>)}
                </div>
              ) : (
                <p className="m-0 text-sm text-success">{t.onboarding.providerReady}</p>
              )}
              <button type="button" onClick={onOpenProviders} className={`mt-3 ${buttonClassName("ghost", "xs")}`}>
                {t.onboarding.openProviders}
              </button>
            </div>
          ) : (
            <button type="button" onClick={onOpenProviders} className={`mt-4 ${buttonClassName("secondary", "sm")}`}>
              {t.onboarding.providerAction}
            </button>
          )}
        </div>

        <div className={panel}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-primary">{t.onboarding.codebaseTitle}</div>
              <p className={`mt-1 ${muted}`}>{t.onboarding.codebaseDescription}</p>
            </div>
            {status(hasCodebase)}
          </div>
          {hasCodebase ? (
            <p className="mb-0 mt-4 text-sm text-success">{t.onboarding.codebaseReady}</p>
          ) : (
            <>
              <div className="mt-4">
                <RepoPicker value={repoSelection} onChange={setRepoSelection} pathDisplay="below-muted" clonePlaceholder={ONBOARDING_GITHUB_PLACEHOLDER} />
              </div>
              {codebaseError && <p role="alert" className="mt-2 text-sm text-danger">{codebaseError}</p>}
              <button
                type="button"
                onClick={() => void handleAddCodebase()}
                disabled={!repoSelection?.path || codebaseBusy}
                className={`mt-4 ${buttonClassName("primary", "sm")}`}
              >
                {codebaseBusy ? t.common.loading : t.onboarding.codebaseAction}
              </button>
            </>
          )}
        </div>

        <div className={panel}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-primary">{t.onboarding.modeTitle}</div>
              <p className={`mt-1 ${muted}`}>{t.onboarding.modeDescription}</p>
            </div>
            {status(preferredMode !== null)}
          </div>
          <div className="mt-4 grid gap-2">
            {(["SESSION", "KANBAN", "TEAM"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={preferredMode === mode}
                onClick={() => onSelectMode(mode)}
                className={`rounded-control border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-accent ${preferredMode === mode
                  ? "border-accent bg-accent-subtle"
                  : "border-default hover:bg-hover"}`}
              >
                <div className="text-sm font-semibold text-primary">{modeTitles[mode]}</div>
                <p className={`mb-0 mt-1 ${muted}`}>{
                  mode === "SESSION" ? t.onboarding.modeSessionDescription
                    : mode === "KANBAN" ? t.onboarding.modeKanbanDescription
                      : t.onboarding.modeTeamDescription
                }</p>
              </button>
            ))}
          </div>
          {preferredMode && (
            <p className="mb-0 mt-4 text-sm text-success">{t.onboarding.modeReady}: {modeTitles[preferredMode]}</p>
          )}
        </div>
      </div>

      {onDismiss && (
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onDismiss} className={buttonClassName("ghost", "sm")}>
            {t.onboarding.continueLater}
          </button>
        </div>
      )}
    </section>
  );
}
