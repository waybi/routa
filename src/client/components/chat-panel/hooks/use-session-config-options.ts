"use client";

/**
 * Read / change the live session's ACP configOptions (model, reasoning effort)
 * through GET/POST /api/sessions/{sessionId}/config-options.
 *
 * Single source of truth: only the configOptions array is stored. Model and
 * effort are derived with summarizeConfigOptions at render time, and every
 * POST response / config_option_update notification replaces the whole array
 * (changing the model resets the effort on DSH, so partial updates would lie).
 */

import { useCallback, useEffect, useState } from "react";
import { resolveApiPath } from "../../../config/backend";
import { desktopAwareFetch } from "../../../utils/diagnostics";
import { extractConfigOptions, type AcpConfigOption } from "@/core/acp/config-options";

type ConfigRequestResult =
  | { kind: "ok"; configOptions: AcpConfigOption[] }
  | { kind: "unavailable" }
  | { kind: "error" };

function configOptionsPath(sessionId: string): string {
  return resolveApiPath(`/api/sessions/${encodeURIComponent(sessionId)}/config-options`);
}

async function requestConfigOptions(sessionId: string, init?: RequestInit): Promise<ConfigRequestResult> {
  try {
    const response = await desktopAwareFetch(configOptionsPath(sessionId), { cache: "no-store", ...init });
    if (response.status === 404) return { kind: "unavailable" };
    if (!response.ok) return { kind: "error" };
    const configOptions = extractConfigOptions(await response.json().catch(() => null));
    return configOptions ? { kind: "ok", configOptions } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

interface SessionConfigState {
  sessionId: string | null;
  configOptions: AcpConfigOption[] | null;
  unavailable: boolean;
  pending: boolean;
}

const EMPTY_STATE: SessionConfigState = { sessionId: null, configOptions: null, unavailable: false, pending: false };

export interface UseSessionConfigOptionsOptions {
  sessionId: string | null;
  /** Latest configOptions pushed by config_option_update for this session. */
  notifiedOptions?: AcpConfigOption[];
  /** Changing this value re-fetches (e.g. when a turn starts/ends after a resume). */
  refreshKey?: unknown;
}

export interface UseSessionConfigOptionsResult {
  configOptions: AcpConfigOption[] | null;
  /** True after a 404: the session has no live agent process. */
  unavailable: boolean;
  /** True while a POST is in flight; selects stay disabled to avoid out-of-order replies. */
  pending: boolean;
  setOption: (configId: string, value: string) => Promise<void>;
  applyConfigOptions: (options: AcpConfigOption[]) => void;
}

export function useSessionConfigOptions({
  sessionId,
  notifiedOptions,
  refreshKey,
}: UseSessionConfigOptionsOptions): UseSessionConfigOptionsResult {
  const [state, setState] = useState<SessionConfigState>(EMPTY_STATE);
  // State belongs to one session; anything recorded for another is ignored.
  const current = state.sessionId === sessionId ? state : { ...EMPTY_STATE, sessionId };

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void (async () => {
      const result = await requestConfigOptions(sessionId);
      if (cancelled) return;
      if (result.kind === "error") {
        console.warn(`[useSessionConfigOptions] config-options request failed for ${sessionId}`);
      }
      setState((prev) => {
        const base = prev.sessionId === sessionId ? prev : { ...EMPTY_STATE, sessionId };
        if (result.kind === "ok") return { ...base, configOptions: result.configOptions, unavailable: false };
        return { ...base, unavailable: true };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  const applyConfigOptions = useCallback((options: AcpConfigOption[]) => {
    if (!sessionId) return;
    setState((prev) => {
      const base = prev.sessionId === sessionId ? prev : { ...EMPTY_STATE, sessionId };
      return { ...base, configOptions: options, unavailable: false };
    });
  }, [sessionId]);

  // A new notification payload replaces the options during render (React's
  // "adjust state when a prop changes" pattern) instead of in an effect.
  const [seenNotified, setSeenNotified] = useState<AcpConfigOption[] | undefined>(undefined);
  if (notifiedOptions !== seenNotified) {
    setSeenNotified(notifiedOptions);
    if (notifiedOptions && sessionId) {
      setState((prev) => {
        const base = prev.sessionId === sessionId ? prev : { ...EMPTY_STATE, sessionId };
        return { ...base, configOptions: notifiedOptions, unavailable: false };
      });
    }
  }

  const setOption = useCallback(async (configId: string, value: string) => {
    if (!sessionId) return;
    const target = sessionId;
    setState((prev) => ({ ...(prev.sessionId === target ? prev : { ...EMPTY_STATE, sessionId: target }), pending: true }));
    const result = await requestConfigOptions(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ configId, value }),
    });
    if (result.kind === "error") {
      console.warn(`[useSessionConfigOptions] failed to set ${configId} for ${target}`);
    }
    setState((prev) => {
      // A reply for a session the user already left must not overwrite the new one.
      if (prev.sessionId !== target) return prev;
      if (result.kind === "ok") return { ...prev, configOptions: result.configOptions, unavailable: false, pending: false };
      if (result.kind === "unavailable") return { ...prev, unavailable: true, pending: false };
      return { ...prev, pending: false };
    });
  }, [sessionId]);

  return {
    configOptions: current.configOptions,
    unavailable: current.unavailable,
    pending: current.pending,
    setOption,
    applyConfigOptions,
  };
}
