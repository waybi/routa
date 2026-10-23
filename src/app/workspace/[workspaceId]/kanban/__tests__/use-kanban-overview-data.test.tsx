import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_INVALIDATE_DEBOUNCE_MS, TASK_INVALIDATE_MAX_WAIT_MS } from "@/client/hooks/use-kanban-events";
import {
  __resetKanbanOverviewCacheForTests,
  OVERVIEW_RECONNECT_DELAY_MS,
  useKanbanOverviewData,
  type OverviewWorkspaceData,
} from "../use-kanban-overview-data";
import type { OverviewWorkspace } from "../kanban-overview-rules";

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
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload), lastEventId: "" } as MessageEvent);
  }
  fail() {
    this.onerror?.(new Event("error"));
  }
}

interface Call {
  url: string;
  signal: AbortSignal;
  resolve: (body: unknown, status?: number) => void;
}

let calls: Call[] = [];
let autoRespond: ((url: string) => { body: unknown; status?: number }) | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal as AbortSignal;
    signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    if (autoRespond) {
      const { body, status } = autoRespond(url);
      resolve(jsonResponse(body, status));
      return;
    }
    calls.push({ url, signal, resolve: (body, status = 200) => resolve(jsonResponse(body, status)) });
  })));
}

const WORKSPACES: OverviewWorkspace[] = [{ id: "w1", title: "One" }, { id: "w2", title: "Two" }];

type HookResult = { data: Record<string, OverviewWorkspaceData>; retry: (id: string) => void };
const holder: { current: HookResult | null } = { current: null };
const latestProxy = {
  get data() { return holder.current!.data; },
  retry: (id: string) => holder.current!.retry(id),
};
const latest = latestProxy;

function Harness({ workspaces }: { workspaces: OverviewWorkspace[] }) {
  const result = useKanbanOverviewData(workspaces);
  useEffect(() => {
    holder.current = result;
  });
  return null;
}

function defaultResponder(url: string) {
  const ws = new URL(url, "http://x").searchParams.get("workspaceId");
  return url.includes("/api/tasks")
    ? { body: { tasks: [{ id: `${ws}-t`, title: "t", status: "PENDING", columnId: "dev" }] } }
    : { body: { boards: [{ id: `${ws}-b`, columns: [] }] } };
}

