import { describe, expect, it } from "vitest";
import { collectAttentionItems } from "../../kanban/kanban-attention-rules";
import { NOW, doneCard, makeBoard, report } from "./inbox-fixtures";

/**
 * design-spec §4 line 148: a completion report counts when either the notes
 * first line carries the report heading (list projection `completionReport`)
 * or the `completion_summary` field is non-empty.
 */
function kinds(task: ReturnType<typeof doneCard>) {
  return collectAttentionItems([task], makeBoard("b1", false), NOW).map((item) => item.kind);
}

describe("completion report sources", () => {
  it("does not report noReport when only completion_summary is filled", () => {
    expect(kinds(doneCard("s", "completed", { completionSummary: "Shipped in abc1234" }))).toEqual([]);
  });

  it("does not report doneFailed when only completion_summary is filled", () => {
    expect(kinds(doneCard("s", "failed", { completionSummary: "Shipped in abc1234" }))).toEqual([]);
  });

  it("still reports noReport when neither source has a report", () => {
    expect(kinds(doneCard("n", "completed", { completionSummary: "   " }))).toEqual(["noReport"]);
  });

  it("accepts the notes report alone", () => {
    expect(kinds(doneCard("r", "completed", { completionReport: report }))).toEqual([]);
  });
});
