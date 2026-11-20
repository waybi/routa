import { beforeEach, describe, expect, it, vi } from "vitest";

const { desktopAwareFetch } = vi.hoisted(() => ({ desktopAwareFetch: vi.fn() }));

vi.mock("@/client/utils/diagnostics", () => ({ desktopAwareFetch }));

import { loadModelDefinitions } from "@/client/components/settings-panel-shared";
import {
  migrateLocalModelDefinitions,
  writeModelDefinitionCache,
  type CustomModelEntry,
} from "../model-catalog-client";

const MODEL_KEY = "routa.modelDefinitions";

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response;
}

function entry(alias: string, modelId = "gpt-mini"): CustomModelEntry {
  return { id: `custom:${alias}`, alias, label: alias, providerId: "dsh", modelId, enabled: true };
}

beforeEach(() => {
  localStorage.clear();
  desktopAwareFetch.mockReset();
});

describe("migrateLocalModelDefinitions", () => {
  it("posts only the aliases the server does not know yet", async () => {
    localStorage.setItem(MODEL_KEY, JSON.stringify([
      { alias: "fast", modelName: "gpt-mini", baseUrl: "https://api.example.com", apiKey: "sk-secret" },
      { alias: "known", modelName: "known-model" },
    ]));
    desktopAwareFetch.mockResolvedValue(json({ model: entry("fast") }, 201));

    const result = await migrateLocalModelDefinitions([entry("known", "known-model")]);

    expect(result.migrated).toEqual(["fast"]);
    expect(result.failed).toEqual([]);
    expect(result.entries.map((item) => item.alias).sort()).toEqual(["fast", "known"]);
    expect(desktopAwareFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((desktopAwareFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ alias: "fast", modelId: "gpt-mini", baseUrl: "https://api.example.com" });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });

  it("treats an alias conflict as already migrated", async () => {
    localStorage.setItem(MODEL_KEY, JSON.stringify([{ alias: "fast", modelName: "gpt-mini" }]));
    desktopAwareFetch.mockResolvedValue(json({ error: "exists", code: "ALIAS_CONFLICT" }, 400));

    const result = await migrateLocalModelDefinitions([]);

    expect(result.migrated).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("reports a real failure instead of silently dropping the entry", async () => {
    localStorage.setItem(MODEL_KEY, JSON.stringify([{ alias: "bad", modelName: "has space" }]));
    desktopAwareFetch.mockResolvedValue(json({ error: "invalid model id" }, 400));

    const result = await migrateLocalModelDefinitions([]);

    expect(result.failed).toEqual([{ alias: "bad", reason: "invalid model id" }]);
  });
});

describe("writeModelDefinitionCache", () => {
  it("keeps the browser-only api key while adopting server fields", () => {
    const previous = [{ alias: "a", modelName: "old-model", apiKey: "sk-keep" }];
    writeModelDefinitionCache([{ ...entry("a", "new-model"), baseUrl: "https://api.example.com" }], previous);

    expect(loadModelDefinitions()).toEqual([
      { alias: "a", modelName: "new-model", baseUrl: "https://api.example.com", apiKey: "sk-keep" },
    ]);
  });
});
