// @vitest-environment node
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Locks the verify-stamp prompt rules (card 907633bf) into all three load paths
// (default / locales/en / locales/zh-CN) for the three roles that use it (dev-executor,
// flight-dev-executor, main-pusher). The two review roles run card commands for real
// (card 4fdb7cd2): the reviewer's re-run is an independent check, no verify-stamp.
const bundledRoot = path.join(process.cwd(), "resources", "specialists");
type LoadPath = [label: string, dir: string, locale: string | undefined];
const loadPaths: LoadPath[] = [
  ["default", bundledRoot, undefined],
  ["en", path.join(bundledRoot, "locales", "en"), "en"],
  ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
];

const reviewers = ["kanban-review-guard", "kanban-flight-review-guard"];
const pusher = "kanban-main-pusher";
const devs = ["kanban-dev-executor", "kanban-flight-dev-executor"];
const allRoles = [pusher, ...devs];

function loadPrompt(dir: string, locale: string | undefined, id: string): string {
  const specialist = loadSpecialistsFromDirectory(dir, "bundled", locale).find((entry) => entry.id === id);
  expect(specialist).toBeDefined();
  return specialist?.behaviorPrompt ?? "";
}

const isZh = (label: string) => label === "zh-CN";
const cases = (ids: string[]) =>
  ids.flatMap((id) => loadPaths.map(([label, dir, locale]) => [id, label, dir, locale] as const));

describe("verify-stamp wrapper rules (AC1, AC5, F4)", () => {
  it.each(cases(allRoles))("%s (%s) wraps card commands with fallback and disable prefix", (id, label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, id);
    expect(prompt).toContain("verify-stamp run --");
    expect(prompt).toContain("command -v verify-stamp");
    expect(prompt).toContain("VERIFY_STAMP_DISABLE=1");
    expect(prompt).toContain(isZh(label) ? "原命令文字一字不改" : "original command text unchanged");
    expect(prompt).toContain(isZh(label) ? "自然真跑" : "for real by itself");
  });

  it.each(cases(allRoles))("%s (%s) hands shell-syntax commands to bash -c or runs them directly", (id, label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, id);
    expect(prompt).toContain("verify-stamp run -- bash -c '<");
    expect(prompt).toContain(isZh(label) ? "verify-stamp 不经 shell 执行参数" : "verify-stamp runs its arguments without a shell");
  });

  it.each(cases(allRoles))("%s (%s) never instructs adding --no-reuse", (id, _label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, id);
    for (const line of prompt.split("\n").filter((l) => l.includes("--no-reuse"))) {
      expect(line).toMatch(/Never add `--no-reuse`|不加 --no-reuse|不用给卡上命令加 --no-reuse/);
    }
  });

  it.each(cases([pusher]))("%s (%s) keeps the record format and explains reuse", (id, label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, id);
    expect(prompt).toContain(
      isZh(label)
        ? "`<命令>` → 退出码 <code> → <关键输出一行>"
        : "`<cmd>` → exit <code> → <one key output line>",
    );
    expect(prompt).toContain(isZh(label) ? "关键输出填 verify-stamp 打印的「复用 …」那一行" : "line it printed that starts with 「复用 …」");
  });
});

describe("flight-review-guard fixed commands and real runs (AC1, AC3, C4, C6)", () => {
  const id = "kanban-flight-review-guard";

  it.each(loadPaths)("fixed verification commands are re-run verbatim, no verify-stamp (%s)", (label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, id);
    const line = prompt.split("\n").find((l) => l.includes("本项目固定验收命令") && l.includes("verificationCommands"));
    expect(line, "fixed-commands line must exist").toBeDefined();
    expect(line).not.toContain("verify-stamp run --");
    expect(line).toContain(isZh(label) ? "原样复跑" : "verbatim");
  });

  it.each(loadPaths)("revert, regression, spot-check and --mutate run for real (%s)", (label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, id);
    expect(prompt).toContain("--mutate");
    const realLine = prompt.split("\n").find((l) => l.includes("--mutate"));
    expect(realLine).toBeDefined();
    expect(realLine).toContain(isZh(label) ? "不经 verify-stamp" : "not through verify-stamp");
    for (const word of isZh(label) ? ["撤掉实现", "回归题", "抽查"] : ["reverting the implementation", "regression", "spot-check"]) {
      expect(realLine).toContain(word);
    }
    expect(prompt).not.toMatch(/reuse.*skip (a )?fail|复用后可跳过失败/i);
  });

  it.each(cases(reviewers))("%s (%s) re-runs card commands only on a clean tree, before the revert", (rid, label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, rid);
    const rule = isZh(label) ? "卡上命令放在撤掉实现之前跑" : "Run the card commands before you revert the implementation";
    const at = prompt.indexOf(rule);
    expect(at).toBeGreaterThan(-1);
    expect(prompt.slice(at, at + 200)).toContain("git status --short");
    if (rid === "kanban-flight-review-guard") {
      const revert = prompt.indexOf(isZh(label) ? "自己撤掉实现验红" : "### Revert the implementation yourself");
      expect(revert).toBeGreaterThan(at);
    }
  });
});

