/**
 * Apply requested model / reasoning effort to a live ACP session through
 * standard configOptions. Order is a hard constraint: changing `model`
 * resets `reasoning_effort` to "" on DSH, so the model is always set first.
 *
 * Every failure degrades to a warning — session creation and recovery must
 * never fail because an agent lacks (or rejects) a config option.
 */

import { getCachedProviderConfigOptions } from "@/core/acp/provider-config-probe";
import {
  MODEL_CONFIG_ID,
  REASONING_EFFORT_CONFIG_ID,
  findOption,
  parseModelValue,
  resolveModelValue,
  summarizeConfigOptions,
  type AcpConfigOption,
  type AcpConfigSummary,
} from "@/core/acp/config-options";

export interface SessionConfigTarget {
  getConfigOptions(sessionId: string): AcpConfigOption[];
  setConfigOption(sessionId: string, configId: string, value: string): Promise<AcpConfigOption[]>;
}

export interface RequestedSessionConfig {
  model?: string;
  reasoningEffort?: string;
}

export interface AppliedSessionConfig extends AcpConfigSummary {
  configOptions: AcpConfigOption[];
  warnings: string[];
}

export async function applySessionConfig(
  target: SessionConfigTarget,
  sessionId: string,
  requested: RequestedSessionConfig,
  logPrefix = "[SessionConfig]",
): Promise<AppliedSessionConfig> {
  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    console.warn(`${logPrefix} ${sessionId}: ${message}`);
  };

  let options: AcpConfigOption[];
  try {
    options = target.getConfigOptions(sessionId);
  } catch (error) {
    warn(`cannot read configOptions: ${error instanceof Error ? error.message : String(error)}`);
    return { configOptions: [], warnings };
  }

  const requestedModel = requested.model?.trim();
  if (requestedModel) {
    const modelOption = findOption(options, MODEL_CONFIG_ID);
    const wantedModelId = parseModelValue(requestedModel)?.model ?? requestedModel;
    if (!modelOption) {
      warn(`agent does not declare a "${MODEL_CONFIG_ID}" option; keeping startup model`);
    } else if (summarizeConfigOptions(options).model !== wantedModelId) {
      const value = resolveModelValue(options, requestedModel);
      if (!value) {
        warn(`model "${requestedModel}" not offered by agent; keeping startup model`);
      } else {
        try {
          options = await target.setConfigOption(sessionId, MODEL_CONFIG_ID, value);
        } catch (error) {
          warn(`set model failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  const requestedEffort = requested.reasoningEffort;
  if (typeof requestedEffort === "string") {
    const effortOption = findOption(options, REASONING_EFFORT_CONFIG_ID);
    if (!effortOption) {
      if (requestedEffort !== "") {
        warn(`agent does not declare a "${REASONING_EFFORT_CONFIG_ID}" option; skipping reasoning effort`);
      }
    } else if (effortOption.currentValue !== requestedEffort) {
      try {
        options = await target.setConfigOption(sessionId, REASONING_EFFORT_CONFIG_ID, requestedEffort);
      } catch (error) {
        warn(`set reasoning effort failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { ...summarizeConfigOptions(options), configOptions: options, warnings };
}

/** Default provider when DSH_ACP_PROVIDER is omitted. */
export const DSH_ENV_MODEL_GROUP = "local-7357";

/** Known option groups can start via env; retain support for explicit local values. */
export function isDshEnvStartableModel(model: string | undefined, options: AcpConfigOption[] | undefined): boolean {
  if (!model) return false;
  return parseModelValue(model.trim())?.provider === DSH_ENV_MODEL_GROUP
    || !!parseModelValue(resolveModelValue(options, model))?.provider;
}

/** Startup env for recovery; unknown models retain the existing replay-only fallback. */
export function buildRecoveryModelEnv(
  provider: string,
  storedModel: string | undefined,
  knownOptions: AcpConfigOption[] | undefined = getCachedProviderConfigOptions(provider)?.configOptions,
): Record<string, string> | undefined {
  const parsed = parseModelValue(storedModel?.trim());
  if (provider !== "dsh" || !parsed || !isDshEnvStartableModel(storedModel, knownOptions)) return undefined;
  const resolved = parseModelValue(resolveModelValue(knownOptions, storedModel!));
  return resolved?.provider && resolved.provider !== DSH_ENV_MODEL_GROUP
    ? { DSH_ACP_PROVIDER: resolved.provider, DSH_ACP_MODEL: resolved.model }
    : { DSH_ACP_MODEL: parsed.model };
}

/**
 * Replay the stored model, then the stored reasoning effort, onto a freshly
 * recreated/loaded session. Only names are stored; values are re-mapped
 * against the options the agent reports now. No-op without an ACP process.
 */
export async function replayStoredSessionConfig(
  target: SessionConfigTarget & { getProcess(sessionId: string): unknown },
  sessionId: string,
  stored: RequestedSessionConfig,
): Promise<AppliedSessionConfig | undefined> {
  if (!target.getProcess(sessionId)) return undefined;
  if (stored.model === undefined && stored.reasoningEffort === undefined) return undefined;
  return applySessionConfig(target, sessionId, stored, "[SessionRecovery]");
}
