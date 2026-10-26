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

// Card f15e33e0 (2026-10-26): QA Frontend must record a formal verdict with update_task.
// The routing follows review-lane-convergence.ts (Review Guard runs after QA, so APPROVED
// stays in Review) and isExemptFromRemainingLaneStepsGuard (review->dev with NOT_APPROVED,
// and any move into blocked).
const VERDICT_HEADING = /## Hard rule: record the formal verdict|## 硬性规则：必须写入正式审核结论/;

describe("kanban-qa-frontend requires a formal verdict via update_task", () => {
  it.each(loadPaths)("%s names update_task and all verdict fields", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-qa-frontend");
    for (const token of ["update_task", "verificationVerdict", "verificationReport", "APPROVED", "NOT_APPROVED", "BLOCKED", "Review Guard", "taskId"]) {
      expect(prompt, token).toContain(token);
    }
    expect(prompt).toMatch(/`update_task` \(not `update_card`\)|`update_task`（不是 `update_card`）/);
    expect(prompt).toMatch(/Do not substitute `move_card` for `update_task`|不能只用 `move_card` 代替 `update_task`/);
    expect(prompt).toMatch(/circuit breaker|熔断/);
  });

  it.each(loadPaths)("%s keeps APPROVED cards in Review for Review Guard", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-qa-frontend");
    expect(prompt).toMatch(/`APPROVED`[^\n]*(stays in Review|卡留在 Review)[^\n]*Review Guard/);
    expect(prompt).toMatch(/`APPROVED`[^\n]*(Do not call `move_card`|不调用 `move_card`)/);
    expect(prompt).not.toMatch(/自动进 Done|auto-moves to Done|automatically (moves|goes) to Done/);
  });

  it.each(loadPaths)("%s sends NOT_APPROVED to dev and BLOCKED to blocked in two steps", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-qa-frontend");
    expect(prompt).toMatch(/- `NOT_APPROVED`[^\n]*`update_task`[^\n]*`move_card`[^\n]*targetColumnId: "dev"/);
    expect(prompt).toMatch(/- `BLOCKED`[^\n]*`update_task`[^\n]*`move_card`[^\n]*targetColumnId: "blocked"/);
    expect(prompt).not.toMatch(/自动退回|automatically (sent|moved) back/);
  });

  it.each(loadPaths)("%s places the rule after the Design Spec check in the right language", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-qa-frontend");
    const heading = locale === "zh-CN" ? "## 硬性规则：必须写入正式审核结论" : "## Hard rule: record the formal verdict";
    const headingAt = prompt.indexOf(heading);
    expect(headingAt).toBeGreaterThan(-1);
    expect(prompt.search(VERDICT_HEADING)).toBe(headingAt);
    expect(headingAt).toBeGreaterThan(prompt.search(/## Design Spec Check|Design Spec check:|Design Spec 核对：/));
    const closingAt = prompt.search(/## Completion|Keep all output in the original task language|所有输出保持需求原始语言/);
    expect(headingAt).toBeLessThan(closingAt);
  });

  it.each(loadPaths)("%s keeps the existing rejection wording", (_label, dir, locale) => {
    const prompt = loadPrompt(dir, locale, "kanban-qa-frontend");
    if (locale === "zh-CN") {
      expect(prompt).toContain('无法证明视觉正确时，先调用 `update_task` 设置 `verificationVerdict: "NOT_APPROVED"`，再调用 `move_card` 退回 `dev`');
    } else if (locale === "en") {
      expect(prompt).toContain("reject back to `dev` if visual evidence is missing or failed");
    } else {
      expect(prompt).toContain('To reject: append actionable feedback under `## Review Feedback`, then call `update_task` with `verificationVerdict: "NOT_APPROVED"` and call `move_card` with `targetColumnId: "dev"`.');
    }
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
