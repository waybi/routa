import { describe, expect, it } from "vitest";
import { findChoiceLabel, parseModelEffortChoices } from "../model-effort-choices";

const payload = {
  configOptions: [
    {
      id: "model",
      options: [
        { group: "deepseek", name: "DeepSeek", options: [{ value: "[\"deepseek\",\"deepseek-v4-pro\"]", name: "DeepSeek V4 Pro" }] },
        { group: "local-7357", options: [{ value: "[\"local-7357\",\"claude-opus-5-5\"]", name: "Claude Opus 5.5" }] },
      ],
    },
    { id: "reasoning_effort", options: [{ value: "low", name: "Low" }, { value: "high" }] },
  ],
};

describe("parseModelEffortChoices groups and raw values", () => {
  it("carries the group display name, falling back to the group id", () => {
    expect(parseModelEffortChoices(payload).models).toEqual([
      { value: "deepseek-v4-pro", label: "DeepSeek V4 Pro", group: "DeepSeek" },
      { value: "claude-opus-5-5", label: "Claude Opus 5.5", group: "local-7357" },
    ]);
  });

  it("keeps the raw DSH model value when asked (live-session POST needs it)", () => {
    expect(parseModelEffortChoices(payload, { keepRawModelValues: true }).models.map((model) => model.value)).toEqual([
      "[\"deepseek\",\"deepseek-v4-pro\"]",
      "[\"local-7357\",\"claude-opus-5-5\"]",
    ]);
  });

  it("labels efforts with their name or raw value", () => {
    expect(parseModelEffortChoices(payload).reasoningEfforts).toEqual([
      { value: "low", label: "Low" },
      { value: "high", label: "high" },
    ]);
  });
});

describe("findChoiceLabel", () => {
  const choices = parseModelEffortChoices(payload).models;

  it("returns the display name when a choice lists the value", () => {
    expect(findChoiceLabel(choices, "claude-opus-5-5")).toBe("Claude Opus 5.5");
  });

  it("falls back to the raw id when no choice lists it", () => {
    expect(findChoiceLabel(choices, "retired-model")).toBe("retired-model");
    expect(findChoiceLabel(undefined, "retired-model")).toBe("retired-model");
  });

  it("returns undefined for blank values", () => {
    expect(findChoiceLabel(choices, "  ")).toBeUndefined();
    expect(findChoiceLabel(choices, undefined)).toBeUndefined();
  });
});
