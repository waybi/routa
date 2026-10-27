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
  readKanbanModelTierSettings,
  resolveTierModelForProvider,
  resolveTierReasoningEffortForProvider,
  writeKanbanModelTierOverrides,
  writeKanbanModelTierSettings,
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
    expect(JSON.parse(fs.readFileSync(file, "utf8")).tiers).toEqual({ smart: { model: "claude-sonnet-5-5" } });
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

  it("dsh code defaults: fast runs Sonnet 5.5 (dev roles), balanced/smart run Opus 5.5", () => {
    expect(PROVIDER_MODEL_TIERS.dsh).toEqual({
      fast: "claude-sonnet-5-5",
      balanced: "claude-opus-5-5",
      smart: "claude-opus-5-5",
    });
    expect(resolveTierModelForProvider("dsh", ModelTier.FAST)).toBe("claude-sonnet-5-5");
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
      fast: {
        override: "claude-haiku-5-5",
        codeDefault: PROVIDER_MODEL_TIERS.dsh.fast,
        effective: "claude-haiku-5-5",
        reasoningEffort: { override: null, effective: null },
      },
      balanced: {
        override: null,
        codeDefault: PROVIDER_MODEL_TIERS.dsh.balanced,
        effective: PROVIDER_MODEL_TIERS.dsh.balanced,
        reasoningEffort: { override: null, effective: null },
      },
      smart: {
        override: null,
        codeDefault: PROVIDER_MODEL_TIERS.dsh.smart,
        effective: PROVIDER_MODEL_TIERS.dsh.smart,
        reasoningEffort: { override: null, effective: null },
      },
    });
  });

  describe("per-tier reasoning effort", () => {
    it("round-trips the new format and writes only non-blank fields", () => {
      const saved = writeKanbanModelTierSettings({
        fast: { model: "claude-haiku-5-5", reasoningEffort: "low" },
        balanced: { model: "", reasoningEffort: "" },
        smart: { reasoningEffort: " high " },
      });
      expect(saved).toEqual({ fast: { model: "claude-haiku-5-5", reasoningEffort: "low" }, smart: { reasoningEffort: "high" } });
      expect(readKanbanModelTierSettings()).toEqual(saved);
      const stored = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(stored.tiers).toEqual(saved);
      expect(typeof stored.updatedAt).toBe("string");
    });

    it("reads the legacy string-per-tier format as models only", () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ tiers: { fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" } }));
      expect(readKanbanModelTierSettings()).toEqual({
        fast: { model: "claude-haiku-5-5" },
        smart: { model: "claude-sonnet-5-5" },
      });
      expect(readKanbanModelTierOverrides()).toEqual({ fast: "claude-haiku-5-5", smart: "claude-sonnet-5-5" });
      expect(resolveTierModelForProvider("dsh", ModelTier.SMART)).toBe("claude-sonnet-5-5");
      expect(resolveTierReasoningEffortForProvider("dsh", ModelTier.SMART)).toBeUndefined();
    });

    it("drops invalid reasoning effort values", () => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ tiers: {
        fast: { model: "claude-haiku-5-5", reasoningEffort: "HIGH with spaces" },
        balanced: { reasoningEffort: 3 },
        smart: { reasoningEffort: "xhigh" },
      } }));
      expect(readKanbanModelTierSettings()).toEqual({
        fast: { model: "claude-haiku-5-5" },
        smart: { reasoningEffort: "xhigh" },
      });
    });

    it("saves a reasoning effort without a model", () => {
      writeKanbanModelTierSettings({ balanced: { reasoningEffort: "medium" } });
      expect(readKanbanModelTierSettings()).toEqual({ balanced: { reasoningEffort: "medium" } });
      expect(readKanbanModelTierOverrides()).toEqual({});
      expect(resolveTierModelForProvider("dsh", ModelTier.BALANCED)).toBe(PROVIDER_MODEL_TIERS.dsh.balanced);
      expect(describeKanbanModelTiers().balanced.reasoningEffort).toEqual({ override: "medium", effective: "medium" });
    });

    it("keeps the stored reasoning effort when only the models are rewritten", () => {
      writeKanbanModelTierSettings({ smart: { model: "claude-sonnet-5-5", reasoningEffort: "high" }, fast: { reasoningEffort: "low" } });
      writeKanbanModelTierOverrides({ smart: "claude-opus-5-5" });
      expect(readKanbanModelTierSettings()).toEqual({
        smart: { model: "claude-opus-5-5", reasoningEffort: "high" },
        fast: { reasoningEffort: "low" },
      });
      writeKanbanModelTierOverrides({});
      expect(readKanbanModelTierSettings()).toEqual({ smart: { reasoningEffort: "high" }, fast: { reasoningEffort: "low" } });
    });

    it("resolves the tier effort for dsh only", () => {
      writeKanbanModelTierSettings({ smart: { reasoningEffort: "high" } });
      expect(resolveTierReasoningEffortForProvider("dsh", ModelTier.SMART)).toBe("high");
      expect(resolveTierReasoningEffortForProvider("dsh", ModelTier.FAST)).toBeUndefined();
      expect(resolveTierReasoningEffortForProvider("dsh", undefined)).toBeUndefined();
      expect(resolveTierReasoningEffortForProvider("claude", ModelTier.SMART)).toBeUndefined();
      expect(resolveTierReasoningEffortForProvider("codex", ModelTier.SMART)).toBeUndefined();
    });
  });
});
