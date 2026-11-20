/**
 * Model catalog — one server-side list for every model picker.
 *
 * Two sources, one API:
 * - provider entries are a read-only mirror of what the execution agent
 *   advertises (ACP configOptions). Only display overrides (label / hidden /
 *   sort) are persisted here; the list itself is never copied, so a model that
 *   disappears upstream cannot linger as a ghost option.
 * - custom entries are owned by Routa: alias + model id + connection. They are
 *   editable and can be mapped to an advertised model or used for an
 *   OpenAI-compatible direct call.
 *
 * Storage is a small JSON file next to the kanban tier settings
 * (~/.routa/model-catalog.json) — same atomic-write style, no schema migration
 * for either the Postgres or SQLite driver.
 */
import fs from "fs";
import os from "os";
import path from "path";

export type ModelSource = "provider" | "custom";

export interface ModelProbeState {
  ok: boolean;
  at: string;
  error?: string | null;
}

export interface CustomModelEntry {
  /** Stable id, `custom:<alias>`; alias is unique inside the catalog. */
  id: string;
  alias: string;
  label: string;
  providerId: string;
  modelId: string;
  baseUrl?: string;
  /** Keychain reference such as `keychain:routa/model/deepseek-v4`. Never a raw key. */
  secretRef?: string;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastProbe?: ModelProbeState | null;
}

export interface ProviderModelOverride {
  /** Raw select value the agent advertises (for DSH a JSON tuple string). */
  value: string;
  label?: string;
  hidden?: boolean;
  sort?: number;
}

export interface ModelCatalogFile {
  version: 1;
  updatedAt?: string;
  custom: CustomModelEntry[];
  providerOverrides: Record<string, ProviderModelOverride[]>;
}

export type CatalogErrorCode =
  | "ALIAS_CONFLICT"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "DUPLICATE_MODEL"
  | "READ_ONLY";

export class ModelCatalogError extends Error {
  readonly code: CatalogErrorCode;

  constructor(code: CatalogErrorCode, message: string) {
    super(message);
    this.name = "ModelCatalogError";
    this.code = code;
  }
}

/** One entry as the pickers see it. */
export interface CatalogEntry {
  key: string;
  /** Value a picker writes back: bare model id for provider entries, alias for custom. */
  value: string;
  /** Agent-native value (DSH: `["provider","model"]`). */
  rawValue?: string;
  label: string;
  group?: string;
  providerId: string;
  source: ModelSource;
  editable: boolean;
  enabled: boolean;
}

const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MODEL_ID_PATTERN = /^[^\s"'<>]{1,200}$/;
/** Raw select value: a bare id or a JSON tuple such as ["provider","model"]. */
const RAW_VALUE_PATTERN = /^[^\s<>]{1,300}$/;
const BASE_URL_PATTERN = /^https?:\/\/[^\s]{1,300}$/;
const OVERRIDE_MAX = 500;

export function getModelCatalogFilePath(): string {
  const override = process.env.ROUTA_MODEL_CATALOG_FILE?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".routa", "model-catalog.json");
}

