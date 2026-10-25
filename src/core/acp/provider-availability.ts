/**
 * Provider availability — one install check shared by every caller.
 *
 * The check is `which(resolveCommand(preset))`: the same command the process
 * layer spawns (process-config.ts buildConfigFromPreset, claude-code-process.ts
 * buildClaudeCodeConfig). Callers translate the result themselves:
 * - session/new returns JSON-RPC error -32002 before creating a session;
 * - GET /api/providers?check=true and `_providers/list` set `unavailableReason`.
 *
 * Probe failures are a normal return value; these functions never throw.
 * Only static presets are covered: registry agents need a network fetch and
 * stay out of the synchronous session/new path.
 */

import { getPresetById, resolveCommand, type AcpAgentPreset } from "./acp-presets";
import { which } from "./utils";

export type ProviderAvailabilityStatus = "available" | "unavailable";

export interface ProviderAvailability {
  status: ProviderAvailabilityStatus;
  /** Command checked (and later spawned): env override, node_modules/.bin path or bare name. */
  command: string;
  /** Set only when unavailable: "<command> is not installed or not in PATH". */
  reason?: string;
}

export function buildCommandUnavailableReason(command: string): string {
  return `${command} is not installed or not in PATH`;
}

/** Availability of a static preset object (list routes already hold the presets). */
export async function resolvePresetAvailability(preset: AcpAgentPreset): Promise<ProviderAvailability> {
  let command = preset.command;
  try {
    command = resolveCommand(preset);
    const resolved = await which(command);
    if (resolved) {
      return { status: "available", command };
    }
  } catch {
    // Treat a failed probe like a missing command.
  }
  return { status: "unavailable", command, reason: buildCommandUnavailableReason(command) };
}

/**
 * Availability of a provider id. Returns null when the id is not a static
 * preset (registry-only agents such as `codex-acp`): the caller lets it through.
 */
export async function resolveProviderAvailability(providerId: string): Promise<ProviderAvailability | null> {
  const preset = getPresetById(providerId);
  if (!preset) return null;
  return resolvePresetAvailability(preset);
}
