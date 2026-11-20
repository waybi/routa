/**
 * Global per-tier default models for lane agents ("看板施工者默认模型").
 *
 * Lane model resolution (first non-blank wins):
 *   card assignedModel > column step model > specialist model
 *   > the global tier entry for this provider > PROVIDER_MODEL_TIERS[provider]
 *   > acp profile default.
 *
 * Lane reasoning effort resolution (first non-blank wins):
 *   card assignedReasoningEffort > column step reasoningEffort
 *   > the global tier effort for this provider > acp profile default.
 *
 * File format: { tiers: { fast: { provider?, model?, reasoningEffort? } }, updatedAt }.
 * `provider` names the lane the entry belongs to; when absent, the entry is
 * treated as dsh. A legacy bare model string is read as { model } and only
 * ever applies to dsh, so existing configs keep working unchanged.
 *
 * Non-dsh lanes must name a full "provider/model" model (e.g.
 * "deepseek-official/deepseek-flash"): pi-acp expands a bare id through PI
 * settings' defaultProvider, which is unset on this box and would be
 * ambiguous. We never synthesize that prefix — a guessed provider resolves to
 * the wrong upstream. dsh keeps bare local gateway ids.
 *
 * The overrides live in a small JSON file next to the user specialists
 * (~/.routa/kanban-model-tiers.json), so they survive restarts and are shared
 * by every board. The file is re-read on every lookup: it is tiny and a
 * settings change must reach the next lane session without a restart.
 */
import fs from "fs";
import os from "os";
import path from "path";

import { ModelTier } from "@/core/models/agent";
import { getModelForProvider, PROVIDER_MODEL_TIERS } from "@/core/acp/provider-registry";

export const KANBAN_MODEL_TIER_KEYS = ["fast", "balanced", "smart"] as const;
export type KanbanModelTierKey = (typeof KANBAN_MODEL_TIER_KEYS)[number];
/** Per-tier model ids only (the model half of the settings). */
export type KanbanModelTierOverrides = Partial<Record<KanbanModelTierKey, string>>;

export interface KanbanTierSetting {
  /** Lane this entry targets. Absent means dsh (legacy format). */
  provider?: string;
  model?: string;
  reasoningEffort?: string;
}
/** Full per-tier settings: provider, model and reasoning effort, each optional. */
export type KanbanModelTierSettings = Partial<Record<KanbanModelTierKey, KanbanTierSetting>>;

/** Lane used by tier entries that do not name one (legacy format). */
export const KANBAN_MODEL_TIER_PROVIDER_ID = "dsh";

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const REASONING_EFFORT_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

export function getKanbanModelTiersFilePath(): string {
  const override = process.env.ROUTA_KANBAN_MODEL_TIERS_FILE?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".routa", "kanban-model-tiers.json");
}

export function isKanbanModelTierKey(value: unknown): value is KanbanModelTierKey {
  return typeof value === "string" && (KANBAN_MODEL_TIER_KEYS as readonly string[]).includes(value);
}

export function isValidKanbanTierProviderId(value: string): boolean {
  return PROVIDER_ID_PATTERN.test(value);
}

export function isValidKanbanTierModelId(value: string): boolean {
  if (MODEL_ID_PATTERN.test(value)) return true;
  // DSH advertises its select values as `["provider","model"]` tuples. Keep the
  // tuple so two providers offering the same bare id stay distinct; a bare id
  // alone cannot say which upstream the lane must start.
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === "string"
      && isValidKanbanTierProviderId(parsed[0])
      && typeof parsed[1] === "string"
      && MODEL_ID_PATTERN.test(parsed[1]);
  } catch {
    return false;
  }
}

export function isValidKanbanTierReasoningEffort(value: string): boolean {
  return REASONING_EFFORT_PATTERN.test(value);
}

export function modelTierToKey(tier: ModelTier | string | undefined): KanbanModelTierKey | undefined {
  switch (typeof tier === "string" ? tier.toUpperCase() : undefined) {
    case ModelTier.FAST:
      return "fast";
    case ModelTier.BALANCED:
      return "balanced";
    case ModelTier.SMART:
      return "smart";
    default:
      return undefined;
  }
}

