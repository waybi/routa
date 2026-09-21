import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  normalizeTaskDescription,
  type TaskHumanSummaryLanguage,
  type TaskHumanSummaryRecord,
} from "./task-human-summary";

/** Cache key: sha256 of the normalized description. Server-only (node:crypto). */
export function hashTaskDescription(description: string | null | undefined): string {
  return createHash("sha256").update(normalizeTaskDescription(description)).digest("hex");
}

/**
 * File-backed cache for human-readable card summaries.
 *
 * One JSON file per (taskId, language). The record carries the description hash it was
 * generated from, so callers decide freshness by comparing hashes; the store never
 * deletes on its own. Default root: ~/.routa/task-summaries (override with
 * ROUTA_TASK_SUMMARY_DIR). Kept out of the task table on purpose: no schema change,
 * legacy cards need nothing new.
 */
export interface TaskHumanSummaryStore {
  get(taskId: string, language: TaskHumanSummaryLanguage): Promise<TaskHumanSummaryRecord | null>;
  save(record: TaskHumanSummaryRecord): Promise<void>;
}

export function resolveTaskHumanSummaryDir(): string {
  return process.env.ROUTA_TASK_SUMMARY_DIR ?? path.join(os.homedir(), ".routa", "task-summaries");
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function isRecord(value: unknown): value is TaskHumanSummaryRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.taskId === "string"
    && typeof record.descriptionHash === "string"
    && typeof record.generatedAt === "string"
    && typeof record.summary === "object"
    && record.summary !== null;
}

export class FileTaskHumanSummaryStore implements TaskHumanSummaryStore {
  constructor(private readonly rootDir: string = resolveTaskHumanSummaryDir()) {}

  private filePath(taskId: string, language: TaskHumanSummaryLanguage): string {
    return path.join(this.rootDir, `${sanitizeSegment(taskId)}.${sanitizeSegment(language)}.json`);
  }

  async get(taskId: string, language: TaskHumanSummaryLanguage): Promise<TaskHumanSummaryRecord | null> {
    const target = this.filePath(taskId, language);
    let raw: string;
    try {
      raw = await fs.promises.readFile(target, "utf-8");
    } catch {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(record: TaskHumanSummaryRecord): Promise<void> {
    await fs.promises.mkdir(this.rootDir, { recursive: true });
    const target = this.filePath(record.taskId, record.language);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(record, null, 2), "utf-8");
    await fs.promises.rename(tmp, target);
  }
}

export class InMemoryTaskHumanSummaryStore implements TaskHumanSummaryStore {
  private readonly records = new Map<string, TaskHumanSummaryRecord>();

  async get(taskId: string, language: TaskHumanSummaryLanguage): Promise<TaskHumanSummaryRecord | null> {
    return this.records.get(`${taskId}:${language}`) ?? null;
  }

  async save(record: TaskHumanSummaryRecord): Promise<void> {
    this.records.set(`${record.taskId}:${record.language}`, record);
  }
}

const GLOBAL_KEY = "__routa_task_human_summary_store__";

export function getTaskHumanSummaryStore(): TaskHumanSummaryStore {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new FileTaskHumanSummaryStore();
  }
  return g[GLOBAL_KEY] as TaskHumanSummaryStore;
}
