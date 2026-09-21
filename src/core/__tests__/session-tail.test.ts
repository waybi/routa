import { describe, expect, it } from "vitest";
import {
  SESSION_TAIL_MAX_CHARS,
  extractSessionTail,
  truncateSessionTail,
} from "../session-tail";

function entry(sessionUpdate: string, content: unknown) {
  return { sessionId: "session-1", update: { sessionUpdate, content } };
}

describe("extractSessionTail", () => {
  it("returns the newest agent message", () => {
    const tail = extractSessionTail([
      entry("agent_message", { text: "first" }),
      entry("agent_message", { text: "second" }),
    ]);

    expect(tail).toEqual({ text: "second", updateType: "agent_message" });
  });

  it("skips tool calls and status updates", () => {
    const tail = extractSessionTail([
      entry("agent_message", { text: "the real last line" }),
      entry("tool_call", { title: "bash" }),
      entry("tool_call_update", { status: "completed" }),
      entry("usage_update", { used: 1 }),
    ]);

    expect(tail?.text).toBe("the real last line");
  });

  it("collapses whitespace so the caption stays one line", () => {
    const tail = extractSessionTail([entry("agent_message", { text: "  multi\n\nline   text " })]);
    expect(tail?.text).toBe("multi line text");
  });

  it("reads text out of a content array", () => {
    const tail = extractSessionTail([
      entry("agent_message_chunk", { content: [{ text: "chunk one " }, { text: "chunk two" }] }),
    ]);

    expect(tail?.text).toBe("chunk one chunk two");
    expect(tail?.updateType).toBe("agent_message_chunk");
  });

  it("accepts a plain string content", () => {
    expect(extractSessionTail([entry("user_message", "hello")])?.text).toBe("hello");
  });

  it("truncates a long message to the caption budget", () => {
    const tail = extractSessionTail([entry("agent_message", { text: "x".repeat(1000) })]);

    expect(tail?.text).toHaveLength(SESSION_TAIL_MAX_CHARS);
    expect(tail?.text.endsWith("…")).toBe(true);
  });

  it("returns null for empty or malformed history", () => {
    expect(extractSessionTail([])).toBeNull();
    expect(extractSessionTail(null)).toBeNull();
    expect(extractSessionTail("not an array")).toBeNull();
    expect(extractSessionTail([null, 42, { noUpdate: true }])).toBeNull();
  });

  it("returns null when only non-message updates exist", () => {
    expect(extractSessionTail([entry("tool_call", { title: "bash" })])).toBeNull();
  });

  it("skips message entries whose content has no text", () => {
    const tail = extractSessionTail([
      entry("agent_message", { text: "has text" }),
      entry("agent_message", { content: [] }),
    ]);

    expect(tail?.text).toBe("has text");
  });
});

describe("truncateSessionTail", () => {
  it("leaves short text untouched", () => {
    expect(truncateSessionTail("short")).toBe("short");
  });

  it("clamps long text and marks the cut", () => {
    const result = truncateSessionTail("y".repeat(500));
    expect(result).toHaveLength(SESSION_TAIL_MAX_CHARS);
    expect(result.endsWith("…")).toBe(true);
  });
});
