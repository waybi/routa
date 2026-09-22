import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanEventBroadcaster } from "../kanban-event-broadcaster";
import {
  SESSION_TAIL_DEBOUNCE_MS,
  SESSION_TAIL_MAX_WAIT_MS,
  SessionTailPublisher,
} from "../session-tail-publisher";

function chunk(text: string) {
  return { sessionId: "s1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } };
}

function message(text: string) {
  return { sessionId: "s1", update: { sessionUpdate: "agent_message", content: { type: "text", text } } };
}

function toolCall() {
  return { sessionId: "s1", update: { sessionUpdate: "tool_call", title: "bash" } };
}

describe("SessionTailPublisher", () => {
  let broadcaster: KanbanEventBroadcaster;
  let publish: ReturnType<typeof vi.fn<KanbanEventBroadcaster["notifySessionTail"]>>;
  let publisher: SessionTailPublisher;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcaster = new KanbanEventBroadcaster();
    publish = vi.spyOn(broadcaster, "notifySessionTail") as unknown as typeof publish;
    publisher = new SessionTailPublisher(broadcaster);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes a paragraph-at-a-time message after the trailing window", () => {
    // dsh delivers whole paragraphs with multi-second gaps; the only cost the
    // debounce imposes on it is one trailing window of latency.
    publisher.observe("s1", "ws", chunk("卡片已移动到 review。"));
    expect(publish).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SESSION_TAIL_DEBOUNCE_MS);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      workspaceId: "ws",
      sessionId: "s1",
      tail: "卡片已移动到 review。",
      updateType: "agent_message_chunk",
    });
  });

  it("coalesces a token stream into one publish", () => {
    // Claude SDK emits text_delta per token; the board must not redraw per
    // token.
    for (const token of ["Hel", "lo", " wor", "ld", "."]) {
      publisher.observe("s1", "ws", chunk(token));
      vi.advanceTimersByTime(50); // well under the debounce window
    }
    expect(publish).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SESSION_TAIL_DEBOUNCE_MS);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toMatchObject({ tail: "Hello world." });
  });

  it("still refreshes once per max-wait while a stream never pauses", () => {
    // A provider that streams continuously for seconds must not leave the
    // caption dark until it finishes.
    const totalMs = SESSION_TAIL_MAX_WAIT_MS * 2 + 100;
    for (let elapsed = 0; elapsed < totalMs; elapsed += 100) {
      publisher.observe("s1", "ws", chunk("x"));
      vi.advanceTimersByTime(100);
    }

    // Two max-wait flushes should have fired during ~2.1 s of streaming.
    expect(publish.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Each flush grows the buffer, so the published text is monotonically longer.
    const lengths = publish.mock.calls.map((call) => call[0].tail.length);
    for (let index = 1; index < lengths.length; index += 1) {
      expect(lengths[index]).toBeGreaterThan(lengths[index - 1]);
    }
  });

  it("replaces the buffer when a whole message arrives after chunks", () => {
    publisher.observe("s1", "ws", chunk("partial"));
    publisher.observe("s1", "ws", message("final answer"));

    vi.advanceTimersByTime(SESSION_TAIL_DEBOUNCE_MS);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toMatchObject({ tail: "final answer", updateType: "agent_message" });
  });

  it("ignores tool-call noise and does not reset the window on it", () => {
    publisher.observe("s1", "ws", chunk("hello"));
    vi.advanceTimersByTime(SESSION_TAIL_DEBOUNCE_MS - 50);
    // Tool call lands just before the window closes; it must not extend it.
    publisher.observe("s1", "ws", toolCall());
    vi.advanceTimersByTime(50);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toMatchObject({ tail: "hello" });
  });

  it("suppresses republishing an identical tail", () => {
    publisher.observe("s1", "ws", message("same line"));
    vi.advanceTimersByTime(SESSION_TAIL_DEBOUNCE_MS);
    publisher.observe("s1", "ws", message("same line"));
    vi.advanceTimersByTime(SESSION_TAIL_DEBOUNCE_MS);

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("keeps sessions independent", () => {
    publisher.observe("s1", "ws", chunk("from one"));
    publisher.observe("s2", "ws", chunk("from two"));
    vi.advanceTimersByTime(SESSION_TAIL_DEBOUNCE_MS);

    expect(publish).toHaveBeenCalledTimes(2);
    const sessions = publish.mock.calls.map((call) => call[0].sessionId).sort();
    expect(sessions).toEqual(["s1", "s2"]);
  });

  it("drops pending state on forget", () => {
    publisher.observe("s1", "ws", chunk("about to be discarded"));
    publisher.forget("s1");
    vi.advanceTimersByTime(SESSION_TAIL_MAX_WAIT_MS + SESSION_TAIL_DEBOUNCE_MS);

    expect(publish).not.toHaveBeenCalled();
    expect(publisher.peek("s1")).toBeNull();
  });

  it("applies the same 240-char cap as the /tail endpoint", () => {
    publisher.observe("s1", "ws", message("y".repeat(1000)));
    vi.advanceTimersByTime(SESSION_TAIL_DEBOUNCE_MS);

    const tail = publish.mock.calls[0][0].tail;
    expect(tail).toHaveLength(240);
    expect(tail.endsWith("…")).toBe(true);
  });
});
