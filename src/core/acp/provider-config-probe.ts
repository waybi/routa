/**
 * Provider-level configOptions (models / reasoning effort) for UIs that need
 * the choices before any session exists (e.g. kanban column settings).
 *
 * - Every live session's configOptions change is recorded as the provider's
 *   latest options (source "session").
 * - Without a cache entry, or with refresh, a probe runs: start the agent in
 *   an empty temp dir, initialize + session/new only — never session/prompt,
 *   so no model is called — then kill the process and delete the temp dir.
 * - Concurrent probes for the same provider share one in-flight promise, so a
 *   burst of requests starts at most one agent process.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AcpProcess } from "@/core/acp/acp-process";
import type { AcpConfigOption } from "@/core/acp/config-options";
import { buildConfigFromPreset } from "@/core/acp/process-config";

export interface ProviderConfigOptionsEntry {
  providerId: string;
  configOptions: AcpConfigOption[];
  /** ISO timestamp of when the options were captured. */
  fetchedAt: string;
  source: "session" | "probe";
}

/** Minimal process surface the probe needs (lets tests inject a fake). */
export interface ProbeProcess {
  start(): Promise<void>;
  initialize(): Promise<unknown>;
  newSession(cwd?: string, mcpServers?: Array<Record<string, unknown>>): Promise<string>;
  getConfigOptions(): AcpConfigOption[] | undefined;
  kill(): void;
}

export type ProbeProcessFactory = (providerId: string, cwd: string) => Promise<ProbeProcess>;

export const PROVIDER_PROBE_TIMEOUT_MS = 30_000;

const cache = new Map<string, ProviderConfigOptionsEntry>();
const inFlight = new Map<string, Promise<ProviderConfigOptionsEntry>>();

const defaultFactory: ProbeProcessFactory = async (providerId, cwd) => {
  const config = await buildConfigFromPreset(providerId, cwd);
  return new AcpProcess(config, () => {});
};

/** Record the latest options seen on a live session of this provider. */
export function recordProviderConfigOptions(providerId: string | undefined, configOptions: AcpConfigOption[]): void {
  if (!providerId || configOptions.length === 0) return;
  cache.set(providerId, {
    providerId,
    configOptions,
    fetchedAt: new Date().toISOString(),
    source: "session",
  });
}

export function getCachedProviderConfigOptions(providerId: string): ProviderConfigOptionsEntry | undefined {
  return cache.get(providerId);
}

/** Test hook. */
export function resetProviderConfigOptionsCache(): void {
  cache.clear();
  inFlight.clear();
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runProbe(
  providerId: string,
  factory: ProbeProcessFactory,
  timeoutMs: number,
): Promise<ProviderConfigOptionsEntry> {
  const cwd = await mkdtemp(path.join(tmpdir(), "routa-config-probe-"));
  let proc: ProbeProcess | undefined;
  let finished = false;
  try {
    const configOptions = await withTimeout(
      (async () => {
        proc = await factory(providerId, cwd);
        // Timed out before the process existed: finally already ran, kill here.
        if (finished) {
          proc.kill();
          throw new Error("probe already finished");
        }
        await proc.start();
        await proc.initialize();
        await proc.newSession(cwd, []);
        return proc.getConfigOptions() ?? [];
      })(),
      timeoutMs,
      `configOptions probe for ${providerId}`,
    );
    const entry: ProviderConfigOptionsEntry = {
      providerId,
      configOptions,
      fetchedAt: new Date().toISOString(),
      source: "probe",
    };
    cache.set(providerId, entry);
    return entry;
  } finally {
    finished = true;
    try {
      proc?.kill();
    } catch (error) {
      console.warn(`[ProviderConfigProbe] kill failed for ${providerId}:`, error);
    }
    await rm(cwd, { recursive: true, force: true });
  }
}

/**
 * Cached options for the provider, probing when missing or when refresh is set.
 * Probe failures reject; callers decide how to surface them.
 */
export async function getProviderConfigOptions(
  providerId: string,
  options: { refresh?: boolean; factory?: ProbeProcessFactory; timeoutMs?: number } = {},
): Promise<ProviderConfigOptionsEntry> {
  if (!options.refresh) {
    const cached = cache.get(providerId);
    if (cached) return cached;
  }
  const pending = inFlight.get(providerId);
  if (pending) return pending;

  const probe = runProbe(
    providerId,
    options.factory ?? defaultFactory,
    options.timeoutMs ?? PROVIDER_PROBE_TIMEOUT_MS,
  ).finally(() => inFlight.delete(providerId));
  inFlight.set(providerId, probe);
  return probe;
}
