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

const DEV_IDS = ["kanban-dev-executor", "kanban-flight-dev-executor"];

describe.each(loadPaths)("dev executors gate UI cards on the Design Spec (%s)", (_label, dir, locale) => {
  it.each(DEV_IDS)("%s rejects a UI card without a Design Spec to todo, then blocked on the second time", (id) => {
    const prompt = loadPrompt(dir, locale, id);
    expect(prompt).toContain("`## Design Spec`");
    expect(prompt).toMatch(/`\.tsx`/);
    expect(prompt).toContain("缺设计规范（Design Spec）");
    expect(prompt).toContain("## Rejection Notes");
    expect(prompt).toMatch(/缺设计规范（Design Spec）[^\n]*`todo`/);
    // Anti-loop: a second missing-spec rejection goes to blocked with a fixed reason.
    expect(prompt).toMatch(/targetColumnId: "blocked"[^\n]*看板 Todo 列未挂 kanban-designer|移到 `blocked`，理由写「看板 Todo 列未挂 kanban-designer」/);
  });

  it.each(DEV_IDS)("%s starts as usual on the 不适用 line and follows a real Design Spec", (id) => {
    const prompt = loadPrompt(dir, locale, id);
    expect(prompt).toContain(NOT_APPLICABLE_LINE);
    expect(prompt).toMatch(/start work as usual|照常开工/);
    expect(prompt).toMatch(/follow every line of it|逐条照做/);
  });

  it.each(DEV_IDS)("%s keeps the existing rejection wording", (id) => {
    const prompt = loadPrompt(dir, locale, id);
    if (locale === "zh-CN") {
      expect(prompt).toContain("若 canonical YAML 缺失、损坏或上游规划不足，退回 Todo，不要盲猜");
    } else {
      expect(prompt).toContain('To reject: call `update_card` with the rejection reason under `## Rejection Notes`, then call `move_card` with `targetColumnId: "todo"`.');
    }
    if (id === "kanban-flight-dev-executor") expect(prompt).toContain("缺验收契约");
  });
});
