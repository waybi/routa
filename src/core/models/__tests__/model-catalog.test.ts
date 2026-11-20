// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ModelCatalogError,
  addCustomModel,
  deleteCustomModel,
  getModelCatalogFilePath,
  mergeCatalog,
  readModelCatalog,
  updateCustomModel,
  upsertProviderOverride,
  writeModelCatalog,
} from "../model-catalog";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-model-catalog-"));
const file = path.join(tmpDir, "model-catalog.json");

const DSH_FLASH = '["deepseek-official","deepseek-flash"]';

beforeEach(() => {
  process.env.ROUTA_MODEL_CATALOG_FILE = file;
  fs.rmSync(file, { force: true });
  for (const name of fs.readdirSync(tmpDir)) {
    if (name.startsWith("model-catalog.json.bak-")) fs.rmSync(path.join(tmpDir, name), { force: true });
  }
});

afterEach(() => {
  delete process.env.ROUTA_MODEL_CATALOG_FILE;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("model catalog storage", () => {
  it("starts empty and uses the env override path", () => {
    expect(getModelCatalogFilePath()).toBe(file);
    expect(readModelCatalog()).toEqual({ version: 1, custom: [], providerOverrides: {} });
  });

  it("adds a custom model, writes atomically and keeps a backup on rewrite", () => {
    const entry = addCustomModel({
      alias: "deepseek-v4",
      modelId: "deepseek-chat",
      label: "DeepSeek V4",
      baseUrl: "https://api.deepseek.com/anthropic",
      secretRef: "keychain:routa/model/deepseek-v4",
    });
    expect(entry.id).toBe("custom:deepseek-v4");
    expect(entry.enabled).toBe(true);

    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(stored.custom).toHaveLength(1);
    expect(stored.updatedAt).toMatch(/^\d{4}-/);

    updateCustomModel("custom:deepseek-v4", { label: "DeepSeek V4.1" });
    const backups = fs.readdirSync(tmpDir).filter((name) => name.includes(".bak-"));
    expect(backups.length).toBeGreaterThan(0);
  });

  it("rejects a duplicate alias and a duplicate provider/model pair", () => {
    addCustomModel({ alias: "deepseek-v4", modelId: "deepseek-chat" });
    expect(() => addCustomModel({ alias: "deepseek-v4", modelId: "deepseek-chat" }))
      .toThrowError(ModelCatalogError);
    try {
      addCustomModel({ alias: "ds2", modelId: "deepseek-chat" });
    } catch (error) {
      expect((error as ModelCatalogError).code).toBe("DUPLICATE_MODEL");
    }
  });

  it("normalizes a Base URL and rejects a missing alias", () => {
    const entry = addCustomModel({ alias: "haiku", modelId: "claude-haiku-5-5", baseUrl: "https://api.example.com/v1/" });
    expect(entry.baseUrl).toBe("https://api.example.com/v1");
    expect(() => addCustomModel({ modelId: "x" })).toThrowError(/别名/);
  });

  it("updates and deletes a custom model", () => {
    addCustomModel({ alias: "gpt6-sol", modelId: "gpt-6.1-sol", providerId: "local-7357" });
    const updated = updateCustomModel("custom:gpt6-sol", { alias: "sol", label: "GPT-6 Sol" });
    expect(updated.id).toBe("custom:sol");
    expect(readModelCatalog().custom[0]).toMatchObject({ alias: "sol", label: "GPT-6 Sol" });

    const removed = deleteCustomModel("custom:sol");
    expect(removed.alias).toBe("sol");
    expect(readModelCatalog().custom).toEqual([]);
    expect(() => deleteCustomModel("custom:sol")).toThrowError(/找不到/);
  });
});

describe("mergeCatalog", () => {
  it("keeps provider raw values, applies display overrides and appends custom entries", () => {
    writeModelCatalog({
      version: 1,
      custom: [
        {
          id: "custom:deepseek-v4",
          alias: "deepseek-v4",
          label: "DeepSeek V4",
          providerId: "dsh",
          modelId: "deepseek-chat",
          enabled: true,
        },
        {
          id: "custom:other",
          alias: "other",
          label: "Other provider only",
          providerId: "pi",
          modelId: "x",
          enabled: true,
        },
      ],
      providerOverrides: {
        dsh: [{ value: DSH_FLASH, label: "DeepSeek Flash（改过名）", sort: 0 }],
      },
    });

    const entries = mergeCatalog("dsh", [
      { value: DSH_FLASH, label: "DeepSeek-V4.1-Flash", group: "DeepSeek" },
      { value: '["local-7357","grok-4.6"]', label: "Grok 4.6", group: "Local 7357" },
    ]);

    expect(entries[0]).toMatchObject({
      value: "deepseek-flash",
      rawValue: DSH_FLASH,
      label: "DeepSeek Flash（改过名）",
      source: "provider",
      editable: false,
    });
    const custom = entries.find((entry) => entry.source === "custom");
    expect(custom).toMatchObject({ value: "deepseek-v4", group: "自定义", editable: true });
    // A custom entry owned by another provider must not leak into dsh's list.
    expect(entries.some((entry) => entry.value === "other")).toBe(false);
  });

  it("drops hidden provider entries and never drops custom ones", () => {
    writeModelCatalog({
      version: 1,
      custom: [{
        id: "custom:mine",
        alias: "mine",
        label: "Mine",
        providerId: "dsh",
        modelId: "mine-1",
        enabled: true,
      }],
      providerOverrides: { dsh: [{ value: DSH_FLASH, hidden: true }] },
    });

    const entries = mergeCatalog("dsh", [
      { value: DSH_FLASH, label: "DeepSeek-V4.1-Flash" },
    ]);
    expect(entries.map((entry) => entry.value)).toEqual(["mine"]);
  });

  it("keeps bare ids untouched for non-DSH agents", () => {
    const entries = mergeCatalog("pi", [{ value: "claude-haiku-5-5", label: "Claude Haiku 5.5" }]);
    expect(entries[0]).toMatchObject({ value: "claude-haiku-5-5", rawValue: "claude-haiku-5-5" });
  });
});

describe("provider display overrides", () => {
  it("upserts an override without persisting the model list itself", () => {    upsertProviderOverride("dsh", { value: DSH_FLASH, hidden: true, sort: 3 });
    const catalog = readModelCatalog();
    expect(catalog.providerOverrides.dsh).toEqual([{ value: DSH_FLASH, hidden: true, sort: 3 }]);
    expect(catalog.custom).toEqual([]);

    upsertProviderOverride("dsh", { value: DSH_FLASH, label: "Renamed" });
    expect(readModelCatalog().providerOverrides.dsh).toEqual([
      { value: DSH_FLASH, label: "Renamed", hidden: true, sort: 3 },
    ]);
  });
});

describe("updateCustomModel", () => {
  it("keeps the baseUrl when omitted and clears it when an empty string is sent", () => {
    const created = addCustomModel({ alias: "clearable", modelId: "m-1", baseUrl: "https://api.example.com" });
    expect(created.baseUrl).toBe("https://api.example.com");

    updateCustomModel(created.id, { label: "Renamed" });
    expect(readModelCatalog().custom[0].baseUrl).toBe("https://api.example.com");

    updateCustomModel(created.id, { baseUrl: "" });
    expect(readModelCatalog().custom[0].baseUrl).toBeUndefined();
  });
});
