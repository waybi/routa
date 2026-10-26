/**
 * Card 64f2e31c (AC4, AC8, C7): the "## 自动处理记录" parser and the
 * per-reason round count behind "the 3rd round goes to the owner".
 */
import { describe, expect, it } from "vitest";
import {
  countResolutionRounds,
  latestAutoResolutionRecordText,
  parseAutoResolutionRecord,
  shouldEscalateToOwner,
} from "../auto-resolution-record";

const ZH = [
  "## 自动处理记录",
  "### 卡在哪",
  "attention:doneFailed；lastSyncError 原文「Done 列失败」",
  "### 判断",
  "missing_report，依据 git merge-base --is-ancestor 退出码 0",
  "### 做了什么",
  "update_card 补完成汇报 → success",
  "### 结果核对",
  "GET 卡片 comments 有 ## 完成汇报",
  "### 没做什么、为什么",
  "没推送：已在主干",
].join("\n");

const EN = ZH
  .replace("## 自动处理记录", "## Auto Resolution Record")
  .replace("### 卡在哪", "### Where it is stuck")
  .replace("### 判断", "### Judgement")
  .replace("### 做了什么", "### What was done")
  .replace("### 结果核对", "### Result check")
  .replace("### 没做什么、为什么", "### What was not done and why");

const comment = (body: string) => ({ body });

describe("parseAutoResolutionRecord (C7)", () => {
  it("takes the five sections of a complete Chinese record", () => {
    const record = parseAutoResolutionRecord(ZH);
    expect(record?.valid).toBe(true);
    expect(record?.missing).toEqual([]);
    expect(record?.sections).toEqual({
      stuck: "attention:doneFailed；lastSyncError 原文「Done 列失败」",
      judgement: "missing_report，依据 git merge-base --is-ancestor 退出码 0",
      actions: "update_card 补完成汇报 → success",
      check: "GET 卡片 comments 有 ## 完成汇报",
      notDone: "没推送：已在主干",
    });
    expect(record?.reasons).toEqual(["attention:doneFailed"]);
  });

  it("accepts the English heading and titles", () => {
    expect(parseAutoResolutionRecord(EN)?.valid).toBe(true);
  });

  it("a missing section is not valid and names the section", () => {
    const record = parseAutoResolutionRecord(ZH.replace("### 结果核对\nGET 卡片 comments 有 ## 完成汇报\n", ""));
    expect(record?.valid).toBe(false);
    expect(record?.missing).toEqual(["check"]);
  });

  it("an empty section is not valid", () => {
    expect(parseAutoResolutionRecord(ZH.replace("没推送：已在主干", ""))?.missing).toEqual(["notDone"]);
  });

  it("a comment whose first line is not the heading is not a record", () => {
    expect(parseAutoResolutionRecord(`备注\n${ZH}`)).toBeNull();
    expect(parseAutoResolutionRecord("## 完成汇报\n- ok")).toBeNull();
    expect(parseAutoResolutionRecord(undefined)).toBeNull();
  });
});

describe("rounds per reason (C7, AC8)", () => {
  const doneFailed = comment(ZH);
  const interrupted = comment(ZH.replace("attention:doneFailed", "attention:interrupted"));

  it.each([0, 1, 2])("%i earlier rounds of the same reason", (rounds) => {
    const comments = Array.from({ length: rounds }, () => doneFailed);
    expect(countResolutionRounds(comments, "attention:doneFailed")).toBe(rounds);
    expect(shouldEscalateToOwner(comments, "attention:doneFailed")).toBe(rounds >= 2);
  });

  it("records of another reason do not count", () => {
    expect(countResolutionRounds([interrupted, interrupted], "attention:doneFailed")).toBe(0);
    expect(shouldEscalateToOwner([interrupted, interrupted, doneFailed], "attention:doneFailed")).toBe(false);
  });

  it("invalid records do not count as a round", () => {
    const broken = comment(ZH.replace("### 判断", "### 其他"));
    expect(countResolutionRounds([broken, broken], "attention:doneFailed")).toBe(0);
  });

  it("latestAutoResolutionRecordText returns the newest record", () => {
    expect(latestAutoResolutionRecordText([doneFailed, comment("other"), interrupted])).toBe(interrupted.body);
    expect(latestAutoResolutionRecordText([comment("other")])).toBeNull();
  });
});
