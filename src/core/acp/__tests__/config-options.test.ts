import { describe, expect, it } from "vitest";

import {
  extractConfigOptions,
  flattenOptionValues,
  parseModelValue,
  resolveModelValue,
  summarizeConfigOptions,
  type AcpConfigOption,
} from "../config-options";

const v = (provider: string, model: string) => JSON.stringify([provider, model]);

const options: AcpConfigOption[] = [
  {
    id: "model",
    type: "select",
    currentValue: v("local-7357", "claude-opus-5-5-pool"),
    options: [
      { group: "other", name: "Other", options: [{ value: v("other", "claude-opus-4-6"), name: "x" }] },
      { group: "local-7357", name: "Local", options: [
        { value: v("local-7357", "claude-opus-5-5-pool"), name: "a" },
        { value: v("local-7357", "claude-opus-4-6"), name: "b" },
      ] },
    ],
  },
  { id: "reasoning_effort", type: "select", currentValue: "", options: [{ value: "", name: "d" }, { value: "high", name: "h" }] },
];

describe("config-options helpers", () => {
  it("flattens grouped and flat select shapes", () => {
    expect(flattenOptionValues(options[0])).toHaveLength(3);
    expect(flattenOptionValues(options[1]).map((e) => e.value)).toEqual(["", "high"]);
  });

  it("parses DSH JSON model values and plain ids", () => {
    expect(parseModelValue(v("p", "m"))).toEqual({ provider: "p", model: "m" });
    expect(parseModelValue("gpt-5")).toEqual({ model: "gpt-5" });
    expect(parseModelValue("")).toBeUndefined();
  });

  it("maps a model id to the full option value, preferring the current provider", () => {
    expect(resolveModelValue(options, "claude-opus-4-6")).toBe(v("local-7357", "claude-opus-4-6"));
    expect(resolveModelValue(options, v("other", "claude-opus-4-6"))).toBe(v("other", "claude-opus-4-6"));
    expect(resolveModelValue(options, "missing-model")).toBeUndefined();
    expect(resolveModelValue(undefined, "claude-opus-4-6")).toBeUndefined();
  });

  it("summarizes the current model id and reasoning effort", () => {
    expect(summarizeConfigOptions(options)).toEqual({ model: "claude-opus-5-5-pool", reasoningEffort: "" });
    expect(summarizeConfigOptions([])).toEqual({});
  });

  it("extracts configOptions arrays from RPC payloads", () => {
    expect(extractConfigOptions({ configOptions: options })).toHaveLength(2);
    expect(extractConfigOptions({ sessionId: "x" })).toBeUndefined();
    expect(extractConfigOptions(null)).toBeUndefined();
  });
});
