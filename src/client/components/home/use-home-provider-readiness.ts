"use client";

/**
 * Read-only "is a model executor ready?" probe for the home page.
 *
 * The old home called `acp.connect()` on mount, which POSTs /api/acp
 * (initialize). The home must only read (design-spec §4), so it asks
 * GET /api/providers?check=true — the same local command probe connect()
 * runs — and merges the user's custom providers. ACP itself connects only
 * when the user opens Settings.
 */

import { useEffect, useState } from "react";
import type { AcpProviderInfo } from "@/client/acp-client";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import { loadCustomAcpProviders, loadHiddenProviders } from "@/client/utils/custom-acp-providers";

export interface HomeProviderReadiness {
  providers: AcpProviderInfo[];
  loaded: boolean;
}

export function useHomeProviderReadiness(): HomeProviderReadiness {
  const [state, setState] = useState<HomeProviderReadiness>({ providers: [], loaded: false });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let probed: AcpProviderInfo[];
      try {
        const response = await desktopAwareFetch("/api/providers?check=true", { cache: "no-store" });
        const body = response.ok ? ((await response.json()) as { providers?: unknown }) : {};
        probed = Array.isArray(body.providers) ? (body.providers as AcpProviderInfo[]) : [];
      } catch {
        probed = [];
      }
      if (cancelled) return;
      const hidden = loadHiddenProviders();
      const custom = loadCustomAcpProviders().map((provider) => ({
        id: provider.id,
        name: provider.name,
        description: provider.description ?? "",
        command: provider.command,
        status: "available" as const,
      }));
      setState({ providers: [...probed, ...custom].filter((provider) => !hidden.includes(provider.id)), loaded: true });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}
