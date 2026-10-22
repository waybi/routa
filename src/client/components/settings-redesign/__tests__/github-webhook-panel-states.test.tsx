import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch,
  getDesktopApiBaseUrl: () => "http://routa.test",
}));

import { ConfirmDialogProvider } from "../../confirm-dialog";
import { GitHubWebhookPanel } from "../../github-webhook-panel";

const config = {
  id: "wh-1",
  name: "Issue triage",
  repo: "acme/widgets",
  githubToken: "***",
  webhookSecret: "s3cret",
  eventTypes: ["issues", "pull_request"],
  labelFilter: [],
  triggerAgentId: "developer",
  enabled: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;
type ExtraHandler = (url: string, init?: RequestInit) => Response | undefined;

function useFetch(configsHandler: Handler, extra?: ExtraHandler) {
  desktopAwareFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const handled = extra?.(url, init);
    if (handled) return handled;
    if (url.startsWith("/api/webhooks/configs")) return configsHandler(url, init);
    if (url.startsWith("/api/webhooks/webhook-logs")) return json({ logs: [] });
    if (url.startsWith("/api/polling/config")) return json({ config: { enabled: false } });
    if (url.startsWith("/api/specialists")) return json({ specialists: [] });
    return json({});
  });
}

function callsWith(method: string, prefix: string) {
  return desktopAwareFetch.mock.calls.filter(
    ([url, init]) => String(url).startsWith(prefix) && (init as RequestInit | undefined)?.method === method,
  );
}

function renderPanel() {
  return render(
    <ConfirmDialogProvider>
      <GitHubWebhookPanel />
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

describe("GitHubWebhookPanel states", () => {
  it("shows a skeleton while the first load is pending", async () => {
    useFetch(() => new Promise(() => {}));
    renderPanel();
    expect(await screen.findByTestId("settings-list-skeleton")).toBeTruthy();
    expect(screen.queryByTestId("ui-empty-state")).toBeNull();
  });

  it("shows an error with a reload button and recovers after retry", async () => {
    let fail = true;
    useFetch(() => (fail ? json({}, 500) : json({ configs: [] })));
    renderPanel();

    await screen.findByTestId("ui-error-state");
    expect(screen.queryByTestId("ui-empty-state")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Load again" }));

    expect(await screen.findByText("No webhook triggers yet")).toBeTruthy();
    expect(screen.queryByTestId("ui-error-state")).toBeNull();
  });

  it("keeps the form and its input when saving fails", async () => {
    useFetch((_url, init) => (init?.method === "POST" ? json({ error: "repo not found" }, 500) : json({ configs: [] })));
    renderPanel();
    await screen.findByText("No webhook triggers yet");

    fireEvent.click(screen.getByRole("button", { name: /Add Trigger/ }));
    fireEvent.change(screen.getByTestId("webhook-name"), { target: { value: "Triage" } });
    fireEvent.change(screen.getByTestId("webhook-repo"), { target: { value: "acme/widgets" } });
    fireEvent.change(screen.getByTestId("webhook-token"), { target: { value: "ghp_abc" } });
    fireEvent.click(screen.getByTestId("webhook-submit"));

    const error = await screen.findByTestId("webhook-save-error");
    expect(error.textContent).toContain("Could not save");
    expect(error.textContent).toContain("repo not found");
    expect((screen.getByTestId("webhook-name") as HTMLInputElement).value).toBe("Triage");
    expect((screen.getByTestId("webhook-repo") as HTMLInputElement).value).toBe("acme/widgets");
    expect(document.querySelector(".bg-success-subtle")).toBeNull();
  });
});

describe("GitHubWebhookPanel register token dialog", () => {
  it("cancels on Escape without a request and returns focus to the register button", async () => {
    useFetch(() => json({ configs: [config] }));
    renderPanel();
    await screen.findByText("Issue triage");

    const registerButton = screen.getByRole("button", { name: /Register on GitHub/ });
    registerButton.focus();
    fireEvent.click(registerButton);

    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const input = screen.getByLabelText("Token") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "ghp_typed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(registerButton);
    expect(callsWith("POST", "/api/webhooks/register")).toHaveLength(0);
    expect(window.prompt).not.toHaveBeenCalled();
  });

  it("sends the same register body as before once a token is confirmed", async () => {
    useFetch(
      () => json({ configs: [config] }),
      (url) => (url === "/api/webhooks/register" ? json({ hook: { id: 42 } }) : undefined),
    );
    renderPanel();
    await screen.findByText("Issue triage");

    const registerButton = screen.getByRole("button", { name: /Register on GitHub/ });
    fireEvent.click(registerButton);
    fireEvent.change(await screen.findByLabelText("Token"), { target: { value: "ghp_real" } });
    fireEvent.click(screen.getByTestId("token-prompt-confirm"));

    await waitFor(() => expect(callsWith("POST", "/api/webhooks/register")).toHaveLength(1));
    const [, init] = callsWith("POST", "/api/webhooks/register")[0];
    expect((init as RequestInit).headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      token: "ghp_real",
      repo: "acme/widgets",
      webhookUrl: "http://routa.test/api/webhooks/github",
      secret: "s3cret",
      events: ["issues", "pull_request"],
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(registerButton));
    expect(window.prompt).not.toHaveBeenCalled();
  });
});

describe("GitHubWebhookPanel delete confirmation", () => {
  it("sends no DELETE when cancelled and one DELETE when confirmed", async () => {
    useFetch((_url, init) => (init?.method === "DELETE" ? json({ ok: true }) : json({ configs: [config] })));
    renderPanel();
    await screen.findByText("Issue triage");

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    fireEvent.click(await screen.findByTestId("confirm-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull());
    expect(callsWith("DELETE", "/api/webhooks/configs")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(callsWith("DELETE", "/api/webhooks/configs")).toHaveLength(1));
    expect(callsWith("DELETE", "/api/webhooks/configs")[0][0]).toBe("/api/webhooks/configs?id=wh-1");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.prompt).not.toHaveBeenCalled();
  });
});
