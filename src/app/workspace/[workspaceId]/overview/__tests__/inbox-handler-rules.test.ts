/**
 * Card 4877583c: who handles an inbox row, how, whether it can be handed to
 * the AI, and the reason fallback from comments. Every case calls the pure
 * functions directly (contract C1, C2, C3, C11, F3).
 */

import { describe, expect, it } from "vitest";
import type { KanbanBoardInfo, TaskInfo } from "../../types";
import {
  buildWorkspaceInbox,
  canHandOffToAi,
  handOffBlock,
  inboxHandler,
  inboxHandling,
  inboxReason,
  inboxReasonText,
  inboxSeverity,
  type InboxReasonText,
} from "../inbox-rules";
import { HOUR, NOW, card, iso } from "./inbox-fixtures";
import {
  RECORD_BODY,
  RESOLVER_AUTOMATION,
  blockedCard,
  blockedRun,
  comment,
  resolution,
  resolverBoard,
} from "./handler-fixtures";

const WS = { id: "w1", title: "W" };
const OTHER_STEP = { enabled: true, steps: [{ id: "s", specialistId: "kanban-main-pusher" }] };
const MIRROR_ONLY = { enabled: true, specialistId: "kanban-blocked-resolver" };
type Automation = KanbanBoardInfo["columns"][number]["automation"];

function handler(task: TaskInfo, board: KanbanBoardInfo | undefined) {
  return inboxHandler({ task }, board);
}

describe("inboxHandler (C1)", () => {
  const board = resolverBoard();
  it.each<[string, TaskInfo, KanbanBoardInfo | undefined, string]>([
    ["① card in review, board runs the resolver", card("a", { columnId: "review" }), board, "owner"],
    ["② card in Blocked, Blocked lane { enabled: false }", blockedCard("a"), resolverBoard({ enabled: false } as Automation), "owner"],
    ["③ enabled, but only another specialist", blockedCard("a"), resolverBoard(OTHER_STEP as Automation), "owner"],
    ["④a board has no Blocked lane", blockedCard("a"), { ...board, columns: board.columns.filter((column) => column.stage !== "blocked") }, "owner"],
    ["④b no board for the row", blockedCard("a"), undefined, "owner"],
    ["⑤ needs_owner in effect", blockedCard("a", { attentionResolution: resolution("needs_owner") }), board, "owner"],
    ["⑤+⑦ needs_owner in effect and the resolver running → owner wins", blockedCard("a", {
      attentionResolution: resolution("needs_owner"),
      laneSessions: [blockedRun(NOW - 30 * 60_000, "running")],
    }), board, "owner"],
    ["⑦ newest Blocked run is running", blockedCard("a", { laneSessions: [blockedRun(NOW - HOUR, "completed"), blockedRun(NOW - 10 * 60_000, "running")] }), board, "aiRunning"],
    ["⑧ an older Blocked run running, the newest completed", blockedCard("a", { laneSessions: [blockedRun(NOW - 2 * HOUR, "running"), blockedRun(NOW - HOUR, "completed")] }), board, "aiQueued"],
    ["⑦' a running run in another lane does not count", blockedCard("a", { laneSessions: [blockedRun(NOW - HOUR, "running", "dev")] }), board, "aiQueued"],
    ["⑨ no runs, no needs_owner", blockedCard("a"), board, "aiQueued"],
    ["⑩ top-level mirror only, no steps", blockedCard("a"), resolverBoard(MIRROR_ONLY as Automation), "aiQueued"],
    ["⑪ Blocked lane id is not 'blocked'", blockedCard("a", { columnId: "stuck" }), resolverBoard(RESOLVER_AUTOMATION, "stuck"), "aiQueued"],
    ["⑪' card in a column id 'blocked' that is not the Blocked lane", blockedCard("a"), resolverBoard(RESOLVER_AUTOMATION, "stuck"), "owner"],
  ])("%s", (_name, task, rowBoard, expected) => {
    expect(handler(task, rowBoard)).toBe(expected);
  });

  it("⑥ needs_owner no longer in effect (a run started after the conclusion) → aiQueued", () => {
    // isAttentionResolutionInEffect keeps needs_owner forever in a lane whose
    // id is "blocked"; a Blocked lane with another id ends it once a run starts.
    const task = blockedCard("a", {
      columnId: "stuck",
      attentionResolution: resolution("needs_owner", { resolvedAt: iso(NOW - 2 * HOUR) }),
      laneSessions: [blockedRun(NOW - HOUR, "completed", "stuck")],
    });
    expect(handler(task, resolverBoard(RESOLVER_AUTOMATION, "stuck"))).toBe("aiQueued");
    const stillInEffect = { ...task, laneSessions: [] };
    expect(handler(stillInEffect, resolverBoard(RESOLVER_AUTOMATION, "stuck"))).toBe("owner");
  });

  it("④ does not throw on a board without columns", () => {
    expect(() => handler(blockedCard("a"), { id: "x" } as KanbanBoardInfo)).not.toThrow();
    expect(handler(blockedCard("a"), { id: "x" } as KanbanBoardInfo)).toBe("owner");
  });
});

