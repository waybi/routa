"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { resolveApiPath } from "@/client/config/backend";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { Select } from "@/client/components/select";
import { useTranslation } from "@/i18n";
import {
  EMPTY_MODEL_EFFORT_CHOICES,
  parseModelEffortChoices,
  withStoredChoice,
  type ModelEffortChoices,
} from "./kanban-model-effort-options";

// One successful request per provider id per page load; settings modal
// columns and card details share it, so switching column or card does not
// refetch.
const choicesRequests = new Map<string, Promise<ModelEffortChoices>>();

/** Test hook: forget cached config-options responses. */
export function resetModelEffortChoicesCache(): void {
  choicesRequests.clear();
}

function loadModelEffortChoices(providerId: string): Promise<ModelEffortChoices> {
  const cached = choicesRequests.get(providerId);
  if (cached) return cached;
  const request = (async () => {
    try {
      const response = await desktopAwareFetch(
        resolveApiPath(`/providers/${encodeURIComponent(providerId)}/config-options`),
        { cache: "no-store" },
      );
      if (response.ok) return parseModelEffortChoices(await response.json());
    } catch {
      // Options unavailable: keep "follow default" and the stored value only.
    }
    // Do not cache a failure; the next mount retries.
    choicesRequests.delete(providerId);
    return EMPTY_MODEL_EFFORT_CHOICES;
  })();
  choicesRequests.set(providerId, request);
  return request;
}

/**
 * Model / effort choices for each provider id. A failed or empty probe leaves
 * the provider with no choices; the dropdowns then only offer "follow
 * default" plus any stored value.
 */
export function useModelEffortChoices(providerIds: string[]): Record<string, ModelEffortChoices> {
  const [choicesByProvider, setChoicesByProvider] = useState<Record<string, ModelEffortChoices>>({});
  const providerKey = Array.from(new Set(providerIds.filter(Boolean))).sort().join("\n");

  useEffect(() => {
    let active = true;
    for (const providerId of providerKey ? providerKey.split("\n") : []) {
      void loadModelEffortChoices(providerId).then((choices) => {
        if (!active) return;
        setChoicesByProvider((current) => (
          current[providerId] === choices ? current : { ...current, [providerId]: choices }
        ));
      });
    }
    return () => {
      active = false;
    };
  }, [providerKey]);

  return choicesByProvider;
}

export function ModelEffortSelects({
  choices,
  model,
  reasoningEffort,
  onModelChange,
  onReasoningEffortChange,
  selectClassName,
  testIdPrefix,
  labelSuffix = "",
  renderField = (_label, control) => control,
}: {
  choices: ModelEffortChoices | undefined;
  model: string | undefined;
  reasoningEffort: string | undefined;
  onModelChange: (value: string) => void;
  onReasoningEffortChange: (value: string) => void;
  selectClassName: string;
  testIdPrefix: string;
  labelSuffix?: string;
  renderField?: (label: string, control: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation();
  const copy = t.kanbanModelSelection;
  const modelChoices = useMemo(
    () => withStoredChoice(choices?.models ?? [], model),
    [choices, model],
  );
  const effortChoices = useMemo(
    () => withStoredChoice(choices?.reasoningEfforts ?? [], reasoningEffort),
    [choices, reasoningEffort],
  );
  const modelLabel = `${copy.model}${labelSuffix}`;
  const effortLabel = `${copy.reasoningEffort}${labelSuffix}`;

  return (
    <>
      {renderField(modelLabel, (
        <Select
          aria-label={modelLabel}
          data-testid={`${testIdPrefix}-model`}
          value={model ?? ""}
          onChange={(event) => onModelChange(event.target.value)}
          className={selectClassName}
        >
          <option value="">{copy.followDefault}</option>
          {modelChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.label}</option>
          ))}
        </Select>
      ))}
      {renderField(effortLabel, (
        <Select
          aria-label={effortLabel}
          data-testid={`${testIdPrefix}-reasoning-effort`}
          value={reasoningEffort ?? ""}
          onChange={(event) => onReasoningEffortChange(event.target.value)}
          className={selectClassName}
        >
          <option value="">{copy.followDefault}</option>
          {effortChoices.map((choice) => (
            <option key={choice.value} value={choice.value}>{choice.label}</option>
          ))}
        </Select>
      ))}
    </>
  );
}
