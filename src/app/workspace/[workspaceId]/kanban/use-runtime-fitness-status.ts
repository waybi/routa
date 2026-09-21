"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/i18n";
import { resolveApiPath } from "@/client/config/backend";
import { desktopAwareFetch } from "@/client/utils/diagnostics";
import type { RuntimeFitnessStatusResponse } from "@/core/fitness/runtime-status-types";

/**
 * Background poll cadence. Fitness status is a status-bar indicator, not
 * something the user is watching tick; 5 s was pure overhead on a route that
 * took 3.2 s to answer on first call.
 */
const RUNTIME_FITNESS_POLL_MS = 15_000;

/**
 * Floor between two fetches from any trigger.
 *
 * `refreshSignal` changes on every `kanban:changed` SSE event *and* on each
 * step of the post-action refresh burst (1 s / 4 s / 8 s / 12 s). While an
 * agent writes comments those pile up, and each one used to fire its own
 * request — the measured symptom was 8 calls in ~6 s on an idle-looking
 * board. Collapsing them here keeps the "refresh soon after an action"
 * behavior without the stampede.
 */
const RUNTIME_FITNESS_MIN_FETCH_INTERVAL_MS = 5_000;

type UseRuntimeFitnessStatusOptions = {
  workspaceId: string;
  codebaseId?: string | null;
  repoPath?: string | null;
  enabled?: boolean;
  refreshSignal?: number;
  isPageVisible?: boolean;
};

type RuntimeFitnessState = {
  data: RuntimeFitnessStatusResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useRuntimeFitnessStatus({
  workspaceId,
  codebaseId,
  repoPath,
  enabled = true,
  refreshSignal,
  isPageVisible = true,
}: UseRuntimeFitnessStatusOptions): RuntimeFitnessState {
  const [data, setData] = useState<RuntimeFitnessStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const inFlightRef = useRef(false);
  const lastFetchAtRef = useRef(0);
  const trailingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lets the throttle's trailing timer call the latest fetchStatus without
  // making fetchStatus depend on itself.
  const fetchStatusRef = useRef<((options?: { force?: boolean }) => Promise<void>) | null>(null);
  const { t } = useTranslation();
  const loadErrorMessage = t.kanban.fitnessLoadError;

  const queryString = useMemo(() => {
    const query = new URLSearchParams();
    if (codebaseId) {
      query.set("codebaseId", codebaseId);
    } else if (repoPath) {
      query.set("repoPath", repoPath);
    } else if (workspaceId) {
      query.set("workspaceId", workspaceId);
    }
    const serialized = query.toString();
    return serialized.length > 0 ? serialized : null;
  }, [codebaseId, repoPath, workspaceId]);

  const fetchStatus = useCallback(async (options?: {
    signal?: AbortSignal;
    showLoading?: boolean;
    /** Skips the throttle; used by the explicit user-facing refresh(). */
    force?: boolean;
  }) => {
    if (!enabled || !queryString || inFlightRef.current) {
      return;
    }

    if (!options?.force) {
      const elapsed = Date.now() - lastFetchAtRef.current;
      if (elapsed < RUNTIME_FITNESS_MIN_FETCH_INTERVAL_MS) {
        // Schedule a single trailing fetch so the last signal in a burst is
        // still reflected, instead of dropping it.
        if (!trailingTimerRef.current) {
          trailingTimerRef.current = setTimeout(() => {
            trailingTimerRef.current = null;
            void fetchStatusRef.current?.({ force: true });
          }, RUNTIME_FITNESS_MIN_FETCH_INTERVAL_MS - elapsed);
        }
        return;
      }
    }

    inFlightRef.current = true;
    lastFetchAtRef.current = Date.now();
    if (options?.showLoading) {
      setLoading(true);
    }

    try {
      const response = await desktopAwareFetch(`${resolveApiPath("/api/fitness/runtime")}?${queryString}`, {
        cache: "no-store",
        signal: options?.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload?.details === "string" ? payload.details : loadErrorMessage);
      }
      setData(payload as RuntimeFitnessStatusResponse);
      setError(null);
    } catch (fetchError) {
      if ((fetchError as Error).name === "AbortError") {
        return;
      }
      setError(toMessage(fetchError));
    } finally {
      inFlightRef.current = false;
      if (options?.showLoading) {
        setLoading(false);
      }
    }
  }, [enabled, loadErrorMessage, queryString]);

  useEffect(() => {
    fetchStatusRef.current = fetchStatus;
  }, [fetchStatus]);

  useEffect(() => () => {
    if (trailingTimerRef.current) {
      clearTimeout(trailingTimerRef.current);
      trailingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !queryString) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    void fetchStatus({ signal: controller.signal, showLoading: true });
    return () => controller.abort();
  }, [enabled, fetchStatus, queryString, refreshNonce, refreshSignal]);

  useEffect(() => {
    if (!enabled || !queryString || !isPageVisible) {
      return;
    }

    const timerId = window.setInterval(() => {
      void fetchStatus();
    }, RUNTIME_FITNESS_POLL_MS);

    return () => window.clearInterval(timerId);
  }, [enabled, fetchStatus, isPageVisible, queryString]);

  const refresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  return { data, loading, error, refresh };
}
