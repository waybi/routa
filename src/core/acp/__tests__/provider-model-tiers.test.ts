import { describe, expect, it } from "vitest";

import { PROVIDER_MODEL_TIERS, getModelForProvider } from "../provider-registry";

// Characterization test for the claude-code-sdk tier -> model mapping.
// Kanban specialists and other agents resolve their model through these tiers
// (see AgentInstanceFactory.resolveModelFromTier). The values must stay current
// with model IDs the runtime/gateway actually accepts, otherwise sessions get
// dispatched on a stale model. Locking them here prevents silent regression.
describe("PROVIDER_MODEL_TIERS.claudeCodeSdk", () => {
  it("maps each tier to the current Claude model IDs", () => {
    expect(PROVIDER_MODEL_TIERS.claudeCodeSdk).toEqual({
      fast: "claude-haiku-4-5",
      balanced: "claude-sonnet-5",
      smart: "claude-opus-4-8",
    });
  });

  it("resolves the smart tier (used by SMART-tier specialists) to claude-opus-4-8", () => {
    expect(getModelForProvider("claudeCodeSdk", "smart")).toBe("claude-opus-4-8");
  });

  it("resolves fast and balanced tiers to current haiku/sonnet IDs", () => {
    expect(getModelForProvider("claudeCodeSdk", "fast")).toBe("claude-haiku-4-5");
    expect(getModelForProvider("claudeCodeSdk", "balanced")).toBe("claude-sonnet-5");
  });
});
