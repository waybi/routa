"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { desktopAwareFetch } from "../utils/diagnostics";
import { GitHubWebhookPanel } from "./github-webhook-panel";
import { AgentInstallPanel } from "./agent-install-panel";
import { SettingsFrame } from "./settings-route-shell";
import { SettingsPageHeader } from "./settings-page-header";
import { SettingsOverviewCards } from "./settings-overview-cards";
import { Tabs } from "./ui/tabs";
import {
  loadCustomAcpProviders,
  saveCustomAcpProviders,
  loadHiddenProviders,
  saveHiddenProviders,
  type CustomAcpProvider,
} from "../utils/custom-acp-providers";
import { ModelsTab } from "./settings-panel-models-tab";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeSwitcher } from "./theme-switcher";
import {
  clearOnboardingState,
  ONBOARDING_COMPLETED_KEY,
} from "../utils/onboarding";
import { useTranslation } from "@/i18n";
import { Select } from "./select";
import {
  AGENT_ROLES,
  ROLE_DESCRIPTIONS,
  SETTINGS_PANEL_HEIGHT,
  inputCls,
  isCustomProvider,
  labelCls,
  loadDefaultProviders,
  loadModelDefinitions,
  saveDefaultProviders,
  sectionHeadCls,
  settingsCardCls,
  type AgentModelConfig,
  type AgentRoleKey,
  type DefaultProviderSettings,
  type MemoryResponse,
  type ModelDefinition,
  type ProviderOption,
  type SettingsPanelProps,
  type SettingsTab,
} from "./settings-panel-shared";
import { ArrowLeft, RefreshCw, Settings, TriangleAlert, X, Package } from "lucide-react";

export {
  getModelDefinitionByAlias,
  loadDefaultProviders,
  loadModelDefinitions,
  loadProviderConnectionConfig,
  loadProviderConnections,
  saveDefaultProviders,
  saveModelDefinitions,
  saveProviderConnections,
} from "./settings-panel-shared";
export type {
  AgentModelConfig,
  DefaultProviderSettings,
  ModelDefinition,
  ProviderConnectionConfig,
  ProviderConnectionsStorage,
  SettingsPanelProps,
} from "./settings-panel-shared";