function emptyCatalog(): ModelCatalogFile {
  return { version: 1, custom: [], providerOverrides: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeCustomEntry(raw: unknown): CustomModelEntry | null {
  if (!isRecord(raw)) return null;
  const alias = asString(raw.alias);
  const modelId = asString(raw.modelId);
  if (!alias || !modelId) return null;
  if (!ALIAS_PATTERN.test(alias) || !MODEL_ID_PATTERN.test(modelId)) return null;
  const providerId = asString(raw.providerId) ?? "dsh";
  if (!PROVIDER_PATTERN.test(providerId)) return null;
  const id = asString(raw.id) ?? `custom:${alias}`;
  return {
    id,
    alias,
    label: asString(raw.label) ?? alias,
    providerId,
    modelId,
    baseUrl: asString(raw.baseUrl),
    secretRef: asString(raw.secretRef),
    enabled: raw.enabled !== false,
    createdAt: asString(raw.createdAt),
    updatedAt: asString(raw.updatedAt),
    lastProbe: isRecord(raw.lastProbe) && typeof raw.lastProbe.ok === "boolean"
      ? {
          ok: raw.lastProbe.ok,
          at: asString(raw.lastProbe.at) ?? new Date().toISOString(),
          error: typeof raw.lastProbe.error === "string" ? raw.lastProbe.error : null,
        }
      : null,
  };
}

function sanitizeOverrides(raw: unknown): Record<string, ProviderModelOverride[]> {
  if (!isRecord(raw)) return {};
  const out: Record<string, ProviderModelOverride[]> = {};
  for (const [providerId, list] of Object.entries(raw)) {
    if (!PROVIDER_PATTERN.test(providerId) || !Array.isArray(list)) continue;
    const entries: ProviderModelOverride[] = [];
    for (const item of list.slice(0, OVERRIDE_MAX)) {
      if (!isRecord(item)) continue;
      const value = asString(item.value);
      if (!value || !RAW_VALUE_PATTERN.test(value)) continue;
      if (entries.some((entry) => entry.value === value)) continue;
      entries.push({
        value,
        label: asString(item.label),
        hidden: item.hidden === true,
        sort: typeof item.sort === "number" && Number.isFinite(item.sort) ? item.sort : undefined,
      });
    }
    if (entries.length) out[providerId] = entries;
  }
  return out;
}

export function sanitizeCatalog(raw: unknown): ModelCatalogFile {
  if (!isRecord(raw)) return emptyCatalog();
  const custom = Array.isArray(raw.custom)
    ? raw.custom.map(sanitizeCustomEntry).filter((entry): entry is CustomModelEntry => entry !== null)
    : [];
  const unique = new Map<string, CustomModelEntry>();
  for (const entry of custom) {
    if (!unique.has(entry.alias)) unique.set(entry.alias, entry);
  }
  return {
    version: 1,
    updatedAt: asString(raw.updatedAt),
    custom: [...unique.values()],
    providerOverrides: sanitizeOverrides(raw.providerOverrides),
  };
}

/** Missing or unreadable file means "no catalog", same as the tier settings. */
export function readModelCatalog(): ModelCatalogFile {
  const filePath = getModelCatalogFilePath();
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return emptyCatalog();
  }
  try {
    return sanitizeCatalog(JSON.parse(text));
  } catch (error) {
    console.warn(`[model-catalog] Ignoring unreadable ${filePath}:`, error);
    return emptyCatalog();
  }
}

/** Atomic write: temp file, optional backup, rename. Never leaves half a file. */
export function writeModelCatalog(catalog: ModelCatalogFile): ModelCatalogFile {
  const clean = sanitizeCatalog(catalog);
  const filePath = getModelCatalogFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    const backup = `${filePath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      fs.copyFileSync(filePath, backup);
      const backups = fs.readdirSync(path.dirname(filePath))
        .filter((name) => name.startsWith(`${path.basename(filePath)}.bak-`))
        .sort();
      for (const stale of backups.slice(0, Math.max(0, backups.length - 5))) {
        fs.rmSync(path.join(path.dirname(filePath), stale), { force: true });
      }
    } catch (error) {
      console.warn(`[model-catalog] Backup skipped for ${filePath}:`, error);
    }
  }
  const next: ModelCatalogFile = { ...clean, updatedAt: new Date().toISOString() };
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
  return next;
}

export interface AddCustomModelInput {
  alias?: unknown;
  modelId?: unknown;
  label?: unknown;
  providerId?: unknown;
  baseUrl?: unknown;
  secretRef?: unknown;
  enabled?: unknown;
}

function requireAlias(value: unknown): string {
  const alias = asString(value);
  if (!alias || !ALIAS_PATTERN.test(alias)) {
    throw new ModelCatalogError("INVALID_INPUT", "别名为必填，2–64 位，只能用字母、数字、点、下划线、短横线");
  }
  return alias;
}

function requireModelId(value: unknown): string {
  const modelId = asString(value);
  if (!modelId || !MODEL_ID_PATTERN.test(modelId)) {
    throw new ModelCatalogError("INVALID_INPUT", "模型 ID 为必填，且不能包含空白或引号");
  }
  return modelId;
}

function optionalProvider(value: unknown): string {
  const providerId = asString(value) ?? "dsh";
  if (!PROVIDER_PATTERN.test(providerId)) {
    throw new ModelCatalogError("INVALID_INPUT", "供应商 id 不合法");
  }
  return providerId;
}

function optionalBaseUrl(value: unknown): string | undefined {
  const baseUrl = asString(value);
  if (!baseUrl) return undefined;
  if (!BASE_URL_PATTERN.test(baseUrl)) {
    throw new ModelCatalogError("INVALID_INPUT", "Base URL 必须以 http(s):// 开头");
  }
  return baseUrl.replace(/\/+$/, "");
}

/** `undefined` keeps the current value, `""` / null clears it. */
function resolveUpdatedBaseUrl(value: unknown, current: string | undefined): string | undefined {
  if (value === undefined) return current;
  if (value === null || value === "") return undefined;
  return optionalBaseUrl(value);
}

export function addCustomModel(input: AddCustomModelInput, catalog = readModelCatalog()): CustomModelEntry {
  const alias = requireAlias(input.alias);
  const modelId = requireModelId(input.modelId);
  const providerId = optionalProvider(input.providerId);
  if (catalog.custom.some((entry) => entry.alias.toLowerCase() === alias.toLowerCase())) {
    throw new ModelCatalogError("ALIAS_CONFLICT", `别名 "${alias}" 已存在`);
  }
  if (catalog.custom.some((entry) => entry.providerId === providerId && entry.modelId === modelId)) {
    throw new ModelCatalogError("DUPLICATE_MODEL", `${providerId}/${modelId} 已经登记过`);
  }
  const now = new Date().toISOString();
  const entry: CustomModelEntry = {
    id: `custom:${alias}`,
    alias,
    label: asString(input.label) ?? alias,
    providerId,
    modelId,
    baseUrl: optionalBaseUrl(input.baseUrl),
    secretRef: asString(input.secretRef),
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
    lastProbe: null,
  };
  writeModelCatalog({ ...catalog, custom: [...catalog.custom, entry] });
  return entry;
}

export interface UpdateCustomModelInput extends AddCustomModelInput {
  lastProbe?: unknown;
}

export function updateCustomModel(id: string, input: UpdateCustomModelInput, catalog = readModelCatalog()): CustomModelEntry {
  const index = catalog.custom.findIndex((entry) => entry.id === id || entry.alias === id);
  if (index < 0) throw new ModelCatalogError("NOT_FOUND", `找不到模型 ${id}`);
  const current = catalog.custom[index];
  const alias = input.alias === undefined ? current.alias : requireAlias(input.alias);
  if (alias !== current.alias && catalog.custom.some((entry) => entry !== current && entry.alias.toLowerCase() === alias.toLowerCase())) {
    throw new ModelCatalogError("ALIAS_CONFLICT", `别名 "${alias}" 已存在`);
  }
  const modelId = input.modelId === undefined ? current.modelId : requireModelId(input.modelId);
  const providerId = input.providerId === undefined ? current.providerId : optionalProvider(input.providerId);
  const next: CustomModelEntry = {
    ...current,
    alias,
    id: alias === current.alias ? current.id : `custom:${alias}`,
    modelId,
    providerId,
    label: input.label === undefined ? current.label : (asString(input.label) ?? alias),
    baseUrl: resolveUpdatedBaseUrl(input.baseUrl, current.baseUrl),
    secretRef: input.secretRef === undefined ? current.secretRef : asString(input.secretRef),
    enabled: input.enabled === undefined ? current.enabled : input.enabled !== false,
    updatedAt: new Date().toISOString(),
  };
  if (catalog.custom.some((entry) => entry !== current && entry.providerId === providerId && entry.modelId === modelId)) {
    throw new ModelCatalogError("DUPLICATE_MODEL", `${providerId}/${modelId} 已经登记过`);
  }
  const custom = [...catalog.custom];
  custom[index] = next;
  writeModelCatalog({ ...catalog, custom });
  return next;
}

export function deleteCustomModel(id: string, catalog = readModelCatalog()): CustomModelEntry {
  const index = catalog.custom.findIndex((entry) => entry.id === id || entry.alias === id);
  if (index < 0) throw new ModelCatalogError("NOT_FOUND", `找不到模型 ${id}`);
  const removed = catalog.custom[index];
  writeModelCatalog({ ...catalog, custom: catalog.custom.filter((_, i) => i !== index) });
  return removed;
}

export interface ProviderOverrideInput {
  value?: unknown;
  label?: unknown;
  hidden?: unknown;
  sort?: unknown;
}

/** Upsert one display override for a provider entry. Never accepts "delete". */
export function upsertProviderOverride(
  providerId: string,
  input: ProviderOverrideInput,
  catalog = readModelCatalog(),
): ProviderModelOverride {
  if (!PROVIDER_PATTERN.test(providerId)) {
    throw new ModelCatalogError("INVALID_INPUT", "供应商 id 不合法");
  }
  const value = asString(input.value);
  if (!value || !RAW_VALUE_PATTERN.test(value)) {
    throw new ModelCatalogError("INVALID_INPUT", "缺少要覆盖的模型 value");
  }
  const list = catalog.providerOverrides[providerId] ?? [];
  const index = list.findIndex((entry) => entry.value === value);
  const patch: ProviderModelOverride = {
    value,
    label: input.label === undefined ? list[index]?.label : asString(input.label),
    hidden: input.hidden === undefined ? list[index]?.hidden : input.hidden === true,
    sort: input.sort === undefined
      ? list[index]?.sort
      : (typeof input.sort === "number" && Number.isFinite(input.sort) ? input.sort : undefined),
  };
  const nextList = [...list];
  if (index >= 0) nextList[index] = patch;
  else nextList.push(patch);
  writeModelCatalog({
    ...catalog,
    providerOverrides: { ...catalog.providerOverrides, [providerId]: nextList.slice(0, OVERRIDE_MAX) },
  });
  return patch;
}

export interface ProbeModelChoice {
  value: string;
  label: string;
  group?: string;
}

/**
 * Merge advertised choices with the catalog.
 *
 * Provider entries keep the agent's native `rawValue`; `value` stays the bare
 * model id so existing pickers keep working. Custom entries use their alias as
 * `value` — the session layer resolves it through the model definition.
 */
export function mergeCatalog(
  providerId: string,
  probeModels: ProbeModelChoice[],
  catalog: ModelCatalogFile = readModelCatalog(),
): CatalogEntry[] {
  const overrides = catalog.providerOverrides[providerId] ?? [];
  const providerEntries: SortableCatalogEntry[] = probeModels
    .map((model, index): SortableCatalogEntry => {
      const override = overrides.find((entry) => entry.value === model.value);
      return {
        key: `provider:${providerId}:${model.value}`,
        value: bareModelId(model.value),
        rawValue: model.value,
        label: override?.label ?? model.label,
        group: model.group,
        providerId,
        source: "provider",
        editable: false,
        enabled: !override?.hidden,
        sort: override?.sort ?? index,
      };
    })
    .filter((entry) => entry.enabled);

  const customEntries: SortableCatalogEntry[] = catalog.custom
    .filter((entry) => entry.enabled && entry.providerId === providerId)
    .map((entry, index): SortableCatalogEntry => ({
      key: entry.id,
      value: entry.alias,
      rawValue: entry.modelId,
      label: entry.label,
      group: "自定义",
      providerId,
      source: "custom",
      editable: true,
      enabled: true,
      sort: 1000 + index,
    }));

  const seen = new Set<string>();
  const merged = [...providerEntries, ...customEntries]
    .filter((entry) => {
      // Provider rows dedupe on the raw advertised value: DSH lists the same bare
      // id under more than one provider group (opencode-go vs local-7357), and
      // collapsing those silently drops rows. Custom aliases stay keyed by alias.
      const dedupeKey = entry.source === "custom"
        ? `${entry.providerId}:${entry.value}`
        : `${entry.providerId}:${entry.rawValue}`;
      if (seen.has(dedupeKey)) return false;
      seen.add(dedupeKey);
      return true;
    })
    .sort((left, right) => left.sort - right.sort);

  return merged.map((entry) => ({
    key: entry.key,
    value: entry.value,
    rawValue: entry.rawValue,
    label: entry.label,
    group: entry.group,
    providerId: entry.providerId,
    source: entry.source,
    editable: entry.editable,
    enabled: entry.enabled,
  }));
}

interface SortableCatalogEntry extends CatalogEntry {
  sort: number;
}

/** DSH advertises `["provider","model"]`; other agents advertise a bare id. */
function bareModelId(value: string): string {
  if (!value.startsWith("[")) return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && typeof parsed[1] === "string" && parsed[1]) return parsed[1];
  } catch {
    // Not a JSON tuple: keep the raw value.
  }
  return value;
}
