import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachMock, detachMock, replayMock } = vi.hoisted(() => ({
  attachMock: vi.fn(() => "conn-1"),
  detachMock: vi.fn(),
  replayMock: vi.fn(async () => 0),
}));

vi.mock("@/core/kanban/kanban-event-broadcaster", () => ({
  getKanbanEventBroadcaster: () => ({
    attach: attachMock,
    detach: detachMock,
    replay: replayMock,
  }),
}));

import { GET } from "../route";
import { resolveReplayCursor } from "../replay-cursor";

function makeRequest(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), { headers });
}

async function drainStart(response: Response): Promise<void> {
  // `start()` runs synchronously on construction; awaiting the first read
  // lets any awaited replay inside it settle.
  const reader = response.body!.getReader();
  await Promise.resolve();
  reader.releaseLock();
}

describe("resolveReplayCursor", () => {
  it("prefers Last-Event-ID over ?since", () => {
    const request = makeRequest("/api/kanban/events?workspaceId=ws&since=1000", { "last-event-id": "evt-9" });
    expect(resolveReplayCursor(request)).toEqual({ afterId: "evt-9" });
  });

  it("accepts ?lastEventId for manual reconnects", () => {
    expect(resolveReplayCursor(makeRequest("/api/kanban/events?workspaceId=ws&lastEventId=evt-7&since=1000")))
      .toEqual({ afterId: "evt-7" });
  });

  it("falls back to ?since when no header", () => {
    expect(resolveReplayCursor(makeRequest("/api/kanban/events?workspaceId=ws&since=1700000000000")))
      .toEqual({ since: 1700000000000 });
  });

  it("ignores a malformed or non-positive since", () => {
    expect(resolveReplayCursor(makeRequest("/api/kanban/events?since=abc"))).toBeNull();
    expect(resolveReplayCursor(makeRequest("/api/kanban/events?since=0"))).toBeNull();
    expect(resolveReplayCursor(makeRequest("/api/kanban/events?since=-5"))).toBeNull();
  });

  it("returns null with neither", () => {
    expect(resolveReplayCursor(makeRequest("/api/kanban/events?workspaceId=ws"))).toBeNull();
  });
});

