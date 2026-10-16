/**
 * GET /api/providers/{providerId}/config-options[?refresh=1]
 *
 * Latest configOptions (models / reasoning effort) for a provider: the most
 * recent live session's options when cached, otherwise a no-prompt probe
 * (initialize + session/new in an empty temp dir). Logic: provider-config-probe.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPresetByIdWithRegistry } from "@/core/acp/acp-presets";
import { summarizeConfigOptions } from "@/core/acp/config-options";
import { getProviderConfigOptions } from "@/core/acp/provider-config-probe";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const { providerId } = await params;
  const refreshParam = request.nextUrl.searchParams.get("refresh");
  const refresh = refreshParam === "1" || refreshParam === "true";

  if (!(await getPresetByIdWithRegistry(providerId))) {
    return NextResponse.json({ error: `Unknown provider: ${providerId}` }, { status: 404 });
  }

  try {
    const entry = await getProviderConfigOptions(providerId, { refresh });
    return NextResponse.json({ ...entry, ...summarizeConfigOptions(entry.configOptions) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `configOptions probe failed: ${message}`, providerId }, { status: 502 });
  }
}
