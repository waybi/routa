"use client";

/**
 * Settings card: global per-tier default models and reasoning efforts for
 * DSH lane agents.
 * Sits on top of Settings › Specialists; values are stored server side
 * (GET/PUT /api/kanban/model-tiers) and read when each lane agent starts.
 */
import { Fragment, useId, useMemo, useState } from "react";
import { ChevronRight, Cpu, Info } from "lucide-react";

import { useTranslation } from "@/i18n";
import { useModelEffortChoices } from "@/client/model-effort/use-model-effort-choices";
import { withStoredChoice, type ModelEffortChoice } from "@/client/model-effort/model-effort-choices";
import {
  filterLaneModelChoices,
  KANBAN_MODEL_TIER_KEYS,
  saveKanbanModelTier,
  saveKanbanModelTierEffort,
  toSpecialistLocale,
  useKanbanModelTiers,
  type KanbanModelTierKey,
  type KanbanModelTiersData,
} from "@/client/kanban-model-tiers/use-kanban-model-tiers";
import { Select } from "./select";

const TIER_CHIP: Record<KanbanModelTierKey, string> = {
  fast: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
  balanced: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/40",
  smart: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/40",
};

const KANBAN_SPECIALIST_PREFIX = "kanban-";
/** Position of "this setting" in copy.orderSteps (highlighted). */
const ORDER_HERE_INDEX = 3;

const BADGE_BASE = "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none";
const BADGE_GLOBAL = `${BADGE_BASE} bg-desktop-accent/10 text-desktop-accent`;
const BADGE_DEFAULT = `${BADGE_BASE} bg-desktop-bg-secondary text-desktop-text-muted`;

type SaveState = { tier: KanbanModelTierKey; status: "saving" | "saved" | "error"; error?: string } | null;

