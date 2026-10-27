/**
 * Card 64f2e31c (AC4, AC8, C7): the "## 自动处理记录" parser and the
 * per-reason round count behind "the 3rd round goes to the owner".
 */
import { describe, expect, it } from "vitest";
import {
  attentionReasonOf,
  countResolutionRounds,
  countResolverSessions,
  isPatchCard,
  latestAutoResolutionRecordText,
  parseAutoResolutionRecord,
  shouldEscalateToOwner,
} from "../auto-resolution-record";
import { blockedColumnOf } from "../attention-to-blocked";
import type { KanbanColumn } from "../../models/kanban";
import type { TaskLaneSession } from "../../models/task";

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

// Card 59f5b059 (AC1–AC3, C1, C2): rounds counted from resolver sessions, patch cards.
describe("attentionReasonOf (C1)", () => {
  it.each([
    ["attention:push_conflict 推送失败", "attention:push_conflict"],
    [null, "attention:blocked"],
    ["随便的错误", "attention:blocked"],
    ["attention:doneFailed — Done 列失败", "attention:doneFailed"],
    [undefined, "attention:blocked"],
  ])("%s → %s", (input, expected) => {
    expect(attentionReasonOf(input)).toBe(expected);
  });
});

describe("countResolverSessions (C1)", () => {
  let seq = 0;
  const resolver = (extra: Partial<TaskLaneSession> = {}): TaskLaneSession => ({
    sessionId: `s-${seq += 1}`,
    columnId: "blocked",
    specialistId: "kanban-blocked-resolver",
    attentionReason: "attention:push_conflict",
    status: "completed",
    startedAt: "2026-10-27T00:00:00.000Z",
    ...extra,
  });
  const reason = "attention:push_conflict";

  it.each([0, 1, 2])("%i resolver sessions of the same reason", (n) => {
    expect(countResolverSessions(Array.from({ length: n }, () => resolver()), "blocked", reason)).toBe(n);
  });

  it("different reasons count only for themselves", () => {
    const sessions = [resolver(), resolver({ attentionReason: "attention:review_failed" })];
    expect(countResolverSessions(sessions, "blocked", reason)).toBe(1);
    expect(countResolverSessions(sessions, "blocked", "attention:review_failed")).toBe(1);
    expect(countResolverSessions(sessions, "blocked", "attention:doneFailed")).toBe(0);
  });

  it("non-resolver sessions and never-started placeholders count 0", () => {
    expect(countResolverSessions([
      resolver({ specialistId: "kanban-dev-crafter" }),
      resolver({ columnId: "dev" }),
      resolver({ sessionId: "rate-limited-1", recoveryReason: "rate_limited", status: "failed" }),
      resolver({ sessionId: "environment-failure-1", recoveryReason: "environment_failure", status: "failed" }),
      resolver({ sessionId: "rate-limited-2" }),
    ], "blocked", reason)).toBe(0);
  });

  it("a failed (crashed, revived) resolver session still counts", () => {
    expect(countResolverSessions([resolver({ status: "failed" }), resolver({ status: "timed_out" })], "blocked", reason)).toBe(2);
  });

  it("old sessions without attentionReason count as attention:blocked", () => {
    const old = [resolver({ attentionReason: undefined }), resolver({ attentionReason: undefined })];
    expect(countResolverSessions(old, "blocked", "attention:blocked")).toBe(2);
    expect(countResolverSessions(old, "blocked", reason)).toBe(0);
  });

  it("finds Blocked by stage=blocked or by id=blocked with the same count", () => {
    const byStage = [{ id: "stuck", name: "Stuck", stage: "blocked", position: 0 }] as KanbanColumn[];
    const byId = [{ id: "blocked", name: "Blocked", stage: "review", position: 0 }] as KanbanColumn[];
    const stageId = blockedColumnOf({ columns: byStage });
    const idId = blockedColumnOf({ columns: byId });
    expect(stageId).toBe("stuck");
    expect(idId).toBe("blocked");
    expect(countResolverSessions([resolver({ columnId: "stuck" }), resolver({ columnId: "stuck" })], stageId, reason)).toBe(2);
    expect(countResolverSessions([resolver(), resolver()], idId, reason)).toBe(2);
    expect(countResolverSessions([resolver()], undefined, reason)).toBe(0);
  });
});

describe("shouldEscalateToOwner with sessions (C2)", () => {
  const record = (reason: string) => comment(ZH.replace("attention:doneFailed", reason));
  const reason = "attention:doneFailed";

  it("no record comments + 2 resolver sessions → escalate", () => {
    expect(shouldEscalateToOwner([], reason, 2)).toBe(true);
    expect(shouldEscalateToOwner(undefined, reason, 2)).toBe(true);
  });

  it("1 comment + 1 session → not yet (the larger value, not the sum)", () => {
    expect(shouldEscalateToOwner([record(reason)], reason, 1)).toBe(false);
  });

  it("2 comments + 0 sessions → escalate; the two-argument call is unchanged", () => {
    expect(shouldEscalateToOwner([record(reason), record(reason)], reason, 0)).toBe(true);
    expect(shouldEscalateToOwner([record(reason), record(reason)], reason)).toBe(true);
    expect(shouldEscalateToOwner([record(reason)], reason)).toBe(false);
  });

  it("an underscore reason in the record counts for itself", () => {
    const pushConflict = record("attention:push_conflict");
    expect(countResolutionRounds([pushConflict, pushConflict], "attention:push_conflict")).toBe(2);
  });
});

describe("isPatchCard (AC3, C1)", () => {
  it.each([
    [{ title: "修推送", objective: "在主干上 git cherry-pick a1b2c3d 后推送" }, true],
    [{ title: "原卡 59f5 的补丁卡", objective: "x" }, true],
    [{ title: "补丁：重推原卡提交", objective: "x" }, true],
    [{ title: "普通卡", objective: "实现功能" }, false],
    [{ title: "修复打补丁流程", objective: "x" }, false],
    [{ title: "普通卡", objective: "跑 git cherry-pick 但没写提交号" }, false],
  ])("%o → %s", (card, expected) => {
    expect(isPatchCard(card)).toBe(expected);
  });
});
