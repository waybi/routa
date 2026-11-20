/**
 * Model / reasoning-effort choices shared by the new-session composer, the
 * session page and the Kanban lane / card settings.
 *
 * Options come from GET /api/providers/{providerId}/config-options and are
 * parsed with the shared ACP configOptions helpers. The selected value is a
 * plain model id (what session/new expects), not the raw select value.
 */

import {
  MODEL_CONFIG_ID,
  REASONING_EFFORT_CONFIG_ID,
  extractConfigOptions,
  findOption,
  flattenOptionValues,
  parseModelValue,
} from "@/core/acp/config-options";

export const MODEL_EFFORT_FALLBACK_PROVIDER_ID = "dsh";

export interface ModelEffortChoice {
  value: string;
  label: string;
  /** Display name of the config-options group the value came from (models only). */
  group?: string;
  /** `custom` marks a Routa-owned alias; `provider` items come from the agent probe. */
  source?: "provider" | "custom";
}

export interface ModelEffortChoices {
  models: ModelEffortChoice[];
  reasoningEfforts: ModelEffortChoice[];
  /** Set when both the catalog and the direct probe failed; explains an empty picker. */
  error?: string;
}

export const EMPTY_MODEL_EFFORT_CHOICES: ModelEffortChoices = { models: [], reasoningEfforts: [] };

export interface CatalogChoiceEntry {
  value: string;
  rawValue?: string;
  label?: string;
  group?: string;
  source?: "provider" | "custom";
}

/**
 * Parse `GET /api/models/catalog` into the same shape as config-options.
 *
 * A custom entry is an alias for a real model id, so the selectable value is
 * always its `rawValue`: Kanban/session/new only understand the real id. When
 * an alias shadows an advertised model, the alias wins and the advertised row
 * is hidden, so the same model never appears twice.
 */
export function parseCatalogChoices(
  payload: unknown,
  { keepRawModelValues = true }: ParseModelEffortChoicesOptions = {},
): ModelEffortChoices {
  const record = (payload ?? {}) as { entries?: unknown; reasoningEfforts?: unknown };
  const rawEntries = Array.isArray(record.entries) ? record.entries : [];

  const customModelIds = new Set<string>();
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as CatalogChoiceEntry;
    if (entry.source !== "custom") continue;
    const modelId = entry.rawValue?.trim();
    if (modelId) customModelIds.add(modelId);
  }

  const models: ModelEffortChoice[] = [];
  const seenModels = new Set<string>();
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as CatalogChoiceEntry;
    const custom = entry.source === "custom";
    if (!custom && customModelIds.has(entry.value)) continue;
    const rawValue = entry.rawValue?.trim();
    // Custom aliases always resolve to the real id; provider rows keep their raw
    // select value only when the caller needs it (live-session POST).
    const value = custom || keepRawModelValues ? (rawValue || entry.value) : entry.value;
    if (!value || seenModels.has(value)) continue;
    seenModels.add(value);
    models.push({
      value,
      label: entry.label?.trim() || value,
      source: custom ? "custom" : "provider",
      ...(entry.group ? { group: entry.group } : {}),
    });
  }

  const reasoningEfforts: ModelEffortChoice[] = [];
  const seenEfforts = new Set<string>();
  const rawEfforts = Array.isArray(record.reasoningEfforts) ? record.reasoningEfforts : [];
  for (const raw of rawEfforts) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { value?: unknown; label?: unknown };
    const value = typeof entry.value === "string" ? entry.value.trim() : "";
    if (!value || seenEfforts.has(value)) continue;
    seenEfforts.add(value);
    const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : value;
    reasoningEfforts.push({ value, label });
  }

  return { models, reasoningEfforts };
}

/** First non-blank provider id, else `dsh`. */
export function resolveModelOptionsProviderId(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return MODEL_EFFORT_FALLBACK_PROVIDER_ID;
}

export interface ParseModelEffortChoicesOptions {
  /**
   * Keep the agent's raw model select value (DSH: `["<provider>","<model>"]`)
   * instead of the plain model id. The live-session POST needs the raw value;
   * session/new and Kanban fields store the plain id.
   */
  keepRawModelValues?: boolean;
}

/** Parse a config-options response body into deduplicated model / effort choices. */
export function parseModelEffortChoices(
  payload: unknown,
  { keepRawModelValues = true }: ParseModelEffortChoicesOptions = {},
): ModelEffortChoices {
  const options = extractConfigOptions(payload);
  const modelOption = findOption(options, MODEL_CONFIG_ID);
  const groupLabels = new Map<string, string>();
  for (const entry of modelOption?.options ?? []) {
    if (entry && typeof entry === "object" && "group" in entry && typeof entry.group === "string") {
      groupLabels.set(entry.group, entry.name?.trim() || entry.group);
    }
  }

  const models: ModelEffortChoice[] = [];
  const seenModels = new Set<string>();
  for (const entry of flattenOptionValues(modelOption)) {
    const modelId = parseModelValue(entry.value)?.model;
    const value = keepRawModelValues ? entry.value : modelId;
    if (!modelId || !value || seenModels.has(value)) continue;
    seenModels.add(value);
    const group = entry.group ? groupLabels.get(entry.group) ?? entry.group : undefined;
    models.push({ value, label: entry.name?.trim() || modelId, ...(group ? { group } : {}) });
  }

  const reasoningEfforts: ModelEffortChoice[] = [];
  const seenEfforts = new Set<string>();
  for (const entry of flattenOptionValues(findOption(options, REASONING_EFFORT_CONFIG_ID))) {
    // "" is the agent's own "provider default"; the "follow default" item covers it.
    if (!entry.value || seenEfforts.has(entry.value)) continue;
    seenEfforts.add(entry.value);
    reasoningEfforts.push({ value: entry.value, label: entry.name?.trim() || entry.value });
  }

  return { models, reasoningEfforts };
}

/** Display name for a stored value, falling back to the raw id when no choice lists it. */
export function findChoiceLabel(
  choices: ModelEffortChoice[] | undefined,
  value: string | undefined,
): string | undefined {
  const wanted = value?.trim();
  if (!wanted) return undefined;
  return choices?.find((choice) => choice.value === wanted)?.label ?? wanted;
}

/**
 * Keep a stored value selectable even when the current options do not list it
 * (provider switched, probe failed), so it is shown instead of silently reset.
 */
export function withStoredChoice(
  choices: ModelEffortChoice[],
  storedValue: string | undefined,
): ModelEffortChoice[] {
  const stored = storedValue?.trim();
  if (!stored || choices.some((choice) => choice.value === stored)) return choices;
  return [...choices, { value: stored, label: stored }];
}
