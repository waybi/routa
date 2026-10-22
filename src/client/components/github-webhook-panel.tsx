"use client";

/**
 * GitHub Webhook Configuration Panel
 *
 * Allows users to:
 * - View and manage GitHub webhook trigger configurations
 * - Create configs (repo, events, trigger agent, token, secret)
 * - Register the webhook directly on GitHub via the API
 * - View recent trigger logs
 */

import { useState, useEffect, useCallback } from "react";
import { Select } from "./select";
import {
  dangerGhostButtonClassName,
  dangerRequiredMarkClassName,
  dangerTextClassName,
  dangerSurfaceClassName,
} from "./color-system";
import { useTranslation } from "@/i18n";
import { useConfirm } from "./confirm-dialog";
import type { TranslationDictionary } from "@/i18n/types";
import { desktopAwareFetch, getDesktopApiBaseUrl } from "@/client/utils/diagnostics";
import { Plus, RefreshCw, SquarePen, Trash2, Link2, Circle, CircleOff } from "lucide-react";
import { EmptyState as UiEmptyState, ErrorState } from "./ui/states";
import { SettingsListSkeleton } from "./settings-redesign/list-skeleton";
import { TokenPromptDialog } from "./settings-redesign/token-prompt-dialog";


// ─── Types ───────────────────────────────────────────────────────────────────

interface WebhookConfig {
  id: string;
  name: string;
  repo: string;
  githubToken: string;
  webhookSecret: string;
  eventTypes: string[];
  labelFilter: string[];
  triggerAgentId: string;
  workspaceId?: string;
  enabled: boolean;
  promptTemplate?: string;
  createdAt: string;
  updatedAt: string;
}

interface TriggerLog {
  id: string;
  configId: string;
  eventType: string;
  eventAction?: string;
  backgroundTaskId?: string;
  signatureValid: boolean;
  outcome: "triggered" | "skipped" | "error";
  errorMessage?: string;
  createdAt: string;
}

interface FormState {
  name: string;
  repo: string;
  githubToken: string;
  webhookSecret: string;
  eventTypes: string[];
  labelFilter: string;
  triggerAgentId: string;
  enabled: boolean;
  promptTemplate: string;
}

const SUPPORTED_EVENTS = [
  { value: "issues", label: "Issues", description: "opened, labeled, closed, etc." },
  { value: "pull_request", label: "Pull Requests", description: "opened, synchronize, merged, etc." },
  { value: "pull_request_review", label: "PR Reviews", description: "approved, changes_requested, commented" },
  { value: "pull_request_review_comment", label: "PR Review Comments", description: "Comments on PR diffs" },
  { value: "check_run", label: "Check Runs", description: "Build success/failure events" },
  { value: "check_suite", label: "Check Suites", description: "Suite of checks completed" },
  { value: "workflow_run", label: "Workflow Runs", description: "GitHub Actions workflow events" },
  { value: "workflow_job", label: "Workflow Jobs", description: "Individual job events" },
  { value: "push", label: "Push", description: "Code pushed to branches" },
  { value: "create", label: "Create", description: "Branch or tag created" },
  { value: "delete", label: "Delete", description: "Branch or tag deleted" },
  { value: "issue_comment", label: "Issue Comments", description: "Comments on issues/PRs" },
];