describe("GET /api/kanban/events", () => {
  beforeEach(() => {
    attachMock.mockClear();
    detachMock.mockClear();
    replayMock.mockClear();
  });

  it("attaches and does not replay on a plain connect", async () => {
    const response = await GET(makeRequest("/api/kanban/events?workspaceId=ws-1"));
    await drainStart(response);

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(attachMock).toHaveBeenCalledWith("ws-1", expect.anything());
    expect(replayMock).not.toHaveBeenCalled();
  });

  it("replays after Last-Event-ID, attaching first so live frames are not lost", async () => {
    const order: string[] = [];
    attachMock.mockImplementationOnce(() => { order.push("attach"); return "conn-1"; });
    replayMock.mockImplementationOnce(async () => { order.push("replay"); return 3; });

    const response = await GET(makeRequest("/api/kanban/events?workspaceId=ws-1", { "last-event-id": "evt-42" }));
    await drainStart(response);

    expect(order).toEqual(["attach", "replay"]);
    expect(replayMock).toHaveBeenCalledWith(expect.anything(), "ws-1", { afterId: "evt-42", limit: 500 });
  });

  it("replays with since on a fresh load", async () => {
    const response = await GET(makeRequest("/api/kanban/events?workspaceId=ws-1&since=1700000000000"));
    await drainStart(response);

    expect(replayMock).toHaveBeenCalledWith(expect.anything(), "ws-1", { since: 1700000000000, limit: 500 });
  });

  it("never replays for the wildcard workspace", async () => {
    // "*" subscribes to everything; replaying every workspace's history into
    // one connection is not a thing anyone asked for.
    const response = await GET(makeRequest("/api/kanban/events", { "last-event-id": "evt-1" }));
    await drainStart(response);

    expect(attachMock).toHaveBeenCalledWith("*", expect.anything());
    expect(replayMock).not.toHaveBeenCalled();
  });

  it("keeps the stream open when replay throws", async () => {
    replayMock.mockRejectedValueOnce(new Error("db gone"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(makeRequest("/api/kanban/events?workspaceId=ws-1", { "last-event-id": "evt-1" }));
    await drainStart(response);

    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(detachMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe("GET /api/kanban/events keep-alive", () => {
  // Literal fallback so a missing export fails on an assertion, not an import.
  const PING_MS = 25_000;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let enqueueSpy: ReturnType<typeof vi.fn> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    attachMock.mockReset();
    attachMock.mockImplementation(((_ws: string, ctrl: ReadableStreamDefaultController<Uint8Array>) => {
      controller = ctrl;
      const original = ctrl.enqueue.bind(ctrl);
      enqueueSpy = vi.fn((chunk?: Uint8Array) => original(chunk));
      ctrl.enqueue = enqueueSpy as typeof ctrl.enqueue;
      return "conn-1";
    }) as unknown as () => string);
    detachMock.mockClear();
    replayMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    attachMock.mockReset();
    attachMock.mockImplementation(() => "conn-1");
    controller = null;
    enqueueSpy = null;
  });

  function pingCalls(): number {
    return (enqueueSpy?.mock.calls ?? []).filter(([chunk]) =>
      new TextDecoder().decode(chunk as Uint8Array).includes("event: ping")).length;
  }

  async function open(url = "/api/kanban/events?workspaceId=ws-1", init: RequestInit = {}) {
    const timersBefore = vi.getTimerCount();
    const response = await GET(new NextRequest(new URL(url, "http://localhost:3000"), init as never));
    const reader = response.body!.getReader();
    await vi.advanceTimersByTimeAsync(0);
    return { reader, timersBefore };
  }

  it("writes a named ping frame with a data line and no id every 25s", async () => {
    const { reader } = await open();
    await vi.advanceTimersByTimeAsync(PING_MS - 1);
    expect(pingCalls()).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(pingCalls()).toBe(1);
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain("event: ping\n");
    expect(text).toMatch(/^data: .*$/m);
    expect(text).not.toMatch(/^id:/m);
    expect(text.endsWith("\n\n")).toBe(true);

    await vi.advanceTimersByTimeAsync(PING_MS);
    expect(pingCalls()).toBe(2);
    await reader.cancel();
  });

  it("never stores, broadcasts or replays a ping", async () => {
    const { reader } = await open("/api/kanban/events?workspaceId=ws-1", { headers: { "last-event-id": "evt-5" } });
    const replaysAfterConnect = replayMock.mock.calls.length;
    expect(replaysAfterConnect).toBe(1);

    await vi.advanceTimersByTimeAsync(PING_MS * 3);
    expect(pingCalls()).toBe(3);
    expect(replayMock).toHaveBeenCalledTimes(replaysAfterConnect);
    expect(attachMock).toHaveBeenCalledTimes(1);
    expect(detachMock).not.toHaveBeenCalled();
    await reader.cancel();
  });

  it.each([
    ["reader.cancel()", async (ctx: { reader: ReadableStreamDefaultReader<Uint8Array>; abort: AbortController }) => {
      await ctx.reader.cancel();
    }],
    ["enqueue on a closed stream", async () => {
      controller!.close();
    }],
    ["request abort", async (ctx: { reader: ReadableStreamDefaultReader<Uint8Array>; abort: AbortController }) => {
      ctx.abort.abort();
    }],
  ])("stops pinging and detaches once after %s", async (_label, kill) => {
    const abort = new AbortController();
    const { reader, timersBefore } = await open(undefined, { signal: abort.signal });
    expect(vi.getTimerCount()).toBe(timersBefore + 1);

    await kill({ reader, abort });
    // The closed-stream case only notices on the next tick.
    await vi.advanceTimersByTimeAsync(PING_MS);
    const pingsAfterDeath = pingCalls();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(pingCalls()).toBe(pingsAfterDeath);
    expect(vi.getTimerCount()).toBe(timersBefore);
    expect(detachMock).toHaveBeenCalledTimes(1);
  });

  it("detaches only once when abort and cancel both fire", async () => {
    const abort = new AbortController();
    const { reader, timersBefore } = await open(undefined, { signal: abort.signal });
    abort.abort();
    await reader.cancel();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(detachMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(timersBefore);
    expect(pingCalls()).toBe(0);
  });
});
