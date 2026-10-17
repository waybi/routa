import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelEffortPicker, type ModelEffortPickerProps } from "../model-effort-picker";
import type { ModelEffortChoices } from "../../model-effort/model-effort-choices";

const choices: ModelEffortChoices = {
  models: [
    { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro", group: "DeepSeek" },
    { value: "claude-opus-5-5", label: "Claude Opus 5.5", group: "Local 7357" },
    { value: "gpt-6.1-sol", label: "GPT 6.1 Sol", group: "Local 7357" },
  ],
  reasoningEfforts: [
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
    { value: "xmax", label: "X-Max" },
  ],
};

function renderPicker(overrides: Partial<ModelEffortPickerProps> = {}) {
  const onChange = vi.fn();
  const view = render(
    <ModelEffortPicker
      choices={choices}
      model="claude-opus-5-5"
      reasoningEffort="high"
      onChange={onChange}
      emptyLabel="Default model"
      {...overrides}
    />,
  );
  return { onChange, ...view };
}

function openPanel() {
  fireEvent.click(screen.getByTestId("model-effort-picker"));
  return screen.getByTestId("model-effort-picker-panel");
}

describe("ModelEffortPicker", () => {
  it("shows display names in the capsule and the empty label when unset", () => {
    const { rerender, onChange } = renderPicker();
    expect(screen.getByTestId("model-effort-picker-label").textContent).toBe("Claude Opus 5.5 · High");

    rerender(
      <ModelEffortPicker choices={choices} model="" reasoningEffort={undefined} onChange={onChange} emptyLabel="Default model" />,
    );
    expect(screen.getByTestId("model-effort-picker-label").textContent).toBe("Default model · Default");
  });

  it("lists models grouped under their group names with a check on the current one", () => {
    renderPicker();
    openPanel();

    expect(screen.getByRole("group", { name: "DeepSeek" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Local 7357" })).toBeTruthy();
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Follow default",
      "DeepSeek V4 Pro",
      "Claude Opus 5.5",
      "GPT 6.1 Sol",
    ]);
    expect(screen.getByRole("option", { name: "Claude Opus 5.5" }).getAttribute("aria-selected")).toBe("true");
  });

  it("selects a model and keeps the current effort", () => {
    const { onChange } = renderPicker();
    openPanel();
    fireEvent.click(screen.getByRole("option", { name: "GPT 6.1 Sol" }));
    expect(onChange).toHaveBeenCalledWith({ model: "gpt-6.1-sol", reasoningEffort: "high" });
  });

  it("renders effort segments only from the choices and selects one", () => {
    const { onChange } = renderPicker();
    openPanel();
    // "Default" plus whatever the choices list (including a non-standard value).
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Default", "Low", "High", "X-Max"]);
    expect(screen.getByRole("radio", { name: "High" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "X-Max" }));
    expect(onChange).toHaveBeenCalledWith({ model: "claude-opus-5-5", reasoningEffort: "xmax" });
  });

  it("reports empty strings when Follow default / Default are chosen", () => {
    const { onChange } = renderPicker();
    openPanel();
    fireEvent.click(screen.getByRole("option", { name: "Follow default" }));
    expect(onChange).toHaveBeenLastCalledWith({ model: "", reasoningEffort: "high" });
    fireEvent.click(screen.getByRole("radio", { name: "Default" }));
    expect(onChange).toHaveBeenLastCalledWith({ model: "claude-opus-5-5", reasoningEffort: "" });
  });

  it("keeps a stored value missing from the choices visible and selected", () => {
    renderPicker({ model: "retired-model" });
    expect(screen.getByTestId("model-effort-picker-label").textContent).toBe("retired-model · High");
    openPanel();
    expect(screen.getByRole("option", { name: "retired-model" }).getAttribute("aria-selected")).toBe("true");
  });

  it("never opens when read-only and shows the reason as the tooltip", () => {
    const { onChange } = renderPicker({ readOnlyReason: "Send a message to resume the session" });
    const button = screen.getByTestId("model-effort-picker");
    expect(button.getAttribute("title")).toBe("Send a message to resume the session");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(screen.queryByTestId("model-effort-picker-panel")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cannot be clicked when disabled", () => {
    renderPicker({ disabled: true });
    const button = screen.getByTestId("model-effort-picker") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByTestId("model-effort-picker-panel")).toBeNull();
  });

  it("closes on Escape and returns focus to the capsule", () => {
    renderPicker();
    const panel = openPanel();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByTestId("model-effort-picker-panel")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("model-effort-picker"));
  });

  it("closes on a mousedown outside the panel", () => {
    renderPicker();
    openPanel();
    fireEvent.mouseDown(screen.getByTestId("model-effort-picker-panel"));
    expect(screen.getByTestId("model-effort-picker-panel")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("model-effort-picker-panel")).toBeNull();
  });

  it("moves focus through models with the arrow keys and selects with Enter", () => {
    const { onChange } = renderPicker();
    const panel = openPanel();
    // Focus starts on the selected model.
    expect(document.activeElement?.textContent).toBe("Claude Opus 5.5");

    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("GPT 6.1 Sol");
    fireEvent.keyDown(panel, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Follow default");
    fireEvent.keyDown(panel, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("GPT 6.1 Sol");

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith({ model: "gpt-6.1-sol", reasoningEffort: "high" });
  });
});

describe("ModelEffortPicker without default choices", () => {
  it("hides Follow default and locks the Default effort segment", () => {
    const { onChange } = renderPicker({ allowDefaultModel: false, allowDefaultEffort: false, reasoningEffort: "" });
    openPanel();
    expect(screen.queryByRole("option", { name: "Follow default" })).toBeNull();
    const defaultSegment = screen.getByRole("radio", { name: "Default" }) as HTMLButtonElement;
    expect(defaultSegment.getAttribute("aria-checked")).toBe("true");
    expect(defaultSegment.disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Low" }));
    expect(onChange).toHaveBeenCalledWith({ model: "claude-opus-5-5", reasoningEffort: "low" });
  });

  it("drops the Default segment once a concrete effort is set", () => {
    renderPicker({ allowDefaultEffort: false });
    openPanel();
    expect(screen.getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Low", "High", "X-Max"]);
  });
});