describe("handOffBlock / canHandOffToAi (AC4)", () => {
  const board = resolverBoard();
  it.each<[string, TaskInfo, KanbanBoardInfo, string | null]>([
    ["not in Blocked", card("a", { columnId: "review" }), board, "notBlocked"],
    ["board has no resolver", blockedCard("a"), resolverBoard({ enabled: false } as Automation), "noResolver"],
    ["resolver running", blockedCard("a", { laneSessions: [blockedRun(NOW - HOUR, "running")] }), board, "running"],
    ["clickable", blockedCard("a"), board, null],
    ["clickable even when needs_owner holds", blockedCard("a", { attentionResolution: resolution("needs_owner") }), board, null],
  ])("%s", (_name, task, rowBoard, expected) => {
    expect(handOffBlock(task, rowBoard)).toBe(expected);
    expect(canHandOffToAi({ task }, rowBoard)).toBe(expected === null);
  });
});

describe("inboxHandling (C2)", () => {
  it.each(["landed", "superseded", "handed_off", "waiting", "needs_owner"])("%s in effect returns category, conclusion and ref", (category) => {
    const task = blockedCard("a", { attentionResolution: resolution(category, { conclusion: `结论 ${category}：原文 保留` }) });
    expect(inboxHandling({ task })).toEqual({ category, conclusion: `结论 ${category}：原文 保留`, ref: "abc1234" });
  });

  it("omits an empty or missing ref", () => {
    expect(inboxHandling({ task: blockedCard("a", { attentionResolution: resolution("waiting", { ref: "" }) }) })).toEqual({ category: "waiting", conclusion: "conclusion waiting" });
    expect(inboxHandling({ task: blockedCard("a", { attentionResolution: resolution("landed", { ref: undefined }) }) })).toEqual({ category: "landed", conclusion: "conclusion landed" });
  });

  it.each<[string, TaskInfo]>([
    ["no resolution", blockedCard("a")],
    ["no longer in effect (handed_off after leaving Blocked)", card("a", { columnId: "review", attentionResolution: resolution("handed_off") })],
    ["unknown category", blockedCard("a", { attentionResolution: resolution("rolled_back") })],
  ])("returns null for %s without throwing", (_name, task) => {
    expect(() => inboxHandling({ task })).not.toThrow();
    expect(inboxHandling({ task })).toBeNull();
  });
});

const LONG_PARAGRAPH = "原".repeat(200);

