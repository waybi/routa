import { NextRequest, NextResponse } from "next/server";

import {
  ModelCatalogError,
  upsertProviderOverride,
} from "@/core/models/model-catalog";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ providerId: string }> };

/**
 * PATCH /api/models/overrides/{providerId}
 * body { value, label?, hidden?, sort? } — display override for one advertised entry.
 * There is deliberately no DELETE: a provider entry can be hidden, never removed.
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { providerId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }
  try {
    const override = upsertProviderOverride(providerId, body as Record<string, unknown>);
    return NextResponse.json({ override });
  } catch (error) {
    if (error instanceof ModelCatalogError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}
