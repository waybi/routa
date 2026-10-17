"use client";

/**
 * Model / reasoning-effort capsule for the active session, rendered in the
 * composer toolbar. Which parts show is decided only by the configOptions the
 * agent advertised (no provider-name checks).
 *
 * Values stay in the agent's raw form (DSH model values are
 * `["<provider>","<model>"]` JSON strings) because POST
 * /api/sessions/{id}/config-options only accepts advertised values. The POST
 * reply replaces the whole configOptions array, so nothing is stored here.
 */

import { useMemo } from "react";
import {
  MODEL_CONFIG_ID,
  REASONING_EFFORT_CONFIG_ID,
  findOption,
  flattenOptionValues,
  parseModelValue,
  summarizeConfigOptions,
  type AcpConfigOption,
} from "@/core/acp/config-options";
import { parseModelEffortChoices } from "@/client/model-effort/model-effort-choices";
import { useTranslation } from "@/i18n";
import { ModelEffortPicker } from "../../model-effort-picker";

export interface SessionConfigSelectsProps {
  configOptions: AcpConfigOption[] | null;
  /** Session has no live agent process (404): read-only. */
  unavailable: boolean;
  /** A change is in flight: the picker is disabled. */
  pending: boolean;
  /** Model stored for the session (used read-only when unavailable). */
  fallbackModel?: string;
  /** Called once per changed option, model first (changing the model resets the effort). */
  onChange: (configId: string, value: string) => void | Promise<void>;
}

/** Whether the toolbar should reserve a slot for the session capsule. */
export function hasSessionConfigPicker({
  configOptions,
  unavailable,
  fallbackModel,
}: Pick<SessionConfigSelectsProps, "configOptions" | "unavailable" | "fallbackModel">): boolean {
  const options = configOptions ?? undefined;
  const hasOptions = Boolean(findOption(options, MODEL_CONFIG_ID) || findOption(options, REASONING_EFFORT_CONFIG_ID));
  return hasOptions || Boolean(unavailable && fallbackModel);
}

export function SessionConfigSelects({
  configOptions,
  unavailable,
  pending,
  fallbackModel,
  onChange,
}: SessionConfigSelectsProps) {
  const { t } = useTranslation();
  const labels = t.chat.sessionConfig;
  const options = configOptions ?? undefined;
  const modelOption = findOption(options, MODEL_CONFIG_ID);
  const rawModel = typeof modelOption?.currentValue === "string" ? modelOption.currentValue : "";
  const model = rawModel || (unavailable ? fallbackModel ?? "" : "");
  const choices = useMemo(() => {
    const parsed = parseModelEffortChoices({ configOptions: options ?? [] }, { keepRawModelValues: true });
    // A current value the agent does not list still shows its model id, not the raw JSON.
    if (!model || parsed.models.some((choice) => choice.value === model)) return parsed;
    const label = parseModelValue(model)?.model ?? model;
    return { ...parsed, models: [...parsed.models, { value: model, label }] };
  }, [options, model]);

  if (!hasSessionConfigPicker({ configOptions, unavailable, fallbackModel })) return null;

  const effortOption = findOption(options, REASONING_EFFORT_CONFIG_ID);
  const summary = summarizeConfigOptions(options);
  // "" is a real value (provider default effort); never coerce it with `||`.
  const effort = summary.reasoningEffort ?? "";
  const effortListsDefault = flattenOptionValues(effortOption).some((entry) => entry.value === "");

  const handleChange = async (next: { model: string; reasoningEffort: string }) => {
    if (next.model && next.model !== model) await onChange(MODEL_CONFIG_ID, next.model);
    if (effortOption && next.reasoningEffort !== effort) await onChange(REASONING_EFFORT_CONFIG_ID, next.reasoningEffort);
  };

  return (
    <ModelEffortPicker
      choices={choices}
      model={model}
      reasoningEffort={effort}
      onChange={(next) => void handleChange(next)}
      disabled={pending}
      readOnlyReason={unavailable ? labels.resumeToSwitch : undefined}
      emptyLabel={labels.unknownModel}
      effortEmptyLabel={summary.reasoningEffort === undefined ? labels.unknownEffort : labels.defaultEffort}
      allowDefaultModel={false}
      allowDefaultEffort={effortListsDefault}
      ariaLabel={`${labels.model} / ${labels.reasoningEffort}`}
      testIdPrefix="session-config-picker"
    />
  );
}