export function KanbanModelTiersCard() {
  const { t, locale } = useTranslation();
  const copy = t.kanbanModelTiers;
  const specialistLocale = toSpecialistLocale(locale);
  const { data, error, setData } = useKanbanModelTiers(specialistLocale);
  const choices = useModelEffortChoices([data?.providerId ?? "dsh"]);
  const laneModels = useMemo(
    () => filterLaneModelChoices(choices[data?.providerId ?? "dsh"]?.models),
    [choices, data?.providerId],
  );
  const efforts = choices[data?.providerId ?? "dsh"]?.reasoningEfforts;
  const [saveState, setSaveState] = useState<SaveState>(null);

  const handleChange = async (tier: KanbanModelTierKey, value: string, field: "model" | "effort") => {
    setSaveState({ tier, status: "saving" });
    try {
      setData(field === "model"
        ? await saveKanbanModelTier(tier, value || null, specialistLocale)
        : await saveKanbanModelTierEffort(tier, value || null, specialistLocale));
      setSaveState({ tier, status: "saved" });
    } catch (reason) {
      setSaveState({ tier, status: "error", error: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  return (
    <section
      className="mx-4 mt-4 shrink-0 overflow-hidden rounded-md border border-desktop-border bg-desktop-bg-primary"
      data-testid="kanban-model-tiers-card"
    >
      <header className="border-b border-desktop-border bg-desktop-bg-secondary/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 shrink-0 text-desktop-accent" aria-hidden />
          <h2 className="text-[13px] font-semibold text-desktop-text-primary">{copy.title}</h2>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-desktop-text-secondary">{copy.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] font-medium text-desktop-text-muted">{copy.orderTitle}</span>
          <ol className="flex flex-wrap items-center gap-1" data-testid="kanban-model-tiers-order">
            {copy.orderSteps.map((step, index) => (
              <Fragment key={step}>
                {index > 0 ? <ChevronRight className="h-3 w-3 shrink-0 text-desktop-text-muted" aria-hidden /> : null}
                <li
                  className={`rounded border px-1.5 py-0.5 text-[11px] leading-4 ${
                    index === ORDER_HERE_INDEX
                      ? "border-desktop-accent/60 bg-desktop-accent/10 font-semibold text-desktop-accent"
                      : "border-desktop-border bg-desktop-bg-primary text-desktop-text-secondary"
                  }`}
                >
                  {step}
                </li>
              </Fragment>
            ))}
          </ol>
        </div>
      </header>

      <div className="px-4 py-3">
        {error && !data ? (
          <div className="mb-3 rounded-sm border border-danger bg-danger-subtle px-3 py-2 text-[11px] text-danger">
            {copy.loadFailed.replace("{error}", error)}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-3" data-testid="kanban-model-tiers-grid">
          {KANBAN_MODEL_TIER_KEYS.map((tier) => (
            <TierRow
              key={tier}
              tier={tier}
              data={data}
              laneModels={laneModels}
              efforts={efforts}
              saveState={saveState?.tier === tier ? saveState : null}
              onChange={(value) => void handleChange(tier, value, "model")}
              onEffortChange={(value) => void handleChange(tier, value, "effort")}
            />
          ))}
        </div>

        {data && laneModels.length === 0 ? (
          <p className="mt-2 text-[11px] text-desktop-text-muted">{copy.noModels}</p>
        ) : null}
      </div>
    </section>
  );
}

function TierRow({
  tier,
  data,
  laneModels,
  efforts,
  saveState,
  onChange,
  onEffortChange,
}: {
  tier: KanbanModelTierKey;
  data: KanbanModelTiersData | null;
  laneModels: Array<{ value: string; label: string }>;
  efforts: ModelEffortChoice[] | undefined;
  saveState: SaveState;
  onChange: (value: string) => void;
  onEffortChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const copy = t.kanbanModelTiers;
  const tierLabel = copy.tiers[tier];
  const state = data?.tiers[tier];
  const value = state?.override ?? "";
  const tooltip = useMemo(() => buildTierTooltip(copy, tier, data), [copy, tier, data]);
  const options = useMemo(() => {
    const list = laneModels.map((model) => ({ value: model.value, label: `${model.label} · ${model.value}` }));
    // Keep a stored value visible even if the agent stops listing it.
    if (value && !list.some((option) => option.value === value)) list.unshift({ value, label: value });
    return list;
  }, [laneModels, value]);
  const effortValue = state?.reasoningEffort?.override ?? "";
  // Keep a stored effort visible even if the agent stops listing it.
  const effortOptions = useMemo(() => withStoredChoice(efforts ?? [], effortValue), [efforts, effortValue]);
  const effectiveEffort = state?.reasoningEffort?.effective ?? null;
  const overridden = Boolean(state?.override || state?.reasoningEffort?.override);
  const statusText = !saveState
    ? ""
    : saveState.status === "saving"
      ? copy.saving
      : saveState.status === "saved"
        ? copy.saved
        : copy.saveFailed.replace("{error}", saveState.error ?? "");
  const idBase = useId();
  const chipId = `${idBase}-chip`;
  const modelLabelId = `${idBase}-model-label`;
  const modelSelectId = `${idBase}-model`;
  const effortLabelId = `${idBase}-effort-label`;
  const effortSelectId = `${idBase}-effort`;

  return (
    <div
      className={`flex min-w-0 flex-col rounded-md border bg-desktop-bg-primary px-3 py-2.5 ${
        overridden ? "border-desktop-accent/60" : "border-desktop-border"
      }`}
      title={tooltip}
      data-testid={`kanban-model-tier-${tier}`}
      data-overridden={String(overridden)}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TIER_CHIP[tier]}`}
          >
            <span id={chipId}>{tierLabel}</span>
            <Info className="h-3 w-3 cursor-help opacity-70 transition-opacity hover:opacity-100" aria-label={tooltip} />
          </span>
          {overridden ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-desktop-accent"
              title={copy.overriddenHint}
              data-testid={`kanban-model-tier-${tier}-overridden`}
            >
              <span className="sr-only">{copy.overriddenHint}</span>
            </span>
          ) : null}
        </span>
        <span
          className={`h-4 min-w-0 truncate text-right text-[10px] leading-4 ${
            saveState?.status === "error" ? "text-danger" : "text-desktop-text-muted"
          }`}
          title={statusText || undefined}
          role="status"
          data-testid={`kanban-model-tier-${tier}-status`}
        >
          {statusText}
        </span>
      </div>

      {/* Below xl the tiers stack, so fields and effective values sit side by side to keep each tier short. */}
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-col gap-0.5">
            <label
              id={modelLabelId}
              htmlFor={modelSelectId}
              className="text-[11px] font-medium text-desktop-text-secondary"
            >
              {copy.modelLabel}
            </label>
            <Select
              id={modelSelectId}
              value={value}
              disabled={!data || saveState?.status === "saving"}
              onChange={(event) => onChange(event.target.value)}
              aria-labelledby={`${modelLabelId} ${chipId}`}
              className="w-full min-w-0 px-2 py-1 text-[12px]"
              data-testid={`kanban-model-tier-${tier}-select`}
            >
              <option value="">{copy.followCodeDefault.replace("{model}", state?.codeDefault ?? "…")}</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-0.5">
            <label
              id={effortLabelId}
              htmlFor={effortSelectId}
              className="text-[11px] font-medium text-desktop-text-secondary"
            >
              {copy.effortLabel}
            </label>
            <Select
              id={effortSelectId}
              value={effortValue}
              disabled={!data || saveState?.status === "saving"}
              onChange={(event) => onEffortChange(event.target.value)}
              aria-labelledby={`${effortLabelId} ${chipId}`}
              className="w-full min-w-0 px-2 py-1 text-[12px]"
              data-testid={`kanban-model-tier-${tier}-effort-select`}
            >
              <option value="">{copy.followEffortDefault}</option>
              {effortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
        </div>

        {state ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] content-start items-center gap-x-3 gap-y-1.5 border-t border-desktop-border pt-2.5 text-[11px] sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0 xl:border-l-0 xl:border-t xl:pl-0 xl:pt-2.5">
            <dt className="text-desktop-text-secondary">{copy.effectiveModelLabel}</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-1.5" data-testid={`kanban-model-tier-${tier}-effective`}>
              <span className="min-w-0 break-all font-mono text-desktop-text-primary">{state.effective}</span>
              <span className={state.override ? BADGE_GLOBAL : BADGE_DEFAULT} data-testid={`kanban-model-tier-${tier}-source`}>
                {state.override ? copy.sourceGlobal : copy.sourceCode}
              </span>
            </dd>
            <dt className="text-desktop-text-secondary">{copy.effectiveEffortLabel}</dt>
            <dd
              className="flex min-w-0 flex-wrap items-center gap-1.5"
              data-testid={`kanban-model-tier-${tier}-effort-effective`}
            >
              <span className="min-w-0 text-desktop-text-primary">{effectiveEffort ?? copy.effortAgentDefault}</span>
              <span
                className={effectiveEffort ? BADGE_GLOBAL : BADGE_DEFAULT}
                data-testid={`kanban-model-tier-${tier}-effort-source`}
              >
                {effectiveEffort ? copy.effortSourceGlobal : copy.effortSourceDefault}
              </span>
            </dd>
          </dl>
        ) : null}
      </div>
    </div>
  );
}

export function buildTierTooltip(
  copy: { tiers: Record<KanbanModelTierKey, string>; tierTooltip: string; tierTooltipOthers: string; tierTooltipNone: string },
  tier: KanbanModelTierKey,
  data: KanbanModelTiersData | null,
): string {
  const tierLabel = copy.tiers[tier];
  const users = (data?.specialists ?? []).filter((specialist) => specialist.tier === tier);
  if (users.length === 0) return copy.tierTooltipNone.replace("{tier}", tierLabel);
  const kanban = users.filter((specialist) => specialist.id.startsWith(KANBAN_SPECIALIST_PREFIX));
  const others = users.length - kanban.length;
  return copy.tierTooltip
    .replace("{tier}", tierLabel)
    .replace("{names}", kanban.length > 0 ? kanban.map((specialist) => specialist.name).join("、") : "—")
    .replace("{others}", others > 0 ? copy.tierTooltipOthers.replace("{count}", String(others)) : "");
}