describe("reviewers run card commands for real (card 4fdb7cd2)", () => {
  it.each(cases(reviewers))("%s (%s) has no verify-stamp wrapper and states the independent re-check", (id, label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, id);
    expect(prompt).not.toContain("verify-stamp run --");
    expect(prompt).not.toContain("--no-reuse");
    expect(prompt).toContain(isZh(label) ? "评审重跑是独立复查" : "the reviewer's re-run is an independent check");
    expect(prompt).toContain("git status --short");
    expect(prompt).toContain(
      isZh(label)
        ? "`<命令>` → 退出码 <code> → <关键输出一行>"
        : "`<cmd>` → exit <code> → <one key output line>",
    );
  });
});

describe("flight-dev-executor reverted run (C4)", () => {
  it.each(loadPaths)("the reverted run is not through verify-stamp (%s)", (label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-flight-dev-executor");
    const line = prompt.split("\n").find((l) => l.includes("撤掉实现") && /not through verify-stamp|不经 verify-stamp/.test(l));
    expect(line).toBeDefined();
    expect(line).toContain(isZh(label) ? "不经 verify-stamp" : "not through verify-stamp");
  });
});

describe("dev roles pre-run the card commands before review (AC4, C5, C12)", () => {
  it.each(cases(devs))("%s (%s) fetches commands read-only and pre-runs them", (id, label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, id);
    const marker = isZh(label) ? "送审前预跑卡上命令" : "### Pre-run the card's verificationCommands";
    const start = prompt.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const end = isZh(label)
      ? prompt.indexOf("\n\n", start)
      : prompt.indexOf("\n\n", start);
    const section = prompt.slice(start, end);
    for (const text of [
      ".task.verificationCommands",
      "sqlite3 -readonly",
      "verify-stamp run --",
      "command -v verify-stamp",
      "VERIFY_STAMP_DISABLE=1",
      "git status --short",
    ]) {
      expect(section).toContain(text);
    }
    expect(section).not.toMatch(/-X (PATCH|POST)/);
    expect(section).toContain(isZh(label) ? "为空或没有这个字段时跳过" : "empty or missing field), skip this step");
    // The step sits before the move to review.
    const anchor = isZh(label)
      ? prompt.indexOf(id === "kanban-flight-dev-executor" ? "出口闸门追加自查：" : "完成后：")
      : prompt.indexOf("Only after all checks pass: call `move_card`");
    expect(anchor).toBeGreaterThan(start);
  });
});

describe("F3: verify-stamp appears in exactly the three roles x three languages", () => {
  const dirs = [
    path.join(bundledRoot, "workflows", "kanban"),
    path.join(bundledRoot, "locales", "en", "workflows", "kanban"),
    path.join(bundledRoot, "locales", "zh-CN", "workflows", "kanban"),
  ];
  const expected = new Set(["main-pusher", "dev-executor", "flight-dev-executor"]);
  const reviewYaml = ["review-guard", "flight-review-guard"];

  it("only the 9 targeted yaml files contain `verify-stamp run --`", () => {
    for (const dir of dirs) {
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
        const has = fs.readFileSync(path.join(dir, file), "utf-8").includes("verify-stamp run --");
        expect(has, `${dir}/${file}`).toBe(expected.has(file.replace(/\.yaml$/, "")));
      }
      for (const name of [...expected, ...reviewYaml]) expect(fs.existsSync(path.join(dir, `${name}.yaml`))).toBe(true);
    }
  });
});