function OnboardingSettingsSection({ onResetOnboarding, onClose }: { onResetOnboarding?: () => void; onClose?: () => void }) {
  const { t } = useTranslation();
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === "true";
  });

  const handleReset = useCallback(() => {
    if (typeof window !== "undefined") {
      clearOnboardingState(window.localStorage);
    }
    setHasCompletedOnboarding(false);
    onResetOnboarding?.();
    onClose?.();
  }, [onResetOnboarding, onClose]);

  return (
    <div className={settingsCardCls}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={sectionHeadCls}>{t.settings.onboardingSection.title}</p>
          <p className="mt-1 text-[10px] text-secondary">
            {t.settings.onboardingSection.description}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
          hasCompletedOnboarding
            ? "bg-success-subtle text-success"
            : "bg-attention-subtle text-attention"
        }`}>
          {hasCompletedOnboarding ? t.settings.onboardingSection.completed : t.settings.onboardingSection.available}
        </span>
      </div>
      <div className="mt-3 flex justify-start">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-md border border-default px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-hover"
        >
          {t.settings.onboardingSection.showAgain}
        </button>
      </div>
    </div>
  );
}

// ─── System Info Footer ─────────────────────────────────────────────────────
function SystemInfoFooter() {
  const { t } = useTranslation();
  const [memoryStats, setMemoryStats] = useState<MemoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await desktopAwareFetch("/api/system/memory?history=true");
      if (res.ok) {
        const data = await res.json();
        if (data?.current && typeof data.current.level === "string") {
          setMemoryStats(data);
        }
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="border-t border-default shrink-0">
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-[11px] text-secondary">
        <div className="flex min-w-0 items-center gap-3 overflow-hidden">
          <span className="shrink-0 font-medium">{t.settings.systemInfo}</span>
          {memoryStats?.current ? (
            <>
              <span className="truncate">
                {t.settings.memory} {memoryStats.current.heapUsedMB}/{memoryStats.current.heapTotalMB} MB
              </span>
              <span className="truncate">
                {t.settings.sessions} {memoryStats.sessionStore.sessionCount}
              </span>
              <span className={`shrink-0 ${
                memoryStats.current.level === "critical"
                  ? "text-danger"
                  : memoryStats.current.level === "warning"
                    ? "text-attention"
                    : "text-success"
              }`}>
                {memoryStats.current.level}
              </span>
            </>
          ) : (
            <span>{loading ? t.common.loading : t.common.unavailable}</span>
          )}
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="shrink-0 rounded-md p-1 text-secondary transition-colors hover:bg-hover hover:text-primary disabled:opacity-50"
          title={t.settings.refreshSystemInfo}
          type="button"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
        </button>
      </div>
    </div>
  );
}

function RolesTab({
  settings,
  modelDefs,
  builtinProviders,
  customProviders,
  registryProviders,
  onChange,
  onOpenModelsTab,
}: {
  settings: DefaultProviderSettings;
  modelDefs: ModelDefinition[];
  builtinProviders: ProviderOption[];
  customProviders: ProviderOption[];
  registryProviders: ProviderOption[];
  onChange: (role: AgentRoleKey, field: "provider" | "model", value: string) => void;
  onOpenModelsTab: () => void;
}) {
  const { t } = useTranslation();
  const datalistId = useId();

  return (
    <div className="px-4 py-4 space-y-4 overflow-y-auto h-full">
      <div className={settingsCardCls}>
        <p className={sectionHeadCls}>Role Defaults</p>
        <p className="mt-1 text-[10px] text-secondary">
          Configure default provider and model override per Routa role. ROUTA-specific settings live here instead of the Providers tab.
        </p>
        <div className="mt-4 flex items-center gap-3 mb-2">
          <div className="w-[90px]" />
          <div className="w-[180px] text-[10px] font-semibold text-secondary">Provider</div>
          <div className="flex-1 text-[10px] font-semibold text-secondary">Model Override</div>
        </div>
        <div className="space-y-2.5">
          {AGENT_ROLES.map((role) => (
            <div key={role} className="flex items-center gap-3">
              <div className="w-[90px] shrink-0">
                <div className="text-xs font-medium text-primary">{role}</div>
                <div className="text-[10px] text-secondary leading-tight">{ROLE_DESCRIPTIONS[role]}</div>
              </div>
              <Select
                value={settings[role]?.provider ?? ""}
                onChange={(event) => onChange(role, "provider", event.target.value)}
                className="w-[180px] shrink-0 text-xs px-2 py-1.5 rounded-md border border-default bg-surface text-primary focus:ring-1 focus:ring-accent focus:outline-none"
              >
                <option value="">Auto</option>
                {builtinProviders.length > 0 && (
                  <optgroup label="Built-in">
                    {builtinProviders.map((provider) => (
                      <option
                        key={provider.id}
                        value={provider.id}
                        disabled={provider.status !== "available"}
                      >
                        {provider.name}{provider.status === "available" ? "" : " (unavailable)"}
                      </option>
                    ))}
                  </optgroup>
                )}
                {customProviders.length > 0 && (
                  <optgroup label={t.settings.customProvider}>
                    {customProviders.map((provider) => (
                      <option
                        key={provider.id}
                        value={provider.id}
                        disabled={provider.status !== "available"}
                      >
                        {provider.name}{provider.status === "available" ? "" : " (unavailable)"}
                      </option>
                    ))}
                  </optgroup>
                )}
                {registryProviders.length > 0 && (
                  <optgroup label="Agent 注册中心（ACP）">
                    {registryProviders.map((provider) => (
                      <option
                        key={provider.id}
                        value={provider.id}
                        disabled={provider.status !== "available"}
                      >
                        {provider.name}{provider.status === "available" ? "" : ` (${provider.status ?? "unavailable"})`}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Select>
              <input
                type="text"
                list={datalistId}
                value={settings[role]?.model ?? ""}
                onChange={(event) => onChange(role, "model", event.target.value)}
                placeholder={modelDefs.length > 0 ? "select alias or type model" : "e.g. claude-3-5-haiku"}
                className="flex-1 text-xs px-2 py-1.5 rounded-md border border-default bg-surface text-primary placeholder:text-secondary focus:ring-1 focus:ring-accent focus:outline-none font-mono"
              />
            </div>
          ))}
        </div>
        <datalist id={datalistId}>
          {modelDefs.map((definition) => (
            <option key={definition.alias} value={definition.alias} label={`${definition.alias} → ${definition.modelName}`} />
          ))}
        </datalist>
        <p className="mt-4 text-[10px] text-secondary">
          Leave model blank to use the provider default. Type a model alias from the{" "}
          <button onClick={onOpenModelsTab} className="text-accent hover:underline">Models tab</button>
          {" "}to use custom connection details.
        </p>
      </div>
    </div>
  );
}

// ─── Custom ACP Providers Section ────────────────────────────────────────────

interface CustomProviderForm {
  id: string;
  name: string;
  command: string;
  args: string;
  description: string;
}

const EMPTY_CUSTOM_PROVIDER_FORM: CustomProviderForm = {
  id: "", name: "", command: "", args: "", description: "",
};

function CustomAcpProvidersSection() {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<CustomAcpProvider[]>(() => loadCustomAcpProviders());
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CustomProviderForm>(EMPTY_CUSTOM_PROVIDER_FORM);
  const [error, setError] = useState<string | null>(null);

  const handleSave = () => {
    setError(null);
    const name = form.name.trim();
    const command = form.command.trim();
    if (!name) { setError(t.settings.nameRequired); return; }
    if (!command) { setError(t.settings.commandRequired); return; }

    const args = form.args
      .split(/\s+/)
      .map((a) => a.trim())
      .filter(Boolean);

    const id = editingId ?? `custom-${crypto.randomUUID()}`;
    const entry: CustomAcpProvider = {
      id,
      name,
      command,
      args,
      description: form.description.trim() || undefined,
    };

    const next = editingId
      ? providers.map((p) => (p.id === editingId ? entry : p))
      : [...providers, entry];

    saveCustomAcpProviders(next);
    setProviders(next);
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_CUSTOM_PROVIDER_FORM);
  };

  const handleEdit = (p: CustomAcpProvider) => {
    setEditingId(p.id);
    setForm({
      id: p.id,
      name: p.name,
      command: p.command,
      args: p.args.join(" "),
      description: p.description ?? "",
    });
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    const next = providers.filter((p) => p.id !== id);
    saveCustomAcpProviders(next);
    setProviders(next);
  };

  return (
    <div className={settingsCardCls}>
      <div className="flex items-center justify-between mb-2">
        <p className={sectionHeadCls}>Custom Providers</p>
        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setEditingId(null); setForm(EMPTY_CUSTOM_PROVIDER_FORM); }}
            className="text-xs text-accent hover:underline"
          >
            + {t.common.add}
          </button>
        )}
      </div>
      <p className="text-[10px] text-secondary mb-3">
        Define your own ACP-compliant agent with a custom command and args.
      </p>

      {error && (
        <p className="text-xs text-danger mb-2">{error}</p>
      )}

      {showForm && (
        <div className="mb-3 p-3 rounded-lg bg-subtle border border-default space-y-2">
          <p className={sectionHeadCls}>{editingId ? "Edit Provider" : "New Provider"}</p>
          <div>
            <label className={labelCls}>Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="My Agent"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Command *</label>
            <input
              value={form.command}
              onChange={(e) => setForm({ ...form, command: e.target.value })}
              placeholder="my-agent-cli"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Args (space-separated, no quoted spaces)</label>
            <input
              value={form.args}
              onChange={(e) => setForm({ ...form, args: e.target.value })}
              placeholder="--acp"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t.settings.optionalDescription}
              className={inputCls}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs font-medium text-on-accent bg-accent hover:opacity-90 rounded-md"
            >
              {editingId ? t.common.save : t.common.add}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditingId(null); setForm(EMPTY_CUSTOM_PROVIDER_FORM); setError(null); }}
              className="px-3 py-1.5 text-xs font-medium text-secondary border border-default rounded-md hover:bg-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {providers.length === 0 && !showForm ? (
        <p className="text-xs text-secondary italic">No custom providers yet.</p>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between px-3 py-2 rounded-lg border border-default bg-surface"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-primary truncate">{p.name}</p>
                <p className="text-[10px] text-secondary font-mono truncate">
                  {p.command} {p.args.join(" ")}
                </p>
              </div>
              <div className="flex gap-1 ml-2 shrink-0">
                <button
                  onClick={() => handleEdit(p)}
                  className="px-2 py-1 text-[10px] text-secondary hover:text-primary border border-default rounded"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  className="px-2 py-1 text-[10px] text-danger hover:opacity-80 border border-danger rounded"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Provider Catalog Section ────────────────────────────────────────────────

interface ProviderCatalogSectionProps {
  allProviders: ProviderOption[];
}

function ProviderCatalogSection({ allProviders }: ProviderCatalogSectionProps) {
  const { t } = useTranslation();
  const [hiddenProviderIds, setHiddenProviderIds] = useState<string[]>(() => loadHiddenProviders());

  const handleToggle = (providerId: string) => {
    const nextHiddenProviderIds = hiddenProviderIds.includes(providerId)
      ? hiddenProviderIds.filter((id) => id !== providerId)
      : [...hiddenProviderIds, providerId];

    setHiddenProviderIds(nextHiddenProviderIds);
    saveHiddenProviders(nextHiddenProviderIds);

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("routa:providers-changed"));
    }
  };

  return (
    <div className={settingsCardCls}>
      <div>
        <p className={sectionHeadCls}>Provider Catalog</p>
        <p className="text-[10px] text-secondary mb-3">
          Built-in, Agent 注册中心（ACP）, and custom providers are listed together here. Hide a provider to remove it from app pickers without deleting its configuration.
        </p>
      </div>

      {allProviders.length === 0 ? (
        <p className="text-xs text-secondary italic">No providers available.</p>
      ) : (
        <div className="space-y-2">
          {allProviders.map((provider) => {
            const isHidden = hiddenProviderIds.includes(provider.id);
            return (
              <div
                key={provider.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg border border-default bg-surface"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={!isHidden}
                    onChange={() => handleToggle(provider.id)}
                    className="w-4 h-4 rounded border-default text-accent focus:ring-accent focus:ring-offset-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-medium text-primary truncate">
                        {provider.name}
                      </p>
                      <span className="rounded-full bg-subtle px-1.5 py-0.5 text-[9px] font-medium text-secondary">
                        {provider.source === "registry" ? t.settings.registry : isCustomProvider(provider) ? t.settings.customProvider : t.settings.builtIn}
                      </span>
                    </div>
                    <p className="text-[10px] text-secondary font-mono truncate">
                      {provider.id}{provider.command ? ` · ${provider.command}` : ""}
                    </p>
                  </div>
                </div>
                <div className="ml-2 flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-secondary">
                    {isHidden ? t.settings.hidden : t.settings.shown}
                  </span>
                  {provider.status && (
                    <span
                      className={`px-2 py-0.5 text-[10px] rounded ${
                        provider.status === "available"
                          ? "bg-success-subtle text-success"
                          : provider.status === "checking"
                            ? "bg-attention-subtle text-attention"
                            : "bg-subtle text-secondary"
                      }`}
                    >
                      {provider.status}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hiddenProviderIds.length > 0 && (
        <div className="mt-3 p-2.5 rounded-lg bg-attention-subtle border border-attention">
          <div className="flex items-start gap-2">
            <TriangleAlert className="w-3.5 h-3.5 text-attention mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            <span className="text-[11px] text-attention">
              {hiddenProviderIds.length} provider{hiddenProviderIds.length > 1 ? "s are" : " is"} hidden from provider pickers.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function WebhooksTab() {
  const { t } = useTranslation();
  const [showFullPanel, setShowFullPanel] = useState(false);
  const isTauriEnv = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  // In Tauri, show the full panel directly
  if (isTauriEnv && showFullPanel) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-default">
          <h3 className="text-sm font-semibold text-primary">
            GitHub Webhook Triggers
          </h3>
          <button
            onClick={() => setShowFullPanel(false)}
            className="p-1.5 rounded-md hover:bg-hover text-secondary hover:text-primary transition-colors"
            title={t.settings.backToOverview}
          >
            <ArrowLeft className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <GitHubWebhookPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-primary mb-1">
          GitHub Webhook Triggers
        </h3>
        <p className="text-xs text-secondary mb-3">
          Automatically trigger agents (Claude Code, GLM-4, etc.) when GitHub events occur
          — issue created, PR opened, CI completed, and more.
        </p>
        <div className="rounded-lg bg-accent-subtle border border-accent px-3 py-2.5 mb-3">
          <p className="text-xs text-accent">
            <span className="font-semibold">Webhook URL:</span>{" "}
            <code className="font-mono bg-accent-subtle px-1 rounded">
              {typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/github
            </code>
          </p>
          <p className="text-xs text-accent mt-1">
            Point your GitHub repository webhook at this URL to start receiving events.
          </p>
        </div>
        {isTauriEnv ? (
          <button
            onClick={() => setShowFullPanel(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-accent text-on-accent text-xs font-medium rounded-lg hover:opacity-90 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Manage Webhook Triggers
          </button>
        ) : (
          <a
            href="/settings/webhooks"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-accent text-on-accent text-xs font-medium rounded-lg hover:opacity-90 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Manage Webhook Triggers
          </a>
        )}
      </div>
    </div>
  );
}

// ─── Docker OpenCode auth.json storage key ────────────────────────────────────
const DOCKER_OPENCODE_AUTH_JSON_KEY = "docker-opencode-auth-json";

/** Load saved Docker OpenCode auth.json from localStorage. */
export function loadDockerOpencodeAuthJson(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(DOCKER_OPENCODE_AUTH_JSON_KEY) ?? "";
}

/** Save Docker OpenCode auth.json to localStorage. */
export function saveDockerOpencodeAuthJson(json: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DOCKER_OPENCODE_AUTH_JSON_KEY, json);
}

const EXAMPLE_AUTH_JSON = `{
  "zai": {
    "type": "api",
    "key": "your-api-key-here"
  }
}`;

// ─── Docker OpenCode Config Section ───────────────────────────────────────────
function DockerOpenCodeSection({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation();
  const [authJson, setAuthJson] = useState(() => loadDockerOpencodeAuthJson());
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback((value: string) => {
    if (value.trim()) {
      try {
        JSON.parse(value);
        setError(null);
      } catch {
        setError("Invalid JSON format");
        return;
      }
    } else {
      setError(null);
    }
    saveDockerOpencodeAuthJson(value);
  }, []);

  return (
    <div className={`space-y-2 ${embedded ? "" : "rounded-lg border border-default p-3"}`}>
      {!embedded && (
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          <span className="text-xs font-semibold text-primary">Docker OpenCode</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-subtle text-accent">auth.json</span>
        </div>
      )}
      <p className="text-[11px] text-secondary">
        Paste your <code className="bg-subtle px-1 rounded">~/.local/share/opencode/auth.json</code> here.
        This config will be mounted into the Docker container.
      </p>
      <textarea
        value={authJson}
        onChange={(e) => setAuthJson(e.target.value)}
        placeholder={EXAMPLE_AUTH_JSON}
        rows={5}
        className="w-full text-xs px-2 py-1.5 rounded-md border border-default bg-surface text-primary placeholder:text-secondary focus:ring-1 focus:ring-accent focus:outline-none font-mono resize-y"
      />
      {error && <p className="text-[10px] text-danger">{error}</p>}
      <button
        onClick={() => handleSave(authJson)}
        className="px-2.5 py-1.5 text-xs font-medium rounded-md bg-accent text-on-accent hover:opacity-90 transition-colors"
      >
        {t.common.save}
      </button>
    </div>
  );
}

// ─── Docker Config Modal (shown on session failure) ────────────────────────
export interface DockerConfigModalProps {
  open: boolean;
  errorMessage: string;
  onClose: () => void;
  /** Called after the auth.json is saved; parent can use this to retry */
  onSaved: (authJson: string) => void;
}

export function DockerConfigModal(props: DockerConfigModalProps) {
  if (!props.open) return null;
  return <DockerConfigModalContent {...props} />;
}

function DockerConfigModalContent({ open: _open, errorMessage, onClose, onSaved }: DockerConfigModalProps) {
  const [authJson, setAuthJson] = useState(() => loadDockerOpencodeAuthJson());
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(() => {
    if (authJson.trim()) {
      try {
        JSON.parse(authJson);
        setError(null);
      } catch {
        setError("Invalid JSON format");
        return;
      }
    }
    saveDockerOpencodeAuthJson(authJson);
    onSaved(authJson);
  }, [authJson, onSaved]);

  // Simplify the error message for display
  const displayError = errorMessage
    .replace(/^Failed to create docker OpenCode session:\s*/i, "")
    .replace(/^Failed to start Docker container:\s*/i, "")
    .trim();

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-surface rounded-xl shadow-2xl w-full max-w-md mx-4 border border-default overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-default">
          <div className="flex items-center gap-2">
            <TriangleAlert className="w-4 h-4 text-attention" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            <h3 className="text-sm font-semibold text-primary">Docker OpenCode — Configuration Required</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-hover text-secondary hover:text-primary">
            <X className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        </div>
        {/* Body */}
        <div className="px-4 py-4 space-y-3">
          {displayError && (
            <div className="p-2.5 rounded-md bg-danger-subtle border border-danger">
              <p className="text-xs text-danger font-mono break-all">{displayError}</p>
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs font-medium text-primary">OpenCode auth.json</label>
            <p className="text-[10px] text-secondary">
              Paste your local <code className="bg-subtle px-1 rounded">~/.local/share/opencode/auth.json</code> here.
            </p>
            <textarea
              value={authJson}
              onChange={(e) => setAuthJson(e.target.value)}
              placeholder={EXAMPLE_AUTH_JSON}
              rows={6}
              autoFocus
              className="w-full text-xs px-2 py-1.5 rounded-md border border-default bg-surface text-primary placeholder:text-secondary focus:ring-1 focus:ring-accent focus:outline-none font-mono resize-y"
            />
            {error && <p className="text-[10px] text-danger">{error}</p>}
          </div>
        </div>
        {/* Footer */}
        <div className="px-4 py-3 border-t border-default flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium rounded-md border border-default text-primary hover:bg-hover transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!authJson.trim()}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-on-accent hover:opacity-90 disabled:opacity-40 transition-colors"
          >
            Save & Retry
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Settings Panel ───────────────────────────────────────────────────
export function SettingsPanel({ open, onClose, providers, initialTab, onResetOnboarding, variant = "modal" }: SettingsPanelProps) {
  if (!open) return null;
  return <SettingsPanelContent onClose={onClose} providers={providers} initialTab={initialTab} onResetOnboarding={onResetOnboarding} variant={variant} />;
}

function SettingsPanelContent({ onClose, providers, initialTab, onResetOnboarding, variant = "modal" }: Omit<SettingsPanelProps, "open">) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DefaultProviderSettings>(() => loadDefaultProviders());
  const [modelDefs, setModelDefs] = useState<ModelDefinition[]>(() => loadModelDefinitions());
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => initialTab ?? "providers");
  const isPageVariant = variant === "page";

  const handleChange = useCallback(
    (role: AgentRoleKey, field: "provider" | "model", value: string) => {
      const current: AgentModelConfig = settings[role] ?? {};
      const updated: AgentModelConfig = { ...current, [field]: value || undefined };
      const isEmpty = !updated.provider && !updated.model;
      const next: DefaultProviderSettings = { ...settings, [role]: isEmpty ? undefined : updated };
      setSettings(next);
      saveDefaultProviders(next);
    },
    [settings],
  );

  const builtinProviders = providers.filter((provider) => provider.source !== "registry" && !isCustomProvider(provider));
  const customProviders = providers.filter((provider) => isCustomProvider(provider));
  const registryProviders = providers.filter((p) => p.source === "registry");
  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    if (tab === "models") {
      setModelDefs(loadModelDefinitions());
    }
  };

  const TAB_DEFS: { key: SettingsTab; label: string }[] = [
    { key: "providers", label: t.settings.providers },
    { key: "registry", label: t.settings.registry },
    { key: "roles", label: t.settings.roles },
    { key: "models", label: t.settings.models },
    { key: "webhooks", label: t.settings.webhooks },
  ];

  const renderTabContent = () => (
    <div className="flex-1 min-h-0 overflow-hidden">
      {activeTab === "providers" && (
        <div className="px-4 py-4 space-y-4 overflow-y-auto h-full">
          <div className={settingsCardCls}>
            <p className={sectionHeadCls}>Providers</p>
            <p className="mt-1 text-[10px] text-secondary">
              Manage detected ACP providers, install additional agents, hide noisy entries, and configure provider-specific credentials.
            </p>
          </div>

          <OnboardingSettingsSection onResetOnboarding={onResetOnboarding} onClose={onClose} />

          <ProviderCatalogSection allProviders={providers} />

          <div className={settingsCardCls}>
            <p className="text-[10px] font-semibold text-secondary mb-2">Provider Credentials</p>
            <DockerOpenCodeSection embedded={true} />
          </div>

          <CustomAcpProvidersSection />
        </div>
      )}
      {activeTab === "registry" && (
        <div className="px-4 py-4 overflow-y-auto h-full">
          <div className={settingsCardCls}>
            <div className="mb-3">
              <p className={sectionHeadCls}>{t.settings.registry}</p>
              <p className="mt-1 text-[10px] text-secondary">
                {t.settings.registryDesc}
              </p>
            </div>
            <AgentInstallPanel embedded={true} />
          </div>
        </div>
      )}
      {activeTab === "roles" && (
        <RolesTab
          settings={settings}
          modelDefs={modelDefs}
          builtinProviders={builtinProviders}
          customProviders={customProviders}
          registryProviders={registryProviders}
          onChange={handleChange}
          onOpenModelsTab={() => handleTabChange("models")}
        />
      )}
      {activeTab === "models" && <ModelsTab />}
      {activeTab === "webhooks" && <WebhooksTab />}
    </div>
  );

  if (isPageVariant) {
    return (
      <SettingsFrame activeItem={activeTab}>
        <div className="flex h-full min-w-0 flex-1 flex-col overflow-auto">
          <SettingsPageHeader
            title={t.settingsRedesign.overview.title}
            description={t.settingsRedesign.overview.description}
          />

          <div className="px-6 pt-5 max-[800px]:px-4">
            <SettingsOverviewCards />
          </div>

          <section className="mt-6 px-6 max-[800px]:px-4" aria-labelledby="settings-legacy-title" data-testid="settings-legacy-section">
            <h2 id="settings-legacy-title" className="m-0 text-sm font-semibold text-primary">
              {t.settingsRedesign.overview.legacyTitle}
            </h2>
            <p className="m-0 mt-0.5 max-w-2xl text-xs text-secondary">
              {activeTab === "providers" && t.settings.providersDesc}
              {activeTab === "registry" && t.settings.registryDesc}
              {activeTab === "roles" && t.settings.rolesDesc}
              {activeTab === "models" && t.settings.modelsDesc}
              {activeTab === "webhooks" && t.settings.webhooksDesc}
            </p>
          </section>

          <Tabs
            label={t.settingsRedesign.overview.legacyTitle}
            value={activeTab}
            onChange={(key) => handleTabChange(key as SettingsTab)}
            className="flex min-h-[480px] flex-1 flex-col"
            listClassName="px-6"
            panelClassName="flex min-h-0 flex-1 flex-col"
            items={TAB_DEFS.map((tab) => ({
              id: tab.key,
              label: tab.label,
              content: tab.key === activeTab ? renderTabContent() : null,
            }))}
          />
        </div>
      </SettingsFrame>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative mx-4 flex h-full max-h-[92vh] w-[calc(100vw-2rem)] max-w-6xl flex-col overflow-hidden rounded-xl border border-default bg-surface shadow-2xl"
        style={{ height: SETTINGS_PANEL_HEIGHT }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-default shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            <h2 className="text-sm font-semibold text-primary">{t.settings.title}</h2>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeSwitcher showLabel />
            <button onClick={onClose}
              className="p-1 rounded-md hover:bg-hover text-secondary hover:text-primary transition-colors">
              <X className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-default shrink-0">
          {TAB_DEFS.map(({ key, label }) => (
            <button key={key} onClick={() => handleTabChange(key)}
              className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === key
                  ? "text-accent border-b-2 border-accent"
                  : "text-secondary hover:text-primary"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {renderTabContent()}

        <SystemInfoFooter />

        {/* Footer */}
        <div className="px-4 py-3 border-t border-default flex justify-end shrink-0">
          <button onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-on-accent hover:opacity-90 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
