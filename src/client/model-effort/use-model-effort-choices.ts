"use client";

import { useEffect, useState } from "react";
import { resolveApiPath } from "@/client/config/backend";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import {
  EMPTY_MODEL_EFFORT_CHOICES,
  parseCatalogChoices,
  parseModelEffortChoices,
  type ModelEffortChoices,
} from "./model-effort-choices";

// One successful request per provider id per page load; the composer, the
// settings modal columns and card details share it, so switching column, card
// or page does not refetch. Cache-less config-options requests start an agent
// probe on the server, so never request per render.
const choicesRequests = new Map<string, Promise<ModelEffortChoices>>();

// Mounted pickers subscribe so an explicit refresh updates every dropdown
// without refetching on render.
type ChoicesListener = (providerId: string, choices: ModelEffortChoices) => void;
const listeners = new Set<ChoicesListener>();

/** Test hook: forget cached choices responses. */
export function resetModelEffortChoicesCache(): void {
  choicesRequests.clear();
  listeners.clear();
}

interface LoadResult {
  choices: ModelEffortChoices | null;
  error?: string;
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The model catalog is the single source of truth: it mirrors the agent's
 * advertised models with display overrides and adds Routa-owned custom aliases.
 * If it is unavailable, fall back to the raw config-options probe so a picker
 * never goes blank for a transient error.
 *
 * `refresh` asks the server to re-probe the agent instead of serving its cache;
 * only an explicit user action should set it (a probe starts an agent process).
 */
async function loadRemoteChoices(providerId: string, refresh: boolean): Promise<LoadResult> {
  try {
    const suffix = refresh ? "&refresh=1" : "";
    const response = await desktopAwareFetch(
      resolveApiPath(`/models/catalog?provider=${encodeURIComponent(providerId)}${suffix}`),
      { cache: "no-store" },
    );
    if (!response.ok) return { choices: null, error: `HTTP ${response.status}` };
    const payload: unknown = await response.json();
    const record = (payload ?? {}) as { entries?: unknown; error?: unknown };
    const probeError = typeof record.error === "string" ? record.error : undefined;
    if (Array.isArray(record.entries) && (!probeError || record.entries.length > 0)) {
      return { choices: parseCatalogChoices(payload) };
    }
    return { choices: null, error: probeError };
  } catch (error) {
    return { choices: null, error: failureText(error) };
  }
}

async function loadConfigOptionsChoices(providerId: string): Promise<LoadResult> {
  try {
    const response = await desktopAwareFetch(
      resolveApiPath(`/providers/${encodeURIComponent(providerId)}/config-options`),
      { cache: "no-store" },
    );
    if (response.ok) return { choices: parseModelEffortChoices(await response.json()) };
    return { choices: null, error: `HTTP ${response.status}` };
  } catch (error) {
    return { choices: null, error: failureText(error) };
  }
}

function loadModelEffortChoices(
  providerId: string,
  options: { refresh?: boolean } = {},
): Promise<ModelEffortChoices> {
  if (!options.refresh) {
    const cached = choicesRequests.get(providerId);
    if (cached) return cached;
  }
  const request = (async () => {
    const fromCatalog = await loadRemoteChoices(providerId, Boolean(options.refresh));
    if (fromCatalog.choices) return fromCatalog.choices;
    const fromProbe = await loadConfigOptionsChoices(providerId);
    if (fromProbe.choices) return fromProbe.choices;
    // Do not cache a failure; the next mount retries.
    choicesRequests.delete(providerId);
    return {
      ...EMPTY_MODEL_EFFORT_CHOICES,
      error: fromProbe.error ?? fromCatalog.error,
    };
  })();
  choicesRequests.set(providerId, request);
  return request;
}

/**
 * Force one re-probe of the provider's advertised models and publish the result
 * to every mounted picker. A probe starts an agent process on the server, so
 * this is meant for an explicit "reload models" action, never for polling.
 */
export async function refreshModelEffortChoices(providerId: string): Promise<ModelEffortChoices> {
  const choices = await loadModelEffortChoices(providerId, { refresh: true });
  for (const listener of listeners) listener(providerId, choices);
  return choices;
}

/**
 * Model / effort choices for each provider id, served by the model catalog with
 * a config-options fallback. A failed load carries `error` so the UI can explain
 * why a picker is empty instead of just showing nothing.
 */
export function useModelEffortChoices(providerIds: string[]): Record<string, ModelEffortChoices> {
  const [choicesByProvider, setChoicesByProvider] = useState<Record<string, ModelEffortChoices>>({});
  const providerKey = Array.from(new Set(providerIds.filter(Boolean))).sort().join("\n");

  useEffect(() => {
    const ids = providerKey ? providerKey.split("\n") : [];
    const listener: ChoicesListener = (providerId, next) => {
      if (!ids.includes(providerId)) return;
      setChoicesByProvider((current) => (current[providerId] === next ? current : { ...current, [providerId]: next }));
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [providerKey]);

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
