import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INVALIDATE_COALESCE_MS,
  TASK_INVALIDATE_DEBOUNCE_MS,
  TASK_INVALIDATE_MAX_WAIT_MS,
  useKanbanEvents,
} from "../use-kanban-events";

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

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  /** A named `event: ping` frame: goes to listeners, never to onmessage. */
  ping() {
    for (const listener of this.listeners.get("ping") ?? []) {
      listener({ type: "ping", data: "{}" } as unknown as Event);
    }
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
  onTasksInvalidate,
  onSessionTail,
  onTaskLifecycle,
}: {
  workspaceId: string;
  onInvalidate: () => void;
  onTasksInvalidate?: (taskIds: string[]) => void;
  onSessionTail?: (event: { sessionId: string; tail: string }) => void;
  onTaskLifecycle?: () => void;
}) {
  useKanbanEvents({ workspaceId, onInvalidate, onTasksInvalidate, onSessionTail, onTaskLifecycle });
  return null;
}

let visibilityOverride: DocumentVisibilityState | null = null;
const originalVisibility = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");

/** jsdom's visibilityState is a read-only getter; override it per test. */
function setVisibility(state: DocumentVisibilityState | null) {
  visibilityOverride = state;
  if (state === null) {
    delete (document as unknown as Record<string, unknown>).visibilityState;
    return;
  }
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibilityOverride ?? originalVisibility?.get?.call(document),
  });
}

function goVisible() {
  setVisibility("visible");
  document.dispatchEvent(new Event("visibilitychange"));
}

function mount(onInvalidate = vi.fn()) {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  const view = render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} />);
  return { ...view, onInvalidate };
}

function taskChanged(resourceId = "task-1") {
  return { type: "kanban:changed", entity: "task", action: "updated", resourceId, source: "agent" };
}

