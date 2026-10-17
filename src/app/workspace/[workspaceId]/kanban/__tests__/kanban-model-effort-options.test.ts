import { describe, expect, it } from "vitest";
import {
  applyStepModelEffort,
  parseModelEffortChoices,
  resolveModelOptionsProviderId,
  withStoredChoice,
} from "../kanban-model-effort-options";

describe("kanban model / effort options", () => {
  it("parses grouped DSH model values into plain model ids and drops the empty effort", () => {
    const choices = parseModelEffortChoices({
      configOptions: [
        {
          id: "model",
          options: [
            { group: "a", options: [{ value: "[\"a\",\"m1\"]", name: "Model One" }] },
            { group: "b", options: [{ value: "[\"b\",\"m1\"]", name: "Model One (b)" }, { value: "m2" }] },
          ],
        },
        { id: "reasoning_effort", options: [{ value: "", name: "Default" }, { value: "high", name: "High" }] },
      ],
    });
    expect(choices.models).toEqual([
      { value: "m1", label: "Model One" },
      { value: "m2", label: "m2" },
    ]);
    expect(choices.reasoningEfforts).toEqual([{ value: "high", label: "High" }]);
    expect(parseModelEffortChoices({ error: "probe failed" })).toEqual({ models: [], reasoningEfforts: [] });
  });

  it("falls back step provider -> board auto provider -> dsh", () => {
    expect(resolveModelOptionsProviderId("codex", "claude")).toBe("codex");
    expect(resolveModelOptionsProviderId("  ", "claude")).toBe("claude");
    expect(resolveModelOptionsProviderId(undefined, null)).toBe("dsh");
  });

  it("keeps a stored value that is missing from the options", () => {
    expect(withStoredChoice([{ value: "m1", label: "M1" }], "gone")).toEqual([
      { value: "m1", label: "M1" },
      { value: "gone", label: "gone" },
    ]);
    expect(withStoredChoice([{ value: "m1", label: "M1" }], "m1")).toHaveLength(1);
  });

  it("removes the field for Follow default and stores trimmed values otherwise", () => {
    expect(applyStepModelEffort({ id: "s", model: "m1" }, "model", "")).toEqual({ id: "s" });
    expect(applyStepModelEffort({ id: "s" }, "reasoningEffort", " high ")).toEqual({ id: "s", reasoningEffort: "high" });
  });
});
