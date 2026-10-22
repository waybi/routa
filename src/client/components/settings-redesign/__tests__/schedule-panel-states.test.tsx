import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch,
}));

import { ConfirmDialogProvider } from "../../confirm-dialog";
import { SchedulePanel } from "../../schedule-panel";

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function renderPanel() {
  return render(
    <ConfirmDialogProvider>
      <SchedulePanel workspaceId="ws-1" />
    </ConfirmDialogProvider>,
  );
}

beforeEach(() => {
  desktopAwareFetch.mockReset();
  vi.spyOn(window, "confirm").mockImplementation(() => {
    throw new Error("native window.confirm must not be used");
  });
  vi.spyOn(window, "prompt").mockImplementation(() => {
    throw new Error("native window.prompt must not be used");
  });
});

describe("SchedulePanel states", () => {
  it("shows a skeleton while the first load is pending", async () => {
    desktopAwareFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/schedules")) return new Promise(() => {});
      return json({ specialists: [] });
    });
    renderPanel();

    expect(await screen.findByTestId("settings-list-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("ui-empty-state")).toBeNull();
  });

  it("shows an error with a reload button and recovers after retry", async () => {
    let fail = true;
    desktopAwareFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/schedules")) return fail ? json({}, 500) : json({ schedules: [] });
      return json({ specialists: [] });
    });
    renderPanel();

    const alert = await screen.findByTestId("ui-error-state");
    expect(alert.textContent).toContain("Could not load this page");
    expect(screen.queryByTestId("ui-empty-state")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Load again" }));

    expect(await screen.findByTestId("ui-empty-state")).toBeTruthy();
    expect(screen.getByText("No schedules yet")).toBeTruthy();
    expect(screen.queryByTestId("ui-error-state")).toBeNull();
  });

  it("keeps the form and its input when saving fails", async () => {
    desktopAwareFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json({ error: "disk full" }, 500);
      if (url.startsWith("/api/schedules")) return json({ schedules: [] });
      return json({ specialists: [] });
    });
    renderPanel();
    await screen.findByTestId("ui-empty-state");

    fireEvent.click(screen.getAllByRole("button", { name: /New Schedule/ })[0]);
    const name = screen.getByPlaceholderText("e.g. Nightly Dependency Update") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Nightly sweep" } });
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    fireEvent.change(selects[1], { target: { value: "developer" } });
    const prompt = screen.getByPlaceholderText(/Check for outdated npm packages/) as HTMLTextAreaElement;
    fireEvent.change(prompt, { target: { value: "sweep it" } });

    fireEvent.submit(name.closest("form")!);

    const error = await screen.findByTestId("schedule-save-error");
    expect(error.textContent).toContain("Could not save");
    expect(error.textContent).toContain("disk full");
    expect((screen.getByPlaceholderText("e.g. Nightly Dependency Update") as HTMLInputElement).value).toBe("Nightly sweep");
    expect((screen.getByPlaceholderText(/Check for outdated npm packages/) as HTMLTextAreaElement).value).toBe("sweep it");
    expect(screen.queryByText("Schedule created")).toBeNull();
    expect(document.querySelector(".bg-success-subtle")).toBeNull();
    await waitFor(() => expect(desktopAwareFetch.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "POST")).toBe(true));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.prompt).not.toHaveBeenCalled();
  });
});