describe("inboxReasonText (C3, C11)", () => {
  const t = (minute: number) => iso(Date.UTC(2026, 9, 27, 6, 53) + minute * 1000);
  it.each<[string, Partial<TaskInfo>, InboxReasonText | null]>([
    ["① lastSyncError set → keeps the original reason", { lastSyncError: "hook", comments: [comment("c", "plain", t(0))] }, null],
    ["② one plain comment", { comments: [comment("c", "第一段\n续行\n\n第二段", t(0))] }, { text: "第一段\n续行", full: "第一段\n续行\n\n第二段" }],
    ["③ plain newer than the record but earlier in the array", {
      comments: [comment("p", "普通评论", t(39)), comment("r", RECORD_BODY, t(1))],
    }, { text: "普通评论", full: "普通评论" }],
    ["④ d5549adc shape: newest plain by createdAt, not the array's last", {
      comments: [
        comment("report", "主干推送中止：`git rebase origin/main` 冲突，已 `git rebase --abort`，未推送。\n\n详情…", t(39)),
        comment("record", RECORD_BODY, t(1)),
        comment("older", "更早的评论", iso(Date.UTC(2026, 9, 27, 6, 0))),
      ],
    }, {
      text: "主干推送中止：`git rebase origin/main` 冲突，已 `git rebase --abort`，未推送。",
      full: "主干推送中止：`git rebase origin/main` 冲突，已 `git rebase --abort`，未推送。\n\n详情…",
    }],
    ["④' plain older than the record and after it in the array", {
      comments: [comment("r", RECORD_BODY, t(40)), comment("p", "较早的普通评论", t(0))],
    }, { text: "较早的普通评论", full: "较早的普通评论" }],
    ["⑤ only a record", { comments: [comment("r", RECORD_BODY, t(0))] }, null],
    ["⑤' only an English record", { comments: [comment("r", "## Auto Resolution Record\n\n### Judgement\nx", t(0))] }, null],
    ["⑥ no comments", { comments: [] }, null],
    ["⑥' comments missing", {}, null],
    ["⑦ record heading with spaces around it is skipped", { comments: [comment("p", "普通", t(0)), comment("r", "  ## 自动处理记录  \n\n### 判断\nx", t(5))] }, { text: "普通", full: "普通" }],
    ["⑧ heading quoted on line 3 is not a record", {
      comments: [comment("p", "第一行\n第二行\n## 自动处理记录 见上", t(0))],
    }, { text: "第一行\n第二行\n## 自动处理记录 见上", full: "第一行\n第二行\n## 自动处理记录 见上" }],
    ["⑨ 200-char paragraph then a second one", { comments: [comment("p", `${LONG_PARAGRAPH}\n\n第二段`, t(0))] }, { text: LONG_PARAGRAPH, full: `${LONG_PARAGRAPH}\n\n第二段` }],
    ["⑩ no blank line → first paragraph is everything", { comments: [comment("p", "一行\n两行", t(0))] }, { text: "一行\n两行", full: "一行\n两行" }],
    ["C11 blank comment is skipped", { comments: [comment("p", "可用", t(0)), comment("b", "   \n  ", t(9))] }, { text: "可用", full: "可用" }],
    ["C11 invalid createdAt sorts oldest", {
      comments: [comment("p", "有时间", t(0)), { id: "x", body: "无时间", createdAt: "not a date" }, { id: "y", body: "缺时间" } as never],
    }, { text: "有时间", full: "有时间" }],
  ])("%s", (_name, overrides, expected) => {
    const task = blockedCard("a", overrides);
    expect(() => inboxReasonText(task)).not.toThrow();
    expect(inboxReasonText(task)).toEqual(expected);
  });

  it("does not change the reason kind or severity of blockedUnknown rows", () => {
    const task = blockedCard("a", { comments: [comment("p", "原因在评论里", iso(NOW - HOUR))] });
    const [row] = buildWorkspaceInbox(WS, [task], [resolverBoard()], NOW, () => []).active;
    expect(row.reason).toBe("blockedUnknown");
    expect(row.severity).toBe(3);
    expect(inboxReason(row.item, task)).toBe("blockedUnknown");
    expect(inboxSeverity("blockedUnknown")).toBe(3);
  });
});

// ── F3: random cross-check against an independent judge ────────────────────

const RESOLVER = "kanban-blocked-resolver";
const HEADINGS = ["## 自动处理记录", "## Auto Resolution Record"];
const MAX = 160;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Case { task: TaskInfo; board: KanbanBoardInfo }

function generate(random: () => number): Case {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const blockedId = pick(["blocked", "stuck"]);
  const automation = pick<Automation | "none" | undefined>([
    "none",
    undefined,
    { enabled: false } as Automation,
    RESOLVER_AUTOMATION,
    MIRROR_ONLY as Automation,
    OTHER_STEP as Automation,
    { enabled: false, steps: [{ id: "s", specialistId: RESOLVER }] } as Automation,
  ]);
  const board = resolverBoard(automation === "none" ? undefined : automation, blockedId);
  if (automation === "none") board.columns = board.columns.filter((column) => column.stage !== "blocked");
  const columns = ["dev", "review", "done", "blocked", "stuck"];
  const base = Date.UTC(2026, 9, 27, 6, 0);
  const sessions = Array.from({ length: Math.floor(random() * 4) }, () => blockedRun(
    base + Math.floor(random() * 4 * HOUR),
    pick(["running", "completed", "failed"] as const),
    random() < 0.6 ? blockedId : pick(columns),
  ));
  const category = pick([undefined, "landed", "superseded", "handed_off", "waiting", "needs_owner", "rolled_back"]);
  const bodies = ["原因 A\n\n细节", "  ## 自动处理记录  \n### 判断", "## 自动处理记录\nx", "## Auto Resolution Record\nx", "正文\n引用 ## 自动处理记录", "   ", `${"长".repeat(170)}\n\n二`, "单行"];
  const comments = Array.from({ length: Math.floor(random() * 7) }, (_, index) => ({
    id: `c${index}`,
    body: pick(bodies),
    createdAt: random() < 0.1 ? "bad" : iso(base + Math.floor(random() * 60) * 60_000),
  }));
  const task = card("t", {
    columnId: random() < 0.5 ? blockedId : pick(columns),
    laneSessions: sessions,
    lastSyncError: random() < 0.2 ? "err" : undefined,
    comments,
    ...(category ? { attentionResolution: resolution(category, { resolvedAt: iso(base + Math.floor(random() * 4 * HOUR)) }) } : {}),
  });
  return { task, board };
}