function cleanModel(value: unknown): string | undefined {
  return typeof value === "string" && isValidKanbanTierModelId(value.trim()) ? value.trim() : undefined;
}

function cleanEffort(value: unknown): string | undefined {
  return typeof value === "string" && isValidKanbanTierReasoningEffort(value.trim()) ? value.trim() : undefined;
}

/**
 * A non-dsh lane may only consume a model that already carries an explicit
 * "provider/model" prefix. Never build that prefix ourselves: pi-acp would
 * fall back to PI settings' defaultProvider (unset here), and a wrong guess
 * would route the session to the wrong upstream.
 */
function hasProviderPrefix(model: string): boolean {
  const slash = model.indexOf("/");
  return slash > 0
    && slash < model.length - 1
    && isValidKanbanTierProviderId(model.slice(0, slash))
    && isValidKanbanTierModelId(model.slice(slash + 1));
}

/**
 * The single normalization point: accepts the current format, the legacy
 * string-per-tier format and a bare tiers record. Invalid values are dropped,
 * tiers left empty are omitted.
 */
function sanitizeSettings(raw: unknown): KanbanModelTierSettings {
  const result: KanbanModelTierSettings = {};
  if (!raw || typeof raw !== "object") return result;
  const source = (raw as { tiers?: unknown }).tiers ?? raw;
  if (!source || typeof source !== "object") return result;
  for (const key of KANBAN_MODEL_TIER_KEYS) {
    const value = (source as Record<string, unknown>)[key];
    const setting: KanbanTierSetting = {};
    if (typeof value === "string") {
      // Legacy bare model: dsh only, no explicit provider recorded.
      const model = cleanModel(value);
      if (model) setting.model = model;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      const rawProvider = (value as KanbanTierSetting).provider;
      // An explicitly written but invalid provider drops the whole tier:
      // never let a typo silently retarget the entry to dsh.
      if (rawProvider !== undefined && rawProvider !== null
        && (typeof rawProvider !== "string" || !isValidKanbanTierProviderId(rawProvider.trim()))) {
        continue;
      }
      if (typeof rawProvider === "string" && rawProvider.trim()) {
        setting.provider = rawProvider.trim();
      }
      const model = cleanModel((value as KanbanTierSetting).model);
      const reasoningEffort = cleanEffort((value as KanbanTierSetting).reasoningEffort);
      if (model) setting.model = model;
      if (reasoningEffort) setting.reasoningEffort = reasoningEffort;
    }
    if (setting.model || setting.reasoningEffort) result[key] = setting;
  }
  return result;
}

/** Current settings; a missing or unreadable file means "no settings". */
export function readKanbanModelTierSettings(): KanbanModelTierSettings {
  const filePath = getKanbanModelTiersFilePath();
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  try {
    return sanitizeSettings(JSON.parse(text));
  } catch (error) {
    console.warn(`[kanban-model-tiers] Ignoring unreadable ${filePath}:`, error);
    return {};
  }
}

