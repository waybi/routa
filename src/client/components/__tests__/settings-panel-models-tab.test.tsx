import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/client/utils/diagnostics", () => ({
  desktopAwareFetch: vi.fn(),
}));

import { ConfirmDialogProvider } from "../confirm-dialog";
import { ModelsTab } from "../settings-panel-models-tab";

const MODEL_KEY = "routa.modelDefinitions";
const HINT_TEXT = "Default model and reasoning effort for kanban lane agents are set on the Specialists page";

function renderModelsTab() {
  return render(
    <ConfirmDialogProvider>
      <ModelsTab />
    </ConfirmDialogProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("ModelsTab specialists hint", () => {
  it("shows the hint text pointing to the Specialists page", () => {
    renderModelsTab();
    const hint = screen.getByTestId("models-tab-specialists-hint");
    expect(hint.getAttribute("role")).toBe("note");
    expect(hint.textContent).toContain(HINT_TEXT);
  });

  it("links to /settings/specialists", () => {
    renderModelsTab();
    const link = screen.getByRole("link", { name: "Go to Specialists" });
    expect(link.getAttribute("href")).toBe("/settings/specialists");
  });

  it("renders the hint before the Add Model form", () => {
    renderModelsTab();
    const hint = screen.getByTestId("models-tab-specialists-hint");
    const addButton = screen.getByRole("button", { name: "Add Model" });
    expect(hint.compareDocumentPosition(addButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the saved model list and delete action visible", () => {
    localStorage.setItem(MODEL_KEY, JSON.stringify([{ alias: "fast", modelName: "gpt-mini" }]));
    renderModelsTab();
    expect(screen.getByTestId("models-tab-specialists-hint")).toBeTruthy();
    expect(screen.getByText("fast")).toBeTruthy();
    expect(screen.getByTitle("Delete")).toBeTruthy();
  });
});
