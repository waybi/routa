"use client";

import {
  loadModelDefinitions,
  saveModelDefinitions,
  type ModelDefinition,
} from "@/client/components/settings-panel-shared";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

/** One custom entry as stored by `~/.routa/model-catalog.json`. */
export interface CustomModelEntry {
  id: string;
  alias: string;
  label: string;
  providerId: string;
  modelId: string;
  baseUrl?: string;
  secretRef?: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateCustomModelInput {
  alias: string;
  modelId: string;
  label?: string;
  providerId?: string;
  baseUrl?: string;
}

export interface UpdateCustomModelInput {
  alias?: string;
  modelId?: string;
  label?: string;
  providerId?: string;
  baseUrl?: string;
  enabled?: boolean;
}

export class ModelCatalogApiError extends Error {
  readonly code?: string;
  readonly status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ModelCatalogApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await desktopAwareFetch(path, init);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const record = (payload ?? {}) as Record<string, unknown>;
    const message = typeof record.error === "string" ? record.error : `${response.status} ${response.statusText}`;
    throw new ModelCatalogApiError(message, response.status, typeof record.code === "string" ? record.code : undefined);
  }
  return payload as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function listCustomModels(): Promise<CustomModelEntry[]> {
  const payload = await request<{ custom?: CustomModelEntry[] }>("/api/models");
  return Array.isArray(payload?.custom) ? payload.custom : [];
}

/** One merged catalog entry: an advertised model or a Routa-owned custom alias. */
export interface CatalogEntryDto {
  value: string;
  rawValue?: string;
  label?: string;
  group?: string;
  source?: "provider" | "custom";
  enabled?: boolean;
}

/** Merged catalog response for one provider. A probe failure still returns custom entries plus `error`. */
export interface CatalogResponse {
  entries: CatalogEntryDto[];
  error?: string;
}

export async function fetchCatalog(providerId = "dsh"): Promise<CatalogResponse> {
  const payload = await request<{ entries?: CatalogEntryDto[]; error?: string }>(
    `/api/models/catalog?provider=${encodeURIComponent(providerId)}`,
  );
  return {
    entries: Array.isArray(payload?.entries) ? payload.entries : [],
    error: typeof payload?.error === "string" ? payload.error : undefined,
  };
}

export async function createCustomModel(input: CreateCustomModelInput): Promise<CustomModelEntry> {
  const payload = await request<{ model: CustomModelEntry }>("/api/models", jsonInit("POST", input));
  return payload.model;
}

export async function updateCustomModel(id: string, patch: UpdateCustomModelInput): Promise<CustomModelEntry> {
  const payload = await request<{ model: CustomModelEntry }>(
    `/api/models/${encodeURIComponent(id)}`,
    jsonInit("PATCH", patch),
  );
  return payload.model;
}

export async function deleteCustomModel(id: string): Promise<CustomModelEntry> {
  const payload = await request<{ model: CustomModelEntry }>(
    `/api/models/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  return payload.model;
}

export function readCachedApiKey(alias: string, cached: ModelDefinition[] = loadModelDefinitions()): string | undefined {
  return cached.find((definition) => definition.alias === alias)?.apiKey;
}

/**
 * Mirror the server catalog into `routa.modelDefinitions` so the legacy readers
 * (session creation, specialists picker) still resolve alias -> baseUrl + key.
 * The server never stores secrets, so the browser keeps them.
 */
export function writeModelDefinitionCache(
  entries: CustomModelEntry[],
  previous: ModelDefinition[] = loadModelDefinitions(),
): void {
  const previousByAlias = new Map(previous.map((definition) => [definition.alias, definition]));
  const next: ModelDefinition[] = entries.map((entry) => {
    const cached = previousByAlias.get(entry.alias);
    return {
      alias: entry.alias,
      modelName: entry.modelId,
      baseUrl: entry.baseUrl,
      apiKey: cached?.apiKey,
    };
  });
  saveModelDefinitions(next);
}

export interface MigrationResult {
  entries: CustomModelEntry[];
  migrated: string[];
  failed: Array<{ alias: string; reason: string }>;
}

/**
 * One-way, idempotent migration of the legacy browser list. Entries that the
 * server already knows are skipped, so this can run on every mount.
 */
export async function migrateLocalModelDefinitions(remote: CustomModelEntry[]): Promise<MigrationResult> {
  const local = loadModelDefinitions().filter((definition) => definition.alias?.trim() && definition.modelName?.trim());
  const byAlias = new Map(remote.map((entry) => [entry.alias.toLowerCase(), entry]));
  const entries = [...remote];
  const migrated: string[] = [];
  const failed: Array<{ alias: string; reason: string }> = [];

  for (const definition of local) {
    const alias = definition.alias.trim();
    if (byAlias.has(alias.toLowerCase())) continue;
    try {
      const created = await createCustomModel({
        alias,
        modelId: definition.modelName.trim(),
        baseUrl: definition.baseUrl?.trim() || undefined,
      });
      entries.push(created);
      byAlias.set(created.alias.toLowerCase(), created);
      migrated.push(created.alias);
    } catch (error) {
      const code = error instanceof ModelCatalogApiError ? error.code : undefined;
      // Already known on the server under this alias / model id — nothing to migrate.
      if (code === "ALIAS_CONFLICT" || code === "DUPLICATE_MODEL") continue;
      failed.push({ alias, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { entries, migrated, failed };
}
