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
}

export interface ModelEffortChoices {
  models: ModelEffortChoice[];
  reasoningEfforts: ModelEffortChoice[];
}

export const EMPTY_MODEL_EFFORT_CHOICES: ModelEffortChoices = { models: [], reasoningEfforts: [] };

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

/** Parse a config-options response body into deduplicated model / effort choices. */
export function parseModelEffortChoices(payload: unknown): ModelEffortChoices {
  const options = extractConfigOptions(payload);
  const models: ModelEffortChoice[] = [];
  const seenModels = new Set<string>();
  for (const entry of flattenOptionValues(findOption(options, MODEL_CONFIG_ID))) {
    const modelId = parseModelValue(entry.value)?.model;
    if (!modelId || seenModels.has(modelId)) continue;
    seenModels.add(modelId);
    models.push({ value: modelId, label: entry.name?.trim() || modelId });
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
