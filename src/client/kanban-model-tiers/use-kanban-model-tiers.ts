"use client";

/**
 * Client side of GET/PUT /api/kanban/model-tiers: the global per-tier default
 * models for DSH lane agents. One request per page load is shared by the
 * settings card and the Kanban settings modal hints.
 */
import { useCallback, useEffect, useState } from "react";

import { resolveApiPath } from "@/client/config/backend";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { ModelEffortChoice } from "@/client/model-effort/model-effort-choices";

export const KANBAN_MODEL_TIER_KEYS = ["fast", "balanced", "smart"] as const;
export type KanbanModelTierKey = (typeof KANBAN_MODEL_TIER_KEYS)[number];

/** The only model group lane agents can run (see routa experience L143). */
export const LANE_MODEL_GROUP_LABELS = ["Local 7357", "local-7357"];

export interface KanbanModelTierState {
  override: string | null;
  codeDefault: string;
  effective: string;
}

export interface KanbanModelTiersData {
  providerId: string;
  tiers: Record<KanbanModelTierKey, KanbanModelTierState>;
  specialists: Array<{ id: string; name: string; tier: KanbanModelTierKey; model?: string }>;
}

// Keyed by specialist locale (only specialist names differ between locales).
const sharedRequests = new Map<string, Promise<KanbanModelTiersData>>();

/** Test hook: forget the cached responses. */
export function resetKanbanModelTiersCache(): void {
  sharedRequests.clear();
}

/** Specialist locale for a UI locale ("zh" -> "zh-CN"). */
export function toSpecialistLocale(locale: string | undefined): string {
  return locale === "zh" ? "zh-CN" : "en";
}

function tiersPath(locale: string): string {
  return resolveApiPath(`/kanban/model-tiers?locale=${encodeURIComponent(locale)}`);
}

async function readJson(response: Response): Promise<KanbanModelTiersData> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
  }
  return body as KanbanModelTiersData;
}

function loadKanbanModelTiers(locale: string): Promise<KanbanModelTiersData> {
  const cached = sharedRequests.get(locale);
  if (cached) return cached;
  const request = desktopAwareFetch(tiersPath(locale), { cache: "no-store" })
    .then(readJson)
    .catch((error: unknown) => {
      sharedRequests.delete(locale);
      throw error;
    });
  sharedRequests.set(locale, request);
  return request;
}

export async function saveKanbanModelTier(
  tier: KanbanModelTierKey,
  model: string | null,
  locale: string,
): Promise<KanbanModelTiersData> {
  const data = await desktopAwareFetch(tiersPath(locale), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [tier]: model }),
  }).then(readJson);
  // Other locales only differ in names; drop them so they refetch the new values.
  sharedRequests.clear();
  sharedRequests.set(locale, Promise.resolve(data));
  return data;
}

export function useKanbanModelTiers(locale: string): {
  data: KanbanModelTiersData | null;
  error: string | null;
  setData: (data: KanbanModelTiersData) => void;
} {
  const [data, setData] = useState<KanbanModelTiersData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadKanbanModelTiers(locale).then(
      (next) => {
        if (active) setData(next);
      },
      (reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [locale]);

  const replace = useCallback((next: KanbanModelTiersData) => {
    setData(next);
    setError(null);
  }, []);

  return { data, error, setData: replace };
}

/** Local 7357 models only: lane agents fail on any other group. */
export function filterLaneModelChoices(models: ModelEffortChoice[] | undefined): ModelEffortChoice[] {
  return (models ?? []).filter((choice) => (
    choice.group !== undefined && LANE_MODEL_GROUP_LABELS.includes(choice.group)
  ));
}

export type StepDefaultModel =
  | { kind: "specialist"; model: string }
  | { kind: "global" | "code"; model: string; tier: KanbanModelTierKey }
  | { kind: "none" };

/**
 * What a lane step left on "follow default" will run: the specialist's own
 * model, else its tier from the global setting, else the code tier table.
 * Undefined when unknown (data not loaded, or a provider other than DSH).
 */
export function resolveStepDefaultModel(
  data: KanbanModelTiersData | null,
  specialistId: string | undefined,
  providerId: string | undefined,
): StepDefaultModel | undefined {
  if (!data || (providerId && providerId !== data.providerId)) return undefined;
  const specialist = specialistId
    ? data.specialists.find((entry) => entry.id === specialistId.toLowerCase())
    : undefined;
  if (!specialist) return specialistId ? undefined : { kind: "none" };
  if (specialist.model) return { kind: "specialist", model: specialist.model };
  const tier = data.tiers[specialist.tier];
  return tier.override
    ? { kind: "global", model: tier.override, tier: specialist.tier }
    : { kind: "code", model: tier.codeDefault, tier: specialist.tier };
}
