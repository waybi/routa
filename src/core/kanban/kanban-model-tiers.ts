/**
 * Global per-tier default models for DSH lane agents ("看板施工者默认模型").
 *
 * Lane model resolution (first non-blank wins):
 *   card assignedModel > column step model > specialist model
 *   > these global tier overrides > PROVIDER_MODEL_TIERS.dsh > acp profile default.
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
export type KanbanModelTierOverrides = Partial<Record<KanbanModelTierKey, string>>;

/** Only DSH lane agents read the overrides; they hold Local 7357 model ids. */
export const KANBAN_MODEL_TIER_PROVIDER_ID = "dsh";

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

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

function sanitizeOverrides(raw: unknown): KanbanModelTierOverrides {
  const result: KanbanModelTierOverrides = {};
  if (!raw || typeof raw !== "object") return result;
  const source = (raw as { tiers?: unknown }).tiers ?? raw;
  if (!source || typeof source !== "object") return result;
  for (const key of KANBAN_MODEL_TIER_KEYS) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === "string" && isValidKanbanTierModelId(value.trim())) {
      result[key] = value.trim();
    }
  }
  return result;
}

/** Current overrides; a missing or unreadable file means "no overrides". */
export function readKanbanModelTierOverrides(): KanbanModelTierOverrides {
  const filePath = getKanbanModelTiersFilePath();
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  try {
    return sanitizeOverrides(JSON.parse(text));
  } catch (error) {
    console.warn(`[kanban-model-tiers] Ignoring unreadable ${filePath}:`, error);
    return {};
  }
}

/** Replace the stored overrides (atomic write). Blank tiers are dropped. */
export function writeKanbanModelTierOverrides(overrides: KanbanModelTierOverrides): KanbanModelTierOverrides {
  const clean = sanitizeOverrides(overrides);
  const filePath = getKanbanModelTiersFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify({ tiers: clean, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  fs.renameSync(tmpPath, filePath);
  return clean;
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

export interface KanbanModelTierState {
  override: string | null;
  codeDefault: string;
  effective: string;
}

export function describeKanbanModelTiers(
  overrides: KanbanModelTierOverrides = readKanbanModelTierOverrides(),
): Record<KanbanModelTierKey, KanbanModelTierState> {
  const entries = KANBAN_MODEL_TIER_KEYS.map((key) => {
    const codeDefault = getCodeDefaultTierModel(KANBAN_MODEL_TIER_PROVIDER_ID, key) ?? "";
    const override = overrides[key] ?? null;
    return [key, { override, codeDefault, effective: override ?? codeDefault }] as const;
  });
  return Object.fromEntries(entries) as Record<KanbanModelTierKey, KanbanModelTierState>;
}
