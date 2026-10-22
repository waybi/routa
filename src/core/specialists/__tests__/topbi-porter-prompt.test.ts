// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Locks the TopBI porter (kanban-topbi-porter) prompt: dev port, Gerrit dev submit,
// alpha deploy/replay, and auto-rollback, across the default, en, and zh-CN load paths.
const bundledRoot = path.join(process.cwd(), "resources", "specialists");
const loadPaths: Array<[string, string, string | undefined]> = [
  ["default", bundledRoot, undefined],
  ["en", path.join(bundledRoot, "locales", "en"), "en"],
  ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
];

function loadPrompt(dir: string, locale: string | undefined): string {
  const porter = loadSpecialistsFromDirectory(dir, "bundled", locale).find(
    (entry) => entry.id === "kanban-topbi-porter"
  );
  expect(porter).toBeDefined();
  return porter?.behaviorPrompt ?? "";
}

const DANGER_TOKENS = ["HEAD:master", "refs/for/master", "--force", "variableContext"];
const GUARD_WORDS = ["不许", "绝不", "禁止", "never", "do not", "must not"];

/**
 * Line-based guard check.
 * Rule: split the prompt into lines; a line is a violation when it contains any of
 * HEAD:master / refs/for/master / --force / variableContext AND the same line
 * (lower-cased) contains none of 不许 / 绝不 / 禁止 / never / do not / must not.
 * Dangerous tokens may only appear inside a prohibition sentence on the same line.
 */
function findUnguardedDangerLines(prompt: string): string[] {
  return prompt.split(/\r?\n/).filter((line) => {
    if (!DANGER_TOKENS.some((token) => line.includes(token))) return false;
    const lower = line.toLowerCase();
    return !GUARD_WORDS.some((word) => lower.includes(word));
  });
}

const REQUIRED_STRINGS = [
  "refs/for/dev",
  "gerrit review --code-review +2 --verified +1 --submit",
  "topbi_alpha_deploy.py deploy --json",
  "topbi_alpha_deploy.py last --json",
  "git cherry-pick --abort",
  "git revert",
  "可合 master",
  "/tmp/topbi-port-",
  "/tmp/routa-evidence/",
];

const SECTION_TITLES = [
  "前提",
  "移植",
  "逐个文件比对两边改动",
  "推 Gerrit dev 并 submit",
  "发 alpha 前取基线",
  "自动发 alpha",
  "alpha 验收",
  "自动回滚",
];

describe("kanban-topbi-porter prompt", () => {
  it.each(loadPaths)("contains the required commands and paths (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    for (const text of REQUIRED_STRINGS) {
      expect(prompt).toContain(text);
    }
  });

  it.each(loadPaths)("lists the 1-9 workflow with Chinese section titles (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    for (const title of SECTION_TITLES) {
      expect(prompt).toContain(title);
    }
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      expect(prompt).toMatch(new RegExp(`^\\s*${step}\\. `, "m"));
    }
  });

  it.each(loadPaths)("states the deploy exit-code contract (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    expect(prompt).toMatch(/退出码 0|exit code 0/i);
    expect(prompt).toMatch(/退出码 1|exit code 1/i);
    expect(prompt).toMatch(/2\/3/);
    expect(prompt).toMatch(/不回滚|do not roll back/i);
    expect(prompt).toMatch(/发 alpha 脚本未部署/);
  });

  it.each(loadPaths)("requires build/ artifacts when src/server/ changes (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    expect(prompt).toContain("src/server/");
    expect(prompt).toContain("build/");
  });

  it.each(loadPaths)("only mentions dangerous push/Bamboo tokens inside prohibitions (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    expect(findUnguardedDangerLines(prompt)).toEqual([]);
    // The prohibitions must actually be stated.
    expect(prompt).toContain("refs/for/master");
    expect(prompt).toContain("--force");
    expect(prompt).toContain("variableContext");
  });

  it("flags a dangerous line without a prohibition word (negative self-check)", () => {
    expect(findUnguardedDangerLines("git push --force origin HEAD:refs/for/dev")).toHaveLength(1);
    expect(findUnguardedDangerLines("Never run git push --force.")).toEqual([]);
    expect(findUnguardedDangerLines("绝不推 HEAD:master")).toEqual([]);
  });
});
