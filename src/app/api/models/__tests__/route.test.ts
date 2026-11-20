// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { DELETE, PATCH } from "../[id]/route";
import { GET, POST } from "../route";
import { PATCH as patchOverride } from "../overrides/[providerId]/route";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-model-catalog-api-"));
const file = path.join(tmpDir, "model-catalog.json");

const json = (url: string, method: string, body: unknown) => new NextRequest(url, {
  method,
  body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const overrideCtx = (providerId: string) => ({ params: Promise.resolve({ providerId }) });

beforeEach(() => {
  process.env.ROUTA_MODEL_CATALOG_FILE = file;
  fs.rmSync(file, { force: true });
});

afterEach(() => {
  delete process.env.ROUTA_MODEL_CATALOG_FILE;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("/api/models", () => {
  it("creates, lists, edits and deletes a custom model", async () => {
    const created = await POST(json("http://localhost/api/models", "POST", {
      alias: "deepseek-v4",
      modelId: "deepseek-chat",
      label: "DeepSeek V4",
      baseUrl: "https://api.deepseek.com/anthropic",
    }));
    expect(created.status).toBe(201);
    expect((await created.json()).model).toMatchObject({ id: "custom:deepseek-v4" });

    const list = await (await GET()).json();
    expect(list.custom).toHaveLength(1);

    const patched = await PATCH(json("http://localhost/api/models/custom:deepseek-v4", "PATCH", {
      label: "DeepSeek V4.1",
      enabled: false,
    }), ctx("custom:deepseek-v4"));
    expect(patched.status).toBe(200);
    expect((await patched.json()).model).toMatchObject({ label: "DeepSeek V4.1", enabled: false });

    const deleted = await DELETE(new NextRequest("http://localhost/api/models/custom:deepseek-v4"), ctx("custom:deepseek-v4"));
    expect(deleted.status).toBe(200);
    expect((await (await GET()).json()).custom).toEqual([]);
  });

  it("rejects a duplicate alias with 400 and a missing model with 404", async () => {
    await POST(json("http://localhost/api/models", "POST", { alias: "dup", modelId: "m1" }));
    const duplicate = await POST(json("http://localhost/api/models", "POST", { alias: "dup", modelId: "m2" }));
    expect(duplicate.status).toBe(400);
    expect((await duplicate.json()).code).toBe("ALIAS_CONFLICT");

    const missing = await PATCH(json("http://localhost/api/models/custom:nope", "PATCH", { label: "x" }), ctx("custom:nope"));
    expect(missing.status).toBe(404);
  });

  it("rejects a malformed body", async () => {
    const response = await POST(json("http://localhost/api/models", "POST", "{not json"));
    expect(response.status).toBe(400);
  });
});

describe("/api/models/overrides", () => {
  it("upserts a display override and keeps the provider list out of the file", async () => {
    const response = await patchOverride(json("http://localhost/api/models/overrides/dsh", "PATCH", {
      value: '["deepseek-official","deepseek-flash"]',
      label: "DeepSeek Flash",
      sort: 1,
    }), overrideCtx("dsh"));
    expect(response.status).toBe(200);
    expect((await response.json()).override).toMatchObject({ label: "DeepSeek Flash" });
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(stored.providerOverrides.dsh).toHaveLength(1);
    expect(stored.custom).toEqual([]);
  });
});
