import { beforeEach, describe, expect, it, vi } from "vitest";

const { store, updateSessionConfigInDb } = vi.hoisted(() => ({
  store: { getSession: vi.fn(), upsertSession: vi.fn() },
  updateSessionConfigInDb: vi.fn(async () => {}),
}));

vi.mock("@/core/acp/http-session-store", () => ({ getHttpSessionStore: () => store }));
vi.mock("@/core/acp/session-db-persister", () => ({ updateSessionConfigInDb }));

import { handleSessionConfigOptionsChanged, syncSessionConfigSummary } from "../session-config-sync";

describe("session config sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.getSession.mockReturnValue({ sessionId: "s1", model: "old", provider: "dsh" });
  });

  it("writes the reported model and effort to memory store and DB", async () => {
    await syncSessionConfigSummary("s1", { model: "claude-opus-4-6", reasoningEffort: "high" });

    expect(store.upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", model: "claude-opus-4-6", reasoningEffort: "high" }),
    );
    expect(updateSessionConfigInDb).toHaveBeenCalledWith("s1", { model: "claude-opus-4-6", reasoningEffort: "high" });
  });

  it("persists config_option_update payloads as flat model/effort", async () => {
    handleSessionConfigOptionsChanged("s1", [
      { id: "model", currentValue: JSON.stringify(["local-7357", "claude-opus-4-6"]) },
      { id: "reasoning_effort", currentValue: "" },
    ]);

    await vi.waitFor(() =>
      expect(updateSessionConfigInDb).toHaveBeenCalledWith("s1", { model: "claude-opus-4-6", reasoningEffort: "" }),
    );
  });

  it("skips writes when the agent reports neither option", async () => {
    await syncSessionConfigSummary("s1", {});
    expect(updateSessionConfigInDb).not.toHaveBeenCalled();
  });
});
