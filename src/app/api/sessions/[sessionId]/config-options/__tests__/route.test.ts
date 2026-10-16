/**
 * @vitest-environment node
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProcessNotFoundError } from "@/core/acp/config-options";

const { manager, syncSessionConfigSummary } = vi.hoisted(() => ({
  manager: {
    getConfigOptions: vi.fn(),
    setConfigOption: vi.fn(),
  },
  syncSessionConfigSummary: vi.fn(async () => {}),
}));

vi.mock("@/core/acp/processer", () => ({
  getAcpProcessManager: () => manager,
}));

vi.mock("@/core/acp/session-config-sync", () => ({
  syncSessionConfigSummary,
}));

import { GET, POST } from "../route";

const mv = (model: string) => JSON.stringify(["local-7357", model]);
const options = (model: string, effort: string) => [
  {
    id: "model",
    currentValue: mv(model),
    options: [{ group: "local-7357", options: [{ value: mv("claude-opus-4-6") }, { value: mv("claude-opus-5-5-pool") }] }],
  },
  { id: "reasoning_effort", currentValue: effort, options: [{ value: "" }, { value: "high" }] },
];
const ctx = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) });
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/sessions/s-1/config-options", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("/api/sessions/[sessionId]/config-options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns configOptions plus flat model and reasoningEffort", async () => {
    manager.getConfigOptions.mockReturnValue(options("claude-opus-5-5-pool", "high"));

    const response = await GET(new NextRequest("http://localhost/api/sessions/s-1/config-options"), ctx("s-1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sessionId: "s-1",
      configOptions: options("claude-opus-5-5-pool", "high"),
      model: "claude-opus-5-5-pool",
      reasoningEffort: "high",
    });
    expect(manager.getConfigOptions).toHaveBeenCalledWith("s-1");
  });

  it("GET returns 404 when the session process is gone", async () => {
    manager.getConfigOptions.mockImplementation((sessionId: string) => {
      throw new SessionProcessNotFoundError(sessionId);
    });

    const response = await GET(new NextRequest("http://localhost/api/sessions/s-9/config-options"), ctx("s-9"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: "会话进程不在，需先恢复会话",
      code: "SESSION_PROCESS_NOT_FOUND",
      sessionId: "s-9",
    });
  });

  it("POST forwards set_config_option, persists, and returns the new state", async () => {
    manager.setConfigOption.mockResolvedValue(options("claude-opus-4-6", "high"));

    const response = await POST(post({ configId: "reasoning_effort", value: "high" }), ctx("s-1"));

    expect(response.status).toBe(200);
    expect(manager.setConfigOption).toHaveBeenCalledWith("s-1", "reasoning_effort", "high");
    await expect(response.json()).resolves.toMatchObject({
      sessionId: "s-1",
      model: "claude-opus-4-6",
      reasoningEffort: "high",
    });
    expect(syncSessionConfigSummary).toHaveBeenCalledWith(
      "s-1",
      expect.objectContaining({ model: "claude-opus-4-6", reasoningEffort: "high" }),
    );
  });

  it("POST returns 404 when the session process is gone", async () => {
    manager.setConfigOption.mockRejectedValue(new SessionProcessNotFoundError("s-9"));

    const response = await POST(post({ configId: "model", value: mv("claude-opus-4-6") }), ctx("s-9"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "SESSION_PROCESS_NOT_FOUND" });
    expect(syncSessionConfigSummary).not.toHaveBeenCalled();
  });

  it("POST rejects a body without configId or with a non-string value", async () => {
    expect((await POST(post({ value: "high" }), ctx("s-1"))).status).toBe(400);
    expect((await POST(post({ configId: "reasoning_effort", value: 3 }), ctx("s-1"))).status).toBe(400);
    expect(manager.setConfigOption).not.toHaveBeenCalled();
  });
});
