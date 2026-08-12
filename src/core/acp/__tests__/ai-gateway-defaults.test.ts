import { describe, expect, it } from "vitest";
import {
  resolveClaudeGatewayBaseUrl,
  resolveClaudeGatewayEffort,
  resolveClaudeGatewayModel,
  DEFAULT_AI_GATEWAY_BASE_URL,
  DEFAULT_AI_GATEWAY_MODEL,
  DEFAULT_AI_GATEWAY_EFFORT,
} from "../claude-code-process";

describe("AI Gateway defaults", () => {
  it("defaults model/effort/baseUrl for Claude sessions", () => {
    // Even if ambient ANTHROPIC_MODEL=grok-4.5, Routa should not inherit it for model.
    expect(resolveClaudeGatewayModel(undefined)).toBe(
      process.env.ROUTA_DEFAULT_MODEL?.trim() || DEFAULT_AI_GATEWAY_MODEL,
    );
    expect(resolveClaudeGatewayModel("claude-opus-5")).toBe("claude-opus-5");
    expect(resolveClaudeGatewayModel("claude-opus-4.8")).toBe("claude-opus-4-8");
    expect(resolveClaudeGatewayEffort(undefined)).toBe(
      process.env.ROUTA_CLAUDE_EFFORT?.trim() || process.env.CLAUDE_CODE_EFFORT?.trim() || DEFAULT_AI_GATEWAY_EFFORT,
    );
    expect(resolveClaudeGatewayEffort("max")).toBe("max");
    expect(resolveClaudeGatewayBaseUrl(undefined)).toBe(
      process.env.ANTHROPIC_BASE_URL?.trim() || DEFAULT_AI_GATEWAY_BASE_URL,
    );
    expect(resolveClaudeGatewayBaseUrl("http://127.0.0.1:7357")).toBe("http://127.0.0.1:7357");

    expect(DEFAULT_AI_GATEWAY_BASE_URL).toBe("http://127.0.0.1:7357");
    expect(DEFAULT_AI_GATEWAY_MODEL).toBe("claude-opus-5");
    expect(DEFAULT_AI_GATEWAY_EFFORT).toBe("max");
  });
});
