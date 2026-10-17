"use client";

import { useEffect, useState } from "react";
import { resolveApiPath } from "@/client/config/backend";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import {
  EMPTY_MODEL_EFFORT_CHOICES,
  parseModelEffortChoices,
  type ModelEffortChoices,
} from "./model-effort-choices";

// One successful request per provider id per page load; the composer, the
// settings modal columns and card details share it, so switching column, card
// or page does not refetch. Cache-less config-options requests start an agent
// probe on the server, so never request per render.
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
 * the provider with no choices; pickers then only offer "follow default" plus
 * any stored value.
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
