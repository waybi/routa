/**
 * @vitest-environment node
 */
import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCachedProviderConfigOptions,
  getProviderConfigOptions,
  recordProviderConfigOptions,
  resetProviderConfigOptionsCache,
  type ProbeProcess,
} from "../provider-config-probe";

const probeOptions = [{ id: "model", currentValue: JSON.stringify(["local-7357", "claude-opus-5-5-pool"]) }];

function fakeProcess(options = probeOptions) {
  const methods: string[] = [];
  const proc: ProbeProcess & { methods: string[]; cwd?: string } = {
    methods,
    start: vi.fn(async () => {
      methods.push("start");
    }),
    initialize: vi.fn(async () => {
      methods.push("initialize");
    }),
    newSession: vi.fn(async (cwd?: string) => {
      methods.push("session/new");
      proc.cwd = cwd;
      return "probe-session";
    }),
    getConfigOptions: vi.fn(() => options),
    kill: vi.fn(() => {
      methods.push("kill");
    }),
  };
  return proc;
}

describe("provider-config-probe", () => {
  beforeEach(() => {
    resetProviderConfigOptionsCache();
  });

  it("probes with initialize + session/new only, then kills the process and removes the temp dir", async () => {
    const proc = fakeProcess();
    let factoryCwd = "";
    const factory = vi.fn(async (_providerId: string, cwd: string) => {
      factoryCwd = cwd;
      expect(existsSync(cwd)).toBe(true);
      return proc;
    });

    const entry = await getProviderConfigOptions("dsh", { factory });

    expect(proc.methods).toEqual(["start", "initialize", "session/new", "kill"]);
    expect(proc.methods).not.toContain("session/prompt");
    expect(Object.keys(proc)).not.toContain("prompt");
    expect(proc.cwd).toBe(factoryCwd);
    expect(existsSync(factoryCwd)).toBe(false);
    expect(entry).toMatchObject({ providerId: "dsh", configOptions: probeOptions, source: "probe" });
    expect(Date.parse(entry.fetchedAt)).not.toBeNaN();
    expect(getCachedProviderConfigOptions("dsh")).toEqual(entry);
  });

  it("serves the cache without probing, and re-probes on refresh", async () => {
    const factory = vi.fn(async () => fakeProcess());
    await getProviderConfigOptions("dsh", { factory });
    await getProviderConfigOptions("dsh", { factory });
    expect(factory).toHaveBeenCalledTimes(1);

    await getProviderConfigOptions("dsh", { factory, refresh: true });
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("returns the latest live-session options recorded for the provider", async () => {
    const sessionOptions = [{ id: "reasoning_effort", currentValue: "high" }];
    recordProviderConfigOptions("dsh", sessionOptions);
    const factory = vi.fn(async () => fakeProcess());

    const entry = await getProviderConfigOptions("dsh", { factory });

    expect(factory).not.toHaveBeenCalled();
    expect(entry).toMatchObject({ configOptions: sessionOptions, source: "session" });
  });

  it("shares one in-flight probe across concurrent requests", async () => {
    const factory = vi.fn(async () => fakeProcess());
    const [a, b] = await Promise.all([
      getProviderConfigOptions("dsh", { factory, refresh: true }),
      getProviderConfigOptions("dsh", { factory, refresh: true }),
    ]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("still kills the process and removes the temp dir when session/new fails or times out", async () => {
    const failing = fakeProcess();
    failing.newSession = vi.fn(async () => {
      throw new Error("auth required");
    });
    let failCwd = "";
    await expect(
      getProviderConfigOptions("dsh", { factory: async (_p, cwd) => ((failCwd = cwd), failing) }),
    ).rejects.toThrow("auth required");
    expect(failing.kill).toHaveBeenCalled();
    expect(existsSync(failCwd)).toBe(false);

    const hanging = fakeProcess();
    hanging.initialize = vi.fn(() => new Promise(() => {}));
    let hangCwd = "";
    await expect(
      getProviderConfigOptions("dsh", { factory: async (_p, cwd) => ((hangCwd = cwd), hanging), timeoutMs: 20 }),
    ).rejects.toThrow("timed out");
    expect(hanging.kill).toHaveBeenCalled();
    expect(existsSync(hangCwd)).toBe(false);
    expect(getCachedProviderConfigOptions("dsh")).toBeUndefined();
  });
});
