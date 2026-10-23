"use client";

/**
 * Accessible-codebase check restored from the pre-redesign home page
 * (e4e5c162 src/app/page.tsx L188-201, L275): a codebase only counts as
 * ready when its path answers GET /api/clone/branches (read-only; the
 * checkout lives in PATCH). Re-checks when the codebase paths change, drops
 * stale results after unmount, and reports `checked` so the readiness block
 * waits for the answer instead of flashing "not ready".
 */

import { useEffect, useState } from "react";
import type { CodebaseData } from "@/client/hooks/use-workspaces";
import { collectAccessibleRepoPaths } from "@/client/utils/repo-validation";

interface AccessResult {
  key: string;
  paths: Set<string>;
}

export function useHomeCodebaseAccess(codebases: CodebaseData[], loaded: boolean) {
  const key = codebases.map((codebase) => codebase.repoPath.trim()).join("\n");
  const [result, setResult] = useState<AccessResult | null>(null);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void collectAccessibleRepoPaths(key ? key.split("\n") : []).then((paths) => {
      if (!cancelled) setResult({ key, paths });
    });
    return () => {
      cancelled = true;
    };
  }, [key, loaded]);

  const checked = loaded && result?.key === key;
  const hasAccessibleCodebase = checked && codebases.some((codebase) => result.paths.has(codebase.repoPath.trim()));
  return { checked, hasAccessibleCodebase };
}
