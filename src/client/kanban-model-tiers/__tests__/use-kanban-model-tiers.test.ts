import { describe, expect, it } from "vitest";

import {
  filterLaneModelChoices,
  resolveStepDefaultModel,
  toSpecialistLocale,
  type KanbanModelTiersData,
} from "../use-kanban-model-tiers";

const data: KanbanModelTiersData = {
  providerId: "dsh",
  tiers: {
    fast: { override: null, codeDefault: "claude-opus-5-5", effective: "claude-opus-5-5" },
    balanced: { override: null, codeDefault: "claude-opus-5-5", effective: "claude-opus-5-5" },
    smart: { override: "claude-sonnet-5-5", codeDefault: "claude-opus-5-5", effective: "claude-sonnet-5-5" },
  },
  specialists: [
    { id: "kanban-dev-executor", name: "Dev Crafter", tier: "smart" },
    { id: "kanban-done-reporter", name: "Done Reporter", tier: "balanced" },
    { id: "kanban-own", name: "Own", tier: "smart", model: "claude-haiku-5-5" },
  ],
};

describe("kanban model tier client helpers", () => {
  it("keeps only Local 7357 models", () => {
    expect(filterLaneModelChoices([
      { value: "deepseek-flash", label: "DeepSeek Flash", group: "DeepSeek" },
      { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", group: "Local 7357" },
      { value: "loose", label: "Loose" },
    ]).map((choice) => choice.value)).toEqual(["claude-sonnet-5-5"]);
    expect(filterLaneModelChoices(undefined)).toEqual([]);
  });

  it("resolves what a follow-default step runs", () => {
    expect(resolveStepDefaultModel(data, "kanban-dev-executor", "dsh"))
      .toEqual({ kind: "global", model: "claude-sonnet-5-5", tier: "smart" });
    expect(resolveStepDefaultModel(data, "kanban-done-reporter", "dsh"))
      .toEqual({ kind: "code", model: "claude-opus-5-5", tier: "balanced" });
    expect(resolveStepDefaultModel(data, "kanban-own", "dsh"))
      .toEqual({ kind: "specialist", model: "claude-haiku-5-5" });
    expect(resolveStepDefaultModel(data, undefined, "dsh")).toEqual({ kind: "none" });
  });

  it("gives no hint when it cannot know the answer", () => {
    expect(resolveStepDefaultModel(null, "kanban-dev-executor", "dsh")).toBeUndefined();
    expect(resolveStepDefaultModel(data, "kanban-dev-executor", "codex")).toBeUndefined();
    expect(resolveStepDefaultModel(data, "custom-unknown", "dsh")).toBeUndefined();
  });

  it("maps the UI locale to the specialist locale", () => {
    expect(toSpecialistLocale("zh")).toBe("zh-CN");
    expect(toSpecialistLocale("en")).toBe("en");
  });
});
