import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import type {
  CanvasArtifactPayload,
  CanvasType,
  CanvasRenderMode,
} from "@/core/models/canvas-artifact";
import {
  createCanvasArtifact,
  type CreateCanvasBody,
} from "./canvas-artifact-service";

export const dynamic = "force-dynamic";

const VALID_CANVAS_TYPES: CanvasType[] = ["fitness_overview"];
const VALID_RENDER_MODES: CanvasRenderMode[] = ["dynamic", "prebuilt"];

function isValidCanvasType(value: unknown): value is CanvasType {
  return (
    typeof value === "string" &&
    VALID_CANVAS_TYPES.includes(value as CanvasType)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * POST /api/canvas — Create a new canvas artifact.
 *
 * Supports two modes:
 *  - `dynamic`: agent provides TSX `source`; compiled client-side.
 *  - `prebuilt`: agent provides `canvasType` + `data`; rendered via template.
 */
export async function POST(request: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isPlainObject(rawBody)) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = rawBody as unknown as CreateCanvasBody;
  const renderMode: CanvasRenderMode = body.renderMode ?? "dynamic";

  if (!VALID_RENDER_MODES.includes(renderMode)) {
    return NextResponse.json(
      { error: `Invalid renderMode. Expected one of: ${VALID_RENDER_MODES.join(", ")}` },
      { status: 400 },
    );
  }

  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  if (!body.workspaceId || typeof body.workspaceId !== "string") {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 },
    );
  }

  if (renderMode === "dynamic") {
    if (!body.source || typeof body.source !== "string") {
      return NextResponse.json(
        { error: "source (TSX string) is required for dynamic renderMode" },
        { status: 400 },
      );
    }
  } else {
    if (!isValidCanvasType(body.canvasType)) {
      return NextResponse.json(
        { error: `canvasType is required for prebuilt mode. Expected one of: ${VALID_CANVAS_TYPES.join(", ")}` },
        { status: 400 },
      );
    }
    if (body.data === undefined || body.data === null) {
      return NextResponse.json(
        { error: "data is required for prebuilt renderMode" },
        { status: 400 },
      );
    }
  }

  const system = getRoutaSystem();
  try {
    const created = await createCanvasArtifact(system, body);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Failed to create canvas artifact";
    const status = message.startsWith("Workspace not found:") || message.startsWith("Task not found:")
      || message.includes("does not belong to workspace")
      ? 400
      : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * GET /api/canvas — List canvas artifacts for a workspace.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId query parameter is required" },
      { status: 400 },
    );
  }

  const system = getRoutaSystem();
  try {
    const allArtifacts = await system.artifactStore.listByWorkspace(workspaceId);
    const canvasArtifacts = allArtifacts
      .filter((a) => a.type === "canvas")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const items = canvasArtifacts.map((a) => {
      const payload = parseCanvasPayload(a.content);
      return {
        id: a.id,
        renderMode: payload?.metadata.renderMode ?? "prebuilt",
        canvasType: payload?.metadata.canvasType ?? undefined,
        title: payload?.metadata.title ?? a.context ?? "Untitled",
        generatedAt: payload?.metadata.generatedAt ?? a.createdAt.toISOString(),
        createdAt: a.createdAt.toISOString(),
      };
    });

    return NextResponse.json({ canvasArtifacts: items });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : "Failed to list canvas artifacts",
      },
      { status: 500 },
    );
  }
}

function parseCanvasPayload(
  content: string | undefined,
): CanvasArtifactPayload | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as CanvasArtifactPayload;
  } catch {
    return null;
  }
}
