// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Locks the retro rules L204/L232/L256 (2026-10-21) into all three load paths:
// the default (en) root files, the locales/en overlay, and the locales/zh-CN overlay.
const bundledRoot = path.join(process.cwd(), "resources", "specialists");
const loadPaths: Array<[string, string, string | undefined]> = [
  ["default", bundledRoot, undefined],
  ["en", path.join(bundledRoot, "locales", "en"), "en"],
  ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
];

function loadPrompt(dir: string, locale: string | undefined, id: string): string {
  const specialist = loadSpecialistsFromDirectory(dir, "bundled", locale).find((entry) => entry.id === id);
  expect(specialist).toBeDefined();
  return specialist?.behaviorPrompt ?? "";
}

describe("kanban-todo-orchestrator prompt", () => {
  it.each(loadPaths)("never lets the knowledge-base search be skipped (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-todo-orchestrator");

    expect(prompt).not.toMatch(/Skip this step for simple tasks|可以跳过这一步/);
    expect(prompt).toContain("知识库：查了 <关键词>，无相关条目");
    expect(prompt).toContain("Knowledge base: searched <keywords>, no relevant entries");
  });

  it.each(loadPaths)("reads experience packs before planning (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-todo-orchestrator");

    expect(prompt).toContain("项目索引/经验包/");
    expect(prompt).toMatch(/知识库目录|~\/Desktop\/my\/knowledge-system/);
    expect(prompt).toContain("triggers.json");
    expect(prompt).toContain("grep -n '^## '");
    expect(prompt).toContain("（经验包 <包>:<行号>）");
    expect(prompt).toContain("(pack <pack>:<line>)");
    expect(prompt).toContain("经验包 <包>：已看标题，无相关条目");
    expect(prompt).toContain("Pack <pack>: titles checked, no relevant entries");
    // Packs come from the knowledge-base resolver, not a hard-coded repository → pack mapping.
    expect(prompt).toContain("flight_resolve.py --card <完整卡号>");
    expect(prompt).not.toMatch(/deepseek-harness\s*→\s*dsh-config/);
  });
});

describe("kanban-review-guard prompt", () => {
  it.each(loadPaths)("re-runs every card verificationCommand before approving (%s)", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-review-guard");

    expect(prompt).toContain("verificationCommands");
    expect(prompt).toMatch(/exit code|退出码/);
    expect(prompt).toMatch(/must NOT (be )?(mark|judge)[^\n]{0,40}APPROVED|不得判 APPROVED/);
    expect(prompt).toContain("卡上无 verificationCommands");
    expect(prompt).toContain("/api/tasks/<cardId>");
  });
});
