"use client";

/**
 * Codebases of the home page's workspace, with a `loaded` flag so the setup
 * reminder never flashes "no codebase" before the first GET returns.
 * Same endpoint as useCodebases (GET /api/workspaces/:id/codebases).
 */

import { useCallback, useEffect, useState } from "react";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { desktopAwareFetch } from "@/client/utils/diagnostics";

interface LoadedCodebases {
  workspaceId: string;
  codebases: CodebaseData[];
}

async function fetchCodebaseList(workspaceId: string): Promise<CodebaseData[]> {
  try {
    const response = await desktopAwareFetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/codebases`);
    if (!response.ok) return [];
    const body = (await response.json()) as { codebases?: CodebaseData[] };
    return body.codebases ?? [];
  } catch {
    return [];
  }
}

export function useHomeCodebases(workspaceId: string | null) {
  const [state, setState] = useState<LoadedCodebases | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!workspaceId || workspaceId === "__placeholder__") return;
    let cancelled = false;
    void fetchCodebaseList(workspaceId).then((codebases) => {
      if (!cancelled) setState({ workspaceId, codebases });
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, version]);

  const refetch = useCallback(async () => {
    setVersion((value) => value + 1);
  }, []);

  const loaded = Boolean(workspaceId) && state?.workspaceId === workspaceId;
  return { codebases: loaded ? state!.codebases : [], loaded, refetch };
}