/** Independent reading of the requirement; imports nothing from the implementation. */
function judge({ task, board }: Case) {
  const time = (value?: string) => {
    const parsed = Date.parse(value ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const lane = board.columns.find((column) => column.stage === "blocked");
  const automation = lane?.automation as { enabled?: boolean; specialistId?: string; steps?: Array<{ specialistId?: string }> } | undefined;
  const enabled = automation?.enabled === true
    && ((automation.steps ?? []).some((step) => step.specialistId === RESOLVER) || automation.specialistId === RESOLVER);
  const inBlocked = Boolean(lane) && task.columnId === lane!.id;
  const laneRuns = (task.laneSessions ?? []).filter((session) => lane && session.columnId === lane.id);
  const running = laneRuns.length > 0 && laneRuns[laneRuns.length - 1].status === "running";
  const resolutionValue = task.attentionResolution;
  // needs_owner holds in a lane with id "blocked", or until a run starts after it.
  const needsOwner = resolutionValue?.category === "needs_owner"
    && (task.columnId === "blocked" || !(task.laneSessions ?? []).some((session) => time(session.startedAt) > time(resolutionValue.resolvedAt)));
  const handlerValue = !inBlocked || !enabled ? "owner" : needsOwner ? "owner" : running ? "aiRunning" : "aiQueued";
  const canHandOff = inBlocked && enabled && !running;
  let reason: { text: string; full: string; shown: string } | null = null;
  if (!task.lastSyncError?.trim()) {
    let best: { body: string; at: number; index: number } | null = null;
    (task.comments ?? []).forEach((entry, index) => {
      const body = entry.body.trim();
      if (!body || HEADINGS.includes(body.split("\n")[0].trim())) return;
      const at = time(entry.createdAt);
      if (!best || at > best.at || (at === best.at && index > best.index)) best = { body, at, index };
    });
    if (best) {
      const { body } = best as { body: string };
      const blank = body.search(/\n[ \t]*\n/u);
      const text = (blank === -1 ? body : body.slice(0, blank)).trim();
      reason = { text, full: body, shown: text.length > MAX ? `${text.slice(0, MAX)}…` : text };
    }
  }
  return { handler: handlerValue, canHandOff, reason };
}

type Impl = {
  handler: typeof inboxHandler;
  canHandOff: typeof canHandOffToAi;
  reasonText: typeof inboxReasonText;
};

const REAL: Impl = { handler: inboxHandler, canHandOff: canHandOffToAi, reasonText: inboxReasonText };

function crossCheck(impl: Impl, count: number, seed: number): { mismatches: number; first?: unknown } {
  const random = mulberry32(seed);
  let mismatches = 0;
  let first: unknown;
  for (let index = 0; index < count; index += 1) {
    const sample = generate(random);
    const expected = judge(sample);
    const text = impl.reasonText(sample.task);
    const actual = {
      handler: impl.handler({ task: sample.task }, sample.board),
      canHandOff: impl.canHandOff({ task: sample.task }, sample.board),
      reason: text ? { ...text, shown: text.text.length > MAX ? `${text.text.slice(0, MAX)}…` : text.text } : null,
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches += 1;
      first ??= { sample, expected, actual };
    }
  }
  return { mismatches, first };
}

describe("F3 random cross-check (10,000 cases)", () => {
  it("matches the independent judge on every case", () => {
    const result = crossCheck(REAL, 10_000, 4877583);
    expect(result.first).toBeUndefined();
    expect(result.mismatches).toBe(0);
  });

  it("catches a planted bug: newest comment by array order instead of createdAt", () => {
    const planted: Impl = {
      ...REAL,
      reasonText: (task) => inboxReasonText(task, (task.comments ?? []).map((entry, index) => ({ ...entry, createdAt: iso(index) }))),
    };
    expect(crossCheck(planted, 2_000, 1).mismatches).toBeGreaterThan(0);
  });

  it("catches a planted bug: running read from the first Blocked run", () => {
    const planted: Impl = {
      ...REAL,
      handler: (row, board) => inboxHandler({ task: { ...row.task, laneSessions: [...(row.task.laneSessions ?? [])].reverse() } }, board),
    };
    expect(crossCheck(planted, 2_000, 2).mismatches).toBeGreaterThan(0);
  });
});
