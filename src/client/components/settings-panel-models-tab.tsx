"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

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
import { useTranslation } from "@/i18n";
import { useConfirm } from "./confirm-dialog";
import { ChevronRight, Info, Plus, Trash2 } from "lucide-react";


export function ModelsTab() {
  const [defs, setDefs] = useState<ModelDefinition[]>(() => loadModelDefinitions());
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [form, setForm] = useState<ModelDefinition>(EMPTY_MODEL_FORM);
  const [aliasError, setAliasError] = useState("");
  const baseUrlListId = useId();
  const aliasInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const confirm = useConfirm();

  const persist = (next: ModelDefinition[]) => {
    setDefs(next);
    saveModelDefinitions(next);
  };

  const handleUpdate = (idx: number, field: keyof ModelDefinition, value: string) => {
    persist(defs.map((definition, definitionIndex) => (definitionIndex === idx ? { ...definition, [field]: value } : definition)));
  };

  const handleDelete = async (idx: number) => {
    if (!(await confirm({ message: `${t.models.deleteConfirm} "${defs[idx].alias}"?`, destructive: true }))) return;
    persist(defs.filter((_, definitionIndex) => definitionIndex !== idx));
    if (expandedIdx === idx) setExpandedIdx(null);
  };

  const handleAddModel = () => {
    const alias = form.alias.trim();
    const modelName = form.modelName.trim();
    if (!alias || !modelName) return;
    if (defs.some((definition) => definition.alias === alias)) {
      setAliasError(`"${alias}" ${t.models.aliasAlreadyExists}`);
      return;
    }
    persist([...defs, { ...form, alias, modelName }]);
    setForm(EMPTY_MODEL_FORM);
    setAliasError("");
    aliasInputRef.current?.focus();
  };

  const handleFormKey = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") handleAddModel();
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
        </div>

        <button
          onClick={handleAddModel}
          disabled={!canAdd}
          className="w-full py-2 text-xs font-semibold rounded-lg bg-accent text-on-accent hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
          {t.models.addModel}
        </button>
      </div>

      {defs.length > 0 && (
        <div className="space-y-1.5">
          <p className={sectionHeadCls}>{t.models.savedModels}</p>
          {defs.map((definition, idx) => {
            const isOpen = expandedIdx === idx;
            return (
              <div key={idx} className="rounded-lg border border-default overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-subtle">
                  <button
                    onClick={() => setExpandedIdx(isOpen ? null : idx)}
                    className="flex-1 flex items-center gap-2 min-w-0 text-left"
                  >
                    <ChevronRight className={`w-3 h-3 text-secondary shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                    <span className="text-xs font-semibold text-primary truncate">{definition.alias}</span>
                    <span className="text-[10px] text-secondary font-mono truncate">→ {definition.modelName}</span>
                    {definition.baseUrl && (
                      <span className="text-[10px] text-accent font-mono truncate hidden sm:block">
                        {definition.baseUrl.replace(/https?:\/\//, "").substring(0, 30)}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => handleDelete(idx)}
                    className="shrink-0 p-1 rounded text-secondary hover:text-danger hover:bg-danger-subtle transition-colors"
                    title={t.common.delete}
                  >
                    <Trash2 className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}/>
                  </button>
                </div>
                {isOpen && (
                  <div className="p-3 space-y-2.5 border-t border-default">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className={labelCls}>{t.models.alias}</label>
                        <input type="text" value={definition.alias}
                          onChange={(event) => handleUpdate(idx, "alias", event.target.value)} className={inputCls} />
                      </div>
                      <div className="space-y-1">
                        <label className={labelCls}>{t.models.modelName}</label>
                        <input type="text" value={definition.modelName}
                          onChange={(event) => handleUpdate(idx, "modelName", event.target.value)} className={`${inputCls} font-mono`} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className={labelCls}>{t.models.baseUrl}</label>
                      <input type="url" list={baseUrlListId} value={definition.baseUrl ?? ""}
                        onChange={(event) => handleUpdate(idx, "baseUrl", event.target.value || "")}
                        placeholder={t.models.placeholderBaseUrl} className={`${inputCls} font-mono`} />
                    </div>
                    <div className="space-y-1">
                      <label className={labelCls}>{t.models.apiKey}</label>
                      <input type="password" value={definition.apiKey ?? ""}
                        onChange={(event) => handleUpdate(idx, "apiKey", event.target.value || "")}
                        placeholder={t.models.placeholderApiKey} autoComplete="off" className={`${inputCls} font-mono`} />
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
      )}
    </div>
  );
}

export { getModelDefinitionByAlias };
