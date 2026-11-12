/**
 * Members a team lead delegates to follow the lead's model and reasoning
 * effort when they run on the same provider.
 *
 * Rules (card 44581a6c, AC4):
 * - different provider than the lead: inherit nothing (model ids and effort
 *   values are provider-specific);
 * - same provider: reasoning effort = the lead's; model = the role's own model
 *   (specialist `model`, else OrchestratorConfig crafterModel / gateModel /
 *   routaModel) when set, else the lead's.
 *
 * DSH starts known models through DSH_ACP_MODEL, with DSH_ACP_PROVIDER for
 * non-local groups. Unknown models keep the replay-only fallback; every model
 * is also applied with session/set_config_option after start.
 */

import { DSH_ENV_MODEL_GROUP, applySessionConfig, type SessionConfigTarget } from "../acp/session-config-apply";
import { parseModelValue, resolveModelValue, type AcpConfigOption } from "../acp/config-options";
import { getHttpSessionStore } from "../acp/http-session-store";
import { AgentRole } from "../models/agent";

export { DSH_ENV_MODEL_GROUP };

export interface ChildModelConfig {
  model?: string;
  reasoningEffort?: string;
}

export interface ChildModelInput {
  childProvider: string;
  callerProvider?: string;
  callerModel?: string;
  callerReasoningEffort?: string;
  /** The role's own model; wins over the lead's model on the same provider. */
  roleModel?: string;
}

export function resolveChildModelConfig(input: ChildModelInput): ChildModelConfig {
  if (input.callerProvider === undefined || input.childProvider !== input.callerProvider) return {};
  const result: ChildModelConfig = {};
  const model = input.roleModel?.trim() || input.callerModel?.trim();
  if (model) result.model = model;
  if (input.callerReasoningEffort !== undefined) result.reasoningEffort = input.callerReasoningEffort;
  return result;
}

export interface RoleModelConfig {
  crafterModel?: string;
  gateModel?: string;
  routaModel?: string;
}

/** Specialist model first, then the per-role OrchestratorConfig override. */
export function resolveRoleModel(
  role: AgentRole | string,
  specialistModel: string | undefined,
  config: RoleModelConfig,
): string | undefined {
  const fromSpecialist = specialistModel?.trim();
  if (fromSpecialist) return fromSpecialist;
  const byRole = role === AgentRole.CRAFTER
    ? config.crafterModel
    : role === AgentRole.GATE
      ? config.gateModel
      : role === AgentRole.ROUTA
        ? config.routaModel
        : undefined;
  return byRole?.trim() || undefined;
}

/** Startup env for a dsh child, resolved only from the lead's known options. */
export function buildChildModelEnv(
  childProvider: string,
  model: string | undefined,
  callerOptions: AcpConfigOption[] | undefined,
): Record<string, string> | undefined {
  if (childProvider !== "dsh" || !model) return undefined;
  const value = resolveModelValue(callerOptions, model);
  const parsed = parseModelValue(value);
  if (!parsed?.provider) return undefined;
  return parsed.provider === DSH_ENV_MODEL_GROUP
    ? { DSH_ACP_MODEL: model }
    : { DSH_ACP_PROVIDER: parsed.provider, DSH_ACP_MODEL: parsed.model };
}

export interface DelegationModelPlan extends ChildModelConfig {
  extraEnv?: Record<string, string>;
}

/** Everything spawnChildAgent needs to start a member on the lead's model / effort. */
export function planDelegationModel(params: {
  callerSessionId: string;
  childProvider: string;
  role: AgentRole | string;
  specialistModel?: string;
  config: RoleModelConfig;
  callerOptions: (sessionId: string) => AcpConfigOption[] | undefined;
}): DelegationModelPlan {
  const caller = getHttpSessionStore().getSession(params.callerSessionId);
  const inherited = resolveChildModelConfig({
    childProvider: params.childProvider,
    callerProvider: caller?.provider,
    callerModel: caller?.model,
    callerReasoningEffort: caller?.reasoningEffort,
    roleModel: resolveRoleModel(params.role, params.specialistModel, params.config),
  });
  if (!inherited.model && inherited.reasoningEffort === undefined) return {};
  let options: AcpConfigOption[] | undefined;
  try {
    options = params.callerOptions(params.callerSessionId);
  } catch {
    options = undefined; // lead has no live process: model goes through set_config_option only
  }
  const extraEnv = buildChildModelEnv(params.childProvider, inherited.model, options);
  return extraEnv ? { ...inherited, extraEnv } : inherited;
}

/** Apply the planned model / effort to the started child; returns the values in effect. */
export async function applyChildModelConfig(
  target: SessionConfigTarget,
  sessionId: string,
  plan: DelegationModelPlan | undefined,
): Promise<ChildModelConfig> {
  if (!plan || (!plan.model && plan.reasoningEffort === undefined)) return {};
  const applied = await applySessionConfig(
    target,
    sessionId,
    { model: plan.model, reasoningEffort: plan.reasoningEffort },
    "[Orchestrator]",
  );
  const result: ChildModelConfig = {};
  const model = applied.model ?? plan.model;
  if (model) result.model = model;
  if (applied.reasoningEffort !== undefined) result.reasoningEffort = applied.reasoningEffort;
  return result;
}