function fetchUrls(): string[] {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  __resetKanbanOverviewCacheForTests();
  calls = [];
  autoRespond = defaultResponder;
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
  installFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useKanbanOverviewData", () => {
  it("loads tasks and boards per workspace and opens one workspace-less SSE (AC2 / AC7)", async () => {
    render(<Harness workspaces={WORKSPACES} />);
    await flush();
    expect(fetchUrls().sort()).toEqual([
      "/api/kanban/boards?workspaceId=w1",
      "/api/kanban/boards?workspaceId=w2",
      "/api/tasks?workspaceId=w1",
      "/api/tasks?workspaceId=w2",
    ]);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/kanban/events");
    expect(latest.data.w1.status).toBe("ready");
    expect(latest.data.w2.tasks[0].id).toBe("w2-t");
  });

  it("marks only the failing workspace as error and recovers on retry (AC2)", async () => {
    autoRespond = (url) => (url.includes("w2") && url.includes("/api/tasks") ? { body: { error: "x" }, status: 500 } : defaultResponder(url));
    render(<Harness workspaces={WORKSPACES} />);
    await flush();
    expect(latest.data.w1.status).toBe("ready");
    expect(latest.data.w2.status).toBe("error");
    autoRespond = defaultResponder;
    act(() => latest.retry("w2"));
    await flush();
    expect(latest.data.w2.status).toBe("ready");
  });

  it("refetches only the event's workspace, debounced, tasks-only for task entity (AC7)", async () => {
    vi.useFakeTimers();
    render(<Harness workspaces={WORKSPACES} />);
    await flush();
    const es = MockEventSource.instances[0];
    const before = fetchUrls().length;
    act(() => {
      es.emit({ type: "connected" });
      es.emit({ type: "kanban:changed", workspaceId: "w1", entity: "task" });
      es.emit({ type: "kanban:changed", workspaceId: "w1", entity: "task" });
      es.emit({ type: "kanban:changed", workspaceId: "w1", entity: "task" });
      es.emit({ type: "kanban:session-tail", workspaceId: "w1", sessionId: "s", tail: "x" });
      es.emit({ type: "kanban:session-activity", workspaceId: "w2", sessionId: "s" });
      es.emit({ type: "kanban:changed", workspaceId: "unknown", entity: "board" });
    });
    act(() => vi.advanceTimersByTime(TASK_INVALIDATE_DEBOUNCE_MS - 1));
    expect(fetchUrls().length).toBe(before);
    act(() => vi.advanceTimersByTime(1));
    await flush();
    expect(fetchUrls().slice(before)).toEqual(["/api/tasks?workspaceId=w1"]);
  });

  it("includes boards for non-task entities and lifecycle events", async () => {
    vi.useFakeTimers();
    render(<Harness workspaces={WORKSPACES} />);
    await flush();
    const es = MockEventSource.instances[0];
    const before = fetchUrls().length;
    act(() => {
      es.emit({ type: "kanban:changed", workspaceId: "w2", entity: "task" });
      es.emit({ type: "kanban:task-lifecycle", workspaceId: "w2", taskId: "t", phase: "completed" });
    });
    act(() => vi.advanceTimersByTime(TASK_INVALIDATE_DEBOUNCE_MS));
    await flush();
    expect(fetchUrls().slice(before).sort()).toEqual(["/api/kanban/boards?workspaceId=w2", "/api/tasks?workspaceId=w2"]);
  });

  it("fires at most MAX_WAIT after the first event while events keep coming (AC7)", async () => {
    vi.useFakeTimers();
    render(<Harness workspaces={WORKSPACES} />);
    await flush();
    const es = MockEventSource.instances[0];
    const before = fetchUrls().length;
    for (let elapsed = 0; elapsed < TASK_INVALIDATE_MAX_WAIT_MS; elapsed += 300) {
      act(() => es.emit({ type: "kanban:changed", workspaceId: "w1", entity: "task" }));
      act(() => vi.advanceTimersByTime(300));
    }
    await flush();
    expect(fetchUrls().slice(before)).toEqual(["/api/tasks?workspaceId=w1"]);
  });

  it("reconnects after 3 s and refetches every workspace on the second connected (AC7)", async () => {
    vi.useFakeTimers();
    render(<Harness workspaces={WORKSPACES} />);
    await flush();
    const first = MockEventSource.instances[0];
    act(() => first.emit({ type: "connected" }));
    act(() => first.fail());
    expect(first.close).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(OVERVIEW_RECONNECT_DELAY_MS - 1));
    expect(MockEventSource.instances).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(MockEventSource.instances).toHaveLength(2);
    const before = fetchUrls().length;
    act(() => MockEventSource.instances[1].emit({ type: "connected" }));
    await flush();
    expect(fetchUrls().slice(before).sort()).toEqual([
      "/api/kanban/boards?workspaceId=w1",
      "/api/kanban/boards?workspaceId=w2",
      "/api/tasks?workspaceId=w1",
      "/api/tasks?workspaceId=w2",
    ]);
  });

  it("closes the connection on unmount and never reconnects afterwards (AC7)", async () => {
    vi.useFakeTimers();
    const view = render(<Harness workspaces={WORKSPACES} />);
    await flush();
    const es = MockEventSource.instances[0];
    act(() => es.fail());
    view.unmount();
    act(() => vi.advanceTimersByTime(OVERVIEW_RECONNECT_DELAY_MS * 2));
    expect(MockEventSource.instances).toHaveLength(1);

    const second = render(<Harness workspaces={WORKSPACES} />);
    await flush();
    const live = MockEventSource.instances[1];
    second.unmount();
    expect(live.close).toHaveBeenCalled();
  });

  it("lets the later request win and aborts the earlier one (AC8)", async () => {
    autoRespond = null;
    render(<Harness workspaces={[{ id: "w1", title: "One" }]} />);
    await flush();
    calls.splice(0).forEach((call) => call.resolve(call.url.includes("tasks") ? { tasks: [] } : { boards: [] }));
    await flush();

    act(() => latest.retry("w1"));
    await flush();
    const older = calls.splice(0);
    act(() => latest.retry("w1"));
    await flush();
    const newer = calls.splice(0);
    expect(older.every((call) => call.signal.aborted)).toBe(true);

    newer.forEach((call) => call.resolve(call.url.includes("tasks") ? { tasks: [{ id: "newer", title: "n", status: "PENDING" }] } : { boards: [] }));
    older.forEach((call) => call.resolve(call.url.includes("tasks") ? { tasks: [{ id: "older", title: "o", status: "PENDING" }] } : { boards: [] }));
    await flush();
    expect(latest.data.w1.status).toBe("ready");
    expect(latest.data.w1.tasks.map((task) => task.id)).toEqual(["newer"]);
  });

  it("shows cached data at once after a remount and refreshes it in the background", async () => {
    const first = render(<Harness workspaces={WORKSPACES} />);
    await flush();
    expect(latest.data.w1.tasks.map((task) => task.id)).toEqual(["w1-t"]);
    first.unmount();

    autoRespond = null;
    const before = fetchUrls().length;
    render(<Harness workspaces={WORKSPACES} />);
    // Before any response: the previous data, not "loading".
    expect(latest.data.w1.status).toBe("ready");
    expect(latest.data.w1.tasks.map((task) => task.id)).toEqual(["w1-t"]);
    expect(latest.data.w2.status).toBe("ready");
    await flush();
    expect(fetchUrls().slice(before).sort()).toEqual([
      "/api/kanban/boards?workspaceId=w1",
      "/api/kanban/boards?workspaceId=w2",
      "/api/tasks?workspaceId=w1",
      "/api/tasks?workspaceId=w2",
    ]);
    expect(latest.data.w1.status).toBe("ready");

    calls.splice(0).forEach((call) => call.resolve(call.url.includes("tasks")
      ? { tasks: [{ id: "fresh", title: "f", status: "PENDING" }] }
      : { boards: [] }));
    await flush();
    expect(latest.data.w1.tasks.map((task) => task.id)).toEqual(["fresh"]);
  });

  it("starts with loading for a workspace that was never loaded", () => {
    render(<Harness workspaces={WORKSPACES} />);
    expect(latest.data.w1).toBeUndefined();
  });
});
