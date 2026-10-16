import { describe, expect, it, vi } from "vitest";

import type { AcpConfigOption } from "../config-options";
import { applySessionConfig, type SessionConfigTarget } from "../session-config-apply";

const mv = (model: string) => JSON.stringify(["local-7357", model]);

function dshOptions(model: string, effort: string): AcpConfigOption[] {
  return [
    {
      id: "model",
      type: "select",
      currentValue: mv(model),
      options: [{ group: "local-7357", name: "Local", options: [
        { value: mv("claude-opus-5-5-pool"), name: "a" },
        { value: mv("claude-opus-4-6"), name: "b" },
      ] }],
    },
    { id: "reasoning_effort", type: "select", currentValue: effort, options: [{ value: "", name: "d" }, { value: "high", name: "h" }] },
  ];
}

/** Fake agent that mirrors DSH: changing model resets reasoning_effort to "". */
function fakeDshTarget(initial: AcpConfigOption[]) {
  let current = initial;
  const calls: Array<[string, string]> = [];
  const target: SessionConfigTarget = {
    getConfigOptions: () => current,
    setConfigOption: vi.fn(async (_sessionId: string, configId: string, value: string) => {
      calls.push([configId, value]);
      const model = configId === "model" ? JSON.parse(value)[1] : JSON.parse(String(current[0].currentValue))[1];
      const effort = configId === "model" ? "" : value;
      current = dshOptions(model, effort);
      return current;
    }),
  };
  return { target, calls };
}

describe("applySessionConfig", () => {
  it("sets model first, then reasoning_effort", async () => {
    const { target, calls } = fakeDshTarget(dshOptions("claude-opus-5-5-pool", ""));

    const result = await applySessionConfig(target, "s1", { model: "claude-opus-4-6", reasoningEffort: "high" });

    expect(calls).toEqual([["model", mv("claude-opus-4-6")], ["reasoning_effort", "high"]]);
    expect(result).toMatchObject({ model: "claude-opus-4-6", reasoningEffort: "high", warnings: [] });
  });

  it("skips the model change when the agent already runs the requested model", async () => {
    const { target, calls } = fakeDshTarget(dshOptions("claude-opus-4-6", ""));

    await applySessionConfig(target, "s1", { model: "claude-opus-4-6", reasoningEffort: "high" });

    expect(calls).toEqual([["reasoning_effort", "high"]]);
  });

  it("keeps the startup model and warns when the model cannot be mapped", async () => {
    const { target, calls } = fakeDshTarget(dshOptions("claude-opus-5-5-pool", ""));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await applySessionConfig(target, "s1", { model: "unknown-model" });

    expect(calls).toEqual([]);
    expect(result.model).toBe("claude-opus-5-5-pool");
    expect(result.warnings[0]).toContain("unknown-model");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("succeeds with warnings when the agent declares no configOptions", async () => {
    const target: SessionConfigTarget = { getConfigOptions: () => [], setConfigOption: vi.fn() };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await applySessionConfig(target, "s1", { model: "claude-opus-4-6", reasoningEffort: "high" });

    expect(target.setConfigOption).not.toHaveBeenCalled();
    expect(result.warnings).toHaveLength(2);
    expect(result.model).toBeUndefined();
    warn.mockRestore();
  });

  it("degrades to a warning when set_config_option fails", async () => {
    const target: SessionConfigTarget = {
      getConfigOptions: () => dshOptions("claude-opus-5-5-pool", ""),
      setConfigOption: vi.fn(async () => { throw new Error("boom"); }),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await applySessionConfig(target, "s1", { reasoningEffort: "high" });

    expect(result.reasoningEffort).toBe("");
    expect(result.warnings[0]).toContain("boom");
    warn.mockRestore();
  });
});