interface SpecialistOption {
  id: string;
  name: string;
  description?: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  repo: "",
  githubToken: "",
  webhookSecret: "",
  eventTypes: ["issues"],
  labelFilter: "",
  triggerAgentId: "claude-code",
  enabled: true,
  promptTemplate: "",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function GitHubWebhookPanel() {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const wt = t.webhook;
  const [configs, setConfigs] = useState<WebhookConfig[]>([]);
  const [logs, setLogs] = useState<TriggerLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState<string | null>(null);
  const [specialists, setSpecialists] = useState<SpecialistOption[]>([]);
  const [serverUrl, setServerUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tokenRequest, setTokenRequest] = useState<{ config: WebhookConfig; trigger: HTMLElement | null } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"configs" | "logs">("configs");
  // Polling state
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [pollingInterval, setPollingInterval] = useState(30);
  const [pollingRunning, setPollingRunning] = useState(false);
  const [pollingLastChecked, setPollingLastChecked] = useState<string | null>(null);
  const [pollingChecking, setPollingChecking] = useState(false);

  // Detect server URL for webhook registration
  useEffect(() => {
    const backendBase = getDesktopApiBaseUrl();
    setServerUrl(backendBase || window.location.origin);
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [cfgRes, logRes, pollRes, specRes] = await Promise.all([
        desktopAwareFetch("/api/webhooks/configs"),
        desktopAwareFetch("/api/webhooks/webhook-logs?limit=50"),
        desktopAwareFetch("/api/polling/config"),
        desktopAwareFetch("/api/specialists"),
      ]);
      if (!cfgRes.ok) throw new Error(`HTTP ${cfgRes.status}`);
      const cfgData = await cfgRes.json();
      setConfigs(cfgData.configs ?? []);
      setLoadError(false);
      if (logRes.ok) {
        const data = await logRes.json();
        setLogs(data.logs ?? []);
      }
      if (specRes.ok) {
        const data = await specRes.json();
        setSpecialists((data.specialists ?? []).filter((s: SpecialistOption & { enabled: boolean }) => s.enabled !== false));
      }
      if (pollRes.ok) {
        const data = await pollRes.json();
        setPollingEnabled(data.config?.enabled ?? false);
        setPollingInterval(data.config?.intervalSeconds ?? 30);
        setPollingRunning(data.config?.isRunning ?? false);
        setPollingLastChecked(data.config?.lastCheckedAt ?? null);
      }
    } catch (err) {
      console.error("Failed to load webhook data:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function openCreate() {
    setForm({ ...EMPTY_FORM, githubToken: process.env.NEXT_PUBLIC_GITHUB_TOKEN ?? "" });
    setEditId(null);
    setShowForm(true);
    setError(null);
    setSaveError(null);
  }

  function openEdit(config: WebhookConfig) {
    setForm({
      name: config.name,
      repo: config.repo,
      githubToken: "", // don't expose masked token; user must re-enter to change
      webhookSecret: config.webhookSecret,
      eventTypes: config.eventTypes,
      labelFilter: (config.labelFilter ?? []).join(", "),
      triggerAgentId: config.triggerAgentId,
      enabled: config.enabled,
      promptTemplate: config.promptTemplate ?? "",
    });
    setEditId(config.id);
    setShowForm(true);
    setError(null);
    setSaveError(null);
  }

  function toggleEvent(ev: string) {
    setForm((prev) => ({
      ...prev,
      eventTypes: prev.eventTypes.includes(ev)
        ? prev.eventTypes.filter((e) => e !== ev)
        : [...prev.eventTypes, ev],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name || !form.repo || !form.triggerAgentId || form.eventTypes.length === 0) {
      setSaveError(wt.requiredFieldsError);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        ...(editId ? { id: editId } : {}),
        name: form.name,
        repo: form.repo,
        ...(form.githubToken ? { githubToken: form.githubToken } : {}),
        webhookSecret: form.webhookSecret,
        eventTypes: form.eventTypes,
        labelFilter: form.labelFilter
          ? form.labelFilter.split(",").map((l) => l.trim()).filter(Boolean)
          : [],
        triggerAgentId: form.triggerAgentId,
        enabled: form.enabled,
        promptTemplate: form.promptTemplate || undefined,
      };

      const res = await desktopAwareFetch("/api/webhooks/configs", {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }

      setSuccess(editId ? wt.configUpdated : wt.configCreated);
      setShowForm(false);
      setEditId(null);
      await loadData();
    } catch (err) {
      setSaveError(`${t.settingsRedesign.states.saveFailed} (${err instanceof Error ? err.message : String(err)})`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: wt.deleteConfirm, destructive: true }))) return;
    try {
      const res = await desktopAwareFetch(`/api/webhooks/configs?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess(wt.configDeleted);
      await loadData();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRegister(config: WebhookConfig, tokenToUse: string) {
    if (!tokenToUse) return;

    setRegistering(config.id);
    setError(null);
    try {
      const webhookUrl = `${serverUrl}/api/webhooks/github`;
      const res = await desktopAwareFetch("/api/webhooks/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: tokenToUse,
          repo: config.repo,
          webhookUrl,
          secret: config.webhookSecret,
          events: config.eventTypes,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSuccess(
        wt.registerSuccess.replace("{hookId}", String(data.hook?.id)).replace("{url}", webhookUrl)
      );
    } catch (err) {
      setError(wt.registerFailed.replace("{error}", String(err)));
    } finally {
      setRegistering(null);
    }
  }

  async function handleToggleEnabled(config: WebhookConfig) {
    try {
      const res = await desktopAwareFetch("/api/webhooks/configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: config.id, enabled: !config.enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadData();
    } catch (err) {
      setError(String(err));
    }
  }

  // ─── Polling Controls ─────────────────────────────────────────────────────

  async function handleTogglePolling() {
    try {
      const newEnabled = !pollingEnabled;
      const res = await desktopAwareFetch("/api/polling/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled, intervalSeconds: pollingInterval }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPollingEnabled(data.config?.enabled ?? false);
      setPollingRunning(data.config?.isRunning ?? false);
      setSuccess(newEnabled ? wt.pollingEnabled : wt.pollingDisabled);
    } catch (err) {
      setError(wt.togglePollingFailed.replace("{error}", String(err)));
    }
  }

  async function handleManualCheck() {
    try {
      setPollingChecking(true);
      const res = await desktopAwareFetch("/api/polling/check", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPollingLastChecked(data.checkedAt);
      const { totalEventsProcessed, totalEventsSkipped } = data.summary;
      setSuccess(wt.checkComplete.replace("{processed}", String(totalEventsProcessed)).replace("{skipped}", String(totalEventsSkipped)));
      await loadData(); // Refresh logs
    } catch (err) {
      setError(wt.manualCheckFailed.replace("{error}", String(err)));
    } finally {
      setPollingChecking(false);
    }
  }

  async function handleUpdatePollingInterval(newInterval: number) {
    if (newInterval < 10) return;
    try {
      const res = await desktopAwareFetch("/api/polling/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervalSeconds: newInterval }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPollingInterval(newInterval);
    } catch (err) {
      setError(wt.updateIntervalFailed.replace("{error}", String(err)));
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Alerts */}
      {error && (
        <div className={`mx-4 mt-3 flex items-start gap-2 rounded-lg px-4 py-2 text-sm ${dangerSurfaceClassName}`}>
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>{error}</span>
          <button onClick={() => setError(null)} className={`ml-auto shrink-0 ${dangerTextClassName}`}>✕</button>
        </div>
      )}
      {success && (
        <div className="mx-4 mt-3 px-4 py-2 rounded-lg bg-success-subtle border border-success text-success text-sm flex items-start gap-2">
          <span className="shrink-0 mt-0.5">✓</span>
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto shrink-0 text-success hover:opacity-80">✕</button>
        </div>
      )}

      {/* Header actions */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        {/* Tabs */}
        <div className="flex gap-1 bg-subtle rounded-lg p-0.5">
          {(["configs", "logs"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeTab === tab
                  ? "bg-surface text-primary shadow-sm"
                  : "text-secondary hover:text-primary"
              }`}
            >
              {tab === "configs" ? wt.tabs.configurations : wt.tabs.triggerLogs}
            </button>
          ))}
        </div>

        {activeTab === "configs" && (
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:opacity-90 text-on-accent text-sm rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
            {wt.addTrigger}
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {activeTab === "configs" && (
          <>
            {/* Polling Control Panel */}
            <div className="mb-4 p-3 bg-subtle rounded-lg border border-default">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-primary">
                      {wt.localPolling}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                      pollingRunning
                        ? "bg-success-subtle text-success"
                        : "bg-subtle text-secondary"
                    }`}>
                      {pollingRunning ? wt.running : wt.stopped}
                    </span>
                  </div>
                  <button
                    onClick={handleTogglePolling}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      pollingEnabled ? "bg-accent" : "bg-default"
                    }`}
                    title={pollingEnabled ? wt.disablePolling : wt.enablePolling}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      pollingEnabled ? "translate-x-4.5" : "translate-x-1"
                    }`} style={{ transform: pollingEnabled ? "translateX(18px)" : "translateX(4px)" }} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={String(pollingInterval)}
                    onChange={(e) => handleUpdatePollingInterval(Number(e.target.value))}
                    className="text-xs px-2 py-1 rounded border border-default bg-surface text-primary"
                    disabled={!pollingEnabled}
                  >
                    <option value={10}>10s</option>
                    <option value={30}>30s</option>
                    <option value={60}>1min</option>
                    <option value={300}>5min</option>
                  </Select>
                  <button
                    onClick={handleManualCheck}
                    disabled={pollingChecking}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-surface border border-default rounded hover:bg-hover disabled:opacity-50 text-primary"
                    title={wt.manuallyCheckNow}
                  >
                    {pollingChecking ? (
                      <div className="w-3 h-3 border border-default border-t-accent rounded-full animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                    )}
                    {wt.checkNow}
                  </button>
                </div>
              </div>
              {pollingLastChecked && (
                <div className="mt-2 text-xs text-secondary">
                  {wt.lastChecked}: {new Date(pollingLastChecked).toLocaleString()}
                </div>
              )}
              <p className="mt-1 text-xs text-secondary">
                {wt.localPollingHint}
              </p>
            </div>

            {showForm && (
              <WebhookConfigForm
                form={form}
                setForm={setForm}
                editId={editId}
                saving={saving}
                saveError={saveError}
                specialists={specialists}
                onSubmit={handleSubmit}
                onCancel={() => { setShowForm(false); setEditId(null); setSaveError(null); }}
                toggleEvent={toggleEvent}
              />
            )}

            {!showForm && (
              <>
                {loadError && (
                  <ErrorState
                    className="mt-2"
                    message={t.settingsRedesign.states.loadFailed}
                    retryLabel={t.settingsRedesign.states.reload}
                    onRetry={() => void loadData()}
                  />
                )}
                {loading && configs.length === 0 ? (
                  <SettingsListSkeleton />
                ) : loadError && configs.length === 0 ? null : configs.length === 0 ? (
                  <EmptyState onAdd={openCreate} t={wt} />
                ) : (
                  <div className="space-y-3 mt-2">
                    {configs.map((config) => (
                      <WebhookConfigCard
                        key={config.id}
                        config={config}
                        onEdit={() => openEdit(config)}
                        onDelete={() => handleDelete(config.id)}
                        onRegister={(trigger) => setTokenRequest({ config, trigger })}
                        onToggle={() => handleToggleEnabled(config)}
                        registering={registering === config.id}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeTab === "logs" && (
          <TriggerLogsTable logs={logs} configs={configs} onRefresh={loadData} />
        )}
      </div>
      <TokenPromptDialog
        open={tokenRequest !== null}
        title={t.settingsRedesign.webhooks.tokenDialogTitle}
        description={t.settingsRedesign.webhooks.tokenDialogDescription}
        subject={tokenRequest?.config.repo}
        label={t.settingsRedesign.webhooks.tokenLabel}
        placeholder={t.settingsRedesign.webhooks.tokenPlaceholder}
        confirmLabel={t.settingsRedesign.webhooks.confirm}
        cancelLabel={t.settingsRedesign.webhooks.cancel}
        returnFocusTo={tokenRequest?.trigger}
        onCancel={() => setTokenRequest(null)}
        onSubmit={(token) => {
          const request = tokenRequest;
          setTokenRequest(null);
          if (request) void handleRegister(request.config, token).then(() => setTimeout(() => request.trigger?.focus(), 0));
        }}
      />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function EmptyState({ onAdd, t }: { onAdd: () => void; t: TranslationDictionary["webhook"] }) {
  const { t: root } = useTranslation();
  return (
    <UiEmptyState
      className="mt-2"
      icon={<Link2 className="h-8 w-8" strokeWidth={1.5} />}
      title={root.settingsRedesign.webhooks.emptyTitle}
      description={root.settingsRedesign.webhooks.emptyDescription}
      action={
        <button
          onClick={onAdd}
          className="px-4 py-2 bg-accent hover:opacity-90 text-on-accent text-sm rounded-lg transition-colors"
        >
          {t.addFirstTrigger}
        </button>
      }
    />
  );
}

interface WebhookConfigFormProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  editId: string | null;
  saving: boolean;
  saveError: string | null;
  specialists: SpecialistOption[];
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  toggleEvent: (ev: string) => void;
}

function WebhookConfigForm({ form, setForm, editId, saving, saveError, specialists, onSubmit, onCancel, toggleEvent }: WebhookConfigFormProps) {
  const { t } = useTranslation();
  return (
    <form onSubmit={onSubmit} className="bg-surface border border-default rounded-xl p-5 mt-2 space-y-4">
      <h3 className="text-sm font-semibold text-primary">
        {editId ? t.webhook.editWebhookTrigger : t.webhook.newWebhookTrigger}
      </h3>
      {saveError && (
        <p role="alert" data-testid="webhook-save-error" className={`rounded-lg px-3 py-2 text-sm ${dangerSurfaceClassName}`}>
          {saveError}
        </p>
      )}

      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-primary mb-1">
          {t.webhook.nameLabel} <span className={dangerRequiredMarkClassName}>*</span>
        </label>
        <input
          data-testid="webhook-name"
          type="text"
          value={form.name}
          onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
          placeholder={t.webhook.namePlaceholder}
          className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          required
        />
      </div>

      {/* Repository */}
      <div>
        <label className="block text-xs font-medium text-primary mb-1">
          {t.webhook.githubRepository} <span className={dangerRequiredMarkClassName}>*</span>
          <span className="ml-1 text-secondary font-normal">{t.webhook.repoFormatHint}</span>
        </label>
        <input
          data-testid="webhook-repo"
          type="text"
          value={form.repo}
          onChange={(e) => setForm((p) => ({ ...p, repo: e.target.value }))}
          placeholder="phodal-archive/data-mesh-spike"
          className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          required
        />
      </div>

      {/* GitHub Token */}
      <div>
        <label className="block text-xs font-medium text-primary mb-1">
          {t.webhook.githubToken} <span className={dangerRequiredMarkClassName}>{editId ? "" : "*"}</span>
          {editId && <span className="ml-1 text-secondary font-normal">{t.webhook.tokenKeepHint}</span>}
        </label>
        <input
          data-testid="webhook-token"
          type="password"
          value={form.githubToken}
          onChange={(e) => setForm((p) => ({ ...p, githubToken: e.target.value }))}
          placeholder={editId ? t.webhook.tokenEditPlaceholder : t.webhook.tokenPlaceholder}
          className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          required={!editId}
        />
      </div>

      {/* {t.webhook.webhookSecret} */}
      <div>
        <label className="block text-xs font-medium text-primary mb-1">
          {t.webhook.webhookSecret}
          <span className="ml-1 text-secondary font-normal">{t.webhook.secretHint}</span>
        </label>
        <input
          data-testid="webhook-secret"
          type="text"
          value={form.webhookSecret}
          onChange={(e) => setForm((p) => ({ ...p, webhookSecret: e.target.value }))}
          placeholder="routa-webhook-secret-2026"
          className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {/* Events */}
      <div>
        <label className="block text-xs font-medium text-primary mb-2">
          {t.webhook.eventsToSubscribe} <span className={dangerRequiredMarkClassName}>*</span>
        </label>
        <div className="grid grid-cols-2 gap-2">
          {SUPPORTED_EVENTS.map((ev) => (
            <label
              key={ev.value}
              className={`flex items-start gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                form.eventTypes.includes(ev.value)
                  ? "border-accent bg-accent-subtle"
                  : "border-default hover:border-secondary"
              }`}
            >
              <input
                type="checkbox"
                data-testid={`event-${ev.value}`}
                checked={form.eventTypes.includes(ev.value)}
                onChange={() => toggleEvent(ev.value)}
                className="mt-0.5 accent-blue-600"
              />
              <div>
                <p className="text-xs font-medium text-primary">{ev.label}</p>
                <p className="text-xs text-secondary">{ev.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

      {/* Label filter */}
      <div>
        <label className="block text-xs font-medium text-primary mb-1">
          {t.webhook.labelFilter}
          <span className="ml-1 text-secondary font-normal">{t.webhook.labelFilterHint}</span>
        </label>
        <input
          data-testid="webhook-label-filter"
          type="text"
          value={form.labelFilter}
          onChange={(e) => setForm((p) => ({ ...p, labelFilter: e.target.value }))}
          placeholder={t.webhook.labelFilterPlaceholder}
          className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {/* Trigger Agent */}
      <div>
        <label className="block text-xs font-medium text-primary mb-1">
          {t.webhook.triggerAgent} <span className={dangerRequiredMarkClassName}>*</span>
        </label>
        <Select
          data-testid="webhook-agent"
          value={form.triggerAgentId}
          onChange={(e) => setForm((p) => ({ ...p, triggerAgentId: e.target.value }))}
          className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
          required
        >
          <option value="">{t.webhook.selectAgent}</option>
          {specialists.length > 0 ? (
            specialists.map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.description ? ` — ${s.description}` : ""}</option>
            ))
          ) : (
            <>
              <option value="claude-code">Claude Code</option>
              <option value="opencode">OpenCode</option>
              <option value="developer">Developer</option>
            </>
          )}
        </Select>
      </div>

      {/* Prompt Template */}
      <div>
        <label className="block text-xs font-medium text-primary mb-1">
          {t.webhook.promptTemplate}
          <span className="ml-1 text-secondary font-normal">{t.webhook.promptTemplateHint}</span>
        </label>
        <textarea
          data-testid="webhook-prompt"
          value={form.promptTemplate}
          onChange={(e) => setForm((p) => ({ ...p, promptTemplate: e.target.value }))}
          rows={3}
          placeholder={t.webhook.promptTemplatePlaceholder}
          className="w-full px-3 py-2 text-sm bg-surface border border-default rounded-lg focus-visible:outline-2 focus-visible:outline-accent resize-none"
        />
      </div>

      {/* Enabled */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          data-testid="webhook-enabled"
          type="checkbox"
          checked={form.enabled}
          onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
          className="accent-blue-600"
        />
        <span className="text-sm text-primary">{t.webhook.enabled}</span>
      </label>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-default">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-primary hover:bg-hover rounded-lg transition-colors"
        >
          {t.common.cancel}
        </button>
        <button
          data-testid="webhook-submit"
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm bg-accent hover:opacity-90 disabled:opacity-50 text-on-accent rounded-lg transition-colors"
        >
          {saving ? `${t.common.loading}…` : editId ? t.common.update : t.common.create}
        </button>
      </div>
    </form>
  );
}

interface WebhookConfigCardProps {
  config: WebhookConfig;
  onEdit: () => void;
  onDelete: () => void;
  onRegister: (trigger: HTMLElement) => void;
  onToggle: () => void;
  registering: boolean;
}

function WebhookConfigCard({ config, onEdit, onDelete, onRegister, onToggle, registering }: WebhookConfigCardProps) {
  const { t } = useTranslation();
  return (
    <div className={`bg-surface border rounded-xl p-4 transition-colors ${
      config.enabled
        ? "border-default"
        : "border-default opacity-60"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`w-2 h-2 rounded-full shrink-0 ${config.enabled ? "bg-success" : "bg-secondary"}`} />
            <h4 className="text-sm font-semibold text-primary truncate">{config.name}</h4>
          </div>
          <p className="text-xs text-secondary mb-2 ml-4">
            <span className="font-medium text-primary">{config.repo}</span>
            {" → "}
            <span className="inline-flex items-center gap-1">
              <span className="w-3.5 h-3.5 inline-block">🤖</span>
              {config.triggerAgentId}
            </span>
          </p>
          <div className="ml-4 flex flex-wrap gap-1">
            {config.eventTypes.map((ev) => (
              <span key={ev} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-accent-subtle text-accent border border-accent">
                {ev}
              </span>
            ))}
            {(config.labelFilter ?? []).length > 0 && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-subtle text-primary border border-default">
                labels: {config.labelFilter.join(", ")}
              </span>
            )}
          </div>
        </div>

        {/* Enabled toggle */}
        <button
          onClick={onToggle}
          title={config.enabled ? t.webhook.disable : t.webhook.enable}
          className="p-1 rounded-md text-secondary hover:text-primary transition-colors"
        >
          {config.enabled ? (
            <CircleOff className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          ) : (
            <Circle className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          )}
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-default">
        <button
          onClick={(event) => onRegister(event.currentTarget)}
          disabled={registering}
          className="flex items-center gap-1 px-2.5 py-1 text-xs bg-primary text-canvas hover:opacity-90 rounded-md transition-colors disabled:opacity-50"
        >
          {registering ? (
            <span className="w-3 h-3 border border-canvas border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
          )}
          {t.webhook.registerOnGithub}
        </button>

        <button
          onClick={onEdit}
          className="flex items-center gap-1 px-2.5 py-1 text-xs text-secondary hover:bg-hover rounded-md transition-colors"
        >
          <SquarePen className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.webhook.edit}
        </button>

