import { NextRequest, NextResponse } from "next/server";

import {
  describeKanbanModelTiers,
  isValidKanbanTierModelId,
  isValidKanbanTierReasoningEffort,
  KANBAN_MODEL_TIER_KEYS,
  KANBAN_MODEL_TIER_PROVIDER_ID,
  modelTierToKey,
  readKanbanModelTierSettings,
  writeKanbanModelTierSettings,
  type KanbanModelTierSettings,
  type KanbanTierSetting,
} from "@/core/kanban/kanban-model-tiers";
import { loadSpecialistsSync } from "@/core/orchestration/specialist-prompts";

export const dynamic = "force-dynamic";

/**
 * Global per-tier default models and reasoning efforts for DSH lane agents.
 *
 * GET  -> { providerId,
 *           tiers: { fast|balanced|smart: { override, codeDefault, effective,
 *                                           reasoningEffort: { override, effective } } },
 *           specialists: [{ id, name, tier, model? }] }
 * PUT  -> same shape. Per tier key, two body forms:
 *   legacy  { fast: "<model>" }  a string sets the model, null or "" clears it;
 *           the stored reasoning effort is kept.
 *   object  { fast: { model?, reasoningEffort? } }  per field: a string sets it,
 *           null or "" clears it, an absent field keeps it.
 *   An absent tier key keeps the whole tier. Invalid values -> 400, nothing written.
 */
function buildResponse(locale: string | null, settings?: KanbanModelTierSettings) {
  const specialists = loadSpecialistsSync(locale || undefined).flatMap((specialist) => {
    const tier = modelTierToKey(specialist.defaultModelTier);
    if (!tier) return [];
    return [{
      id: specialist.id,
      name: specialist.name,
      tier,
      ...(specialist.model ? { model: specialist.model } : {}),
    }];
  });
  return {
    providerId: KANBAN_MODEL_TIER_PROVIDER_ID,
    tiers: describeKanbanModelTiers(settings),
    specialists,
  };
}

type FieldUpdate = { kind: "keep" } | { kind: "clear" } | { kind: "set"; value: string } | { kind: "invalid" };

function parseField(value: unknown, isValid: (value: string) => boolean): FieldUpdate {
  if (value === undefined) return { kind: "keep" };
  if (value === null || (typeof value === "string" && value.trim() === "")) return { kind: "clear" };
  if (typeof value !== "string" || !isValid(value.trim())) return { kind: "invalid" };
  return { kind: "set", value: value.trim() };
}

function applyField(current: string | undefined, update: FieldUpdate): string | undefined {
  if (update.kind === "keep") return current;
  if (update.kind === "set") return update.value;
  return undefined;
}

export async function GET(request: NextRequest) {
  return NextResponse.json(buildResponse(request.nextUrl.searchParams.get("locale")));
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const current = readKanbanModelTierSettings();
  const next: KanbanModelTierSettings = { ...current };
  for (const key of KANBAN_MODEL_TIER_KEYS) {
    if (!(key in body)) continue;
    const value = (body as Record<string, unknown>)[key];
    const isObject = !!value && typeof value === "object" && !Array.isArray(value);
    const modelUpdate = parseField(isObject ? (value as KanbanTierSetting).model : value, isValidKanbanTierModelId);
    if (modelUpdate.kind === "invalid") {
      return NextResponse.json({ error: `Invalid model for tier "${key}"` }, { status: 400 });
    }
    const effortUpdate: FieldUpdate = isObject
      ? parseField((value as KanbanTierSetting).reasoningEffort, isValidKanbanTierReasoningEffort)
      : { kind: "keep" };
    if (effortUpdate.kind === "invalid") {
      return NextResponse.json({ error: `Invalid reasoning effort for tier "${key}"` }, { status: 400 });
    }
    next[key] = {
      model: applyField(current[key]?.model, modelUpdate),
      reasoningEffort: applyField(current[key]?.reasoningEffort, effortUpdate),
    };
  }

  const saved = writeKanbanModelTierSettings(next);
  return NextResponse.json(buildResponse(request.nextUrl.searchParams.get("locale"), saved));
}
