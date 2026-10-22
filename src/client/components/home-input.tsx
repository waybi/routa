"use client";

/**
 * HomeInput - Task-first input component
 *
 * An operational input that prioritizes the user's immediate intent:
 * - TiptapInput for rich text, skills (/), file mentions (@)
 * - Inline control bar: Agent dropdown, Workspace pill, Repo/Branch pill
 * - Agent selection is lightweight — a small dropdown, not separate cards
 * - Context (workspace/repo) is always visible but non-intrusive
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { TiptapInput, type InputContext } from "./tiptap-input";
import { ModelEffortPicker } from "./model-effort-picker";
import { useModelEffortChoices } from "../model-effort/use-model-effort-choices";
import { useAcp } from "../hooks/use-acp";
import { useSkills } from "../hooks/use-skills";
import { useWorkspaces, useCodebases } from "../hooks/use-workspaces";
import type { RepoSelection } from "./repo-picker";
import { storePendingPrompt } from "../utils/pending-prompt";
import { loadProviderConnectionConfig, getModelDefinitionByAlias, DockerConfigModal } from "./settings-panel";
import { desktopAwareFetch } from "../utils/diagnostics";
import { collectAccessibleRepoPaths } from "@/client/utils/repo-validation";
import { useTranslation } from "@/i18n";
import { Check, ChevronDown, Folder, CircleUser, Sun, Zap } from "lucide-react";


type AgentRole = "ROUTA" | "CRAFTER" | "DEVELOPER";
type BuiltInAgentRole = Extract<AgentRole, "ROUTA" | "CRAFTER">;
type FooterMetaMode = "default" | "repo-only";

export type HomeInputDispatchMode = "pending-prompt" | "direct-prompt";

interface HomeInputSessionConfig {
  role?: string;
  mcpProfile?: string;
  systemPrompt?: string | ((text: string) => string);
}

export interface LaunchModeConfig {
  id: string;
  label: string;
  description: string;
  placeholder?: string;
  defaultAgentRole?: BuiltInAgentRole;
  allowRoleSwitch?: boolean;
  allowCustomSpecialist?: boolean;
  lockedSpecialistId?: string;
  requireRepoSelection?: boolean;
  dispatchMode?: HomeInputDispatchMode;
  buildSessionUrl?: (workspaceId: string | null, sessionId: string) => string | null;
  sessionConfig?: HomeInputSessionConfig;
}

export function resolveHomeInputSpecialistId(options: {
  lockedSpecialistId?: string;
  allowCustomSpecialist: boolean;
  selectedSpecialistId: string | null;
}): string | null {
  return options.lockedSpecialistId ?? (
    options.allowCustomSpecialist ? options.selectedSpecialistId : null
  );
}

interface SpecialistSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
  defaultProvider?: string;
  model?: string;
}

interface HomeInputProps {
  /** Initial workspace ID (optional) */
  workspaceId?: string;
  /** Visual style variant */
  variant?: "default" | "hero";
  /** Footer metadata density below the input */
  footerMetaMode?: FooterMetaMode;
  /** Called when workspace selection changes */
  onWorkspaceChange?: (workspaceId: string | null) => void;
  onSessionCreated?: (
    sessionId: string,
    promptText: string,
    sessionContext?: { cwd?: string; branch?: string; repoName?: string },
  ) => void;
  /** Declarative launch modes used by the launcher surface */
  launchModes?: LaunchModeConfig[];
  /** Preselect a launcher mode, useful when entering from another surface */
  initialLaunchModeId?: string | null;
  /** Observe launcher mode changes */
  onLaunchModeChange?: (launchModeId: string) => void;
  /** Lock the input to a specific specialist and reuse its config */
  lockedSpecialistId?: string;
  /** Override the destination route after session creation */
  buildSessionUrl?: (workspaceId: string | null, sessionId: string) => string | null;
  /** Default built-in role to preselect on load */
  defaultAgentRole?: BuiltInAgentRole;
  /** When true, block session creation until a repository is explicitly selected */
  requireRepoSelection?: boolean;
  /** Externally triggered skill (e.g. from grid card click) */
  externalPendingSkill?: string | null;
  /** Called after the external skill has been consumed */
  onExternalSkillConsumed?: () => void;
  /** Skills to display as subtle suggestion pills below the input */
  displaySkills?: Array<{ name: string; description: string }>;
  /** Called when a skill pill is clicked */
  onSkillPillClick?: (name: string) => void;
  /** Legacy fallback for single-mode launchers. Prefer launchModes for new call sites. */
  extraSessionParams?: HomeInputSessionConfig;
}

