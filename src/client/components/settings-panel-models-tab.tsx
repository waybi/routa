"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  BASE_URL_SUGGESTIONS,
  EMPTY_MODEL_FORM,
  SETTINGS_PANEL_BODY_MAX_HEIGHT,
  getModelDefinitionByAlias,
  inputCls,
  labelCls,
  loadModelDefinitions,
  saveModelDefinitions,
  sectionHeadCls,
  type ModelDefinition,
} from "./settings-panel-shared";
import {
  ModelCatalogApiError,
  createCustomModel,
  deleteCustomModel,
  fetchCatalog,
  listCustomModels,
  migrateLocalModelDefinitions,
  readCachedApiKey,
  updateCustomModel,
  type CustomModelEntry,
} from "@/client/lib/model-catalog-client";
import { useTranslation } from "@/i18n";
import { useConfirm } from "./confirm-dialog";
import { AlertCircle, ChevronRight, Info, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

interface ModelRow {
  id: string;
  alias: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  localOnly: boolean;
}

function rowFromEntry(entry: CustomModelEntry, cached: ModelDefinition[], apiKey?: string): ModelRow {
  return {
    id: entry.id,
    alias: entry.alias,
    modelName: entry.modelId,
    baseUrl: entry.baseUrl ?? "",
    apiKey: apiKey ?? readCachedApiKey(entry.alias, cached) ?? "",
    enabled: entry.enabled,
    localOnly: false,
  };
}

function rowFromCache(definition: ModelDefinition): ModelRow {
  return {
    id: `local:${definition.alias}`,
    alias: definition.alias,
    modelName: definition.modelName,
    baseUrl: definition.baseUrl ?? "",
    apiKey: definition.apiKey ?? "",
    enabled: true,
    localOnly: true,
  };
}

function persistRows(rows: ModelRow[]): void {
  saveModelDefinitions(rows.map((row) => ({
    alias: row.alias,
    modelName: row.modelName,
    baseUrl: row.baseUrl || undefined,
    apiKey: row.apiKey || undefined,
  })));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAliasConflict(error: unknown): boolean {
  return error instanceof ModelCatalogApiError && error.code === "ALIAS_CONFLICT";
}

export function ModelsTab() {
  // Start from the browser cache so the list never flashes empty, then reconcile with the server.
  const [rows, setRows] = useState<ModelRow[]>(() => loadModelDefinitions().map(rowFromCache));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ModelRow | null>(null);
  const [form, setForm] = useState<ModelDefinition>(EMPTY_MODEL_FORM);
  const [aliasError, setAliasError] = useState("");
  const [formError, setFormError] = useState("");
  const [rowError, setRowError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  /** Models the agent advertises; null = list unavailable, so no verdict is shown. */
  const [advertised, setAdvertised] = useState<Set<string> | null>(null);
  const baseUrlListId = useId();
  const aliasInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const confirm = useConfirm();
  const tRef = useRef(t);
  tRef.current = t;
  // Any local edit wins over a slow server response; "Retry" clears it on purpose.
  const dirtyRef = useRef(false);

  const load = useCallback(async () => {
    const copy = tRef.current;
    dirtyRef.current = false;
    setLoading(true);
    setLoadError("");
    setNotice("");
    const cached = loadModelDefinitions();
    try {
      const remote = await listCustomModels();
      const migration = await migrateLocalModelDefinitions(remote);
      const next = migration.entries.map((entry) => rowFromEntry(entry, cached));
      if (!dirtyRef.current) {
        setRows(next);
        persistRows(next);
      }
      if (migration.migrated.length > 0) {
        setNotice(`${copy.models.migrated} · ${migration.migrated.join(", ")}`);
      }
      if (migration.failed.length > 0) {
        setLoadError(`${copy.models.syncFailed}: ${migration.failed.map((item) => item.alias).join(", ")}`);
      }
    } catch (error) {
      setLoadError(`${tRef.current.models.syncFailed} (${errorMessage(error)})`);
      if (!dirtyRef.current) setRows(cached.map(rowFromCache));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Which aliases DSH can actually start: only ids in its advertised list.
  useEffect(() => {
    let alive = true;
    void fetchCatalog("dsh")
      .then(({ entries, error }) => {
        if (!alive || error) return;
        const providerEntries = entries.filter((entry) => entry.source !== "custom");
        if (providerEntries.length === 0) return;
        const values = new Set<string>();
        for (const entry of providerEntries) {
          if (entry.value) values.add(entry.value);
          if (entry.rawValue) values.add(entry.rawValue);
        }
        setAdvertised(values);
      })
      .catch(() => {
        // Probe down: leave the verdict hidden rather than guessing.
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleAddModel = async () => {
    const alias = form.alias.trim();
    const modelName = form.modelName.trim();
    if (!alias || !modelName) return;
    if (rows.some((row) => row.alias.toLowerCase() === alias.toLowerCase())) {
      setAliasError(`"${alias}" ${t.models.aliasAlreadyExists}`);
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      const created = await createCustomModel({
        alias,
        modelId: modelName,
        baseUrl: form.baseUrl?.trim() || undefined,
      });
      const row = rowFromEntry(created, loadModelDefinitions(), form.apiKey ?? "");
      const next = [...rows.filter((item) => !item.localOnly), row];
      dirtyRef.current = true;
      setRows(next);
      persistRows(next);
      setForm(EMPTY_MODEL_FORM);
      setAliasError("");
      setNotice(t.models.savedToServer);
      aliasInputRef.current?.focus();
    } catch (error) {
      if (isAliasConflict(error)) setAliasError(`"${alias}" ${t.models.aliasAlreadyExists}`);
      else setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleFormKey = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") void handleAddModel();
  };

  const toggleRow = (row: ModelRow) => {
    if (expandedId === row.id) {
      setExpandedId(null);
      setDraft(null);
      setRowError("");
      return;
    }
    setExpandedId(row.id);
    setDraft({ ...row });
    setRowError("");
  };

  const patchDraft = (field: keyof ModelRow, value: string) => {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
  };

  const handleSaveRow = async () => {
    if (!draft) return;
    const alias = draft.alias.trim();
    const modelName = draft.modelName.trim();
    if (!alias || !modelName) {
      setRowError(t.models.alias);
      return;
    }
    setBusy(true);
    setRowError("");
    if (draft.localOnly) {
      const next = rows.map((row) => (row.id === draft.id ? { ...draft, alias, modelName } : row));
      dirtyRef.current = true;
      setRows(next);
      persistRows(next);
      setExpandedId(null);
      setDraft(null);
      setBusy(false);
      return;
    }
    try {
      const updated = await updateCustomModel(draft.id, {
        alias,
        modelId: modelName,
        baseUrl: draft.baseUrl.trim(),
        enabled: draft.enabled,
      });
      const next = rows.map((row) => (row.id === draft.id ? rowFromEntry(updated, [], draft.apiKey) : row));
      dirtyRef.current = true;
      setRows(next);
      persistRows(next);
      setExpandedId(null);
      setDraft(null);
      setNotice(t.models.savedToServer);
    } catch (error) {
      setRowError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEnabled = async (row: ModelRow) => {
    const enabled = !row.enabled;
    if (row.localOnly) {
      const next = rows.map((item) => (item.id === row.id ? { ...item, enabled } : item));
      dirtyRef.current = true;
      setRows(next);
      persistRows(next);
      return;
    }
    try {
      const updated = await updateCustomModel(row.id, { enabled });
      const next = rows.map((item) => (item.id === row.id ? { ...item, enabled: updated.enabled } : item));
      dirtyRef.current = true;
      setRows(next);
      persistRows(next);
    } catch (error) {
      setRowError(errorMessage(error));
    }
  };

  const handleDelete = async (row: ModelRow) => {
    if (!(await confirm({ message: `${t.models.deleteConfirm} "${row.alias}"?`, destructive: true }))) return;
    if (!row.localOnly) {
      try {
        await deleteCustomModel(row.id);
      } catch (error) {
        setRowError(errorMessage(error));
        return;
      }
    }
    const next = rows.filter((item) => item.id !== row.id);
    dirtyRef.current = true;
    setRows(next);
    persistRows(next);
    if (expandedId === row.id) {
      setExpandedId(null);
      setDraft(null);
    }
  };

  const canAdd = form.alias.trim().length > 0 && form.modelName.trim().length > 0;

  return (
    <div className="px-4 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: SETTINGS_PANEL_BODY_MAX_HEIGHT }}>
      <datalist id={baseUrlListId}>
        {BASE_URL_SUGGESTIONS.map((url) => <option key={url} value={url} />)}
      </datalist>

      <div
        role="note"
        data-testid="models-tab-specialists-hint"
        className="flex items-start gap-2 rounded-lg border border-desktop-border bg-desktop-bg-secondary px-3 py-2 text-[11px] text-desktop-text-secondary"
      >
        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="min-w-0 flex-1">{t.settingsRedesign.modelsTabHint.text}</span>
        <Link href="/settings/specialists" className="shrink-0 text-accent hover:underline">
          {t.settingsRedesign.modelsTabHint.link}
        </Link>
      </div>

      {notice && (
        <div role="status" className="rounded-lg border border-success bg-success-subtle px-3 py-2 text-[11px] text-success">
          {notice}
        </div>
      )}

      {loadError && (
        <div role="alert" className="rounded-lg border border-danger bg-danger-subtle px-3 py-2 text-[11px] text-danger space-y-1">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="min-w-0 flex-1">{loadError}</span>
            <button onClick={() => void load()} className="shrink-0 underline hover:no-underline">
              {t.models.retry}
            </button>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-accent bg-gradient-to-b from-accent-subtle to-transparent p-3.5 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shrink-0">
            <Plus className="w-3 h-3 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}/>
          </div>
          <span className="text-xs font-semibold text-accent">{t.models.addModel}</span>
          <span className="text-[10px] text-secondary ml-auto hidden sm:block">{t.models.pressEnterToAdd}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className={labelCls}>{t.models.alias} <span className="text-accent">*</span></label>
            <input
              ref={aliasInputRef}
              autoFocus
              type="text"
              value={form.alias}
              onChange={(event) => {
                setForm({ ...form, alias: event.target.value });
                setAliasError("");
              }}
              onKeyDown={handleFormKey}
              placeholder={t.models.placeholderAlias}
              className={`${inputCls} ${aliasError ? "border-danger focus:ring-danger" : ""}`}
            />
            {aliasError && <p className="text-[10px] text-danger">{aliasError}</p>}
          </div>
          <div className="space-y-1">
            <label className={labelCls}>{t.models.modelName} <span className="text-accent">*</span></label>
            <input
              type="text"
              value={form.modelName}
              onChange={(event) => setForm({ ...form, modelName: event.target.value })}
              onKeyDown={handleFormKey}
              placeholder={t.models.placeholderModelName}
              className={`${inputCls} font-mono`}
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className={labelCls}>{t.models.baseUrl}</label>
          <input
            type="url"
            list={baseUrlListId}
            value={form.baseUrl ?? ""}
            onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
            onKeyDown={handleFormKey}
            placeholder={t.models.placeholderBaseUrl}
            className={`${inputCls} font-mono`}
          />
        </div>

        <div className="space-y-1">
          <label className={labelCls}>{t.models.apiKey}</label>
          <input
            type="password"
            value={form.apiKey ?? ""}
            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            onKeyDown={handleFormKey}
            placeholder={t.models.placeholderApiKey}
            autoComplete="off"
            className={`${inputCls} font-mono`}
          />
          <p className="text-[10px] text-secondary">{t.models.apiKeyLocalOnly}</p>
        </div>

        {formError && <p className="text-[10px] text-danger" role="alert">{formError}</p>}

        <button
          onClick={() => void handleAddModel()}
          disabled={!canAdd || busy}
          className="w-full py-2 text-xs font-semibold rounded-lg bg-accent text-on-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>}
          {t.models.addModel}
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <p className={sectionHeadCls}>{t.models.serverCatalog}</p>
          {loading && <Loader2 className="w-3 h-3 text-secondary animate-spin" aria-hidden="true" />}
          <button
            onClick={() => void load()}
            className="ml-auto p-1 rounded text-secondary hover:text-accent hover:bg-accent-subtle transition-colors"
            title={t.models.retry}
          >
            <RefreshCw className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          </button>
        </div>

        {rows.length === 0 && !loading && (
          <p className="text-[11px] text-secondary">{t.models.empty}</p>
        )}

        {rows.map((row) => {
          const isOpen = expandedId === row.id && draft !== null;
          return (
            <div key={row.id} className="rounded-lg border border-default overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-subtle">
                <button
                  onClick={() => toggleRow(row)}
                  className="flex-1 flex items-center gap-2 min-w-0 text-left"
                >
                  <ChevronRight className={`w-3 h-3 text-secondary shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                  <span className="text-xs font-semibold text-primary truncate">{row.alias}</span>
                  <span className="text-[10px] text-secondary font-mono truncate">→ {row.modelName}</span>
                  {row.baseUrl && (
                    <span className="text-[10px] text-accent font-mono truncate hidden sm:block">
                      {row.baseUrl.replace(/https?:\/\//, "").substring(0, 30)}
                    </span>
                  )}
                  {row.localOnly && (
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded border border-accent text-accent">
                      {t.models.localOnly}
                    </span>
                  )}
                  {advertised && !advertised.has(row.modelName) && (
                    <span
                      title={t.models.executableHint}
                      className="shrink-0 text-[9px] px-1.5 py-0.5 rounded border border-danger text-danger"
                    >
                      {t.models.cannotStart}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => void handleToggleEnabled(row)}
                  className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${row.enabled ? "border-success text-success hover:bg-success-subtle" : "border-default text-secondary hover:bg-subtle"}`}
                  title={row.enabled ? t.common.enabled : t.common.disabled}
                >
                  {row.enabled ? t.common.enabled : t.common.disabled}
                </button>
                <button
                  onClick={() => void handleDelete(row)}
                  className="shrink-0 p-1 rounded text-secondary hover:text-danger hover:bg-danger-subtle transition-colors"
                  title={t.common.delete}
                >
                  <Trash2 className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                </button>
              </div>
              {isOpen && draft && (
                <div className="p-3 space-y-2.5 border-t border-default">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className={labelCls}>{t.models.alias}</label>
                      <input type="text" value={draft.alias}
                        onChange={(event) => patchDraft("alias", event.target.value)} className={inputCls} />
                    </div>
                    <div className="space-y-1">
                      <label className={labelCls}>{t.models.modelName}</label>
                      <input type="text" value={draft.modelName}
                        onChange={(event) => patchDraft("modelName", event.target.value)} className={`${inputCls} font-mono`} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t.models.baseUrl}</label>
                    <input type="url" list={baseUrlListId} value={draft.baseUrl}
                      onChange={(event) => patchDraft("baseUrl", event.target.value)}
                      placeholder={t.models.placeholderBaseUrl} className={`${inputCls} font-mono`} />
                  </div>
                  <div className="space-y-1">
                    <label className={labelCls}>{t.models.apiKey}</label>
                    <input type="password" value={draft.apiKey}
                      onChange={(event) => patchDraft("apiKey", event.target.value)}
                      placeholder={t.models.placeholderApiKey} autoComplete="off" className={`${inputCls} font-mono`} />
                  </div>
                  {advertised && (
                    <p className="text-[10px] text-secondary" title={t.models.executableHint}>
                      {advertised.has(draft.modelName) ? t.models.canStart : t.models.cannotStart}
                    </p>
                  )}
                  {rowError && <p className="text-[10px] text-danger" role="alert">{rowError}</p>}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => void handleSaveRow()}
                      disabled={busy}
                      className="px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-accent text-on-accent hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
                    >
                      {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                      {t.common.save}
                    </button>
                    <button
                      onClick={() => { setExpandedId(null); setDraft(null); setRowError(""); }}
                      className="px-3 py-1.5 text-[11px] rounded-lg border border-default text-secondary hover:bg-subtle"
                    >
                      {t.common.cancel}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <p className="text-[10px] text-secondary pt-1">
          {t.models.aliasDescription}
        </p>
      </div>
    </div>
  );
}

export { getModelDefinitionByAlias };
