// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Locks the flight checklist roles onto the knowledge-base resolver (flight_resolve.py):
// no hard-coded repository → experience-pack mapping, no "path contains topbi" push skip,
// across the default, en and zh-CN load paths.
const bundledRoot = path.join(process.cwd(), "resources", "specialists");
const loadPaths: Array<[string, string, string | undefined]> = [
  ["default", bundledRoot, undefined],
  ["en", path.join(bundledRoot, "locales", "en"), "en"],
  ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
];

const RESOLVER = "python3 ~/Desktop/my/knowledge-system/tools/flight_resolve.py --card <完整卡号>";
const CARD_ROLES = ["kanban-contract-setter", "kanban-todo-orchestrator", "kanban-flight-review-guard", "kanban-high-risk-reviewer"];

function load(dir: string, locale: string | undefined, id: string) {
  const specialist = loadSpecialistsFromDirectory(dir, "bundled", locale).find((entry) => entry.id === id);
  expect(specialist, `${id} in ${dir}`).toBeDefined();
  return specialist!;
}

const prompt = (dir: string, locale: string | undefined, id: string) => load(dir, locale, id).behaviorPrompt ?? "";

describe.each(loadPaths)("flight_resolve.py prompts (%s)", (label, dir, locale) => {
  const zh = label === "zh-CN";

  it("the four card roles call the resolver and carry no repository → pack mapping", () => {
    for (const id of [...CARD_ROLES, "kanban-main-pusher"]) {
      const text = prompt(dir, locale, id);
      if (id !== "kanban-main-pusher") expect(text, id).toContain(RESOLVER);
      expect(text, id).not.toMatch(/routa ?→ ?routa|topbi \/ plywood_go ?→ ?topbi/);
      if (id !== "kanban-main-pusher") expect(text, id).toContain("要读的经验包");
    }
  });

  it("contract setter copies the 标准来源 line first and stays in Todo when the resolver fails", () => {
    const text = prompt(dir, locale, "kanban-contract-setter");
    expect(text).toContain("标准来源：");
    expect(text).toContain("## 验收契约（出题人）");
    expect(text).not.toContain("情况表缺失");
    expect(text).toContain("从解析器输出的事故表");
    expect(text).toContain("项目未登记");
    expect(text).toMatch(zh ? /命令退出码非 0：在评论里贴报错原文，卡留在 Todo/ : /exits non-zero.*paste the error text verbatim in a card comment and leave the card in Todo/);
  });

  it("todo orchestrator still adds packs by triggers.json keywords", () => {
    expect(prompt(dir, locale, "kanban-todo-orchestrator")).toContain("triggers.json");
  });

  it("review guard records a changed 标准来源 without rejecting and re-runs the project's fixed commands", () => {
    const text = prompt(dir, locale, "kanban-flight-review-guard");
    expect(text).toContain("标准来源变了：契约 X，现在 Y");
    expect(text).toMatch(zh ? /只记录，不因此打回/ : /Only record it; do not reject the card for this/);
    expect(text).toContain("本项目固定验收命令");
    expect(text).toContain("高危护栏");
  });

  it("review guard judges ACs by the structured-field section of the prompt", () => {
    const text = prompt(dir, locale, "kanban-flight-review-guard");
    expect(text).toContain("## Acceptance Criteria（结构化字段，评审以此为准）");
    expect(text).toContain(zh ? "不能判为笔误" : "never call a missing AC a typo");
    expect(text).toContain(zh ? "不能只写契约编号" : "never write only contract ids");
    expect(text).toContain("✅/❌");
  });

  it("review guard checks the contract against the resolver's 审题 section and reports it on pass", () => {
    const text = prompt(dir, locale, "kanban-flight-review-guard");
    expect(text).toContain("## 审题（评审守卫）");
    expect(text).toContain("## 验收契约（出题人）");
    expect(text).toMatch(zh ? /解析器无审题节`，不因此打回/ : /解析器无审题节` in Review Findings\. Do not reject the card for this\./);
    expect(text).toMatch(zh ? /计入打回次数/ : /it counts as a rejection/);
    expect(text).toMatch(zh ? /含「高风险：」行、「审题：」结果行/ : /the `审题：…` result line/);
  });

  it("main pusher skips by resolver delivery and falls back to the gerrit remote check", () => {
    const text = prompt(dir, locale, "kanban-main-pusher");
    expect(text).toContain(`${RESOLVER} --format json`);
    expect(text).toContain("`delivery`");
    expect(text).toContain(
      zh
        ? "主干推送已跳过：本项目交付方式是 <delivery>，按该方式交付。"
        : "Mainline push skipped: this project delivers via <delivery>; deliver through that path.",
    );
    expect(text).toMatch(/gerrit.*:29418/);
    expect(text).not.toMatch(/路径含 `?topbi|path contains `topbi`/i);
  });
});

describe("role metadata is identical across the three files", () => {
  it.each([...CARD_ROLES, "kanban-main-pusher"])("%s", (id) => {
    const [base, ...locales] = loadPaths.map(([, dir, locale]) => load(dir, locale, id));
    for (const other of locales) {
      const meta = (entry: typeof other) => ({ id: entry.id, role: entry.frontmatter.role, modelTier: entry.frontmatter.modelTier });
      expect(meta(other)).toEqual(meta(base!));
      expect(meta(base!).modelTier).toBeTruthy();
    }
  });
});
