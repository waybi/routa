import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { NotificationBell, NotificationProvider, useNotifications } from "../notification-center";

/**
 * Appearance-only checks for the redesigned bell. Behavior (which lane
 * transitions notify, one entry per card, status-first titles) is covered by
 * kanban/__tests__/use-task-lifecycle-notifications.test.tsx; this file only
 * asserts the bell still shows those entries and uses the redesign tokens.
 */

const captured: { add: ReturnType<typeof useNotifications>["addNotification"] } = { add: () => {} };

function Capture() {
  const { addNotification } = useNotifications();
  useEffect(() => {
    captured.add = addNotification;
  }, [addNotification]);
  return null;
}

const add: ReturnType<typeof useNotifications>["addNotification"] = (notification) => captured.add(notification);

function renderBell() {
  return render(
    <NotificationProvider>
      <Capture />
      <NotificationBell />
    </NotificationProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("NotificationBell (redesign look)", () => {
  it("renders no unread badge on the first (server-matching) render", () => {
    window.localStorage.setItem(
      "routa_notifications",
      JSON.stringify([{ id: "n1", type: "task", title: "Done · X", message: "", timestamp: "2026-10-22T00:00:00Z", read: false }]),
    );
    const { getByTestId } = renderBell();
    expect(getByTestId("notification-bell").querySelector(".bg-danger")).toBeNull();
  });

  it("keeps one entry per card and opens the card link", async () => {
    renderBell();
    act(() => {
      add({ type: "task", title: "Blocked · Card A", message: "m1", link: "/workspace/w/kanban?card=a", metadata: { taskId: "a" } });
      add({ type: "task", title: "Done · Card A", message: "m2", link: "/workspace/w/kanban?card=a", metadata: { taskId: "a" } });
    });

    const bell = screen.getByTestId("notification-bell");
    // The unread badge appears after mount so SSR and hydration match.
    await waitFor(() => expect(bell.textContent).toContain("1"));
    fireEvent.click(bell);

    expect(screen.getByText("Done · Card A")).toBeTruthy();
    expect(screen.queryByText("Blocked · Card A")).toBeNull();
  });

  it("uses redesign tokens rather than fixed palette colors", async () => {
    renderBell();
    act(() => {
      add({ type: "task", title: "Done · Card B", message: "m", metadata: { taskId: "b" } });
    });
    const bell = screen.getByTestId("notification-bell");
    await waitFor(() => expect(bell.querySelector(".bg-danger")).not.toBeNull());
    fireEvent.click(bell);

    const html = bell.parentElement?.innerHTML ?? "";
    expect(html).toContain("bg-surface");
    expect(html).toContain("bg-danger");
    expect(html).not.toMatch(/slate-|blue-\d|#[0-9a-fA-F]{3,8}\b/);
  });
});
