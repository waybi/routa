import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({
  desktopAwareFetch: vi.fn(),
}));

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch,
}));

import { ConfirmDialogProvider } from "../../confirm-dialog";
import { ModelsTab } from "../../settings-panel-models-tab";
import { SpecialistsTab } from "../../settings-panel-specialists-tab";

const MODEL_KEY = "routa.modelDefinitions";

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

beforeEach(() => {
  desktopAwareFetch.mockReset();
  localStorage.clear();
  vi.spyOn(window, "confirm").mockImplementation(() => {
    throw new Error("native window.confirm must not be used");
  });
  vi.spyOn(window, "prompt").mockImplementation(() => {
    throw new Error("native window.prompt must not be used");
  });
});

describe("ModelsTab delete confirmation", () => {
  it("keeps the model when cancelled and removes it once confirmed", async () => {
    localStorage.setItem(MODEL_KEY, JSON.stringify([{ alias: "fast", modelName: "gpt-mini" }]));
    render(
      <ConfirmDialogProvider>
        <ModelsTab />
      </ConfirmDialogProvider>,
    );
    expect(screen.getByText("fast")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Delete"));
    fireEvent.click(await screen.findByTestId("confirm-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull());
    expect(screen.getByText("fast")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(MODEL_KEY) ?? "[]")).toHaveLength(1);

    fireEvent.click(screen.getByTitle("Delete"));
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(screen.queryByText("fast")).toBeNull());
    expect(JSON.parse(localStorage.getItem(MODEL_KEY) ?? "[]")).toHaveLength(0);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.prompt).not.toHaveBeenCalled();
  });
});

describe("SpecialistsTab delete confirmation", () => {
  it("sends no DELETE when cancelled and one DELETE when confirmed", async () => {
    desktopAwareFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return json({ ok: true });
      return json({
        specialists: [
          {
            id: "frontend-dev",
            name: "Frontend Dev",
            role: "DEVELOPER",
            defaultModelTier: "BALANCED",
            systemPrompt: "Build UI.",
            source: "user",
          },
        ],
      });
    });
    render(
      <ConfirmDialogProvider>
        <SpecialistsTab modelDefs={[]} />
      </ConfirmDialogProvider>,
    );
    fireEvent.click((await screen.findByText("Frontend Dev")).closest("button")!);

    const deleteCalls = () =>
      desktopAwareFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");

    fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }));
    fireEvent.click(await screen.findByTestId("confirm-dialog-cancel"));
    await waitFor(() => expect(screen.queryByTestId("confirm-dialog")).toBeNull());
    expect(deleteCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0][0]).toBe("/api/specialists?id=frontend-dev");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(window.prompt).not.toHaveBeenCalled();
  });
});
