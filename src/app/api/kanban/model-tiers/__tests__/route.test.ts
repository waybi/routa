// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { PROVIDER_MODEL_TIERS } from "@/core/acp/provider-registry";
import { GET, PUT } from "../route";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-model-tiers-route-"));
const file = path.join(tmpDir, "kanban-model-tiers.json");

const put = (body: unknown) => PUT(new NextRequest("http://localhost/api/kanban/model-tiers", {
  method: "PUT",
  body: typeof body === "string" ? body : JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
}));

describe("/api/kanban/model-tiers", () => {
  beforeEach(() => {
    process.env.ROUTA_KANBAN_MODEL_TIERS_FILE = file;
    fs.rmSync(file, { force: true });
  });
  afterEach(() => {
    delete process.env.ROUTA_KANBAN_MODEL_TIERS_FILE;
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET reports the code defaults and which specialists use each tier", async () => {
    const data = await (await GET(new NextRequest("http://localhost/api/kanban/model-tiers"))).json();
    expect(data.providerId).toBe("dsh");
    expect(data.tiers.smart).toEqual({
      override: null,
      codeDefault: PROVIDER_MODEL_TIERS.dsh.smart,
      effective: PROVIDER_MODEL_TIERS.dsh.smart,
      reasoningEffort: { override: null, effective: null },
    });
    expect(data.specialists).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "kanban-done-reporter", tier: "balanced" }),
    ]));
  });

  it("PUT sets one tier, keeps absent tiers and persists to the file", async () => {
    await put({ fast: "claude-haiku-5-5" });
    const response = await put({ smart: "claude-sonnet-5-5" });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.tiers.smart).toMatchObject({ override: "claude-sonnet-5-5", effective: "claude-sonnet-5-5" });
    expect(data.tiers.fast).toMatchObject({ override: "claude-haiku-5-5" });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).tiers).toEqual({
      fast: { model: "claude-haiku-5-5" },
      smart: { model: "claude-sonnet-5-5" },
    });

    const reread = await (await GET(new NextRequest("http://localhost/api/kanban/model-tiers"))).json();
    expect(reread.tiers.smart.effective).toBe("claude-sonnet-5-5");
  });

  it("PUT null or blank clears a tier back to the code default", async () => {
    await put({ smart: "claude-sonnet-5-5", fast: "claude-haiku-5-5" });
    const data = await (await put({ smart: null, fast: "  " })).json();
    expect(data.tiers.smart).toEqual({
      override: null,
      codeDefault: PROVIDER_MODEL_TIERS.dsh.smart,
      effective: PROVIDER_MODEL_TIERS.dsh.smart,
      reasoningEffort: { override: null, effective: null },
    });
    expect(data.tiers.fast.override).toBeNull();
  });

  it("PUT object form sets the reasoning effort without touching the model", async () => {
    await put({ smart: "claude-sonnet-5-5" });
    const data = await (await put({ smart: { reasoningEffort: "high" } })).json();
    expect(data.tiers.smart).toMatchObject({
      override: "claude-sonnet-5-5",
      reasoningEffort: { override: "high", effective: "high" },
    });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).tiers).toEqual({
      smart: { model: "claude-sonnet-5-5", reasoningEffort: "high" },
    });
  });

  it("PUT object form sets both fields, keeps absent fields and clears with null or blank", async () => {
    await put({ fast: { model: "claude-haiku-5-5", reasoningEffort: "low" } });
    let data = await (await put({ fast: { model: "gpt-5.6-luna" } })).json();
    expect(data.tiers.fast).toMatchObject({ override: "gpt-5.6-luna", reasoningEffort: { override: "low" } });

    data = await (await put({ fast: { reasoningEffort: null } })).json();
    expect(data.tiers.fast).toMatchObject({ override: "gpt-5.6-luna", reasoningEffort: { override: null, effective: null } });

    await put({ fast: { reasoningEffort: "medium" } });
    data = await (await put({ fast: { model: "", reasoningEffort: "  " } })).json();
    expect(data.tiers.fast).toMatchObject({ override: null, reasoningEffort: { override: null } });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).tiers).toEqual({});
  });

  it("PUT legacy string form keeps the stored reasoning effort", async () => {
    await put({ balanced: { reasoningEffort: "medium" } });
    let data = await (await put({ balanced: "gpt-6-astra" })).json();
    expect(data.tiers.balanced).toMatchObject({ override: "gpt-6-astra", reasoningEffort: { override: "medium" } });
    data = await (await put({ balanced: null })).json();
    expect(data.tiers.balanced).toMatchObject({ override: null, reasoningEffort: { override: "medium" } });
  });

  it("PUT rejects invalid reasoning efforts and object fields without writing", async () => {
    expect((await put({ smart: { reasoningEffort: "Has Spaces" } })).status).toBe(400);
    expect((await put({ smart: { reasoningEffort: 3 } })).status).toBe(400);
    expect((await put({ smart: { model: "has spaces in it" } })).status).toBe(400);
    expect((await put({ smart: { model: "claude-sonnet-5-5", reasoningEffort: "!" } })).status).toBe(400);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("PUT rejects invalid bodies and model ids without writing", async () => {
    expect((await put("not json")).status).toBe(400);
    expect((await put([1])).status).toBe(400);
    expect((await put({ smart: 42 })).status).toBe(400);
    expect((await put({ smart: "has spaces in it" })).status).toBe(400);
    expect(fs.existsSync(file)).toBe(false);
  });
});
