// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Locks how the lanes after the Designer use `## Design Spec` (card 143cfbed, 2026-10-26)
// into all three load paths. Reword the prompts and these assertions together.
const bundledRoot = path.join(process.cwd(), "resources", "specialists");
const loadPaths: Array<[string, string, string | undefined]> = [
  ["default", bundledRoot, undefined],
  ["en", path.join(bundledRoot, "locales", "en"), "en"],
  ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
];
const NOT_APPLICABLE_LINE = "不适用：改动文件里没有页面、组件或样式";

function loadPrompt(dir: string, locale: string | undefined, id: string): string {
  const specialist = loadSpecialistsFromDirectory(dir, "bundled", locale).find((entry) => entry.id === id);
  expect(specialist, id).toBeDefined();
  return specialist?.behaviorPrompt ?? "";
}

describe("kanban-contract-setter turns a Design Spec into contract items", () => {
  it.each(loadPaths)("%s", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-contract-setter");
    expect(prompt).toContain("`## Design Spec`");
    expect(prompt).toContain(NOT_APPLICABLE_LINE);
    expect(prompt).toMatch(/turn every line of it into one contract item that can be judged right or wrong|逐条转成可判对错的验收条/);
    expect(prompt).toMatch(/name who\/which component and the constraint|写清是谁、哪个组件、什么约束/);
    expect(prompt).toContain("（来源：Design Spec）");
  });
});

describe("kanban-qa-frontend checks screenshots against the Design Spec line by line", () => {
  it.each(loadPaths)("%s", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-qa-frontend");
    expect(prompt).toContain("`## Design Spec`");
    expect(prompt).toContain(NOT_APPLICABLE_LINE);
    expect(prompt).toMatch(/line by line|逐条对照/);
    expect(prompt).toContain("「符合」");
    expect(prompt).toContain("「不符合」");
  });
});
