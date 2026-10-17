import { describe, expect, it, vi } from "vitest";
import { processUpdate } from "../message-processor";
import type { ChatMessage } from "../../types";

describe("processUpdate", () => {
  it("surfaces acp_status errors as info messages", () => {
    const messages: ChatMessage[] = [];
    const noopRef = { current: {} as Record<string, string | null> };
    const noopSetter = vi.fn();

    processUpdate(
      "acp_status",
      {
        sessionUpdate: "acp_status",
        status: "error",
        error: "ACP Error [-32603]: Internal error: Permission denied",
      },
      messages,
      "session-1",
      null,
      () => "",
      noopRef,
      noopRef,
      noopSetter,
      noopSetter,
      noopSetter,
      {},
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "info",
      content: "ACP Error [-32603]: Internal error: Permission denied",
      rawData: {
        sessionUpdate: "acp_status",
        status: "error",
      },
    });
  });

  describe("config_option_update", () => {
    const configOptions = [
      { id: "model", currentValue: "[\"local-7357\",\"claude-opus-5-5\"]", options: [] },
      { id: "reasoning_effort", currentValue: "high", options: [{ value: "" }, { value: "high" }] },
    ];

    function run(update: Record<string, unknown>, configOptionUpdates?: Record<string, unknown>) {
      const messages: ChatMessage[] = [];
      const noopRef = { current: {} as Record<string, string | null> };
      const noopSetter = vi.fn();
      processUpdate(
        "config_option_update",
        update,
        messages,
        "session-1",
        null,
        () => "",
        noopRef,
        noopRef,
        noopSetter,
        noopSetter,
        noopSetter,
        {},
        configOptionUpdates as never,
      );
      return messages;
    }

    it("records the full configOptions replacement for the session", () => {
      const updates: Record<string, unknown> = {};
      const messages = run({ sessionUpdate: "config_option_update", configOptions }, updates);
      expect(updates).toEqual({ "session-1": configOptions });
      expect(messages).toHaveLength(0);
    });

    it("does not throw when the caller passes no configOptionUpdates collector", () => {
      expect(() => run({ sessionUpdate: "config_option_update", configOptions })).not.toThrow();
    });

    it("ignores payloads without a configOptions array", () => {
      const updates: Record<string, unknown> = {};
      run({ sessionUpdate: "config_option_update", configOptions: "nope" }, updates);
      expect(updates).toEqual({});
    });
  });
});
