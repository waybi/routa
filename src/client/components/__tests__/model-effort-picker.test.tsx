import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelEffortPicker, resolvePanelLeft, type ModelEffortPickerProps } from "../model-effort-picker";
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

describe("ModelEffortPicker panel layout", () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  function placeButton(rect: { left: number; right: number; top?: number; bottom?: number }) {
    const top = rect.top ?? 100;
    const bottom = rect.bottom ?? 124;
    const button = screen.getByTestId("model-effort-picker");
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
      left: rect.left,
      right: rect.right,
      width: rect.right - rect.left,
      top,
      bottom,
      height: bottom - top,
      x: rect.left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect);
  }

  function panelBox(panel: HTMLElement) {
    // jsdom does not lay out; the component drives size and position through style.
    return { left: parseFloat(panel.style.left), width: parseFloat(panel.style.width) };
  }

  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 1500, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 950, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
    vi.restoreAllMocks();
  });

  it("keeps the panel inside the viewport when the capsule sits at the right edge", () => {
    renderPicker();
    placeButton({ left: 1400, right: 1490 });
    const { left, width } = panelBox(openPanel());
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + width).toBeLessThanOrEqual(1500 - 8);
  });

  it("applies the same clamp when the panel opens upwards", () => {
    renderPicker();
    placeButton({ left: 1400, right: 1490, top: 900, bottom: 924 });
    const panel = openPanel();
    expect(panel.style.bottom).not.toBe("");
    const { left, width } = panelBox(panel);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(left + width).toBeLessThanOrEqual(1500 - 8);
  });

  it("still anchors to the capsule's left edge when there is room", () => {
    renderPicker();
    placeButton({ left: 40, right: 130 });
    expect(openPanel().style.left).toBe("40px");
  });

  it("is at least 320px wide and keeps a wider form trigger's width", () => {
    renderPicker();
    placeButton({ left: 40, right: 130 });
    const panel = openPanel();
    expect(panelBox(panel).width).toBeGreaterThanOrEqual(320);
    expect(parseFloat(panel.style.minWidth)).toBeGreaterThanOrEqual(320);
  });

  it("matches a form trigger that is wider than 320px", () => {
    renderPicker({ variant: "form" });
    placeButton({ left: 40, right: 440 });
    expect(panelBox(openPanel()).width).toBe(400);
  });

  it("shows every effort label in full without truncation", () => {
    renderPicker({
      choices: {
        ...choices,
        reasoningEfforts: [
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "xhigh", label: "Xhigh" },
          { value: "max", label: "Max" },
        ],
      },
    });
    openPanel();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["Default", "Low", "Medium", "High", "Xhigh", "Max"]);
    for (const radio of radios) {
      expect(radio.className).not.toContain("truncate");
      expect(radio.className).toContain("whitespace-nowrap");
    }
    expect(screen.getByRole("radiogroup").className).toContain("flex-wrap");
  });
});

describe("resolvePanelLeft", () => {
  it("right-aligns to the trigger, then clamps into the viewport", () => {
    expect(resolvePanelLeft({ left: 40, right: 130 }, 320, 1500)).toBe(40);
    expect(resolvePanelLeft({ left: 1400, right: 1490 }, 320, 1500)).toBe(1170);
    expect(resolvePanelLeft({ left: 1450, right: 1499 }, 320, 1500)).toBe(1172);
    expect(resolvePanelLeft({ left: 10, right: 100 }, 320, 300)).toBe(8);
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

describe("ModelEffortPicker default model hint", () => {
  it("shows the resolved default model on hover of Follow default and of an unset capsule", () => {
    renderPicker({ model: "", defaultModelHint: "Follow default: this step runs claude-sonnet-5-5" });
    expect(screen.getByTestId("model-effort-picker").getAttribute("title")).toContain("claude-sonnet-5-5");
    openPanel();
    expect(screen.getByRole("option", { name: "Follow default" }).getAttribute("title"))
      .toBe("Follow default: this step runs claude-sonnet-5-5");
  });

  it("keeps the capsule hover plain when a model is chosen", () => {
    renderPicker({ defaultModelHint: "Follow default: this step runs claude-sonnet-5-5" });
    expect(screen.getByTestId("model-effort-picker").getAttribute("title")).not.toContain("claude-sonnet-5-5");
  });
});