export function HomeInput({
  workspaceId: propWorkspaceId,
  variant = "default",
  footerMetaMode = "default",
  onWorkspaceChange,
  onSessionCreated,
  launchModes,
  initialLaunchModeId,
  onLaunchModeChange,
  lockedSpecialistId,
  buildSessionUrl,
  defaultAgentRole = "ROUTA",
  requireRepoSelection = false,
  externalPendingSkill,
  onExternalSkillConsumed,
  displaySkills,
  onSkillPillClick: _onSkillPillClick,
  extraSessionParams,
}: HomeInputProps) {
  const router = useRouter();
  const acp = useAcp();
  const skillsHook = useSkills();
  const workspacesHook = useWorkspaces();
  const { t } = useTranslation();

  const normalizedLaunchModes = React.useMemo<LaunchModeConfig[]>(() => {
    if (launchModes && launchModes.length > 0) {
      return launchModes.map((mode) => ({
        defaultAgentRole: mode.defaultAgentRole ?? "ROUTA",
        allowRoleSwitch: mode.allowRoleSwitch ?? true,
        allowCustomSpecialist: mode.allowCustomSpecialist ?? true,
        requireRepoSelection: mode.requireRepoSelection ?? false,
        dispatchMode: mode.dispatchMode ?? "pending-prompt",
        ...mode,
      }));
    }

    return [{
      id: "default",
      label: t.common.session,
      description: t.home.directDesc,
      defaultAgentRole,
      allowRoleSwitch: true,
      allowCustomSpecialist: true,
      requireRepoSelection,
      dispatchMode: extraSessionParams ? "direct-prompt" : "pending-prompt",
      buildSessionUrl,
      lockedSpecialistId,
      sessionConfig: extraSessionParams,
    }];
  }, [buildSessionUrl, defaultAgentRole, extraSessionParams, launchModes, lockedSpecialistId, requireRepoSelection, t.common.session, t.home.directDesc]);

  const [activeLaunchModeId, setActiveLaunchModeId] = useState<string>(() => {
    const requestedModeId = initialLaunchModeId ?? normalizedLaunchModes[0]?.id ?? "default";
    return normalizedLaunchModes.some((mode) => mode.id === requestedModeId)
      ? requestedModeId
      : (normalizedLaunchModes[0]?.id ?? "default");
  });

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(propWorkspaceId ?? null);
  const { codebases } = useCodebases(selectedWorkspaceId ?? "");
  const [accessibleCodebasePaths, setAccessibleCodebasePaths] = useState<Set<string>>(new Set());

  const [selectedRole, setSelectedRole] = useState<AgentRole>(defaultAgentRole);
  const [repoSelection, setRepoSelection] = useState<RepoSelection | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const repoSelectionRef = useRef<RepoSelection | null>(null);
  const [pendingSkill, setPendingSkill] = useState<string | null>(null);
  // Model / effort picked in the composer before the session exists ("" = default).
  const [pickedModelEffort, setPickedModelEffort] = useState({ model: "", reasoningEffort: "" });

  // Specialists
  const [specialists, setSpecialists] = useState<SpecialistSummary[]>([]);
  const [selectedSpecialistId, setSelectedSpecialistId] = useState<string | null>(null);
  const [showSpecialistDropdown, setShowSpecialistDropdown] = useState(false);
  const specialistDropdownRef = useRef<HTMLDivElement>(null);

  // Dropdown states
  const [showWorkspaceDropdown, setShowWorkspaceDropdown] = useState(false);
  const wsDropdownRef = useRef<HTMLDivElement>(null);

  const activeLaunchMode = normalizedLaunchModes.find((mode) => mode.id === activeLaunchModeId) ?? normalizedLaunchModes[0];
  const effectiveLockedSpecialistId = activeLaunchMode?.lockedSpecialistId ?? lockedSpecialistId;
  const allowRoleSwitch = activeLaunchMode?.allowRoleSwitch ?? true;
  const allowCustomSpecialist = activeLaunchMode?.allowCustomSpecialist ?? true;
  const effectiveRequireRepoSelection = activeLaunchMode?.requireRepoSelection ?? requireRepoSelection;
  const effectiveDispatchMode = activeLaunchMode?.dispatchMode ?? (extraSessionParams ? "direct-prompt" : "pending-prompt");
  const effectiveBuildSessionUrl = activeLaunchMode?.buildSessionUrl ?? buildSessionUrl;
  const activeSessionConfig = activeLaunchMode?.sessionConfig ?? extraSessionParams;
  const effectiveFooterMetaMode = footerMetaMode;
  const effectivePlaceholder = activeLaunchMode?.placeholder ?? t.home.inputPlaceholder;
  const effectiveDefaultAgentRole = activeLaunchMode?.defaultAgentRole ?? defaultAgentRole;
  const effectiveSelectedSpecialistId = resolveHomeInputSpecialistId({
    lockedSpecialistId: effectiveLockedSpecialistId,
    allowCustomSpecialist,
    selectedSpecialistId,
  });

  // Sync with external workspaceId prop
  useEffect(() => {
    if (propWorkspaceId && propWorkspaceId !== selectedWorkspaceId) {
      setSelectedWorkspaceId(propWorkspaceId);
    }
  }, [propWorkspaceId, selectedWorkspaceId]);

  useEffect(() => {
    setSelectedRole(effectiveDefaultAgentRole);
  }, [effectiveDefaultAgentRole]);

  useEffect(() => {
    if (!allowCustomSpecialist && !effectiveLockedSpecialistId && selectedSpecialistId) {
      setSelectedSpecialistId(null);
    }
  }, [allowCustomSpecialist, effectiveLockedSpecialistId, selectedSpecialistId]);

  useEffect(() => {
    if (!normalizedLaunchModes.some((mode) => mode.id === activeLaunchModeId)) {
      setActiveLaunchModeId(normalizedLaunchModes[0]?.id ?? "default");
    }
  }, [activeLaunchModeId, normalizedLaunchModes]);

  useEffect(() => {
    if (!initialLaunchModeId) return;
    if (!normalizedLaunchModes.some((mode) => mode.id === initialLaunchModeId)) return;
    if (initialLaunchModeId === activeLaunchModeId) return;
    setActiveLaunchModeId(initialLaunchModeId);
  }, [activeLaunchModeId, initialLaunchModeId, normalizedLaunchModes]);

  useEffect(() => {
    if (!activeLaunchMode) return;
    onLaunchModeChange?.(activeLaunchMode.id);
  }, [activeLaunchMode, onLaunchModeChange]);

  // Auto-select first workspace if none selected
  useEffect(() => {
    if (!selectedWorkspaceId && workspacesHook.workspaces.length > 0) {
      const first = workspacesHook.workspaces[0].id;
      setSelectedWorkspaceId(first);
      onWorkspaceChange?.(first);
    }
  }, [workspacesHook.workspaces, selectedWorkspaceId, onWorkspaceChange]);

  const handleWorkspaceChange = useCallback(
    (wsId: string | null) => {
      setSelectedWorkspaceId(wsId);
      onWorkspaceChange?.(wsId);
      setShowWorkspaceDropdown(false);
    },
    [onWorkspaceChange],
  );

  // Load specialists
  useEffect(() => {
    desktopAwareFetch("/api/specialists")
      .then((r) => r.ok ? r.json() : { specialists: [] })
      .then((data) => setSpecialists(data.specialists ?? []))
      .catch(() => {});
  }, []);

  // Close specialist dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (specialistDropdownRef.current && !specialistDropdownRef.current.contains(e.target as Node)) {
        setShowSpecialistDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Auto-connect ACP
  useEffect(() => {
    if (!acp.connected && !acp.loading) {
      acp.connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acp.connected, acp.loading]);

  // Load repo skills when selection changes
  useEffect(() => {
    if (repoSelection?.path) {
      skillsHook.loadRepoSkills(repoSelection.path);
    } else {
      skillsHook.clearRepoSkills();
    }
    // Only depend on the path, not the entire skillsHook object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoSelection?.path]);

  useEffect(() => {
    repoSelectionRef.current = repoSelection;
  }, [repoSelection]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const nextPaths = await collectAccessibleRepoPaths(codebases.map((codebase) => codebase.repoPath));
      if (!cancelled) {
        setAccessibleCodebasePaths(nextPaths);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [codebases]);

  // Auto-select default codebase
  useEffect(() => {
    const validCodebases = codebases.filter((codebase) => accessibleCodebasePaths.has(codebase.repoPath));
    if (validCodebases.length === 0) {
      if (repoSelectionRef.current && codebases.some((codebase) => codebase.repoPath === repoSelectionRef.current?.path)) {
        repoSelectionRef.current = null;
        setRepoSelection(null);
      }
      return;
    }

    const def = validCodebases.find((c) => c.isDefault) ?? validCodebases[0];
    const nextSelection = {
      path: def.repoPath,
      branch: def.branch ?? "",
      name: def.label ?? def.repoPath.split("/").pop() ?? "",
    };
    repoSelectionRef.current = nextSelection;
    setRepoSelection(nextSelection);
  }, [accessibleCodebasePaths, codebases]);

  const handleRepoSelectionChange = useCallback((selection: RepoSelection | null) => {
    repoSelectionRef.current = selection;
    setRepoSelection(selection);
  }, []);

  // Handle external pending skill from grid
  useEffect(() => {
    if (externalPendingSkill) {
      setPendingSkill(externalPendingSkill);
      onExternalSkillConsumed?.();
    }
  }, [externalPendingSkill, onExternalSkillConsumed]);

  // Click outside to close workspace dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wsDropdownRef.current && !wsDropdownRef.current.contains(e.target as Node)) {
        setShowWorkspaceDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Options for the composer picker; one cached request per provider.
  const pickerProviderId = acp.selectedProvider?.trim() ?? "";
  const modelEffortChoicesByProvider = useModelEffortChoices(pickerProviderId ? [pickerProviderId] : []);
  const pickerChoices = pickerProviderId ? modelEffortChoicesByProvider[pickerProviderId] : undefined;
  const showModelEffortPicker = Boolean(
    pickerChoices && (pickerChoices.models.length > 0 || pickerChoices.reasoningEfforts.length > 0),
  );
  // Model ids are provider-specific: switching provider resets the pick to default
  // (adjust-state-on-prop-change pattern, so the reset lands in the same render).
  const [pickerProviderSeen, setPickerProviderSeen] = useState(pickerProviderId);
  if (pickerProviderSeen !== pickerProviderId) {
    setPickerProviderSeen(pickerProviderId);
    setPickedModelEffort({ model: "", reasoningEffort: "" });
  }
  const pickedModel = showModelEffortPicker ? pickedModelEffort.model : "";
  const pickedEffort = showModelEffortPicker ? pickedModelEffort.reasoningEffort : "";

  const handleSend = useCallback(
    async (text: string, context: InputContext) => {
      if (!text.trim() || !acp.connected) return;
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setIsSubmitting(true);

      try {
        const idempotencyKey = `home-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const wsId = selectedWorkspaceId ?? undefined;
        const effectiveRepoSelection = repoSelectionRef.current;
        const effectiveCwd = context.cwd ?? effectiveRepoSelection?.path;
        if (effectiveRequireRepoSelection && !effectiveCwd) {
          return;
        }
        const effectiveSpecialistId = resolveHomeInputSpecialistId({
          lockedSpecialistId: effectiveLockedSpecialistId,
          allowCustomSpecialist,
          selectedSpecialistId,
        });
        const selectedSpec = effectiveSpecialistId ? specialists.find((s) => s.id === effectiveSpecialistId) : undefined;
        const effectiveProvider = context.provider ?? selectedSpec?.defaultProvider ?? acp.selectedProvider;
        const conn = loadProviderConnectionConfig(effectiveProvider);
        // Picker choice ranks after the legacy toolbar model and before the specialist/connection default.
        const modelAliasOrName = context.model ?? (pickedModel || undefined) ?? selectedSpec?.model ?? conn.model;
        const def = modelAliasOrName ? getModelDefinitionByAlias(modelAliasOrName) : undefined;
        // When a custom specialist is selected, use the specialist's role
        const effectiveRole = activeSessionConfig?.role ?? (selectedSpec?.role as typeof selectedRole) ?? selectedRole;
        const resolvedSystemPrompt = typeof activeSessionConfig?.systemPrompt === "function"
          ? activeSessionConfig.systemPrompt(text)
          : activeSessionConfig?.systemPrompt;
        const result = await acp.createSession(
          effectiveCwd,
          effectiveProvider,
          context.mode,
          effectiveRole,
          wsId,
          def ? def.modelName : modelAliasOrName,
          idempotencyKey,
          effectiveSpecialistId ?? undefined,
          undefined,
          def?.baseUrl ?? conn.baseUrl,
          def?.apiKey ?? conn.apiKey,
          effectiveRepoSelection?.branch,
          undefined,
          undefined,
          activeSessionConfig?.mcpProfile as Parameters<typeof acp.createSession>[14],
          resolvedSystemPrompt,
          undefined,
          undefined,
          undefined,
          pickedEffort || undefined,
        );

        if (result?.sessionId) {
          const promptText = context.skill ? `/${context.skill} ${text}` : text;
          const pendingPrompt = context.skill
            ? {
                text,
                skillName: context.skill,
                skillRepoPath: effectiveCwd,
              }
            : text;
          const url = effectiveBuildSessionUrl
            ? effectiveBuildSessionUrl(wsId ?? null, result.sessionId)
            : wsId
              ? `/workspace/${wsId}/sessions/${result.sessionId}`
              : `/workspace/${result.sessionId}`;
          if (effectiveDispatchMode === "direct-prompt") {
            void acp.promptSession(result.sessionId, promptText).catch((error) => {
              console.error("[HomeInput] Failed to send direct prompt:", error);
            });
          } else {
            storePendingPrompt(result.sessionId, pendingPrompt);
          }
          onSessionCreated?.(result.sessionId, promptText, {
            cwd: effectiveCwd,
            branch: effectiveRepoSelection?.branch,
            repoName: effectiveRepoSelection?.name,
          });
          if (url) {
            router.push(url);
          }
        }
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [acp, activeSessionConfig, allowCustomSpecialist, effectiveBuildSessionUrl, effectiveDispatchMode, effectiveLockedSpecialistId, effectiveRequireRepoSelection, pickedEffort, pickedModel, router, onSessionCreated, selectedRole, selectedSpecialistId, selectedWorkspaceId, specialists],
  );

  const activeWorkspace = workspacesHook.workspaces.find((w) => w.id === selectedWorkspaceId);
  const selectedSpecialist = effectiveSelectedSpecialistId
    ? specialists.find((s) => s.id === effectiveSelectedSpecialistId)
    : undefined;
  const specialistLocked = Boolean(effectiveLockedSpecialistId);
  const isHero = variant === "hero";
  const shellClass = isHero
    ? "relative rounded-[28px] border border-accent bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(239,246,255,0.98))] shadow-[0_34px_100px_-44px_rgba(37,99,235,0.28)] transition-colors group-focus-within:border-accent"
    : "relative rounded-2xl border border-default bg-surface shadow-sm transition-colors group-focus-within:border-attention";
  const shellGlowClass = isHero
    ? "absolute -inset-3 rounded-[34px] bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.24),transparent_42%),radial-gradient(circle_at_85%_30%,rgba(96,165,250,0.18),transparent_38%)] opacity-0 blur-2xl transition-opacity duration-500 pointer-events-none group-focus-within:opacity-100"
    : "absolute -inset-1 rounded-2xl bg-accent-subtle opacity-0 blur-xl transition-opacity duration-500 pointer-events-none group-focus-within:opacity-100";
  const bottomBarClass = isHero
    ? "flex flex-wrap items-center gap-1.5 overflow-visible rounded-b-[27px] border-t border-accent bg-accent-subtle px-3 py-2 backdrop-blur"
    : "flex flex-wrap items-center gap-1.5 overflow-visible border-t border-default px-3 py-2";
  const skillPillClass = isHero
    ? "group shrink-0 flex w-[160px] flex-col gap-0.5 rounded-xl border border-accent bg-surface px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:border-accent hover:bg-accent-subtle"
    : "group shrink-0 flex w-[140px] flex-col gap-0.5 rounded-lg border border-default bg-subtle px-2.5 py-2 text-left transition-all hover:border-attention hover:bg-surface";
  const showLaunchModeSelector = normalizedLaunchModes.length > 1;
  const fixedRoleLabel = selectedRole === "ROUTA" ? t.home.multiAgent : t.home.crafter;

  return (
    <div className={`w-full ${isHero ? "max-w-none" : "mx-auto max-w-2xl"}`}>
      {showLaunchModeSelector && (
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          {normalizedLaunchModes.map((mode) => {
            const isActive = mode.id === activeLaunchMode?.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setActiveLaunchModeId(mode.id)}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                  isActive
                    ? "border-default bg-accent text-on-accent shadow-sm"
                    : "border-default bg-surface text-primary hover:bg-surface"
                }`}
              >
                <div className={`text-[11px] font-semibold ${isActive ? "text-on-accent" : "text-secondary"}`}>
                  {mode.label}
                </div>
                <div className={`mt-1 text-[12px] leading-5 ${isActive ? "text-on-accent" : "text-secondary"}`}>
                  {mode.description}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Input container with ambient glow on focus */}
      <div className="group relative" id="home-input-container">
        {/* Glow effect */}
        <div className={shellGlowClass} />

        <div className={shellClass}>
          {/* TiptapInput */}
          <TiptapInput
            onSend={handleSend}
            placeholder={effectivePlaceholder}
            disabled={!acp.connected || isSubmitting || (effectiveRequireRepoSelection && !repoSelection?.path)}
            loading={isSubmitting}
            skills={skillsHook.skills}
            repoSkills={skillsHook.repoSkills}
            providers={acp.providers}
            selectedProvider={acp.selectedProvider}
            onProviderChange={acp.setProvider}
            repoSelection={repoSelection}
            onRepoChange={handleRepoSelectionChange}
            additionalRepos={codebases
              .filter((codebase) => accessibleCodebasePaths.has(codebase.repoPath))
              .map((codebase) => ({
              name: codebase.label ?? codebase.repoPath.split("/").pop() ?? codebase.repoPath,
              path: codebase.repoPath,
              branch: codebase.branch,
            }))}
            repoPathDisplay="hidden"
            agentRole={selectedRole}
            onFetchModels={acp.listProviderModels}
            pendingSkill={pendingSkill}
            onSkillInserted={() => setPendingSkill(null)}
            variant={variant}
            beforeProviderSlot={showModelEffortPicker ? (
              <ModelEffortPicker
                choices={pickerChoices}
                model={pickedModel}
                reasoningEffort={pickedEffort}
                onChange={setPickedModelEffort}
                disabled={!acp.connected || isSubmitting}
                emptyLabel={t.chat.sessionConfig.defaultModel}
                testIdPrefix="home-model-effort-picker"
              />
            ) : undefined}
          />

          {/* ─── Bottom Control Bar ─────────────────────────────────── */}
          <div className={bottomBarClass}>
            {effectiveSelectedSpecialistId ? (
              /* ── Specialist mode: show specialist pill as primary selector ── */
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 rounded-lg border border-attention bg-attention-subtle px-2.5 py-1 text-xs font-medium text-attention">
                  <CircleUser className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                  <span className="max-w-35 truncate">
                    {selectedSpecialist?.name ?? t.home.customSpecialist}
                  </span>
                  {!specialistLocked && (
                    <button
                      type="button"
                      onClick={() => setSelectedSpecialistId(null)}
                      className="ml-0.5 text-attention transition-colors hover:text-attention"
                      title="Switch to built-in role"
                      aria-label={t.common.clearSpecialist}
                    >
                      ×
                    </button>
                  )}
                </div>
                {!specialistLocked && allowCustomSpecialist && specialists.length > 1 && (
                  <div className="relative" ref={specialistDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setShowSpecialistDropdown((v) => !v)}
                      className="flex items-center gap-1 rounded-lg border border-transparent px-1.5 py-1 text-xs text-secondary transition-all hover:border-default hover:bg-hover"
                      title="Switch specialist"
                    >
                      <ChevronDown className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                    </button>
                    {showSpecialistDropdown && (
                      <div className="absolute bottom-full left-0 z-50 mb-1 w-52 overflow-hidden rounded-xl border border-default bg-surface shadow-xl">
                        <div className="p-1 max-h-48 overflow-y-auto">
                          {specialists.map((s) => (
                            <button key={s.id} onClick={() => { setSelectedSpecialistId(s.id); setShowSpecialistDropdown(false); }}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                                s.id === selectedSpecialistId ? "bg-attention-subtle text-attention" : "text-primary hover:bg-hover"
                              }`}>
                              <div className="font-medium truncate">{s.name}</div>
                              {s.description && <div className="text-[10px] text-secondary truncate mt-0.5">{s.description}</div>}
                              {s.defaultProvider && <div className="text-[10px] text-secondary mt-0.5 font-mono">provider:{s.defaultProvider}</div>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : !allowRoleSwitch ? (
              <div className="flex items-center gap-1.5 rounded-lg border border-default bg-subtle px-2.5 py-1 text-xs font-medium text-primary">
                <Zap className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}/>
                <span>{fixedRoleLabel}</span>
              </div>
            ) : (
              /* ── Built-in role mode: segmented toggle + optional specialist picker ── */
              <>
                <div className="flex items-center gap-0.5 rounded-[18px] border border-accent bg-surface p-1 shadow-[0_10px_28px_-22px_rgba(37,99,235,0.42)]" role="group" aria-label={t.common.agentMode}>
                  <button type="button" onClick={() => setSelectedRole("ROUTA")}
                    title="Multi-agent orchestration — spawns specialized agents for complex multi-step tasks (Routa)"
                    className={`flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-xs font-medium transition-all ${
                      selectedRole === "ROUTA"
                        ? "bg-accent text-on-accent shadow-[0_14px_26px_-18px_rgba(37,99,235,0.68)]"
                        : "text-secondary hover:bg-accent-subtle hover:text-primary"
                    }`}>
                    <Sun className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={selectedRole === "ROUTA" ? 2.5 : 2}/>
                    {t.home.multiAgent}
                  </button>
                  <button type="button" onClick={() => setSelectedRole("CRAFTER")}
                    title="Single-agent implementation — best for focused coding tasks (Crafter)"
                    className={`flex items-center gap-1.5 rounded-[14px] px-3 py-1.5 text-xs font-medium transition-all ${
                      selectedRole === "CRAFTER"
                        ? "bg-attention text-on-accent shadow-[0_14px_26px_-18px_rgba(245,158,11,0.65)]"
                        : "text-secondary hover:bg-attention-subtle hover:text-primary"
                    }`}>
                    <Zap className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={selectedRole === "CRAFTER" ? 2.5 : 2}/>
                    {t.home.crafter}
                  </button>
                </div>

                {/* Custom Specialist — shown as an additive option when specialists exist */}
                {allowCustomSpecialist && specialists.length > 0 && (
                  <>
                    <div className="h-4 w-px bg-default" />
                    <div className="relative" ref={specialistDropdownRef}>
                      <button type="button" onClick={() => setShowSpecialistDropdown((v) => !v)}
                        className="flex items-center gap-1.5 rounded-lg border border-dashed border-default px-2 py-1 text-xs text-secondary transition-all hover:border-attention hover:bg-hover hover:text-attention"
                        title="Use a custom specialist instead">
                        <CircleUser className="w-3.5 h-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                        Custom
                        <ChevronDown className="w-2.5 h-2.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                      </button>
                      {showSpecialistDropdown && (
                        <div className="absolute bottom-full left-0 z-50 mb-1 w-56 overflow-hidden rounded-xl border border-default bg-surface shadow-xl">
                          <div className="px-2 pt-2 pb-1">
                            <p className="mb-1 px-1 text-[10px] font-semibold text-secondary">{t.settings.specialists}</p>
                          </div>
                          <div className="max-h-48 overflow-y-auto border-t border-default p-1">
                            {specialists.map((s) => (
                              <button key={s.id} onClick={() => { setSelectedSpecialistId(s.id); setShowSpecialistDropdown(false); }}
                                className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary transition-colors hover:bg-attention-subtle hover:text-attention">
                                <div className="font-medium truncate">{s.name}</div>
                                {s.description && <div className="text-[10px] text-secondary truncate mt-0.5">{s.description}</div>}
                                {s.role && <div className="text-[10px] text-secondary mt-0.5 font-mono">{s.role}</div>}
                                {s.defaultProvider && <div className="text-[10px] text-secondary mt-0.5 font-mono">provider:{s.defaultProvider}</div>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {/* Workspace Pill */}
            {workspacesHook.workspaces.length > 0 && (
              <div className="relative" ref={wsDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowWorkspaceDropdown((v) => !v)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-secondary hover:bg-hover border border-transparent hover:border-default transition-all"
                >
                  <Folder className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                  <span className="max-w-30 truncate">
                    {activeWorkspace?.title ?? t.workspace.workspaces}
                  </span>
                  <ChevronDown className="w-2.5 h-2.5 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                </button>

                {showWorkspaceDropdown && (
                  <div className="absolute bottom-full left-0 mb-1 w-52 rounded-xl border border-default bg-surface shadow-xl z-50 overflow-hidden">
                    <div className="p-1 max-h-48 overflow-y-auto">
                      {workspacesHook.workspaces.map((ws) => (
                        <button
                          key={ws.id}
                          onClick={() => handleWorkspaceChange(ws.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${
                            ws.id === selectedWorkspaceId
                              ? "bg-attention-subtle text-attention"
                              : "text-primary hover:bg-hover"
                          }`}
                        >
                          <Folder className="w-3.5 h-3.5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}/>
                          {ws.title}
                          {ws.id === selectedWorkspaceId && (
                            <Check className="w-3.5 h-3.5 ml-auto text-attention" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Spacer */}
            <div className="hidden flex-1 sm:block" />

            {/* Keyboard hint */}
            <span className="hidden sm:inline text-[11px] text-secondary">
              <kbd className="px-1 py-0.5 rounded bg-subtle font-mono text-[10px]">
                ⏎
              </kbd>{" "}
              send
            </span>
          </div>
        </div>
      </div>

      {/* ─── Mode Tips ──────────────────────────────────────────────── */}
      <div className="mt-1.5 min-h-5 px-1">
        {repoSelection?.path && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] text-secondary">
            <span className="font-medium text-secondary">
              {t.home.repoPath}
            </span>
            <span className="font-mono truncate" title={repoSelection.path}>
              {repoSelection.path}
            </span>
          </div>
        )}
        {effectiveFooterMetaMode === "default" && activeLaunchMode?.description ? (
          <div className="flex items-center gap-1.5 text-[10px] text-secondary">
            <span className="flex h-2 w-2 items-center justify-center rounded-full bg-default">
              <span className="h-1 w-1 rounded-full bg-secondary" />
            </span>
            <span>{activeLaunchMode.description}</span>
          </div>
        ) : effectiveFooterMetaMode === "default" && effectiveSelectedSpecialistId ? (
          (() => {
            const spec = selectedSpecialist;
            return (
              <div className="flex items-center gap-1.5 text-[10px] text-secondary">
                <span className="flex h-2 w-2 items-center justify-center rounded-full bg-attention-subtle">
                  <span className="h-1 w-1 rounded-full bg-attention" />
                </span>
                <span className="font-medium text-attention">{spec?.name}</span>
                {spec?.role && <><span className="text-secondary">·</span><span className="font-mono text-[9px]">{spec.role}</span></>}
              </div>
            );
          })()
        ) : effectiveFooterMetaMode === "default" && selectedRole === "ROUTA" ? (
          <div className="flex items-center gap-1.5 text-[10px] text-secondary">
            <span className="w-2 h-2 rounded-full bg-attention-subtle flex items-center justify-center">
              <span className="h-1 w-1 rounded-full bg-attention" />
            </span>
            <span>{t.home.multiAgentDesc}</span>
          </div>
        ) : effectiveFooterMetaMode === "default" ? (
          <div className="flex items-center gap-1.5 text-[10px] text-secondary">
            <span className="flex h-2 w-2 items-center justify-center rounded-full bg-default">
              <span className="h-1 w-1 rounded-full bg-secondary" />
            </span>
            <span>{t.home.directDesc}</span>
          </div>
        ) : null}
      </div>

      {/* ─── Skills — horizontal scroll row ─────────────────────── */}
      {displaySkills && displaySkills.length > 0 && (
        <div className="mt-2 -mx-0.5">
          <div className="flex gap-1.5 overflow-x-auto pb-0 scrollbar-none" style={{ scrollbarWidth: "none" }}>
            {displaySkills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                onClick={() => setPendingSkill(skill.name)}
                className={skillPillClass}
              >
                <span className={`text-[11px] font-mono font-medium transition-colors truncate ${
                  isHero
                    ? "text-secondary group-hover:text-information"
                    : "text-secondary group-hover:text-attention"
                }`}>
                  /{skill.name}
                </span>
                {skill.description && (
                  <span className={`text-[10px] leading-snug line-clamp-1 ${
                    isHero ? "text-secondary" : "text-secondary"
                  }`}>
                    {skill.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Docker Config Modal ──────────────────────────────────── */}
      <DockerConfigModal
        open={!!acp.dockerConfigError}
        errorMessage={acp.dockerConfigError ?? ""}
        onClose={() => acp.clearDockerConfigError()}
        onSaved={() => {
          acp.clearDockerConfigError();
          // Input text is still in TiptapInput — user can re-submit
        }}
      />
    </div>
  );
}
