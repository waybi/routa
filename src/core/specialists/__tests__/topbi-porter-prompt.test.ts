// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Locks the TopBI porter (kanban-topbi-porter) prompt: local Go two-instance replay on the card
// branch (topbi_local_replay.py run), the exit-code handling, the `## 本机回放验收` success report,
// the `## 移植失败` failure exit (no move_card in Done), and that no dev/alpha/push flow is left,
// across the default, en, and zh-CN load paths.
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
  "topbi_local_replay.py run",
  "--topbi-base origin/master",
  "--control spend-x2",
  "--workdir /tmp/routa-evidence/",
  "local-replay",
  "test -f",
  "run_in_background",
  "40",
  "## 移植失败",
  "可合 master：否",
  "可合 master：是",
  "可合 master：否（缺本机回放：",
  "## 本机回放验收",
  "本机回放：一致",
  "本机回放：预期变化（",
  "本机回放：未做（回放脚本未部署）",
  "本机回放：未做（参数错）",
  "/plywood",
  "探针",
  "/tmp/routa-evidence/",
];

const SECTION_TITLES = ["前提", "本机回放", "结果处理", "写报告", "全程不做"];

// Old dev/alpha/rollback flow words that must be gone (card 5cf1e338).
const REMOVED_STRINGS = [
  "HEAD:dev",
  "topbi_alpha_deploy.py deploy",
  "alpha-before",
  "alpha-after",
  "topbi_alpha_replay.py",
  "TOPBI_ALPHA_BASE_URL",
  "topbi_dev_build_client.sh",
  "alpha 回放：",
  "## 移植与 alpha 验收",
  "origin/dev",
  "git cherry-pick",
  "git revert",
  "/tmp/topbi-port-",
  "git push origin",
  "回滚",
  "git add build/public",
];

describe("kanban-topbi-porter prompt", () => {
  it.each(loadPaths)("contains the required commands and paths (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    for (const text of REQUIRED_STRINGS) {
      expect(prompt).toContain(text);
    }
  });

  it.each(loadPaths)("lists the 1-5 workflow with Chinese section titles (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    for (const title of SECTION_TITLES) {
      expect(prompt).toContain(title);
    }
    for (const step of [1, 2, 3, 4, 5]) {
      expect(prompt).toMatch(new RegExp(`^\\s*${step}\\. `, "m"));
    }
  });

  it.each(loadPaths)("states the replay exit-code contract (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    for (const code of [0, 1, 2, 3]) {
      expect(prompt).toMatch(new RegExp(`退出码 ${code}|exit code ${code}`, "i"));
    }
    expect(prompt).toMatch(/回放超时/);
  });

  it.each(loadPaths)("never marks a missing replay as mergeable (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    expect(prompt).toMatch(/绝不写「是」|never write 「是」/);
  });

  it.each(loadPaths)("only mentions dangerous push/Bamboo tokens inside prohibitions (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    expect(findUnguardedDangerLines(prompt)).toEqual([]);
    // The prohibitions must actually be stated.
    expect(prompt).toContain("refs/for/master");
    expect(prompt).toContain("--force");
    expect(prompt).toContain("variableContext");
    expect(prompt).toMatch(/绝不 push 任何远端|never push to any remote/i);
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

describe("kanban-topbi-porter local replay (no dev port, no alpha)", () => {
  it.each(loadPaths)("drops the old dev/alpha/rollback flow words (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    for (const text of REMOVED_STRINGS) {
      expect(prompt).not.toContain(text);
    }
  });

  it.each(loadPaths)("keeps one identical replay command and checks the script first (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale);
    const script = "/Users/ouweibing/Desktop/topgames_work/local-tools/tools/topbi-alpha-deploy/topbi_local_replay.py";
    expect(prompt).toContain(`test -f ${script}`);
    expect(prompt.indexOf("test -f")).toBeLessThan(prompt.indexOf(`${script} run`));
    expect(prompt).toMatch(/--topbi-new <(卡分支 HEAD|card branch HEAD)> --control spend-x2/);
  });

  it.each(loadPaths)("frames description and role reminder as local replay (%s)", (_label, dir, locale) => {
    const specialist = loadSpecialistsFromDirectory(dir, "bundled", locale).find(
      (entry) => entry.id === "kanban-topbi-porter"
    );
    const text = `${specialist?.frontmatter.description ?? ""}\n${specialist?.frontmatter.roleReminder ?? ""}`;
    expect(text).toMatch(/本机回放|local replay/i);
    expect(text).not.toMatch(/alpha/i);
    expect(text).not.toContain("HEAD:dev");
  });
});

describe("kanban-done-reporter TopBI port failure rule", () => {
  it.each(loadPaths)("copies the `## 移植失败` verdict line into the report (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-done-reporter");
    expect(prompt).toContain("## 移植失败");
    expect(prompt).toContain("可合 master：否");
  });
});
