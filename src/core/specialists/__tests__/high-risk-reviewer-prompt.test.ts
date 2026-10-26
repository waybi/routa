// @vitest-environment node
/**
 * Card faca483f: the High-Risk Reviewer may pass a card only after it confirmed
 * the Flight Review Guard finished this round (its latest run completed and
 * wrote this round's verdict and comment). Otherwise it moves the card back to
 * review so the Review lane runs again. Three cards (92744a50, be1f66d2,
 * 311fa29b) were passed on a verdict left from an earlier round.
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

import { loadSpecialistsFromDirectory } from "../specialist-file-loader";

const bundledRoot = path.join(process.cwd(), "resources", "specialists");
const ID = "kanban-high-risk-reviewer";

const STEP1_EN = "- Read the task's `verificationVerdict` and the Flight Review Guard's latest review comment.";
const STEP1_ZH = "- 读卡片的 `verificationVerdict` 和评审守卫最新的评审评论";

// The rule tested in the replay eval (Vault replay-eval, commit c638d43c), with
// the machine path replaced by the portable `<routa repo>/routa.db`.
const RULE_EN = "- Before you may pass, confirm the Flight Review Guard really finished this round: its latest run on this card (the latest Flight Review Guard run started after the latest QA run ended) has status `completed` (not failed, timed_out, cancelled or still running), and that same run wrote this round's `verificationVerdict` and its own review comment (match by session, author or time). A verdict, review comment or `高风险：` line left from an earlier round, or written by another step, does not count; if you cannot tell which run wrote it, treat it as not confirmed. If the card does not show this, check it read-only in `<routa repo>/routa.db` (`tasks.lane_sessions`, `tasks.comments`). If you cannot confirm both, do not approve and do not review in the Review Guard's place: comment what is missing, then call `move_card` with `targetColumnId: \"review\"` so the Review lane runs again. This is not a `【评审打回 第 N 次】` and does not count toward N.";

const loadPaths: Array<[string, string, string | undefined, "en" | "zh"]> = [
  ["default", bundledRoot, undefined, "en"],
  ["en", path.join(bundledRoot, "locales", "en"), "en", "en"],
  ["zh-CN", path.join(bundledRoot, "locales", "zh-CN"), "zh-CN", "zh"],
];

function promptOf(dir: string, locale: string | undefined): string {
  return loadSpecialistsFromDirectory(dir, "bundled", locale).find((entry) => entry.id === ID)?.behaviorPrompt ?? "";
}

function lineAfter(text: string, anchor: string): string | undefined {
  const lines = text.split("\n").map((line) => line.trim());
  const index = lines.indexOf(anchor);
  return index >= 0 ? lines[index + 1] : undefined;
}

describe.each(loadPaths)("high-risk reviewer confirms this round's Review Guard run (%s)", (_label, dir, locale, lang) => {
  const text = promptOf(dir, locale);

  it("is loaded", () => {
    expect(text).not.toBe("");
  });

  it("names the portable routa.db and no machine path", () => {
    expect(text).toContain("routa.db");
    expect(text).not.toContain("/Users/");
  });

  it("has the rule right after reading the verdict", () => {
    if (lang === "en") {
      for (const key of ["completed", "tasks.lane_sessions", "targetColumnId: \"review\"", "does not count toward N"]) {
        expect(text, key).toContain(key);
      }
      expect(lineAfter(text, STEP1_EN)).toBe(RULE_EN);
    } else {
      for (const key of ["tasks.lane_sessions", "review", "不计入"]) {
        expect(text, key).toContain(key);
      }
      const rule = lineAfter(text, STEP1_ZH) ?? "";
      // The six points of AC2, each as a phrase of the rule.
      for (const point of [
        "晚于最近一次 QA 运行结束", "`completed`", "failed、timed_out、cancelled、仍在运行都不算",
        "同一次运行写的", "按会话、作者或时间对应",
        "上一轮留下的、或其他步骤写的", "`高风险：` 行都不算", "按「未确认」处理",
        "只读查 `<routa 仓库>/routa.db`", "`tasks.lane_sessions`、`tasks.comments`",
        "不放行", "不替评审守卫评审", "先写评论说明缺什么", "`targetColumnId: \"review\"`", "让 Review 列重跑",
        "不算 `【评审打回 第 N 次】`", "不计入 N",
      ]) {
        expect(rule, point).toContain(point);
      }
    }
  });
});

describe("the three high-risk-reviewer.yaml files keep their identity", () => {
  const files = [
    path.join(bundledRoot, "workflows", "kanban", "high-risk-reviewer.yaml"),
    path.join(bundledRoot, "locales", "en", "workflows", "kanban", "high-risk-reviewer.yaml"),
    path.join(bundledRoot, "locales", "zh-CN", "workflows", "kanban", "high-risk-reviewer.yaml"),
  ];

  it.each(files)("%s: no /Users/ path", (file) => {
    expect(fs.readFileSync(file, "utf8")).not.toContain("/Users/");
  });

  it("same id, role and model tier in all three", () => {
    const loaded = loadPaths.map(([, dir, locale]) =>
      loadSpecialistsFromDirectory(dir, "bundled", locale).find((entry) => entry.id === ID));
    for (const entry of loaded) {
      expect(entry?.id).toBe(ID);
      expect(entry?.frontmatter.role).toBe("GATE");
      // The default file spells the key model_tier, the locale overlays modelTier.
      expect(entry?.frontmatter.modelTier ?? entry?.frontmatter.model_tier).toBe("smart");
    }
  });
});