describe("useKanbanEvents", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockEventSource.reset();
    setVisibility(null);
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

  describe("task-only refresh", () => {
    function setup() {
      vi.useFakeTimers();
      const onInvalidate = vi.fn();
      const onTasksInvalidate = vi.fn();
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} onTasksInvalidate={onTasksInvalidate} onTaskLifecycle={vi.fn()} />);
      const source = MockEventSource.instances[0];
      source.emit({ type: "connected" });
      return { onInvalidate, onTasksInvalidate, source };
    }

    it("routes entity=task frames to onTasksInvalidate only", () => {
      const { onInvalidate, onTasksInvalidate, source } = setup();
      source.emit(taskChanged("task-7"));
      vi.advanceTimersByTime(TASK_INVALIDATE_MAX_WAIT_MS * 2);
      expect(onTasksInvalidate).toHaveBeenCalledTimes(1);
      expect(onTasksInvalidate).toHaveBeenCalledWith(["task-7"]);
      expect(onInvalidate).not.toHaveBeenCalled();
    });

    it.each(["board", "column", "queue"])("keeps the full refresh for entity=%s", (entity) => {
      const { onInvalidate, onTasksInvalidate, source } = setup();
      source.emit({ type: "kanban:changed", entity, action: "updated" });
      vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
      expect(onInvalidate).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(TASK_INVALIDATE_MAX_WAIT_MS * 2);
      expect(onTasksInvalidate).not.toHaveBeenCalled();
    });

    it("keeps the full refresh for task-lifecycle, reconnect, and fitness frames", () => {
      const { onInvalidate, onTasksInvalidate, source } = setup();

      source.emit({ type: "kanban:task-lifecycle", workspaceId: "workspace-1", taskId: "task-1", taskTitle: "T", phase: "completed" });
      vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
      expect(onInvalidate).toHaveBeenCalledTimes(1);

      source.emit({ type: "fitness:changed" });
      expect(onInvalidate).toHaveBeenCalledTimes(2);

      source.fail();
      vi.advanceTimersByTime(3_000);
      MockEventSource.instances[1].emit({ type: "connected" });
      vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
      expect(onInvalidate).toHaveBeenCalledTimes(3);

      vi.advanceTimersByTime(TASK_INVALIDATE_MAX_WAIT_MS * 2);
      expect(onTasksInvalidate).not.toHaveBeenCalled();
    });

    it("refreshes a single task frame after exactly 400ms", () => {
      const { onTasksInvalidate, source } = setup();
      source.emit(taskChanged());
      vi.advanceTimersByTime(TASK_INVALIDATE_DEBOUNCE_MS - 1);
      expect(onTasksInvalidate).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onTasksInvalidate).toHaveBeenCalledTimes(1);
    });

    it("never waits more than 1500ms while frames keep arriving every 100ms", () => {
      const { onTasksInvalidate, source } = setup();
      const fireTimes: number[] = [];
      onTasksInvalidate.mockImplementation(() => fireTimes.push(Date.now()));
      const start = Date.now();

      for (let elapsed = 0; elapsed < 3_000; elapsed += 100) {
        source.emit(taskChanged(`task-${elapsed}`));
        vi.advanceTimersByTime(100);
      }

      expect(fireTimes.length).toBeGreaterThanOrEqual(2);
      expect(fireTimes[0] - start).toBeLessThanOrEqual(TASK_INVALIDATE_MAX_WAIT_MS);
      for (let index = 1; index < fireTimes.length; index += 1) {
        expect(fireTimes[index] - fireTimes[index - 1]).toBeLessThanOrEqual(TASK_INVALIDATE_MAX_WAIT_MS);
      }
      // Ids are coalesced per refresh.
      expect((onTasksInvalidate.mock.calls[0][0] as string[]).length).toBeGreaterThan(1);
    });

    it("restarts the debounce window after a refresh", () => {
      const { onTasksInvalidate, source } = setup();
      for (let elapsed = 0; elapsed < TASK_INVALIDATE_MAX_WAIT_MS; elapsed += 100) {
        source.emit(taskChanged());
        vi.advanceTimersByTime(100);
      }
      expect(onTasksInvalidate).toHaveBeenCalledTimes(1);

      // Quiet for a while, then a fresh frame waits the full 400ms again.
      vi.advanceTimersByTime(TASK_INVALIDATE_MAX_WAIT_MS * 2);
      expect(onTasksInvalidate).toHaveBeenCalledTimes(1);
      source.emit(taskChanged("task-next"));
      vi.advanceTimersByTime(TASK_INVALIDATE_DEBOUNCE_MS - 1);
      expect(onTasksInvalidate).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(onTasksInvalidate).toHaveBeenCalledTimes(2);
      expect(onTasksInvalidate).toHaveBeenLastCalledWith(["task-next"]);
    });

    it("drops a pending tasks-only refresh when a full refresh fires", () => {
      const { onInvalidate, onTasksInvalidate, source } = setup();
      source.emit(taskChanged());
      source.emit({ type: "kanban:changed", entity: "board", action: "updated" });
      vi.advanceTimersByTime(TASK_INVALIDATE_MAX_WAIT_MS * 2);
      expect(onInvalidate).toHaveBeenCalledTimes(1);
      expect(onTasksInvalidate).not.toHaveBeenCalled();
    });

    it("falls back to the full refresh when no onTasksInvalidate is given", () => {
      vi.useFakeTimers();
      const onInvalidate = vi.fn();
      vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
      render(<HookHarness workspaceId="workspace-1" onInvalidate={onInvalidate} />);
      const source = MockEventSource.instances[0];
      source.emit({ type: "connected" });
      source.emit(taskChanged());
      vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
      expect(onInvalidate).toHaveBeenCalledTimes(1);
    });
  });

  describe("self-healing reconnect", () => {
    // Literal values from the requirement, not the exported constants, so a
    // regression in the constants is caught too.
    const EXPECTED_BACKOFF = [3000, 6000, 12000, 24000, 48000, 60000, 60000];
    const WATCHDOG = 60_000;

    it("backs off 3s, 6s, 12s, 24s, 48s, 60s, 60s across consecutive errors", () => {
      mount();
      const delays: number[] = [];
      for (let attempt = 0; attempt < EXPECTED_BACKOFF.length; attempt += 1) {
        const count = MockEventSource.instances.length;
        MockEventSource.instances[count - 1].fail();
        let waited = 0;
        while (MockEventSource.instances.length === count && waited < 120_000) {
          vi.advanceTimersByTime(1000);
          waited += 1000;
        }
        delays.push(waited);
      }
      expect(delays).toEqual(EXPECTED_BACKOFF);
    });

    it("never reconnects one millisecond early", () => {
      mount();
      for (const delay of EXPECTED_BACKOFF) {
        const count = MockEventSource.instances.length;
        MockEventSource.instances[count - 1].fail();
        vi.advanceTimersByTime(delay - 1);
        expect(MockEventSource.instances).toHaveLength(count);
        vi.advanceTimersByTime(1);
        expect(MockEventSource.instances).toHaveLength(count + 1);
      }
    });

    it("resets the backoff to 3s once a connection opens", () => {
      mount();
      for (const delay of [3000, 6000, 12000]) {
        MockEventSource.instances.at(-1)!.fail();
        vi.advanceTimersByTime(delay);
      }
      const reopened = MockEventSource.instances.at(-1)!;
      reopened.open();
      const count = MockEventSource.instances.length;
      reopened.fail();
      vi.advanceTimersByTime(2999);
      expect(MockEventSource.instances).toHaveLength(count);
      vi.advanceTimersByTime(1);
      expect(MockEventSource.instances).toHaveLength(count + 1);
    });

    it("reconnects at once when a tab that lost its connection in the background comes back", () => {
      const { onInvalidate } = mount();
      const first = MockEventSource.instances[0];
      first.open();
      first.emit({ type: "connected" });
      first.emit({ type: "kanban:changed" }, "evt-77");
      vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
      onInvalidate.mockClear();

      setVisibility("hidden");
      first.fail();
      expect(MockEventSource.instances).toHaveLength(1);

      goVisible();
      expect(MockEventSource.instances).toHaveLength(2);
      const second = MockEventSource.instances[1];
      expect(new URL(second.url, "http://localhost").searchParams.get("lastEventId")).toBe("evt-77");

      second.open();
      second.emit({ type: "connected" });
      vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
      expect(onInvalidate).toHaveBeenCalledTimes(1);

      // The backoff timer from the background error was dropped.
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(2);
    });

    it("keeps retrying with backoff while hidden instead of giving up", () => {
      mount();
      setVisibility("hidden");
      MockEventSource.instances[0].fail();
      vi.advanceTimersByTime(2999);
      expect(MockEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(MockEventSource.instances).toHaveLength(2);
    });

    it("leaves a live connection alone when the tab comes back", () => {
      mount();
      const source = MockEventSource.instances[0];
      source.open();
      setVisibility("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      goVisible();
      expect(MockEventSource.instances).toHaveLength(1);
      expect(source.close).not.toHaveBeenCalled();
    });

    it("closes and reconnects after 60s with no message at all", () => {
      mount();
      const source = MockEventSource.instances[0];
      source.open();
      vi.advanceTimersByTime(WATCHDOG - 1);
      expect(MockEventSource.instances).toHaveLength(1);
      expect(source.close).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(source.close).toHaveBeenCalled();
      expect(MockEventSource.instances).toHaveLength(2);
    });

    it.each([
      ["a ping", (source: MockEventSource) => source.ping()],
      ["a message", (source: MockEventSource) => source.emit({ type: "kanban:session-activity", sessionId: "s" })],
    ])("restarts the watchdog on %s", (_label, deliver) => {
      mount();
      const source = MockEventSource.instances[0];
      source.open();
      vi.advanceTimersByTime(40_000);
      deliver(source);
      vi.advanceTimersByTime(WATCHDOG - 1);
      expect(MockEventSource.instances).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(MockEventSource.instances).toHaveLength(2);
    });

    it("never reconnects a healthy connection that keeps receiving pings", () => {
      mount();
      const source = MockEventSource.instances[0];
      source.open();
      for (let elapsed = 0; elapsed < 5 * 60_000; elapsed += 25_000) {
        vi.advanceTimersByTime(25_000);
        source.ping();
      }
      expect(MockEventSource.instances).toHaveLength(1);
      expect(source.close).not.toHaveBeenCalled();
    });

    it("does not deliver a ping to onmessage", () => {
      const { onInvalidate } = mount();
      const source = MockEventSource.instances[0];
      const onmessage = vi.spyOn(source, "onmessage" as never);
      source.ping();
      expect(onmessage).not.toHaveBeenCalled();
      vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
      expect(onInvalidate).not.toHaveBeenCalled();
    });

    it("ignores late callbacks from a replaced connection", () => {
      mount();
      const old = MockEventSource.instances[0];
      old.fail();
      vi.advanceTimersByTime(3000);
      const current = MockEventSource.instances[1];
      current.open();

      // Stale error and stale open from the old connection.
      old.fail();
      old.open();
      old.ping();
      vi.advanceTimersByTime(10_000);
      expect(MockEventSource.instances).toHaveLength(2);
      expect(current.close).not.toHaveBeenCalled();

      // The old connection's watchdog was cleared; only the current one runs.
      vi.advanceTimersByTime(WATCHDOG - 10_000 - 1);
      expect(MockEventSource.instances).toHaveLength(2);
      vi.advanceTimersByTime(1);
      expect(MockEventSource.instances).toHaveLength(3);
    });

    it("matches the requirement judge on 200 random error/open sequences", () => {
      // Judge from the requirement: after n consecutive errors with no open in
      // between, the wait is 3000 * 2^(n-1) ms capped at 60000.
      const judge = (streak: number) => Math.min(3000 * 2 ** (streak - 1), 60_000);
      let seed = 20261026;
      const rand = () => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return seed / 2 ** 31;
      };
      for (let run = 0; run < 200; run += 1) {
        MockEventSource.reset();
        const { unmount } = mount();
        let streak = 0;
        const steps = 1 + Math.floor(rand() * 12);
        for (let step = 0; step < steps; step += 1) {
          const current = MockEventSource.instances.at(-1)!;
          if (rand() < 0.3) {
            current.open();
            streak = 0;
          }
          current.fail();
          streak += 1;
          const expected = judge(streak);
          const count = MockEventSource.instances.length;
          vi.advanceTimersByTime(expected - 1);
          expect(MockEventSource.instances, `run ${run} step ${step}`).toHaveLength(count);
          vi.advanceTimersByTime(1);
          expect(MockEventSource.instances, `run ${run} step ${step}`).toHaveLength(count + 1);
        }
        unmount();
        vi.useRealTimers();
      }
    });

    it("cleans up every timer and listener on unmount", () => {
      const removeSpy = vi.spyOn(document, "removeEventListener");
      const addSpy = vi.spyOn(document, "addEventListener");
      const { unmount } = mount();
      const source = MockEventSource.instances[0];
      source.fail();
      const added = addSpy.mock.calls.find(([type]) => type === "visibilitychange");
      expect(added).toBeTruthy();

      unmount();
      expect(removeSpy).toHaveBeenCalledWith("visibilitychange", added![1]);
      expect(vi.getTimerCount()).toBe(0);

      source.fail();
      goVisible();
      vi.advanceTimersByTime(120_000);
      expect(MockEventSource.instances).toHaveLength(1);
      removeSpy.mockRestore();
      addSpy.mockRestore();
    });
  });
});
