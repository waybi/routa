"use client";

/**
 * Settings card: global per-tier default models for DSH lane agents.
 * Sits on top of Settings › Specialists; values are stored server side
 * (GET/PUT /api/kanban/model-tiers) and read when each lane agent starts.
 */
import { useMemo, useState } from "react";
import { Cpu, Info } from "lucide-react";

import { useTranslation } from "@/i18n";
import { useModelEffortChoices } from "@/client/model-effort/use-model-effort-choices";
import {
  filterLaneModelChoices,
  KANBAN_MODEL_TIER_KEYS,
  saveKanbanModelTier,
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
  const [saveState, setSaveState] = useState<SaveState>(null);

  const handleChange = async (tier: KanbanModelTierKey, value: string) => {
    setSaveState({ tier, status: "saving" });
    try {
      setData(await saveKanbanModelTier(tier, value || null, specialistLocale));
      setSaveState({ tier, status: "saved" });
    } catch (reason) {
      setSaveState({ tier, status: "error", error: reason instanceof Error ? reason.message : String(reason) });
    }
  };

  return (
    <section
      className="mx-4 mt-4 rounded-md border border-desktop-accent/40 border-l-4 border-l-desktop-accent bg-desktop-bg-secondary px-4 py-3"
      data-testid="kanban-model-tiers-card"
    >
      <div className="flex items-start gap-2">
        <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-desktop-accent" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-semibold text-desktop-text-primary">{copy.title}</h2>
          <p className="mt-0.5 text-[11px] leading-5 text-desktop-text-secondary">{copy.description}</p>
          <p className="mt-0.5 text-[11px] leading-5 text-desktop-text-muted">{copy.order}</p>
        </div>
      </div>

      {error && !data ? (
        <p className="mt-3 text-[11px] text-red-600 dark:text-red-400">{copy.loadFailed.replace("{error}", error)}</p>
      ) : null}

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {KANBAN_MODEL_TIER_KEYS.map((tier) => (
          <TierRow
            key={tier}
            tier={tier}
            data={data}
            laneModels={laneModels}
            saveState={saveState?.tier === tier ? saveState : null}
            onChange={(value) => void handleChange(tier, value)}
          />
        ))}
      </div>

      {data && laneModels.length === 0 ? (
        <p className="mt-2 text-[10px] text-desktop-text-muted">{copy.noModels}</p>
      ) : null}
    </section>
  );
}

function TierRow({
  tier,
  data,
  laneModels,
  saveState,
  onChange,
}: {
  tier: KanbanModelTierKey;
  data: KanbanModelTiersData | null;
  laneModels: Array<{ value: string; label: string }>;
  saveState: SaveState;
  onChange: (value: string) => void;
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

  return (
    <div
      className="rounded-sm border border-desktop-border bg-desktop-bg-primary px-3 py-2"
      title={tooltip}
      data-testid={`kanban-model-tier-${tier}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TIER_CHIP[tier]}`}>
          {tierLabel}
          <Info className="h-3 w-3" aria-label={tooltip} />
        </span>
        {saveState ? (
          <span className={`text-[10px] ${saveState.status === "error" ? "text-red-600 dark:text-red-400" : "text-desktop-text-muted"}`}>
            {saveState.status === "saving"
              ? copy.saving
              : saveState.status === "saved"
                ? copy.saved
                : copy.saveFailed.replace("{error}", saveState.error ?? "")}
          </span>
        ) : null}
      </div>
      <Select
        value={value}
        disabled={!data || saveState?.status === "saving"}
        onChange={(event) => onChange(event.target.value)}
        aria-label={`${copy.title} · ${tierLabel}`}
        className="mt-2 w-full px-2 py-1.5 text-[12px] font-mono"
        data-testid={`kanban-model-tier-${tier}-select`}
      >
        <option value="">{copy.followCodeDefault.replace("{model}", state?.codeDefault ?? "…")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </Select>
      {state ? (
        <p className="mt-1.5 text-[11px] text-desktop-text-secondary">
          <span className="font-mono font-semibold text-desktop-text-primary">
            {copy.effective.replace("{model}", state.effective)}
          </span>
          <span className="ml-1 text-desktop-text-muted">
            ({state.override ? copy.sourceGlobal : copy.sourceCode})
          </span>
        </p>
      ) : null}
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
