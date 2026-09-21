/**
 * Integration coverage for the completion-notification chain.
 *
 * Renders the real hook inside the real NotificationProvider and ToastProvider
 * and feeds it the lifecycle frame the SSE hook produces, so this asserts what
 * the user actually gets when an agent run finishes: a toast, a bell entry,
 * and (while the tab is hidden) an OS notification.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/client/components/toast";
import { NotificationBell, NotificationProvider } from "@/client/components/notification-center";
import type { KanbanTaskLifecyclePayload } from "@/client/hooks/use-kanban-events";
import { useTaskLifecycleNotifications } from "../use-task-lifecycle-notifications";

function Harness({
  onReady,
  onOpenTask,
}: {
  onReady: (handler: (event: KanbanTaskLifecyclePayload) => void) => void;
  onOpenTask?: (taskId: string) => void;
}) {
  const handler = useTaskLifecycleNotifications({ onOpenTask });
  onReady(handler);
  return <NotificationBell />;
}

function renderChain(onOpenTask?: (taskId: string) => void) {
  let handler: ((event: KanbanTaskLifecyclePayload) => void) | null = null;
  render(
    <NotificationProvider>
      <ToastProvider>
        <Harness onReady={(fn) => { handler = fn; }} onOpenTask={onOpenTask} />
      </ToastProvider>
    </NotificationProvider>,
  );
  return () => handler!;
}

function lifecycle(overrides: Partial<KanbanTaskLifecyclePayload> = {}): KanbanTaskLifecyclePayload {
  return {
    type: "kanban:task-lifecycle",
    workspaceId: "workspace-1",
    taskId: "task-1",
    taskTitle: "Ship the thing",
    sessionId: "session-1",
    phase: "completed",
    columnId: "dev",
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTaskLifecycleNotifications", () => {
  it("shows a success toast when a run completes", async () => {
    const getHandler = renderChain();

    act(() => getHandler()(lifecycle({ lastMessagePreview: "all green" })));

    const toast = await screen.findByTestId("toast-success");
    expect(toast.textContent).toContain("Ship the thing");
    expect(toast.textContent).toContain("all green");
  });

  it("shows a sticky error toast when a run fails", async () => {
    const getHandler = renderChain();

    act(() => getHandler()(lifecycle({ phase: "failed", lastMessagePreview: "provider exploded" })));

    const toast = await screen.findByTestId("toast-error");
    expect(toast.textContent).toContain("Ship the thing");
    expect(toast.textContent).toContain("provider exploded");
  });

  it("records the event in the notification bell so it survives a tab switch", async () => {
    const getHandler = renderChain();

    act(() => getHandler()(lifecycle()));

    // Unread badge on the bell.
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem("routa_notifications") ?? "[]");
      expect(stored).toHaveLength(1);
      expect(stored[0].title).toContain("Ship the thing");
      expect(stored[0].read).toBe(false);
    });
  });

  it("routes the toast action to the card opener", async () => {
    const onOpenTask = vi.fn();
    const getHandler = renderChain(onOpenTask);

    act(() => getHandler()(lifecycle()));

    const action = await screen.findByRole("button", { name: "Open card" });
    act(() => action.click());

    expect(onOpenTask).toHaveBeenCalledWith("task-1");
  });

  it("ignores non-terminal phases", async () => {
    const getHandler = renderChain();

    act(() => getHandler()(lifecycle({ phase: "started" })));

    await waitFor(() => {
      expect(screen.queryByTestId("toast-viewport")).toBeNull();
    });
  });

  it("does not notify twice for a replayed frame", async () => {
    const getHandler = renderChain();

    act(() => getHandler()(lifecycle()));
    // SSE reconnects replay recent frames.
    act(() => getHandler()(lifecycle()));

    await waitFor(() => {
      expect(screen.getAllByTestId("toast-success")).toHaveLength(1);
    });
    const stored = JSON.parse(window.localStorage.getItem("routa_notifications") ?? "[]");
    expect(stored).toHaveLength(1);
  });

  it("raises an OS notification only while the tab is hidden", async () => {
    const NotificationMock = vi.fn();
    (NotificationMock as unknown as { permission: string }).permission = "granted";
    (NotificationMock as unknown as { requestPermission: () => Promise<string> }).requestPermission =
      async () => "granted";
    vi.stubGlobal("Notification", NotificationMock);

    const getHandler = renderChain();

    // Foreground: toast only, no OS notification.
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => getHandler()(lifecycle({ taskId: "task-visible" })));
    await screen.findByTestId("toast-success");
    expect(NotificationMock).not.toHaveBeenCalled();

    // Hidden: this is the case the board could never cover before.
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => getHandler()(lifecycle({ taskId: "task-hidden" })));

    await waitFor(() => expect(NotificationMock).toHaveBeenCalledTimes(1));
    const [title, options] = NotificationMock.mock.calls[0];
    expect(title).toContain("Ship the thing");
    expect(options).toMatchObject({ tag: "task-hidden" });
  });

  it("stays silent when disabled", async () => {
    function DisabledHarness({ onReady }: { onReady: (h: (e: KanbanTaskLifecyclePayload) => void) => void }) {
      const handler = useTaskLifecycleNotifications({ enabled: false });
      onReady(handler);
      return null;
    }

    let handler: ((event: KanbanTaskLifecyclePayload) => void) | null = null;
    render(
      <NotificationProvider>
        <ToastProvider>
          <DisabledHarness onReady={(fn) => { handler = fn; }} />
        </ToastProvider>
      </NotificationProvider>,
    );

    act(() => handler!(lifecycle()));

    await waitFor(() => {
      expect(screen.queryByTestId("toast-viewport")).toBeNull();
    });
  });
});
