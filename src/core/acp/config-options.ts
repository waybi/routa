/**
 * ACP session configOptions helpers.
 *
 * Agents (DSH first) advertise standard `configOptions` on session/new and
 * session/load results, push full replacements through
 * session/update(config_option_update), and accept changes through
 * session/set_config_option. This module only holds types and pure helpers;
 * process/session wiring lives in acp-process.ts and its callers.
 */

export const MODEL_CONFIG_ID = "model";
export const REASONING_EFFORT_CONFIG_ID = "reasoning_effort";

/** Raised when a config operation targets a session without a live ACP process. */
export class SessionProcessNotFoundError extends Error {
  readonly code = "SESSION_PROCESS_NOT_FOUND";

  constructor(readonly sessionId: string) {
    super(`No live ACP process for session ${sessionId}`);
    this.name = "SessionProcessNotFoundError";
  }
}

export interface AcpConfigSelectValue {
  value: string;
  name?: string;
  description?: string;
}

export interface AcpConfigSelectGroup {
  group: string;
  name?: string;
  options: AcpConfigSelectValue[];
}

export interface AcpConfigOption {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  type?: string;
  currentValue?: unknown;
  /** Flat `{value,name}` entries or grouped `{group,name,options}` entries. */
  options?: Array<AcpConfigSelectValue | AcpConfigSelectGroup>;
}

export interface AcpConfigSummary {
  /** Current model id (e.g. `claude-opus-4-6`), parsed from the model option value. */
  model?: string;
  /** Current reasoning effort; `""` means provider default. */
  reasoningEffort?: string;
}

/** Narrow an unknown payload (RPC result / notification) to a configOptions array. */
export function extractConfigOptions(payload: unknown): AcpConfigOption[] | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const value = (payload as { configOptions?: unknown }).configOptions;
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (item): item is AcpConfigOption =>
      !!item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string",
  );
}

export function findOption(
  options: AcpConfigOption[] | undefined,
  id: string,
): AcpConfigOption | undefined {
  return options?.find((option) => option.id === id);
}

function isGroup(entry: AcpConfigSelectValue | AcpConfigSelectGroup): entry is AcpConfigSelectGroup {
  return Array.isArray((entry as AcpConfigSelectGroup).options);
}

/** Flatten both flat and grouped select shapes into `{value, group?}` entries. */
export function flattenOptionValues(
  option: AcpConfigOption | undefined,
): Array<AcpConfigSelectValue & { group?: string }> {
  const out: Array<AcpConfigSelectValue & { group?: string }> = [];
  for (const entry of option?.options ?? []) {
    if (!entry || typeof entry !== "object") continue;
    if (isGroup(entry)) {
      for (const child of entry.options) {
        if (child && typeof child.value === "string") out.push({ ...child, group: entry.group });
      }
    } else if (typeof entry.value === "string") {
      out.push(entry);
    }
  }
  return out;
}

/**
 * Parse a model option value. DSH encodes it as a JSON string
 * `["<provider>","<model>"]`; anything else is treated as a plain model id.
 */
export function parseModelValue(value: unknown): { provider?: string; model: string } | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.length >= 2 && typeof parsed[1] === "string") {
      return { provider: typeof parsed[0] === "string" ? parsed[0] : undefined, model: parsed[1] };
    }
  } catch {
    // not JSON — plain model id
  }
  return { model: value };
}

/**
 * Map a model id (`claude-opus-4-6`) or a full option value to the exact
 * select value advertised by the agent. Prefers an exact value match, then a
 * model-id match within the current provider, then the first model-id match.
 */
export function resolveModelValue(
  options: AcpConfigOption[] | undefined,
  modelId: string,
): string | undefined {
  const modelOption = findOption(options, MODEL_CONFIG_ID);
  const values = flattenOptionValues(modelOption);
  const wanted = modelId.trim();
  if (!wanted) return undefined;

  const exact = values.find((entry) => entry.value === wanted);
  if (exact) return exact.value;

  const currentProvider = parseModelValue(modelOption?.currentValue)?.provider;
  const matches = values.filter((entry) => parseModelValue(entry.value)?.model === wanted);
  if (matches.length === 0) return undefined;
  const sameProvider = currentProvider
    ? matches.find((entry) => parseModelValue(entry.value)?.provider === currentProvider)
    : undefined;
  return (sameProvider ?? matches[0]).value;
}

export function summarizeConfigOptions(options: AcpConfigOption[] | undefined): AcpConfigSummary {
  const summary: AcpConfigSummary = {};
  const model = findOption(options, MODEL_CONFIG_ID);
  const parsed = parseModelValue(model?.currentValue);
  if (parsed) summary.model = parsed.model;
  const effort = findOption(options, REASONING_EFFORT_CONFIG_ID);
  if (effort && typeof effort.currentValue === "string") summary.reasoningEffort = effort.currentValue;
  return summary;
}
