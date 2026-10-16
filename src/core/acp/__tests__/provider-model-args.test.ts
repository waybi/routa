import { describe, expect, it } from "vitest";

import { buildProviderModelArgs } from "../provider-model-args";

describe("buildProviderModelArgs", () => {
  it("uses Codex ACP config overrides for Codex models", () => {
    expect(buildProviderModelArgs("codex", "gpt-5.4")).toEqual([
      "-c",
      'model="gpt-5.4"',
    ]);
  });

  it("uses generic model flags for providers that support -m", () => {
    expect(buildProviderModelArgs("opencode", "anthropic/claude-sonnet-4-5")).toEqual([
      "-m",
      "anthropic/claude-sonnet-4-5",
    ]);
  });

  it("never builds CLI model args for dsh (model goes via DSH_ACP_MODEL)", () => {
    expect(buildProviderModelArgs("dsh", "claude-opus-4-6")).toBeUndefined();
    expect(buildProviderModelArgs("dsh", "anything")).toBeUndefined();
  });

  it("omits blank model overrides", () => {
    expect(buildProviderModelArgs("codex", "  ")).toBeUndefined();
  });
});
