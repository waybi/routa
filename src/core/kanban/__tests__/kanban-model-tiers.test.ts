// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { ModelTier } from "../../models/agent";
import { PROVIDER_MODEL_TIERS } from "../../acp/provider-registry";
import {
  describeKanbanModelTiers,
  getKanbanModelTiersFilePath,
  readKanbanModelTierOverrides,
  resolveTierModelForProvider,
  writeKanbanModelTierOverrides,
} from "../kanban-model-tiers";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "routa-model-tiers-unit-"));
const file = path.join(tmpDir, "nested", "kanban-model-tiers.json");

describe("kanban global model tiers", () => {
  beforeEach(() => {
    process.env.ROUTA_KANBAN_MODEL_TIERS_FILE = file;
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
  afterEach(() => {
    delete process.env.ROUTA_KANBAN_MODEL_TIERS_FILE;
  });
  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores the overrides in ~/.routa by default", () => {
    delete process.env.ROUTA_KANBAN_MODEL_TIERS_FILE;
    expect(getKanbanModelTiersFilePath()).toBe(path.join(os.homedir(), ".routa", "kanban-model-tiers.json"));
  });

  it("has no overrides when the file is missing or unreadable", () => {
    expect(readKanbanModelTierOverrides()).toEqual({});
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{not json");
    expect(readKanbanModelTierOverrides()).toEqual({});
  });

  it("round-trips through the file and drops blank or invalid tiers", () => {
    const saved = writeKanbanModelTierOverrides({
      smart: " claude-sonnet-5-5 ",
      balanced: "",
      fast: "bad model id with spaces",
    });
    expect(saved).toEqual({ smart: "claude-sonnet-5-5" });
    expect(readKanbanModelTierOverrides()).toEqual({ smart: "claude-sonnet-5-5" });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).tiers).toEqual({ smart: "claude-sonnet-5-5" });
    expect(fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("uses the override for its dsh tier and the code table for the others", () => {
    writeKanbanModelTierOverrides({ smart: "claude-sonnet-5-5" });
    expect(resolveTierModelForProvider("dsh", ModelTier.SMART)).toBe("claude-sonnet-5-5");
    expect(resolveTierModelForProvider("dsh", ModelTier.BALANCED)).toBe(PROVIDER_MODEL_TIERS.dsh.balanced);
    expect(resolveTierModelForProvider("dsh", ModelTier.FAST)).toBe(PROVIDER_MODEL_TIERS.dsh.fast);
  });

  it("falls back to the code table when no override is set", () => {
    expect(resolveTierModelForProvider("dsh", ModelTier.SMART)).toBe(PROVIDER_MODEL_TIERS.dsh.smart);
  });

  it("never applies the dsh overrides to other providers", () => {
    writeKanbanModelTierOverrides({ smart: "claude-sonnet-5-5" });
    expect(resolveTierModelForProvider("claude", ModelTier.SMART)).toBe(PROVIDER_MODEL_TIERS.claude.smart);
  });

  it("returns nothing without a tier or for a provider without a tier table", () => {
    writeKanbanModelTierOverrides({ smart: "claude-sonnet-5-5" });
    expect(resolveTierModelForProvider("dsh", undefined)).toBeUndefined();
    expect(resolveTierModelForProvider("no-such-provider", ModelTier.SMART)).toBeUndefined();
  });

  it("describes override, code default and effective model per tier", () => {
    writeKanbanModelTierOverrides({ fast: "claude-haiku-5-5" });
    expect(describeKanbanModelTiers()).toEqual({
      fast: { override: "claude-haiku-5-5", codeDefault: PROVIDER_MODEL_TIERS.dsh.fast, effective: "claude-haiku-5-5" },
      balanced: { override: null, codeDefault: PROVIDER_MODEL_TIERS.dsh.balanced, effective: PROVIDER_MODEL_TIERS.dsh.balanced },
      smart: { override: null, codeDefault: PROVIDER_MODEL_TIERS.dsh.smart, effective: PROVIDER_MODEL_TIERS.dsh.smart },
    });
  });
});
