import { NextRequest, NextResponse } from "next/server";

import {
  describeKanbanModelTiers,
  isValidKanbanTierModelId,
  KANBAN_MODEL_TIER_KEYS,
  KANBAN_MODEL_TIER_PROVIDER_ID,
  modelTierToKey,
  readKanbanModelTierOverrides,
  writeKanbanModelTierOverrides,
  type KanbanModelTierOverrides,
} from "@/core/kanban/kanban-model-tiers";
import { loadSpecialistsSync } from "@/core/orchestration/specialist-prompts";

export const dynamic = "force-dynamic";

/**
 * Global per-tier default models for DSH lane agents.
 *
 * GET  -> { providerId, tiers: { fast|balanced|smart: { override, codeDefault, effective } },
 *           specialists: [{ id, name, tier, model? }] }
 * PUT  { fast?, balanced?, smart? } -> same shape. A string sets the tier,
 *      null or "" clears it ("follow the code default"), an absent key keeps it.
 */
function buildResponse(locale: string | null, overrides?: KanbanModelTierOverrides) {
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
    tiers: describeKanbanModelTiers(overrides),
    specialists,
  };
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

  const next: KanbanModelTierOverrides = { ...readKanbanModelTierOverrides() };
  for (const key of KANBAN_MODEL_TIER_KEYS) {
    if (!(key in body)) continue;
    const value = (body as Record<string, unknown>)[key];
    if (value === null || (typeof value === "string" && value.trim() === "")) {
      delete next[key];
      continue;
    }
    if (typeof value !== "string" || !isValidKanbanTierModelId(value.trim())) {
      return NextResponse.json({ error: `Invalid model for tier "${key}"` }, { status: 400 });
    }
    next[key] = value.trim();
  }

  const saved = writeKanbanModelTierOverrides(next);
  return NextResponse.json(buildResponse(request.nextUrl.searchParams.get("locale"), saved));
}
