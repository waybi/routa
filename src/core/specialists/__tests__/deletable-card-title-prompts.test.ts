// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Owner request 2026-10-30 (card e5a5ec48): a superseded card that the Done gate
// keeps in Blocked should say in its title that it can be deleted.
const root = path.join(process.cwd(), "resources", "specialists");
const paths: Array<[string, string, string | undefined]> = [
  ["default", root, undefined],
  ["en", path.join(root, "locales", "en"), "en"],
  ["zh-CN", path.join(root, "locales", "zh-CN"), "zh-CN"],
];

describe.each(paths)("blocked-resolver deletable title prefix (%s)", (_label, dir, locale) => {
  const prompt =
    loadSpecialistsFromDirectory(dir, "bundled", locale).find(
      (entry) => entry.id === "kanban-blocked-resolver",
    )?.behaviorPrompt ?? "";

  it("adds the title prefix only after the three proofs", () => {
    expect(prompt).toContain("【可以直接删除】");
    expect(prompt).toContain('{"title":"【可以直接删除】');
    expect(prompt).toMatch(/git log --oneline origin\/<(分支|branch)>\.\.<(卡分支|card branch)>/u);
    expect(prompt).toContain("git merge-base --is-ancestor <ref>");
    expect(prompt).toMatch(/api\/tasks\?workspaceId=/u);
    expect(prompt).toContain("dependencies");
  });

  it("keeps the no-delete red line and scopes the title exception", () => {
    expect(prompt).toContain("[redline:no-delete-card]");
    expect(prompt).not.toContain("不改卡片标题和原始描述");
    expect(prompt).not.toContain("Do not modify the card title, the original description");
  });
});
