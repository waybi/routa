// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Locks the TopBI porter (kanban-topbi-porter) prompt: dev port, GitLab dev push
// (fast-forward HEAD:dev + ls-remote check), alpha deploy/replay, auto-rollback, and the
// `## 移植失败` failure exit (no move_card in Done), across the default, en, and zh-CN load paths.
const bundledRoot = path.join(process.cwd(), "resources", "specialists");
const loadPaths: Array<[string, string, string | undefined]> = [
  ["default", bundledRoot, undefined],
  ["en", path.join(bundledRoot, "locales", "en"), "en"],
  ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
];

function loadPrompt(dir: string, locale: string | undefined, id = "kanban-topbi-porter"): string {
  const specialist = loadSpecialistsFromDirectory(dir, "bundled", locale).find(
    (entry) => entry.id === id
  );
  expect(specialist).toBeDefined();
  return specialist?.behaviorPrompt ?? "";
}

const DANGER_TOKENS = [
  "HEAD:master",
  "refs/for/master",
  "--force",
  "variableContext",
  "gerrit",
  "move_card",
];
const GUARD_WORDS = ["不许", "绝不", "禁止", "never", "do not", "must not"];

/**
 * Line-based guard check.
 * Rule: split the prompt into lines; a line is a violation when it contains any of
 * HEAD:master / refs/for/master / --force / variableContext / gerrit / move_card
 * (case-insensitive, so `Gerrit` counts) AND the same line (lower-cased) contains none of
 * 不许 / 绝不 / 禁止 / never / do not / must not.
 * Dangerous tokens may only appear inside a prohibition sentence on the same line.
 */
function findUnguardedDangerLines(prompt: string): string[] {
  return prompt.split(/\r?\n/).filter((line) => {
    const lower = line.toLowerCase();
    if (!DANGER_TOKENS.some((token) => lower.includes(token.toLowerCase()))) return false;
    return !GUARD_WORDS.some((word) => lower.includes(word));
  });
}

const REQUIRED_STRINGS = [
  "git fetch origin dev",
  "git push origin HEAD:dev",
  "git ls-remote origin refs/heads/dev",
  "git rev-parse HEAD",
  "## 移植失败",
  "可合 master：否",
  "dev 提交号",
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
  "推 GitLab dev",
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
    expect(findUnguardedDangerLines("git push gerrit HEAD:dev")).toHaveLength(1);
    expect(findUnguardedDangerLines("Push to Gerrit dev")).toHaveLength(1);
    expect(findUnguardedDangerLines("call move_card to blocked")).toHaveLength(1);
    expect(findUnguardedDangerLines("绝不调用 move_card")).toEqual([]);
  });

  it.each(loadPaths)("no longer mentions Gerrit push/review or a Done-lane move to blocked (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    for (const text of ["refs/for/dev", "gerrit review", "gerrit query", 'targetColumnId: "blocked"', "Change-Id"]) {
      expect(prompt).not.toContain(text);
    }
  });
});

// Alpha replay on every card (topbi_alpha_replay.py capture/compare) and the frontend
// rebuild of build/public on dev (topbi_dev_build_client.sh), card 537676a9.
const REPLAY_AND_REBUILD_STRINGS = [
  "topbi_alpha_replay.py capture",
  "topbi_alpha_replay.py compare",
  "topbi_dev_build_client.sh",
  "回放脚本未部署",
  "alpha 回放：未做（回放脚本未部署）",
  "alpha 发版前回放失败，见 index.json",
  "前端重编",
  "alpha-before",
  "alpha-after",
  "alpha-requests.json",
  "--requests",
  "git diff --name-only origin/dev..HEAD",
  "src/client/",
  "src/common/",
  "assets/",
  "config/webpack",
  "package.json",
  "package-lock.json",
  "git add build/public",
  "build: 重编前端产物",
  "前端产物无变化",
  "build/public/",
  "预期变化",
  "前端重编：",
  "alpha 回放：",
  "缺 alpha 回放",
  "^..HEAD",
];

/**
 * Line-based check: TOPBI_ALPHA_BASE_URL may only appear as an optional override of the
 * alpha address, never as a precondition for replaying. A line mentioning it is a violation
 * unless the same line (lower-cased) contains 覆盖 or override.
 */
function findBaseUrlPreconditionLines(prompt: string): string[] {
  return prompt.split(/\r?\n/).filter((line) => {
    if (!line.includes("TOPBI_ALPHA_BASE_URL")) return false;
    const lower = line.toLowerCase();
    return !lower.includes("覆盖") && !lower.includes("override");
  });
}

describe("kanban-topbi-porter alpha replay and frontend rebuild", () => {
  it.each(loadPaths)("contains the replay and rebuild commands and fixed strings (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    for (const text of REPLAY_AND_REBUILD_STRINGS) {
      expect(prompt).toContain(text);
    }
  });

  it.each(loadPaths)("no longer requires TOPBI_ALPHA_BASE_URL before replaying (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    expect(findBaseUrlPreconditionLines(prompt)).toEqual([]);
    expect(prompt).not.toContain("TOPBI_ALPHA_BASE_URL` 已配置");
    expect(prompt).not.toContain("is set and reachable");
    expect(prompt).not.toContain("含回放做了且一致");
    expect(prompt).not.toContain("including a replay that was done and matched");
  });

  it("flags TOPBI_ALPHA_BASE_URL used as a precondition (negative self-check)", () => {
    expect(findBaseUrlPreconditionLines("环境变量 TOPBI_ALPHA_BASE_URL 已配置才回放")).toHaveLength(1);
    expect(findBaseUrlPreconditionLines("TOPBI_ALPHA_BASE_URL 仅用于覆盖 alpha 地址")).toEqual([]);
    expect(findBaseUrlPreconditionLines("TOPBI_ALPHA_BASE_URL may Override the alpha URL")).toEqual([]);
  });

  it.each(loadPaths)("places the frontend rebuild inside step 3, before the step 4 push (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    const step3 = prompt.search(/^\s*3\. /m);
    const step4 = prompt.search(/^\s*4\. /m);
    const rebuild = prompt.search(/^\s+- \*\*前端重编/m);
    expect(step3).toBeGreaterThanOrEqual(0);
    expect(rebuild).toBeGreaterThan(step3);
    expect(rebuild).toBeLessThan(step4);
  });

  it.each(loadPaths)("never force-adds build/public (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    expect(prompt).not.toContain("git add -f");
    expect(prompt).not.toContain("git add --force");
  });
});

describe("kanban-done-reporter TopBI port failure rule", () => {
  it.each(loadPaths)("copies the `## 移植失败` verdict line into the report (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-done-reporter");
    expect(prompt).toContain("## 移植失败");
    expect(prompt).toContain("可合 master：否");
  });
});
