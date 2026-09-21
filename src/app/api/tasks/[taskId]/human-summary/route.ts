/**
 * /api/tasks/[taskId]/human-summary - Human-readable ("人话版") card summary.
 *
 * GET  ?language=zh-CN|en        → cached summary (if any) + current description hash.
 *                                  Never calls the model.
 * POST { language, force? }      → returns the cache when its hash matches the current
 *                                  description; otherwise (or with force) generates,
 *                                  saves and returns the new record.
 *
 * Both responses share one shape so the client can treat them alike:
 *   { taskId, descriptionHash, language, record: TaskHumanSummaryRecord | null, stale: boolean, cached: boolean }
 */

import { NextRequest, NextResponse } from "next/server";
import { getRoutaSystem } from "@/core/routa-system";
import type {
  TaskHumanSummaryLanguage,
  TaskHumanSummaryRecord,
} from "@/core/kanban/task-human-summary";
import { getTaskHumanSummaryStore, hashTaskDescription } from "@/core/kanban/task-human-summary-store";
import {
  createDefaultTaskHumanSummaryTextGenerator,
  generateTaskHumanSummary,
  TaskHumanSummaryGenerationError,
} from "@/core/kanban/task-human-summary-generator";

export const dynamic = "force-dynamic";

function resolveLanguage(value: unknown): TaskHumanSummaryLanguage {
  return value === "en" ? "en" : "zh-CN";
}

function buildResponse(params: {
  taskId: string;
  descriptionHash: string;
  language: TaskHumanSummaryLanguage;
  record: TaskHumanSummaryRecord | null;
  cached: boolean;
}) {
  return {
    taskId: params.taskId,
    descriptionHash: params.descriptionHash,
    language: params.language,
    record: params.record,
    stale: params.record ? params.record.descriptionHash !== params.descriptionHash : false,
    cached: params.cached,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const language = resolveLanguage(request.nextUrl.searchParams.get("language"));
  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const descriptionHash = hashTaskDescription(task.objective);
  const record = await getTaskHumanSummaryStore().get(taskId, language);
  return NextResponse.json(buildResponse({ taskId, descriptionHash, language, record, cached: record !== null }));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await params;
  const body: { language?: unknown; force?: unknown } = await request.json().catch(() => ({}));
  const language = resolveLanguage(body.language);
  const force = body.force === true;

  const system = getRoutaSystem();
  const task = await system.taskStore.get(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const store = getTaskHumanSummaryStore();
  const descriptionHash = hashTaskDescription(task.objective);
  const existing = await store.get(taskId, language);
  if (!force && existing && existing.descriptionHash === descriptionHash) {
    return NextResponse.json(buildResponse({ taskId, descriptionHash, language, record: existing, cached: true }));
  }

  try {
    const generate = await createDefaultTaskHumanSummaryTextGenerator();
    const record = await generateTaskHumanSummary(
      {
        taskId,
        title: task.title,
        objective: task.objective,
        columnId: task.columnId,
        language,
      },
      generate,
    );
    await store.save(record);
    return NextResponse.json(buildResponse({ taskId, descriptionHash, language, record, cached: false }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof TaskHumanSummaryGenerationError && error.code !== "provider" ? 502 : 500;
    console.error(`[human-summary] generation failed for task ${taskId}:`, message);
    return NextResponse.json({ error: message }, { status });
  }
}
