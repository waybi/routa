import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KANBAN_SSE_PING_FRAME } from "@/app/api/kanban/events/keep-alive";
import { useKanbanOverviewData } from "@/app/workspace/[workspaceId]/kanban/use-kanban-overview-data";
import { useKanbanEvents } from "../use-kanban-events";
import { reconnectDelayMs } from "../use-resilient-event-source";

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readyState = 0;
  readonly url: string;
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  readonly close = vi.fn(() => {
    this.readyState = 2;
  });
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  /** Dispatch a named event the way a browser does for `event: <name>`. */
  dispatchNamed(name: string) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ type: name, data: "{}" } as unknown as Event);
    }
  }
  emit(payload: unknown, lastEventId = "") {
    this.onmessage?.({ data: JSON.stringify(payload), lastEventId } as MessageEvent);
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
}

/** The event name the Next server's ping frame carries (`event: <name>`). */
const PING_EVENT_NAME = /^event: (\S+)\n/.exec(KANBAN_SSE_PING_FRAME)![1];

const onInvalidate = vi.fn();

function BoardHarness() {
  useKanbanEvents({ workspaceId: "workspace-1", onInvalidate });
  return null;
}

function OverviewHarness() {
  useKanbanOverviewData([{ id: "w1", title: "One" }]);
  return null;
}

const HOOKS = [
  ["board page (useKanbanEvents)", BoardHarness],
  ["overview (useKanbanOverviewData)", OverviewHarness],
] as const;

function fetchCount(): number {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
}

beforeEach(() => {
  MockEventSource.instances = [];
  onInvalidate.mockReset();
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reconnectDelayMs", () => {
  it("matches the requirement judge min(3000 * 2^n, 60000) for n = 0..10000 (F3)", () => {
    // Judge written from the requirement; for large n the answer is the cap.
    const judge = (n: number) => (n >= 5 ? 60_000 : 3000 * 2 ** n);
    for (let n = 0; n <= 10_000; n += 1) {
      const delay = reconnectDelayMs(n);
      expect(Number.isInteger(delay) && delay > 0, `n=${n}`).toBe(true);
      expect(delay, `n=${n}`).toBe(judge(n));
    }
  });
});

describe.each(HOOKS)("shared reconnect via %s", (_label, Harness) => {
  it("the Next ping frame's named event restarts the watchdog (F4)", () => {
    expect(PING_EVENT_NAME).toBe("ping");
    render(<Harness />);
    const source = MockEventSource.instances[0];
    act(() => source.open());
    act(() => vi.advanceTimersByTime(59_000));
    act(() => source.dispatchNamed(PING_EVENT_NAME));
    act(() => vi.advanceTimersByTime(59_000));
    expect(MockEventSource.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("reconnects at once when a tab that lost its connection comes back (F4)", () => {
    render(<Harness />);
    const source = MockEventSource.instances[0];
    act(() => source.fail());
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    delete (document as unknown as Record<string, unknown>).visibilityState;
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("ignores late callbacks from a replaced connection (C8)", () => {
    // Run the same script twice: once with stale callbacks from the old
    // connection, once without. Everything observable must match.
    const run = (withStale: boolean) => {
      MockEventSource.instances = [];
      const view = render(<Harness />);
      const old = MockEventSource.instances[0];
      act(() => old.open());
      act(() => old.emit({ type: "connected" }));
      act(() => old.fail());
      act(() => vi.advanceTimersByTime(3000));
      const current = MockEventSource.instances[1];
      act(() => current.open());
      act(() => current.emit({ type: "connected" }));
      act(() => vi.advanceTimersByTime(10_000));
      const fetchesBefore = fetchCount();
      const invalidatesBefore = onInvalidate.mock.calls.length;
      if (withStale) {
        act(() => {
          old.fail();
          old.open();
          old.dispatchNamed("ping");
          old.emit({ type: "connected" });
          old.emit({ type: "kanban:changed", workspaceId: "w1" });
        });
      }
      const sample: number[] = [];
      // Watchdog of the current connection: 60 s after its open, not later.
      act(() => vi.advanceTimersByTime(60_000 - 10_000 - 1));
      sample.push(MockEventSource.instances.length);
      act(() => vi.advanceTimersByTime(1));
      sample.push(MockEventSource.instances.length);
      sample.push(fetchCount() - fetchesBefore);
      sample.push(onInvalidate.mock.calls.length - invalidatesBefore);
      sample.push(current.close.mock.calls.length);
      view.unmount();
      sample.push(vi.getTimerCount());
      return sample;
    };
    const withoutStale = run(false);
    expect(withoutStale.slice(0, 2)).toEqual([2, 3]);
    expect(run(true)).toEqual(withoutStale);
  });
});
