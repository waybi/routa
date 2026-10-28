// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Card 7fbfba57: the four Review roles must ask for the one-line block summary
// ("阻塞原因：…｜需要你定：…") in every language path.
const root = path.join(process.cwd(), "resources", "specialists");
const paths: Array<[string, string, string | undefined, string[]]> = [
  ["default", root, undefined, ["阻塞原因：", "需要你定：", "Blocked because:", "Needs your decision:"]],
  ["en", path.join(root, "locales", "en"), "en", ["Blocked because:", "Needs your decision:"]],
  ["zh-CN", path.join(root, "locales", "zh-CN"), "zh-CN", ["阻塞原因：", "需要你定：", "无，AI 会自行处理"]],
];
const ROLES = ["kanban-review-guard", "kanban-flight-review-guard", "kanban-high-risk-reviewer", "kanban-qa-frontend"];

describe.each(paths)("block summary line prompts (%s)", (_label, dir, locale, needles) => {
  const all = loadSpecialistsFromDirectory(dir, "bundled", locale);
  it.each(ROLES)("%s asks for the summary line", (id) => {
    const prompt = all.find((entry) => entry.id === id)?.behaviorPrompt ?? "";
    expect(prompt).not.toBe("");
    for (const needle of needles) expect(prompt).toContain(needle);
    expect(prompt).toContain("BLOCKED");
  });
});