/** Replace the stored settings (atomic write, new format). Blank fields and tiers are dropped. */
export function writeKanbanModelTierSettings(settings: KanbanModelTierSettings): KanbanModelTierSettings {
  const clean = sanitizeSettings({ tiers: settings });
  const filePath = getKanbanModelTiersFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify({ tiers: clean, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
  return clean;
}

function toOverrides(settings: KanbanModelTierSettings): KanbanModelTierOverrides {
  const result: KanbanModelTierOverrides = {};
  for (const key of KANBAN_MODEL_TIER_KEYS) {
    const model = settings[key]?.model;
    if (model) result[key] = model;
  }
  return result;
}

/** Current per-tier models (the model half of the settings). */
export function readKanbanModelTierOverrides(): KanbanModelTierOverrides {
  return toOverrides(readKanbanModelTierSettings());
}

/**
 * Replace the stored per-tier models. Only the model half changes: each
 * tier's stored reasoning effort is kept. Blank or invalid models are dropped.
 */
export function writeKanbanModelTierOverrides(overrides: KanbanModelTierOverrides): KanbanModelTierOverrides {
  const current = readKanbanModelTierSettings();
  const next: KanbanModelTierSettings = {};
  for (const key of KANBAN_MODEL_TIER_KEYS) {
    next[key] = {
      provider: current[key]?.provider,
      model: cleanModel(overrides[key]),
      reasoningEffort: current[key]?.reasoningEffort,
    };
  }
  return toOverrides(writeKanbanModelTierSettings(next));
}

/** Code default (PROVIDER_MODEL_TIERS) for a provider tier, if the provider has a tier table. */
export function getCodeDefaultTierModel(providerId: string, tier: KanbanModelTierKey): string | undefined {
  if (!PROVIDER_MODEL_TIERS[providerId]) return undefined;
  return getModelForProvider(providerId, tier);
}

/**
 * The model a session gets from its specialist tier when neither the card,
 * the column step nor the specialist names one: the global tier entry that
 * targets this provider, else the provider's code tier table. Undefined when
 * neither exists (the agent then runs its own default).
 *
 * An entry targets a provider through its `provider` field; missing means dsh
 * (legacy format). A non-dsh entry is only handed down when its model already
 * carries a "provider/model" prefix — the caller never synthesizes one.
 */
export function resolveTierModelForProvider(
  providerId: string,
  tier: ModelTier | string | undefined,
  settings: KanbanModelTierSettings = readKanbanModelTierSettings(),
): string | undefined {
  const tierKey = modelTierToKey(tier);
  if (!tierKey) return undefined;
  const entry = settings[tierKey];
  if (entry?.model && (entry.provider ?? KANBAN_MODEL_TIER_PROVIDER_ID) === providerId) {
    if (providerId === KANBAN_MODEL_TIER_PROVIDER_ID || hasProviderPrefix(entry.model)) {
      return entry.model;
    }
    console.warn(
      `[kanban-model-tiers] Ignoring ${tierKey} model "${entry.model}" for ${providerId}: expected provider/model prefix`,
    );
  }
  return getCodeDefaultTierModel(providerId, tierKey);
}

/**
 * The reasoning effort a session gets from its specialist tier when neither
 * the card nor the column step names one. The entry's `provider` (absent =
 * dsh) must match the lane. Undefined without a tier or when the tier has
 * none (acp default applies).
 */
export function resolveTierReasoningEffortForProvider(
  providerId: string,
  tier: ModelTier | string | undefined,
  settings?: KanbanModelTierSettings,
): string | undefined {
  const tierKey = modelTierToKey(tier);
  if (!tierKey) return undefined;
  const entry = (settings ?? readKanbanModelTierSettings())[tierKey];
  if (!entry || (entry.provider ?? KANBAN_MODEL_TIER_PROVIDER_ID) !== providerId) return undefined;
  return entry.reasoningEffort;
}

export interface KanbanModelTierState {
  override: string | null;
  codeDefault: string;
  effective: string;
  /** null effective = no global effort, the acp profile default applies. */
  reasoningEffort: { override: string | null; effective: string | null };
}

export function describeKanbanModelTiers(
  settings: KanbanModelTierSettings = readKanbanModelTierSettings(),
): Record<KanbanModelTierKey, KanbanModelTierState> {
  const entries = KANBAN_MODEL_TIER_KEYS.map((key) => {
    const codeDefault = getCodeDefaultTierModel(KANBAN_MODEL_TIER_PROVIDER_ID, key) ?? "";
    const override = settings[key]?.model ?? null;
    const effort = settings[key]?.reasoningEffort ?? null;
    return [key, {
      override,
      codeDefault,
      effective: override ?? codeDefault,
      reasoningEffort: { override: effort, effective: effort },
    }] as const;
  });
  return Object.fromEntries(entries) as Record<KanbanModelTierKey, KanbanModelTierState>;
}
