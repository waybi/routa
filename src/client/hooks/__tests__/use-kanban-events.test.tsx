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

function taskChanged(resourceId = "task-1") {
  return { type: "kanban:changed", entity: "task", action: "updated", resourceId, source: "agent" };
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
});
