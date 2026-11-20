import { NextRequest, NextResponse } from "next/server";

import {
  addCustomModel,
  ModelCatalogError,
  readModelCatalog,
} from "@/core/models/model-catalog";

export const dynamic = "force-dynamic";

/** GET /api/models — raw catalog (custom entries + provider display overrides). */
export async function GET() {
  return NextResponse.json(readModelCatalog());
}

/** POST /api/models — add one custom model. */
export async function POST(request: NextRequest) {
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
    const model = addCustomModel(body as Record<string, unknown>);
    return NextResponse.json({ model }, { status: 201 });
  } catch (error) {
    if (error instanceof ModelCatalogError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 });
    }
    throw error;
  }
}
