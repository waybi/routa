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
      fast: "claude-haiku-5-5",
      smart: "claude-sonnet-5-5",
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
    });
    expect(data.tiers.fast.override).toBeNull();
  });

  it("PUT rejects invalid bodies and model ids without writing", async () => {
    expect((await put("not json")).status).toBe(400);
    expect((await put([1])).status).toBe(400);
    expect((await put({ smart: 42 })).status).toBe(400);
    expect((await put({ smart: "has spaces in it" })).status).toBe(400);
    expect(fs.existsSync(file)).toBe(false);
  });
});
