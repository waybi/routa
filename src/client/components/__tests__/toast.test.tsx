import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, toast } from "../toast";

function renderProvider() {
  return render(
    <ToastProvider>
      <div>app</div>
    </ToastProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("renders a success toast and auto-dismisses it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderProvider();

    act(() => {
      toast.success("Card created", { description: "demo card" });
    });

    expect(await screen.findByText("Card created")).toBeTruthy();
    expect(screen.getByText("demo card")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(4100);
    });

    await waitFor(() => {
      expect(screen.queryByText("Card created")).toBeNull();
    });
  });

  it("keeps error toasts on screen until dismissed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderProvider();

    act(() => {
      toast.error("Failed to create card", { description: "500 boom" });
    });

    expect(await screen.findByText("Failed to create card")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // Sticky by design: a failure the user never reads is the bug this fixes.
    expect(screen.getByText("Failed to create card")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Failed to create card");
  });

  it("replaces a toast in place when the same id is reused", async () => {
    renderProvider();

    act(() => {
      toast.loading("Creating session", { id: "session-1" });
    });
    expect(await screen.findByText("Creating session")).toBeTruthy();

    act(() => {
      toast.success("Session ready", { id: "session-1" });
    });

    await waitFor(() => {
      expect(screen.queryByText("Creating session")).toBeNull();
    });
    expect(screen.getByText("Session ready")).toBeTruthy();
    // Replaced in place rather than stacked as a second entry.
    expect(screen.getAllByTestId("toast-success")).toHaveLength(1);
    expect(screen.queryByTestId("toast-loading")).toBeNull();
  });

  it("invokes the action callback and dismisses the toast", async () => {
    const onClick = vi.fn();
    renderProvider();

    act(() => {
      toast.info("demo completed", { action: { label: "Open card", onClick } });
    });

    const actionButton = await screen.findByRole("button", { name: "Open card" });
    act(() => {
      actionButton.click();
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText("demo completed")).toBeNull();
    });
  });

  it("caps the visible stack and keeps the newest entries", async () => {
    renderProvider();

    act(() => {
      for (let index = 0; index < 6; index += 1) {
        toast.error(`failure ${index}`);
      }
    });

    await waitFor(() => {
      expect(screen.getAllByTestId("toast-error")).toHaveLength(4);
    });
    expect(screen.queryByText("failure 0")).toBeNull();
    expect(screen.getByText("failure 5")).toBeTruthy();
  });

  it("does not throw when no provider is mounted", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    // Simulates SSR / a surface that has not adopted the layer yet.
    expect(() => toast.error("orphan failure")).not.toThrow();
    consoleError.mockRestore();
  });
});
