/**
 * Integration coverage for the completion-notification chain.
 *
 * Renders the real hook inside the real NotificationProvider and ToastProvider
 * and feeds it the lifecycle frame the SSE hook produces, so this asserts what
 * the user actually gets when an agent run finishes: a toast, a bell entry,
 * and (while the tab is hidden) an OS notification.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/client/components/toast";
import { NotificationBell, NotificationProvider } from "@/client/components/notification-center";
import type { KanbanTaskLifecyclePayload } from "@/client/hooks/use-kanban-events";
import { I18nContext } from "@/i18n/context";
import en from "@/i18n/locales/en";
import zh from "@/i18n/locales/zh";
import { buildTaskNotificationLink, useTaskLifecycleNotifications } from "../use-task-lifecycle-notifications";

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

function renderChain(onOpenTask?: (taskId: string) => void, locale: "en" | "zh" = "en") {
  let handler: ((event: KanbanTaskLifecyclePayload) => void) | null = null;
  render(
    <I18nContext.Provider value={{ locale, setLocale: () => {}, t: locale === "zh" ? zh : en }}>
      <NotificationProvider>
        <ToastProvider>
          <Harness onReady={(fn) => { handler = fn; }} onOpenTask={onOpenTask} />
        </ToastProvider>
      </NotificationProvider>
    </I18nContext.Provider>,
  );
  return () => handler!;
}

type StoredNotification = {
  id: string;
  title: string;
  read: boolean;
  link?: string;
  metadata?: Record<string, unknown>;
};

function readStored(): StoredNotification[] {
  return JSON.parse(window.localStorage.getItem("routa_notifications") ?? "[]") as StoredNotification[];
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

  it.each(["started", "needs_review"] as const)(
    "AC1: ignores %s frames (no toast, no bell entry, no OS notification)",
    async (phase) => {
      const NotificationMock = vi.fn();
      (NotificationMock as unknown as { permission: string }).permission = "granted";
      (NotificationMock as unknown as { requestPermission: () => Promise<string> }).requestPermission =
        async () => "granted";
      vi.stubGlobal("Notification", NotificationMock);
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      const getHandler = renderChain();

      act(() => getHandler()(lifecycle({ phase, timestamp: "t1" })));
      act(() => getHandler()(lifecycle({ phase, timestamp: "t2" })));
      act(() => getHandler()(lifecycle({ phase, timestamp: "t3" })));

      await waitFor(() => {
        expect(screen.queryByTestId("toast-viewport")).toBeNull();
      });
      expect(readStored()).toHaveLength(0);
      expect(NotificationMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["completed", "toast-success"],
    ["blocked", "toast-info"],
    ["rejected", "toast-info"],
    ["failed", "toast-error"],
  ] as const)("AC2: a %s frame yields one toast and one bell entry", async (phase, toastId) => {
    const getHandler = renderChain();

    act(() => getHandler()(lifecycle({ phase })));
    act(() => getHandler()(lifecycle({ phase })));

    await waitFor(() => {
      expect(screen.getAllByTestId(toastId)).toHaveLength(1);
    });
    const stored = readStored();
    expect(stored).toHaveLength(1);
    expect(stored[0].metadata).toMatchObject({ taskId: "task-1", phase });
  });

  it("AC3: keeps only the newest entry per card, first and unread", async () => {
    const getHandler = renderChain();

    act(() => getHandler()(lifecycle({ phase: "failed", timestamp: "2026-01-01T00:00:00.000Z" })));
    act(() => getHandler()(lifecycle({ taskId: "task-2", taskTitle: "Other card", timestamp: "2026-01-01T00:00:01.000Z" })));
    act(() => getHandler()(lifecycle({ phase: "completed", timestamp: "2026-01-01T00:00:02.000Z" })));

    await waitFor(() => {
      const stored = readStored();
      expect(stored).toHaveLength(2);
      expect(stored[0].metadata).toMatchObject({ taskId: "task-1", phase: "completed" });
      expect(stored[0].title).toBe("Completed · Ship the thing");
      expect(stored[0].read).toBe(false);
      expect(stored[1].metadata).toMatchObject({ taskId: "task-2" });
    });
    expect(readStored().filter((n) => n.metadata?.taskId === "task-1")).toHaveLength(1);
  });

  it("AC3: tolerates legacy stored entries without metadata", async () => {
    window.localStorage.setItem("routa_notifications", JSON.stringify([
      { id: "legacy-1", type: "info", title: "Legacy", message: "", timestamp: "2025-01-01T00:00:00.000Z", read: true },
      { id: "legacy-2", type: "info", title: "Legacy null", message: "", timestamp: "2025-01-01T00:00:00.000Z", read: false, metadata: null },
      { id: "legacy-3", type: "info", title: "Legacy string", message: "", timestamp: "2025-01-01T00:00:00.000Z", read: false, metadata: "x" },
    ]));
    const getHandler = renderChain();

    expect(() => act(() => getHandler()(lifecycle()))).not.toThrow();

    await waitFor(() => {
      const stored = readStored();
      expect(stored).toHaveLength(4);
      expect(stored[0].metadata).toMatchObject({ taskId: "task-1" });
      expect(stored.slice(1).map((n) => n.id)).toEqual(["legacy-1", "legacy-2", "legacy-3"]);
    });
  });

  it("AC4: links the bell entry to the card on its board", async () => {
    const getHandler = renderChain();

    act(() => getHandler()(lifecycle({ workspaceId: "workspace 1", boardId: "board-9" })));

    await waitFor(() => {
      const [entry] = readStored();
      const url = new URL(entry.link ?? "", "http://localhost");
      expect(url.pathname).toBe("/workspace/workspace%201/kanban");
      expect(url.searchParams.get("taskId")).toBe("task-1");
      expect(url.searchParams.get("boardId")).toBe("board-9");
    });
  });

  it("AC4: omits boardId from the link when the event has none", () => {
    const link = buildTaskNotificationLink({ workspaceId: "workspace-1", taskId: "task-1" });
    expect(link).toBe("/workspace/workspace-1/kanban?taskId=task-1");
  });

  it("AC4: clicking the bell entry navigates to its link", async () => {
    const originalLocation = window.location;
    const fakeLocation = { href: "http://localhost/" };
    Object.defineProperty(window, "location", { configurable: true, value: fakeLocation });
    try {
      const getHandler = renderChain();
      act(() => getHandler()(lifecycle({ boardId: "board-1" })));

      fireEvent.click(screen.getByTitle(en.notifications.title));
      // The toast shows the same title; click the bell entry, which is a <button> row.
      const matches = await screen.findAllByText("Completed · Ship the thing");
      const bellEntry = matches.map((el) => el.closest("button")).find((el) => el !== null);
      expect(bellEntry).toBeTruthy();
      fireEvent.click(bellEntry!);

      expect(fakeLocation.href).toBe("/workspace/workspace-1/kanban?boardId=board-1&taskId=task-1");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it.each([
    ["completed", "Completed · ", "已完成 · "],
    ["blocked", "Blocked · ", "被阻塞 · "],
    ["rejected", "Sent back · ", "被打回 · "],
    ["failed", "Failed · ", "执行失败 · "],
  ] as const)("AC5: %s titles lead with the status", async (phase, enPrefix, zhPrefix) => {
    const getEnHandler = renderChain(undefined, "en");
    act(() => getEnHandler()(lifecycle({ phase })));
    await waitFor(() => expect(readStored()[0]?.title).toBe(`${enPrefix}Ship the thing`));

    window.localStorage.clear();
    const getZhHandler = renderChain(undefined, "zh");
    act(() => getZhHandler()(lifecycle({ phase, taskId: "task-zh" })));
    await waitFor(() => expect(readStored()[0]?.title).toBe(`${zhPrefix}Ship the thing`));
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
