// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isCompletionReportNote } from "../completion-report";
import { upsertTaskCommentEntry } from "../task-comment-log";
import { isCompletionReportNote as isCompletionReportNoteFromUi } from "@/app/workspace/[workspaceId]/kanban/kanban-completion-report";

describe("isCompletionReportNote", () => {
  it.each([
    ["## 完成汇报\n内容", true],
    ["# 完工汇报", true],
    ["【完成总结】 xxx", true],
    ["[完工总结]", true],
    ["\n\n### Completion Summary\nbody", true],
    ["completion report: done", true],
    ["## Dev Evidence\n完成汇报", false],
    ["普通评论", false],
    ["", false],
  ])("recognises %j as %s", (body, expected) => {
    expect(isCompletionReportNote(body)).toBe(expected);
  });

  it("is the same function the card detail UI uses", () => {
    expect(isCompletionReportNoteFromUi).toBe(isCompletionReportNote);
  });
});

describe("upsertTaskCommentEntry", () => {
  it("updates only the newest report when a card already holds duplicates", () => {
    const existing = [
      { id: "r1", body: "## 完成汇报\n旧1", createdAt: "2026-10-01T00:00:00.000Z", source: "update_card" as const },
      { id: "n1", body: "进度", createdAt: "2026-10-01T00:01:00.000Z", source: "update_card" as const },
      { id: "r2", body: "## 完成汇报\n旧2", createdAt: "2026-10-01T00:02:00.000Z", source: "update_card" as const },
    ];
    const next = upsertTaskCommentEntry(existing, "## 完成汇报\n新", { sessionId: "s-new" });
    expect(next.map((entry) => [entry.id, entry.body])).toEqual([
      ["r1", "## 完成汇报\n旧1"],
      ["n1", "进度"],
      ["r2", "## 完成汇报\n新"],
    ]);
    expect(next[2].sessionId).toBe("s-new");
  });

  it("appends the first report and ignores blank input", () => {
    expect(upsertTaskCommentEntry(undefined, "  ")).toEqual([]);
    const next = upsertTaskCommentEntry([], "## 完成汇报\n首份");
    expect(next).toHaveLength(1);
    expect(next[0].body).toBe("## 完成汇报\n首份");
  });
});
