import { NextRequest, NextResponse } from "next/server";

import {
  MODEL_CONFIG_ID,
  REASONING_EFFORT_CONFIG_ID,
  findOption,
  flattenOptionValues,
  parseModelValue,
  type AcpConfigOption,
} from "@/core/acp/config-options";
import { getProviderConfigOptions } from "@/core/acp/provider-config-probe";
import {
  mergeCatalog,
  readModelCatalog,
  type ProbeModelChoice,
} from "@/core/models/model-catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/models/catalog?provider=dsh[&refresh=1]
 *
 * The single entry point every model picker should read: advertised models
 * mirrored with display overrides, plus Routa-owned custom models. A probe
 * failure still returns the custom entries so the picker degrades instead of
 * going blank.
 */
export async function GET(request: NextRequest) {
  const providerId = request.nextUrl.searchParams.get("provider")?.trim() || "dsh";
  const refresh = ["1", "true"].includes(request.nextUrl.searchParams.get("refresh") ?? "");

  try {
    const probed = await getProviderConfigOptions(providerId, { refresh });
    return NextResponse.json({
      providerId,
      fetchedAt: probed.fetchedAt,
      source: probed.source,
      entries: mergeCatalog(providerId, collectModelChoices(probed.configOptions)),
      reasoningEfforts: collectReasoningEfforts(probed.configOptions),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      providerId,
      fetchedAt: null,
      source: null,
      entries: mergeCatalog(providerId, [], readModelCatalog()),
      reasoningEfforts: [],
      error: `configOptions probe failed: ${message}`,
    });
  }
}

/** Same shape the client parser builds: raw select value + display name + group name. */
function collectModelChoices(options: AcpConfigOption[]): ProbeModelChoice[] {
  const modelOption = findOption(options, MODEL_CONFIG_ID);
  const groupLabels = new Map<string, string>();
  for (const entry of modelOption?.options ?? []) {
    if (entry && typeof entry === "object" && "group" in entry && typeof entry.group === "string") {
      groupLabels.set(entry.group, entry.name?.trim() || entry.group);
    }
  }
  const choices: ProbeModelChoice[] = [];
  const seen = new Set<string>();
  for (const entry of flattenOptionValues(modelOption)) {
    if (seen.has(entry.value)) continue;
    const modelId = parseModelValue(entry.value)?.model;
    if (!modelId) continue;
    seen.add(entry.value);
    choices.push({
      value: entry.value,
      label: entry.name?.trim() || modelId,
      ...(entry.group ? { group: groupLabels.get(entry.group) ?? entry.group } : {}),
    });
  }
  return choices;
}

/** Reasoning efforts are still agent-owned: mirror them so one request feeds both pickers. */
function collectReasoningEfforts(options: AcpConfigOption[]): Array<{ value: string; label: string }> {
  const efforts: Array<{ value: string; label: string }> = [];
  const seen = new Set<string>();
  for (const entry of flattenOptionValues(findOption(options, REASONING_EFFORT_CONFIG_ID))) {
    // "" is the agent's own "provider default"; the picker's "follow default" covers it.
    if (!entry.value || seen.has(entry.value)) continue;
    seen.add(entry.value);
    efforts.push({ value: entry.value, label: entry.name?.trim() || entry.value });
  }
  return efforts;
}
