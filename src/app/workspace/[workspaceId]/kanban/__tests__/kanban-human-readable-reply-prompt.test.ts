import { describe, expect, it } from "vitest";
import { buildKanbanHumanReadableReplyPrompt } from "../i18n/kanban-task-agent";

/**
 * The card-detail session panel wraps a human's follow-up question with
 * reply-writing rules so the agent answers like a colleague, not a work log.
 * These lock the parts a reader would notice if they regressed.
 */
describe("buildKanbanHumanReadableReplyPrompt", () => {
  it("keeps the user's request verbatim at the end", () => {
    const prompt = buildKanbanHumanReadableReplyPrompt({
      request: "为什么这张卡还在 review 列？",
      language: "zh-CN",
    });

    expect(prompt.trimEnd().endsWith("为什么这张卡还在 review 列？")).toBe(true);
    // Rules come before the request, separated so the agent can tell them apart.
    expect(prompt.indexOf("---")).toBeLessThan(prompt.indexOf("为什么这张卡还在 review 列？"));
  });

  it("asks for outcome first and evidence the reader can check (en)", () => {
    const prompt = buildKanbanHumanReadableReplyPrompt({ request: "what changed?", language: "en" });

    expect(prompt).toContain("Lead with the outcome or the direct answer in the first sentence");
    expect(prompt).toContain("not the order you did the work");
    expect(prompt).toContain("a file path with line number, an exact command they can rerun, or quoted output");
    expect(prompt).toContain("say so plainly and name the concrete blocker");
  });

  it("bans the filler phrases a reader would notice (zh-CN)", () => {
    const prompt = buildKanbanHumanReadableReplyPrompt({ request: "进展如何", language: "zh-CN" });

    expect(prompt).toContain("第一句就给结论");
    expect(prompt).toContain("「值得注意的是」「总的来说」「综上所述」");
    expect(prompt).toContain("术语第一次出现时用一句大白话解释");
    expect(prompt).toContain("不要把「做了很多事」包装成进展");
  });

  it("defaults to English when no language is given", () => {
    const prompt = buildKanbanHumanReadableReplyPrompt({ request: "status?" });
    expect(prompt).toContain("## How to write this reply");
    expect(prompt).not.toContain("这条回复怎么写");
  });

  it("does not alter the request text itself", () => {
    // Braces and template-looking tokens in a real question must survive.
    const request = "why does {{workspaceId}} show as undefined in the {{boardId}} header?";
    const prompt = buildKanbanHumanReadableReplyPrompt({ request, language: "en" });
    expect(prompt).toContain(request);
  });
});
