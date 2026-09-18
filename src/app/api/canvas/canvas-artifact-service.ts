import { NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import { createArtifact } from "@/core/models/artifact";
import { createTask, TaskStatus } from "@/core/models/task";
import type {
  CanvasArtifactPayload,
  CanvasType,
  CanvasRenderMode,
} from "@/core/models/canvas-artifact";

type RoutaSystem = ReturnType<typeof getRoutaSystem>;

export interface CreateCanvasBody {
  /** Render mode. Defaults to "dynamic". */
  renderMode?: CanvasRenderMode;
  /** Pre-built template (required for "prebuilt" mode). */
  canvasType?: CanvasType;
  title: string;
  /** TSX source code (required for "dynamic" mode). */
  source?: string;
  /** Structured data (required for "prebuilt" mode). */
  data?: unknown;
  workspaceId: string;
  taskId?: string;
  codebaseId?: string;
  repoPath?: string;
  agentId?: string;
}

export interface CreatedCanvasArtifact {
  id: string;
  renderMode: CanvasRenderMode;
  canvasType?: CanvasType;
  title: string;
  taskId: string;
  createdAt: string;
}

async function resolveCanvasTaskId(
  system: RoutaSystem,
  body: CreateCanvasBody,
): Promise<string | NextResponse> {
  const workspace = await system.workspaceStore.get(body.workspaceId);
  if (!workspace) {
    return NextResponse.json(
      { error: `Workspace not found: ${body.workspaceId}` },
      { status: 400 },
    );
  }

  if (body.taskId) {
    const task = await system.taskStore.get(body.taskId);
    if (!task) {
      return NextResponse.json(
        { error: `Task not found: ${body.taskId}` },
        { status: 400 },
      );
    }
    if (task.workspaceId !== body.workspaceId) {
      return NextResponse.json(
        {
          error: `taskId ${body.taskId} does not belong to workspace ${body.workspaceId}`,
        },
        { status: 400 },
      );
    }
    return task.id;
  }

  const task = createTask({
    id: crypto.randomUUID(),
    title: `Canvas artifact: ${body.title}`,
    objective: `Backing task for canvas artifact "${body.title}".`,
    workspaceId: body.workspaceId,
    status: TaskStatus.COMPLETED,
    labels: ["canvas"],
    codebaseIds: body.codebaseId ? [body.codebaseId] : [],
  });

  await system.taskStore.save(task);
  return task.id;
}

export async function createCanvasArtifact(
  system: RoutaSystem,
  body: CreateCanvasBody,
): Promise<CreatedCanvasArtifact> {
  const renderMode: CanvasRenderMode = body.renderMode ?? "dynamic";
  const taskId = await resolveCanvasTaskId(system, body);
  if (taskId instanceof NextResponse) {
    const payload = await taskId.json();
    throw new Error(typeof payload?.error === "string" ? payload.error : "Failed to resolve canvas task");
  }

  const payload: CanvasArtifactPayload = {
    metadata: {
      renderMode,
      canvasType: renderMode === "prebuilt" ? body.canvasType : undefined,
      title: body.title,
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      workspaceId: body.workspaceId,
      codebaseId: body.codebaseId,
      repoPath: body.repoPath,
    },
    source: renderMode === "dynamic" ? body.source : undefined,
    data: renderMode === "prebuilt" ? body.data : undefined,
  };

  const id = crypto.randomUUID();
  const artifact = createArtifact({
    id,
    type: "canvas",
    taskId,
    workspaceId: body.workspaceId,
    providedByAgentId: body.agentId,
    content: JSON.stringify(payload),
    context: `Canvas: ${body.title}`,
    status: "provided",
    metadata: {
      renderMode,
      canvasType: renderMode === "prebuilt" ? (body.canvasType ?? "") : "",
      title: body.title,
      schemaVersion: "1",
    },
  });

  await system.artifactStore.saveArtifact(artifact);

  return {
    id: artifact.id,
    renderMode,
    canvasType: payload.metadata.canvasType,
    title: body.title,
    taskId,
    createdAt: artifact.createdAt.toISOString(),
  };
}
