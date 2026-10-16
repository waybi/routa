/**
 * @vitest-environment node
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPresetByIdWithRegistry, getProviderConfigOptions } = vi.hoisted(() => ({
  getPresetByIdWithRegistry: vi.fn(),
  getProviderConfigOptions: vi.fn(),
}));

vi.mock("@/core/acp/acp-presets", () => ({ getPresetByIdWithRegistry }));
vi.mock("@/core/acp/provider-config-probe", () => ({ getProviderConfigOptions }));

import { GET } from "../route";

const ctx = (providerId: string) => ({ params: Promise.resolve({ providerId }) });
const req = (query = "") => new NextRequest(`http://localhost/api/providers/dsh/config-options${query}`);

describe("/api/providers/[providerId]/config-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPresetByIdWithRegistry.mockResolvedValue({ id: "dsh" });
  });

  it("returns the provider options with flat model / reasoningEffort", async () => {
    getProviderConfigOptions.mockResolvedValue({
      providerId: "dsh",
      configOptions: [
        { id: "model", currentValue: JSON.stringify(["local-7357", "claude-opus-5-5-pool"]) },
        { id: "reasoning_effort", currentValue: "" },
      ],
      fetchedAt: "2026-10-16T00:00:00.000Z",
      source: "session",
    });

    const response = await GET(req(), ctx("dsh"));

    expect(response.status).toBe(200);
    expect(getProviderConfigOptions).toHaveBeenCalledWith("dsh", { refresh: false });
    await expect(response.json()).resolves.toMatchObject({
      providerId: "dsh",
      source: "session",
      model: "claude-opus-5-5-pool",
      reasoningEffort: "",
    });
  });

  it("passes refresh=1 through to force a probe", async () => {
    getProviderConfigOptions.mockResolvedValue({ providerId: "dsh", configOptions: [], fetchedAt: "x", source: "probe" });
    await GET(req("?refresh=1"), ctx("dsh"));
    expect(getProviderConfigOptions).toHaveBeenCalledWith("dsh", { refresh: true });
  });

  it("returns 404 for unknown providers without probing, 502 when the probe fails", async () => {
    getPresetByIdWithRegistry.mockResolvedValueOnce(undefined);
    expect((await GET(req(), ctx("nope"))).status).toBe(404);
    expect(getProviderConfigOptions).not.toHaveBeenCalled();

    getProviderConfigOptions.mockRejectedValue(new Error("timed out"));
    expect((await GET(req(), ctx("dsh"))).status).toBe(502);
  });
});
