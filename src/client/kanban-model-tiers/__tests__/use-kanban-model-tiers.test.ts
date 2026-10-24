import { describe, expect, it } from "vitest";

import { enRedesignSettings as en } from "@/i18n/locales/en-redesign-settings";
import { zhRedesignSettings as zh } from "@/i18n/locales/zh-redesign-settings";
import {
  buildStepDefaultHint,
  filterLaneModelChoices,
  resolveStepDefaultModel,
  resolveStepDefaultReasoningEffort,
  toSpecialistLocale,
  type KanbanModelTiersData,
} from "../use-kanban-model-tiers";

const data: KanbanModelTiersData = {
  providerId: "dsh",
  tiers: {
    fast: {
      override: null, codeDefault: "claude-opus-5-5", effective: "claude-opus-5-5",
      reasoningEffort: { override: null, effective: null },
    },
    balanced: {
      override: null, codeDefault: "claude-opus-5-5", effective: "claude-opus-5-5",
      reasoningEffort: { override: "medium", effective: "medium" },
    },
    smart: {
      override: "claude-sonnet-5-5", codeDefault: "claude-opus-5-5", effective: "claude-sonnet-5-5",
      reasoningEffort: { override: null, effective: null },
    },
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

  it("resolves where a follow-default step's reasoning effort comes from", () => {
    expect(resolveStepDefaultReasoningEffort(data, "kanban-done-reporter", "dsh"))
      .toEqual({ kind: "global", effort: "medium", tier: "balanced" });
    expect(resolveStepDefaultReasoningEffort(data, "kanban-dev-executor", "dsh")).toEqual({ kind: "acp" });
    expect(resolveStepDefaultReasoningEffort(data, undefined, "dsh")).toEqual({ kind: "acp" });
    expect(resolveStepDefaultReasoningEffort(data, "kanban-dev-executor", "codex")).toBeUndefined();
    expect(resolveStepDefaultReasoningEffort(null, "kanban-dev-executor", "dsh")).toBeUndefined();
    expect(resolveStepDefaultReasoningEffort(data, "custom-unknown", "dsh")).toBeUndefined();
  });

  it("hover text names both the model source and the reasoning effort source", () => {
    const zhCopy = zh.kanbanModelTiers;
    expect(buildStepDefaultHint(zhCopy, data, "kanban-done-reporter", "dsh"))
      .toBe("跟随默认：这一步会用 claude-opus-5-5（平衡档，代码默认）；推理档位 medium（平衡档，看板施工者默认）");
    expect(buildStepDefaultHint(zhCopy, data, "kanban-dev-executor", "dsh"))
      .toBe("跟随默认：这一步会用 claude-sonnet-5-5（智能档，看板施工者默认模型）；推理档位用施工者配置默认");
    expect(buildStepDefaultHint(zhCopy, data, undefined, "dsh"))
      .toBe(`${zhCopy.followDefaultHintNoTier}${zhCopy.hintEffortDefault}`);

    const enHint = buildStepDefaultHint(en.kanbanModelTiers, data, "kanban-done-reporter", "dsh")!;
    expect(enHint).toContain("claude-opus-5-5");
    expect(enHint).toContain("reasoning effort medium (Balanced tier");
    expect(buildStepDefaultHint(en.kanbanModelTiers, data, "kanban-own", "dsh"))
      .toContain("reasoning effort follows the agent profile default");
    expect(buildStepDefaultHint(zhCopy, data, "kanban-dev-executor", "codex")).toBeUndefined();
  });

  it("maps the UI locale to the specialist locale", () => {
    expect(toSpecialistLocale("zh")).toBe("zh-CN");
    expect(toSpecialistLocale("en")).toBe("en");
  });
});