        <button
          onClick={onDelete}
          className={`ml-auto flex items-center gap-1 rounded-md px-2.5 py-1 text-xs ${dangerGhostButtonClassName}`}
        >
          <Trash2 className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.webhook.delete}
        </button>
      </div>
    </div>
  );
}

interface TriggerLogsTableProps {
  logs: TriggerLog[];
  configs: WebhookConfig[];
  onRefresh: () => void;
}

function TriggerLogsTable({ logs, configs, onRefresh }: TriggerLogsTableProps) {
  const { t } = useTranslation();
  const configMap = Object.fromEntries(configs.map((c) => [c.id, c.name]));

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-secondary">{logs.length} {t.webhook.recentEvents}</p>
        <button
          onClick={onRefresh}
          className="flex items-center gap-1 text-xs text-secondary hover:text-primary"
        >
          <RefreshCw className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.webhook.refresh}
        </button>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm text-secondary">{t.webhook.noEventsYet}</p>
          <p className="text-xs text-secondary mt-1">{t.webhook.noEventsHint}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => (
            <div key={log.id} className="bg-surface border border-default rounded-lg px-3 py-2.5 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                log.outcome === "triggered" ? "bg-success" :
                log.outcome === "skipped" ? "bg-attention" : "bg-danger"
              }`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-primary truncate">
                  {log.eventType}{log.eventAction ? ` · ${log.eventAction}` : ""}
                  <span className="ml-1.5 text-secondary font-normal">
                    {configMap[log.configId] ?? log.configId}
                  </span>
                </p>
                {log.errorMessage && (
                  <p className="text-xs text-danger truncate">{log.errorMessage}</p>
                )}
                {log.backgroundTaskId && (
                  <p className="text-xs text-secondary">{t.webhook.taskLabel}: {log.backgroundTaskId}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-secondary">
                {new Date(log.createdAt).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
