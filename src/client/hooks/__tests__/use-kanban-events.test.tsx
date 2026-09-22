import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INVALIDATE_COALESCE_MS, useKanbanEvents } from "../use-kanban-events";

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly url: string;
  readonly close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emit(payload: unknown, lastEventId = "") {
    this.onmessage?.({ data: JSON.stringify(payload), lastEventId } as MessageEvent);
  }

  fail() {
    this.onerror?.(new Event("error"));
  }

  static reset() {
    MockEventSource.instances = [];
  }
}

function HookHarness({
  workspaceId,
  onInvalidate,
  onSessionTail,
}: {
  workspaceId: string;
  onInvalidate: () => void;
  onSessionTail?: (event: { sessionId: string; tail: string }) => void;
}) {
  useKanbanEvents({ workspaceId, onInvalidate, onSessionTail });
  return null;
}

describe("useKanbanEvents", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockEventSource.reset();
  });

  it("ignores the initial connected event but invalidates on actual kanban changes", () => {
    vi.useFakeTimers();
    const onInvalidate = vi.fn();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} />);

    const source = MockEventSource.instances[0];
    expect(source?.url).toContain("/api/kanban/events?workspaceId=workspace-1");

    source.emit({ type: "connected" });
    vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
    expect(onInvalidate).not.toHaveBeenCalled();

    source.emit({ type: "kanban:changed" });
    vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it("collapses a replay burst of kanban:changed into one invalidate", () => {
    // On reconnect the server may replay dozens of stored frames in a few
    // ms. Each used to cost a full board refetch.
    vi.useFakeTimers();
    const onInvalidate = vi.fn();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} />);
    const source = MockEventSource.instances[0];
    source.emit({ type: "connected" });

    for (let index = 0; index < 50; index += 1) {
      source.emit({ type: "kanban:changed" });
    }
    expect(onInvalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it("asks for the last hour on a fresh load and resumes from lastEventId on manual reconnect", () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<HookHarness workspaceId="workspace-1" onInvalidate={vi.fn()} />);
    const first = MockEventSource.instances[0];
    const firstUrl = new URL(first.url, "http://localhost");
    expect(firstUrl.searchParams.get("since")).toBe(String(now - 60 * 60 * 1000));
    expect(firstUrl.searchParams.get("lastEventId")).toBeNull();

    first.emit({ type: "connected" });
    first.emit({ type: "kanban:changed" }, "evt-abc");
    first.fail();
    vi.advanceTimersByTime(3000);

    const second = MockEventSource.instances[1];
    expect(second).toBeTruthy();
    const secondUrl = new URL(second.url, "http://localhost");
    expect(secondUrl.searchParams.get("lastEventId")).toBe("evt-abc");
    expect(secondUrl.searchParams.get("since")).toBeNull();
  });

  it("throttles rapid fitness change events", () => {
    vi.useFakeTimers();
    const onInvalidate = vi.fn();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} />);

    const source = MockEventSource.instances[0];
    source.emit({ type: "connected" });
    source.emit({ type: "fitness:changed" });
    source.emit({ type: "fitness:changed" });

    expect(onInvalidate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(749);
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(onInvalidate).toHaveBeenCalledTimes(2);
  });

  it("invalidates when the SSE connection reconnects after the first connect", () => {
    vi.useFakeTimers();
    const onInvalidate = vi.fn();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} />);

    const firstSource = MockEventSource.instances[0];
    firstSource.emit({ type: "connected" });
    firstSource.fail();

    vi.advanceTimersByTime(3_000);

    const secondSource = MockEventSource.instances[1];
    expect(secondSource).toBeTruthy();

    secondSource.emit({ type: "connected" });
    vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  it("routes session-tail frames to the caption handler without invalidating", () => {
    // A caption change is not a card-data change, so it must not trigger the
    // board refetch — that was the whole point of pushing it separately.
    const onInvalidate = vi.fn();
    const onSessionTail = vi.fn();
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);

    render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} onSessionTail={onSessionTail} />);
    const source = MockEventSource.instances[0];
    source.emit({ type: "connected" });

    source.emit({
      type: "kanban:session-tail",
      workspaceId: "workspace-1",
      sessionId: "session-9",
      tail: "Running tests…",
      updateType: "agent_message_chunk",
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(onSessionTail).toHaveBeenCalledTimes(1);
    expect(onSessionTail.mock.calls[0][0]).toMatchObject({ sessionId: "session-9", tail: "Running tests…" });
    expect(onInvalidate).not.toHaveBeenCalled();
  });
});
