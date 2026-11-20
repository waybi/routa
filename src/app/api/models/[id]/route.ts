import { NextRequest, NextResponse } from "next/server";

import {
  deleteCustomModel,
  ModelCatalogError,
  updateCustomModel,
} from "@/core/models/model-catalog";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(error: unknown) {
  if (error instanceof ModelCatalogError) {
    const status = error.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
  throw error;
}

/** PATCH /api/models/{id} — edit one custom model. */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
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
    const model = updateCustomModel(id, body as Record<string, unknown>);
    return NextResponse.json({ model });
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/models/{id} — remove one custom model. Provider entries are not deletable. */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const model = deleteCustomModel(id);
    return NextResponse.json({ model });
  } catch (error) {
    return errorResponse(error);
  }
}
