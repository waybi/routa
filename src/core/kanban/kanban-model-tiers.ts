/**
 * Global per-tier default models for DSH lane agents ("看板施工者默认模型").
 *
 * Lane model resolution (first non-blank wins):
 *   card assignedModel > column step model > specialist model
 *   > these global tier overrides > PROVIDER_MODEL_TIERS.dsh > acp profile default.
 *
 * Lane reasoning effort resolution (first non-blank wins):
 *   card assignedReasoningEffort > column step reasoningEffort
 *   > this tier's global reasoning effort (dsh only) > acp profile default.
 *
 * File format: { tiers: { fast: { model?, reasoningEffort? } }, updatedAt }.
 * The legacy format (tiers.fast is a model string) is read as { model } and
 * upgraded on the next write; it is only normalized here, at read time.
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
  model?: string;
  reasoningEffort?: string;
}
/** Full per-tier settings: model and reasoning effort, each optional. */
export type KanbanModelTierSettings = Partial<Record<KanbanModelTierKey, KanbanTierSetting>>;

/** Only DSH lane agents read the overrides; they hold Local 7357 model ids. */
export const KANBAN_MODEL_TIER_PROVIDER_ID = "dsh";

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

export function isValidKanbanTierModelId(value: string): boolean {
  return MODEL_ID_PATTERN.test(value);
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
      const model = cleanModel(value);
      if (model) setting.model = model;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
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
    next[key] = { model: cleanModel(overrides[key]), reasoningEffort: current[key]?.reasoningEffort };
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
 * the column step nor the specialist names one: the global override for DSH,
 * else the code tier table. Undefined when the provider has no tier table
 * (the agent then runs its own default).
 */
export function resolveTierModelForProvider(
  providerId: string,
  tier: ModelTier | string | undefined,
  overrides: KanbanModelTierOverrides = providerId === KANBAN_MODEL_TIER_PROVIDER_ID
    ? readKanbanModelTierOverrides()
    : {},
): string | undefined {
  const tierKey = modelTierToKey(tier);
  if (!tierKey || !PROVIDER_MODEL_TIERS[providerId]) return undefined;
  if (providerId === KANBAN_MODEL_TIER_PROVIDER_ID && overrides[tierKey]) {
    return overrides[tierKey];
  }
  return getCodeDefaultTierModel(providerId, tierKey);
}

/**
 * The reasoning effort a DSH session gets from its specialist tier when
 * neither the card nor the column step names one. Undefined for other
 * providers, without a tier, or when the tier has none (acp default applies).
 */
export function resolveTierReasoningEffortForProvider(
  providerId: string,
  tier: ModelTier | string | undefined,
  settings?: KanbanModelTierSettings,
): string | undefined {
  if (providerId !== KANBAN_MODEL_TIER_PROVIDER_ID) return undefined;
  const tierKey = modelTierToKey(tier);
  if (!tierKey) return undefined;
  return (settings ?? readKanbanModelTierSettings())[tierKey]?.reasoningEffort;
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
