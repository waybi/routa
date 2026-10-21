// @vitest-environment node
import { describe, expect, it } from "vitest";

import fixture from "../__fixtures__/completion-report-summary-cases.json";
import {
  pickLatestCompletionReport,
  summarizeTaskCompletionReport,
  type CompletionReportSummary,
} from "../completion-report";
import { hydrateTaskComments, type TaskCommentEntry } from "@/core/models/task";
import { splitCompletionReports } from "@/app/workspace/[workspaceId]/kanban/kanban-completion-report";

interface SummaryCase {
  name: string;
  comments: Array<{ body: string; createdAt: string }>;
  legacyComment?: string;
  expected: CompletionReportSummary | null;
}

const cases = (fixture as { cases: SummaryCase[] }).cases;

function toEntries(testCase: SummaryCase): TaskCommentEntry[] {
  const comments = testCase.comments.map((comment, index) => ({ id: `c${index}`, ...comment }));
  return hydrateTaskComments(comments, testCase.legacyComment);
}

describe("summarizeTaskCompletionReport (shared fixture — change it, run TS and Rust tests)", () => {
  it("covers at least 13 cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(13);
  });

  it.each(cases.map((testCase) => [testCase.name, testCase] as const))("%s", (_name, testCase) => {
    expect(summarizeTaskCompletionReport(toEntries(testCase))).toEqual(testCase.expected);
  });
});

describe("pickLatestCompletionReport", () => {
  it("selects the same report the card detail shows as newest", () => {
    const entries = [
      { id: "a", body: "## 完成汇报\nA", createdAt: "2026-10-14T01:19:00.000Z" },
      { id: "b", body: "进度", createdAt: "2026-10-15T00:00:00.000Z" },
      { id: "c", body: "## 完成汇报\nC", createdAt: "" },
      { id: "d", body: "## Completion Summary\nD", createdAt: "2026-10-13T00:00:00.000Z" },
      { id: "e", body: "## 完工汇报\nE", createdAt: "2026-10-14T01:19:00.000Z" },
    ];
    const latest = pickLatestCompletionReport(entries);
    expect(latest?.id).toBe(splitCompletionReports(entries).completionReports[0]?.id);
    expect(latest?.id).toBe("e");
  });

  it("returns null when there is no report", () => {
    expect(pickLatestCompletionReport([{ body: "进度", createdAt: "" }])).toBeNull();
  });
});
