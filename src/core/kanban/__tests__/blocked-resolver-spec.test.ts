// @vitest-environment node
/**
 * Card 64f2e31c (AC3, AC6, C6): the three blocked-resolver yaml files
 * (root, locales/zh-CN, locales/en) carry the same id / role / model tier,
 * the same 8 categories and the same red lines; the three main-pusher files
 * all record-only when the resolver concluded landed / superseded. Inline
 * broken copies prove the check turns red.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { TASK_ATTENTION_RESOLUTION_CATEGORIES } from "@/core/models/task-attention-resolution";

const ROOT = path.resolve(__dirname, "../../../../resources/specialists");
const VARIANTS = ["workflows/kanban", "locales/zh-CN/workflows/kanban", "locales/en/workflows/kanban"];

const RESOLVER_CATEGORIES = [
  "landed", "superseded", "push_conflict", "baseline_failure", "own_failure", "missing_report", "environment", "needs_owner",
];
const RESOLVER_REDLINES = [
  "max-rounds-2", "max-new-cards-2", "no-force-push", "no-reset-hard", "no-delete-card",
  "no-delete-worktree", "no-column-config-change", "no-other-card-code",
];

interface SpecialistDoc {
  id?: string;
  role?: string;
  model_tier?: string;
  modelTier?: string;
  system_prompt?: string;
}

function load(text: string): SpecialistDoc {
  return yaml.load(text) as SpecialistDoc;
}

function read(variant: string, file: string): string {
  return readFileSync(path.join(ROOT, variant, file), "utf8");
}

const tags = (prompt: string, kind: string) =>
  Array.from(prompt.matchAll(new RegExp(`\\[${kind}:([a-z0-9_-]+)\\]`, "gu")), (match) => match[1]);

/** Problems with a set of resolver files; empty when they agree with the card's table. */
function resolverSpecProblems(docs: SpecialistDoc[]): string[] {
  const problems: string[] = [];
  const identity = docs.map((doc) => `${doc.id}|${doc.role}|${doc.model_tier ?? doc.modelTier}`);
  if (new Set(identity).size !== 1) problems.push(`identity differs: ${identity.join(" / ")}`);
  docs.forEach((doc, index) => {
    const prompt = doc.system_prompt ?? "";
    const categories = tags(prompt, "category");
    if (JSON.stringify([...categories].sort()) !== JSON.stringify([...RESOLVER_CATEGORIES].sort())) {
      problems.push(`file ${index}: categories ${categories.join(",")}`);
    }
    const redlines = tags(prompt, "redline");
    if (JSON.stringify([...redlines].sort()) !== JSON.stringify([...RESOLVER_REDLINES].sort())) {
      problems.push(`file ${index}: red lines ${redlines.join(",")}`);
    }
    for (const category of TASK_ATTENTION_RESOLUTION_CATEGORIES) {
      if (!prompt.includes(`category=${category}`) && category !== "needs_owner") problems.push(`file ${index}: no PATCH for ${category}`);
    }
    if (!/## (自动处理记录|Auto Resolution Record)/u.test(prompt)) problems.push(`file ${index}: no record heading`);
  });
  return problems;
}

describe("blocked-resolver yaml (C6)", () => {
  const texts = VARIANTS.map((variant) => read(variant, "blocked-resolver.yaml"));
  const docs = texts.map(load);

  it("the three files agree with the card's category table and red lines", () => {
    expect(resolverSpecProblems(docs)).toEqual([]);
    expect(docs[0]).toMatchObject({ id: "kanban-blocked-resolver", role: "CRAFTER" });
  });

  it("the record has the five fixed sections in every language", () => {
    const zh = docs[1].system_prompt ?? "";
    for (const title of ["卡在哪", "判断", "做了什么", "结果核对", "没做什么、为什么"]) expect(zh).toContain(`### ${title}`);
    for (const doc of [docs[0], docs[2]]) {
      for (const title of ["Where it is stuck", "Judgement", "What was done", "Result check", "What was not done and why"]) {
        expect(doc.system_prompt).toContain(`### ${title}`);
      }
    }
  });

  it("the environment category checks the gateway first and never sleeps (C14)", () => {
    expect(docs[1].system_prompt).toMatch(/最近 10 分钟[\s\S]*不要用 sleep/u);
    for (const doc of [docs[0], docs[2]]) expect(doc.system_prompt).toMatch(/last 10 minutes[\s\S]*Never sleep/u);
  });

  it("backfilled reports go through MCP update_card, not REST PATCH comment (C16)", () => {
    expect(docs[1].system_prompt).toMatch(/MCP `update_card` 补写首行为 `## 完成汇报`/u);
    for (const doc of [docs[0], docs[2]]) expect(doc.system_prompt).toMatch(/never use the REST PATCH `comment` field/u);
  });

  it("patch cards cherry-pick and keep the original verification (C17)", () => {
    for (const doc of docs) {
      expect(doc.system_prompt).toContain("git cherry-pick <");
      expect(doc.system_prompt).toMatch(/git diff --quiet issue\/</u);
      expect(doc.system_prompt).toContain("search_cards");
    }
  });

  it("turns red when one file loses a category or changes its model tier", () => {
    const dropped = texts[1].replace("[category:superseded]", "");
    expect(resolverSpecProblems([docs[0], load(dropped), docs[2]])).toEqual([expect.stringContaining("file 1: categories")]);
    const retiered = texts[2].replace('modelTier: "smart"', 'modelTier: "fast"');
    expect(resolverSpecProblems([docs[0], docs[1], load(retiered)])).toEqual([expect.stringContaining("identity differs")]);
  });
});

describe("main-pusher yaml (C6, AC6)", () => {
  const docs = VARIANTS.map((variant) => load(read(variant, "main-pusher.yaml")));

  it("all three skip the push when attentionResolution is landed or superseded", () => {
    for (const doc of docs) {
      expect(doc.system_prompt).toContain("[attention-resolution-skip]");
      expect(doc.system_prompt).toContain("attentionResolution.category");
      expect(doc.system_prompt).toMatch(/`landed`[\s\S]*`superseded`/u);
    }
    expect(docs[1].system_prompt).toContain("只记录不推送");
    expect(new Set(docs.map((doc) => `${doc.id}|${doc.role}|${doc.model_tier ?? doc.modelTier}`)).size).toBe(1);
  });
});
