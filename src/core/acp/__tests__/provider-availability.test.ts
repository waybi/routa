/**
 * @vitest-environment node
 *
 * Shared provider install check (card f1bc30c7 AC1 / contract C1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { which } = vi.hoisted(() => ({ which: vi.fn<(command: string) => Promise<string | null>>() }));

vi.mock("@/core/acp/utils", () => ({ which }));

// resolveCommand loads the platform bridge with a runtime require("@/core/platform"),
// which Node cannot resolve under vitest. Keep its env-override → bare-command order.
vi.mock("@/core/acp/acp-presets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/acp/acp-presets")>();
  return {
    ...actual,
    resolveCommand: vi.fn((preset: { command: string; envBinOverride?: string }) =>
      (preset.envBinOverride && process.env[preset.envBinOverride]) || preset.command),
  };
});

import { getPresetById } from "@/core/acp/acp-presets";
import {
  buildCommandUnavailableReason,
  resolvePresetAvailability,
  resolveProviderAvailability,
} from "@/core/acp/provider-availability";

const MISSING = "routa-missing-cmd-test";

describe("resolveProviderAvailability", () => {
  beforeEach(() => {
    which.mockReset();
    vi.stubEnv("CODEX_ACP_BIN", MISSING);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports a static preset as unavailable when which finds nothing", async () => {
    which.mockResolvedValue(null);

    await expect(resolveProviderAvailability("codex")).resolves.toEqual({
      status: "unavailable",
      command: MISSING,
      reason: `${MISSING} is not installed or not in PATH`,
    });
    expect(which).toHaveBeenCalledWith(MISSING);
  });

  it("reports a static preset as available (no reason) when which resolves a path", async () => {
    which.mockResolvedValue(`/usr/local/bin/${MISSING}`);

    const result = await resolveProviderAvailability("codex");

    expect(result).toEqual({ status: "available", command: MISSING });
    expect(result).not.toHaveProperty("reason");
  });

  it("returns null for ids that are not static presets (registry-only codex-acp)", async () => {
    which.mockResolvedValue(null);

    await expect(resolveProviderAvailability("codex-acp")).resolves.toBeNull();
    expect(which).not.toHaveBeenCalled();
  });

  it("normalizes the claude-code alias to the claude preset", async () => {
    vi.stubEnv("CLAUDE_CODE_BIN", MISSING);
    which.mockResolvedValue(null);

    await expect(resolveProviderAvailability("claude-code")).resolves.toEqual({
      status: "unavailable",
      command: MISSING,
      reason: buildCommandUnavailableReason(MISSING),
    });
  });

  it("treats a throwing probe as unavailable instead of throwing", async () => {
    which.mockRejectedValue(new Error("exec failed"));
    const preset = getPresetById("codex");
    expect(preset).toBeDefined();

    await expect(resolvePresetAvailability(preset!)).resolves.toMatchObject({
      status: "unavailable",
      command: MISSING,
    });
  });
});
