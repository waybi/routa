// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Card 7fbfba57: the nine roles that can block a card must ask for the two-line
// block message ("阻塞原因：…" + "不用你管：/要你定：…") in every language path.
const root = path.join(process.cwd(), "resources", "specialists");
const SAMPLES = [
  "阻塞原因：上线前有一项老检查没过，不是这张卡的问题",
  "不用你管：AI 正在修这项检查，修好后这张卡自动上线。",
  "阻塞原因：改的代码和别人刚上线的改动冲突了",
  "要你定：先撤掉别人的改动，还是等它合并完再上",
];
const ZH = ["阻塞原因：", "不用你管：", "要你定：", "40", ...SAMPLES];
const EN = ["Blocked because:", "No action needed:", "You decide:", ...SAMPLES];
const paths: Array<[string, string, string | undefined, string[]]> = [
  ["default", root, undefined, [...ZH, ...EN]],
  ["en", path.join(root, "locales", "en"), "en", EN],
  ["zh-CN", path.join(root, "locales", "zh-CN"), "zh-CN", ZH],
];
const ROLES = [
  "kanban-main-pusher",
  "kanban-blocked-resolver",
  "kanban-dev-executor",
  "kanban-flight-dev-executor",
  "kanban-topbi-porter",
  "kanban-review-guard",
  "kanban-flight-review-guard",
  "kanban-high-risk-reviewer",
  "kanban-qa-frontend",
];
const REVIEW_ROLES = ROLES.filter((id) => /review|qa-frontend/u.test(id));

describe.each(paths)("block message prompts (%s)", (_label, dir, locale, needles) => {
  const all = loadSpecialistsFromDirectory(dir, "bundled", locale);
  const promptOf = (id: string) => all.find((entry) => entry.id === id)?.behaviorPrompt ?? "";
  it.each(ROLES)("%s asks for the two lines and not the older one-line form", (id) => {
    const prompt = promptOf(id);
    expect(prompt).not.toBe("");
    for (const needle of needles) expect(prompt).toContain(needle);
    expect(prompt).not.toContain("｜需要你定");
    expect(prompt).not.toContain("Needs your decision");
  });
  it.each(REVIEW_ROLES)("%s keeps the review-bounce first-line exception", (id) => {
    expect(promptOf(id)).toContain("【评审打回 第 N 次】");
  });
  it("blocked-resolver updates the comment head when the card stays Blocked", () => {
    const prompt = promptOf("kanban-blocked-resolver");
    expect(prompt).toMatch(locale === "en" ? /still stays in Blocked/u : /仍留在 Blocked/u);
  });
  it("topbi-porter adds no card-moving action in the new section", () => {
    const prompt = promptOf("kanban-topbi-porter");
    const section = prompt.slice(prompt.search(/挡卡留言前两行|Block message first two lines/u));
    expect(section).not.toMatch(/move_card\(|调用 `?move_card/u);
  });
});
