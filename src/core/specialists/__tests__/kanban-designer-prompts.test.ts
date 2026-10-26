// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadBundledSpecialists, loadSpecialistsFromDirectory } from "../specialist-file-loader";

// Locks the kanban-designer promises (card 143cfbed, 2026-10-26) into all three load paths:
// the default (en) root files, the locales/en overlay and the locales/zh-CN overlay.
// If you reword the prompt, update these assertions; do not drop them to make the test pass.
const bundledRoot = path.join(process.cwd(), "resources", "specialists");
const loadPaths: Array<[string, string, string | undefined]> = [
  ["default", bundledRoot, undefined],
  ["en", path.join(bundledRoot, "locales", "en"), "en"],
  ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN"],
];

const DESIGNER_ID = "kanban-designer";
const NOT_APPLICABLE_SPEC = "## Design Spec\n不适用：改动文件里没有页面、组件或样式";

function loadDesigner(dir: string, locale: string | undefined) {
  return loadSpecialistsFromDirectory(dir, "bundled", locale).find((entry) => entry.id === DESIGNER_ID);
}

describe("kanban-designer specialist", () => {
  it.each(loadPaths)("loads from the %s path", (_label, dir, locale) => {
    const designer = loadDesigner(dir, locale);
    expect(designer).toBeDefined();
    expect(designer?.behaviorPrompt).not.toBe("");
  });

  it("has the same id, role and model tier in all three files", () => {
    const fields = loadPaths.map(([label, dir, locale]) => {
      const designer = loadDesigner(dir, locale);
      return { label, id: designer?.id, role: designer?.frontmatter.role, modelTier: designer?.frontmatter.modelTier };
    });
    for (const entry of fields) {
      expect(entry.id, entry.label).toBe(DESIGNER_ID);
      expect(entry.role, entry.label).toBe("CRAFTER");
      expect(entry.modelTier, entry.label).toBe(fields[0]!.modelTier);
    }
    expect(fields[0]!.modelTier).toBeTruthy();
  });

  it.each(loadPaths)("writes the fixed not-applicable line byte for byte (%s)", (_label, dir, locale) => {
    const prompt = loadDesigner(dir, locale)?.behaviorPrompt ?? "";
    expect(prompt).toContain(NOT_APPLICABLE_SPEC);
  });

  it.each(loadPaths)("judges UI cards by .tsx/.css, page or component directories, or an explicit UI requirement (%s)", (_label, dir, locale) => {
    const prompt = loadDesigner(dir, locale)?.behaviorPrompt ?? "";
    expect(prompt).toContain("`.tsx`");
    expect(prompt).toContain("`.css`");
    expect(prompt).toContain("src/client/components/**");
    expect(prompt).toMatch(/requirement explicitly says the UI changes|需求明说要改界面/);
  });

  it.each(loadPaths)("reads docs/design/DESIGN.md first and falls back to existing pages (%s)", (_label, dir, locale) => {
    const prompt = loadDesigner(dir, locale)?.behaviorPrompt ?? "";
    expect(prompt).toContain("docs/design/DESIGN.md");
    expect(prompt).toMatch(/has no `docs\/design\/DESIGN\.md`|没有 `docs\/design\/DESIGN\.md`/);
    expect(prompt).toMatch(/which files you used as the reference|参照了哪些文件/);
  });

  it.each(loadPaths)("queries the design library with an intent word or brand (%s)", (_label, dir, locale) => {
    const prompt = loadDesigner(dir, locale)?.behaviorPrompt ?? "";
    expect(prompt).toContain("python3 ~/Desktop/my/knowledge-system/distill/_index/search.py --kind design");
    expect(prompt).toContain("design-library/");
    expect(prompt).toMatch(/UI-intent word|界面意图词/);
    expect(prompt).toMatch(/name a brand|点名品牌/);
    expect(prompt).toMatch(/0 hits|0 命中/);
    expect(prompt).toContain("cd ~/Desktop/my/knowledge-system && pwd -P");
  });

  it.each(loadPaths)("is read-only: no code changes, no Vault writes, no move_card by default (%s)", (_label, dir, locale) => {
    const prompt = loadDesigner(dir, locale)?.behaviorPrompt ?? "";
    expect(prompt).toMatch(/do not change any file in the repository|不改仓库里任何文件/);
    expect(prompt).toMatch(/do not write to the Vault|不写 Vault/);
    expect(prompt).toMatch(/Do not call `move_card`|不调用 `move_card`/);
  });

  it.each(loadPaths)("asks for the four Design Spec parts, kept features and hover tips (%s)", (_label, dir, locale) => {
    const prompt = loadDesigner(dir, locale)?.behaviorPrompt ?? "";
    expect(prompt).toMatch(/\*\*Reuse\*\*|\*\*沿用\*\*/);
    expect(prompt).toMatch(/\*\*Follow\*\*|\*\*照着\*\*/);
    expect(prompt).toMatch(/\*\*Do not invent\*\*|\*\*不许另起\*\*/);
    expect(prompt).toMatch(/\*\*References\*\*|\*\*参照\*\*/);
    expect(prompt).toMatch(/close buttons are icon buttons, never red|关闭按钮用图标按钮，不用红色/);
    expect(prompt).toMatch(/shipped features that must stay visible|必须保留且直接可见的已上线功能/);
    expect(prompt).toMatch(/hover tooltip|悬停提示/);
  });

  it.each([["default", undefined], ["en", "en"], ["zh-CN", "zh-CN"]] as const)(
    "is returned by loadBundledSpecialists (%s)",
    (_label, locale) => {
      const ids = loadBundledSpecialists(locale).map((entry) => entry.id);
      expect(ids).toContain(DESIGNER_ID);
    },
  );
});
