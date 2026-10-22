import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch,
}));

import { ConfirmDialogProvider } from "../confirm-dialog";
import { SchedulePanel } from "../schedule-panel";

const schedule = {
  id: "sch-1",
  name: "Nightly sweep",
  cronExpr: "0 2 * * *",
  taskPrompt: "sweep",
  agentId: "routa",
  workspaceId: "ws-1",
  enabled: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function deleteCalls() {
  return desktopAwareFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
}

beforeEach(() => {
  desktopAwareFetch.mockReset();
  desktopAwareFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return jsonResponse({ ok: true });
    if (url.startsWith("/api/schedules")) return jsonResponse({ schedules: [schedule] });
    if (url.startsWith("/api/specialists")) return jsonResponse({ specialists: [] });
    return jsonResponse({});
  });
  vi.spyOn(window, "confirm").mockImplementation(() => {
    throw new Error("native window.confirm must not be used");
  });
});

function renderPanel() {
  return render(
    <ConfirmDialogProvider>
      <SchedulePanel workspaceId="ws-1" />
    </ConfirmDialogProvider>,
  );
}

describe("SchedulePanel delete confirmation", () => {
  it("asks with the in-app dialog and sends nothing when cancelled", async () => {
    renderPanel();
    await screen.findByText("Nightly sweep");

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));

    expect(await screen.findByTestId("confirm-dialog")).toBeTruthy();
    expect(window.confirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull());
    expect(deleteCalls()).toHaveLength(0);
  });

  it("sends the DELETE request once the user confirms", async () => {
    renderPanel();
    await screen.findByText("Nightly sweep");

    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0][0]).toBe("/api/schedules/sch-1");
  });
});
