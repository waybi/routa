import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("../../../utils/diagnostics", () => ({
  desktopAwareFetch,
}));

import { ConfirmDialogProvider } from "../../confirm-dialog";
import { McpServersTab } from "../../settings-panel-mcp-tab";

const server = { id: "fs", name: "Filesystem", type: "stdio", command: "npx", args: ["fs"], enabled: true };

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function callsWith(method: string) {
  return desktopAwareFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === method);
}

function renderTab() {
  return render(
    <ConfirmDialogProvider>
      <McpServersTab />
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

describe("McpServersTab states", () => {
  it("shows a skeleton while the first load is pending", async () => {
    desktopAwareFetch.mockImplementation(() => new Promise(() => {}));
    renderTab();
    expect(await screen.findByTestId("settings-list-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("ui-empty-state")).toBeNull();
  });

  it("shows an error with a reload button and recovers after retry", async () => {
    let fail = true;
    desktopAwareFetch.mockImplementation(async () => (fail ? json({ error: "db down" }, 500) : json({ servers: [] })));
    renderTab();

    const alert = await screen.findByTestId("ui-error-state");
    expect(alert.textContent).toContain("db down");
    expect(screen.queryByTestId("ui-empty-state")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Load again" }));

    expect(await screen.findByText("No MCP servers yet")).toBeTruthy();
    expect(screen.queryByTestId("ui-error-state")).toBeNull();
  });

  it("keeps the form and its input when saving fails", async () => {
    desktopAwareFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json({ error: "id taken" }, 500) : json({ servers: [] }),
    );
    renderTab();
    await screen.findByText("No MCP servers yet");

    fireEvent.click(screen.getByRole("button", { name: /New/ }));
    fireEvent.change(screen.getByPlaceholderText("my-mcp-server"), { target: { value: "fs" } });
    fireEvent.change(screen.getByPlaceholderText("My MCP Server"), { target: { value: "Filesystem" } });
    fireEvent.change(screen.getByPlaceholderText("npx"), { target: { value: "npx" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    const error = await screen.findByTestId("mcp-save-error");
    expect(error.textContent).toContain("Could not save");
    expect(error.textContent).toContain("id taken");
    expect((screen.getByPlaceholderText("my-mcp-server") as HTMLInputElement).value).toBe("fs");
    expect((screen.getByPlaceholderText("My MCP Server") as HTMLInputElement).value).toBe("Filesystem");
  });
});

describe("McpServersTab delete confirmation", () => {
  it("sends no DELETE when cancelled and one DELETE when confirmed", async () => {
    desktopAwareFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? json({ ok: true }) : json({ servers: [server] }),
    );
    renderTab();
    await screen.findByText("Filesystem");

    fireEvent.click(screen.getByTitle("Delete"));
    fireEvent.click(await screen.findByTestId("confirm-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull());
    expect(callsWith("DELETE")).toHaveLength(0);

    fireEvent.click(screen.getByTitle("Delete"));
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(callsWith("DELETE")).toHaveLength(1));
    expect(callsWith("DELETE")[0][0]).toBe("/api/mcp-servers?id=fs");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.prompt).not.toHaveBeenCalled();
  });
});
