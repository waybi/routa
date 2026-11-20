import { describe, expect, it } from "vitest";

import { filterLaneModelChoices } from "@/client/kanban-model-tiers/use-kanban-model-tiers";
import { parseCatalogChoices } from "../model-effort-choices";

const payload = {
  providerId: "dsh",
  entries: [
    {
      value: "deepseek-official/deepseek-flash",
      rawValue: '["deepseek-official","deepseek-flash"]',
      label: "DeepSeek Flash",
      group: "DeepSeek",
      source: "provider",
    },
    {
      value: "deepseek-chat",
      rawValue: '["deepseek-official","deepseek-chat"]',
      label: "DeepSeek Chat",
      group: "DeepSeek",
      source: "provider",
    },
    {
      value: "v4-alias",
      rawValue: "deepseek-chat",
      label: "V4 alias",
      group: "自定义",
      source: "custom",
    },
    {
      value: "custom-only",
      rawValue: "mystery-model",
      label: "Mystery",
      group: "自定义",
      source: "custom",
    },
  ],
  reasoningEfforts: [
    { value: "high", label: "High" },
    { value: "high", label: "High duplicate" },
    { value: "", label: "provider default" },
  ],
};

describe("parseCatalogChoices", () => {
  it("uses the real model id for custom aliases and hides the shadowed provider row", () => {
    const choices = parseCatalogChoices(payload);
    expect(choices.models.map((choice) => choice.value)).toEqual([
      '["deepseek-official","deepseek-flash"]',
      "deepseek-chat",
      "mystery-model",
    ]);
    const alias = choices.models.find((choice) => choice.value === "deepseek-chat");
    expect(alias).toMatchObject({ label: "V4 alias", source: "custom" });
    expect(choices.models.some((choice) => choice.value === "deepseek-official/deepseek-chat")).toBe(false);
  });

  it("keeps the agent's raw select value when the caller asks for it", () => {
    const choices = parseCatalogChoices(payload, { keepRawModelValues: true });
    const flash = choices.models.find((choice) => choice.label === "DeepSeek Flash");
    expect(flash?.value).toBe('["deepseek-official","deepseek-flash"]');
  });

  it("dedupes and drops blank reasoning efforts", () => {
    const choices = parseCatalogChoices(payload);
    expect(choices.reasoningEfforts).toEqual([{ value: "high", label: "High" }]);
  });

  it("survives a malformed payload", () => {
    expect(parseCatalogChoices(null).models).toEqual([]);
    expect(parseCatalogChoices({ entries: "nope" }).models).toEqual([]);
  });
});

describe("filterLaneModelChoices", () => {
  it("keeps whitelisted groups and every custom alias", () => {
    const choices = parseCatalogChoices(payload).models;
    expect(filterLaneModelChoices(choices).map((choice) => choice.value)).toEqual([
      '["deepseek-official","deepseek-flash"]',
      "deepseek-chat",
      "mystery-model",
    ]);
  });

  it("keeps every advertised group and drops only ungrouped rows", () => {
    const filtered = filterLaneModelChoices([
      { value: "gemini-x", label: "Gemini", group: "Gemini" },
      { value: "alias", label: "Alias", group: "自定义", source: "custom" },
      { value: "loose", label: "Loose" },
    ]);
    expect(filtered.map((choice) => choice.value)).toEqual(["gemini-x", "alias"]);
  });
});
