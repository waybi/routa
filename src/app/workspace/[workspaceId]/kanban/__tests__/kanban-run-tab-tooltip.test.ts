import { describe, expect, it } from "vitest";
import { enTail } from "@/i18n/locales/en-tail";
import { zhTail } from "@/i18n/locales/zh-tail";
import { buildRunTabTooltip, type RunTabTooltipInput } from "../kanban-run-tab-tooltip";

const zh = zhTail.kanbanDetailRedesign.runTabTooltip;
const en = enTail.kanbanDetailRedesign.runTabTooltip;
const NOW = new Date("2026-10-23T08:00:00.000Z");

/** Local-time HH:MM computed independently, so the assertions pass in any TZ. */
function hhmm(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function build(overrides: Partial<RunTabTooltipInput>): string {
  return buildRunTabTooltip({ index: 0, now: NOW, copy: zh, ...overrides });
}

// Real samples from card 92744a50 (tabs 7, 10 and 4).
const RUN_7 = { index: 6, columnId: "dev", status: "timed_out", startedAt: "2026-10-23T02:48:16Z", completedAt: "2026-10-23T03:47:26Z", stepLabel: "Flight Dev Crafter" };
const RUN_10 = { index: 9, columnId: "review", status: "failed", startedAt: "2026-10-23T04:04:28Z", completedAt: "2026-10-23T04:05:18Z", stepLabel: "Flight Dev Crafter" };
const RUN_4 = { index: 3, columnId: "dev", status: "completed", startedAt: "2026-10-23T02:04:15Z", completedAt: "2026-10-23T02:40:16Z", stepLabel: "Flight Dev Crafter" };

describe("buildRunTabTooltip — real samples (C1)", () => {
  it("tab 7: dev / timed_out / 59 minutes", () => {
    expect(build(RUN_7)).toBe([
      "第 7 次 · 开发：按计划写代码",
      "超时：长时间没动静，系统判它卡住了",
      `${hhmm(RUN_7.startedAt)}–${hhmm(RUN_7.completedAt)}，用时 59 分钟`,
      "Flight Dev Crafter",
    ].join("\n"));
  });

  it("tab 10: review / failed / under a minute shows seconds", () => {
    expect(build(RUN_10)).toBe([
      "第 10 次 · 验收：检查做得对不对",
      "出错：中途报错退出（想看原因点开这一片看右侧记录）",
      `${hhmm(RUN_10.startedAt)}–${hhmm(RUN_10.completedAt)}，用时 50 秒`,
      "Flight Dev Crafter",
    ].join("\n"));
  });

  it("tab 4: dev / completed / 36 minutes", () => {
    expect(build(RUN_4)).toBe([
      "第 4 次 · 开发：按计划写代码",
      "已完成",
      `${hhmm(RUN_4.startedAt)}–${hhmm(RUN_4.completedAt)}，用时 36 分钟`,
      "Flight Dev Crafter",
    ].join("\n"));
  });

  it("shows 10:48–11:47 for tab 7 when the local zone is UTC+8", () => {
    if (new Date(RUN_7.startedAt).getTimezoneOffset() !== -480) return;
    expect(build(RUN_7).split("\n")[2]).toBe("10:48–11:47，用时 59 分钟");
  });
});

describe("buildRunTabTooltip — status line (C2)", () => {
  const cases: Array<[string, string]> = [
    ["completed", "已完成"],
    ["running", "进行中"],
    ["timed_out", "超时：长时间没动静，系统判它卡住了"],
    ["failed", "出错：中途报错退出（想看原因点开这一片看右侧记录）"],
    ["transitioned", "已转入下一道工序"],
    ["unknown", "状态未记录"],
    ["paused", "paused"],
  ];

  it.each(cases)("status %s → %s", (status, expected) => {
    expect(build({ ...RUN_7, status }).split("\n")[1]).toBe(expected);
  });

  it("omits the status line when status is missing, without blank lines", () => {
    const withStatus = build(RUN_7);
    const withoutStatus = build({ ...RUN_7, status: undefined });
    expect(withoutStatus.split("\n")).toHaveLength(withStatus.split("\n").length - 1);
    expect(/\n\n/.test(withoutStatus)).toBe(false);
    expect(withoutStatus.split("\n")[1]).toContain("用时 59 分钟");
    expect(withoutStatus.endsWith("\nFlight Dev Crafter")).toBe(true);
  });
});

describe("buildRunTabTooltip — stage line (C3)", () => {
  const lanes: Array<[string, string]> = [
    ["backlog", "梳理：弄清要做什么"],
    ["todo", "计划：拆成几步"],
    ["dev", "开发：按计划写代码"],
    ["review", "验收：检查做得对不对"],
    ["done", "收尾：推送并写完成汇报"],
    ["blocked", "阻塞：卡住等处理"],
  ];

  it.each(lanes)("columnId %s → %s", (columnId, expected) => {
    expect(build({ index: 2, columnId }).split("\n")[0]).toBe(`第 3 次 · ${expected}`);
  });

  it("unknown column prefers columnName and adds no explanation", () => {
    const line = build({ index: 2, columnId: "qa-extra", columnName: "QA Extra" }).split("\n")[0];
    expect(line).toBe("第 3 次 · QA Extra");
    expect(line).not.toContain("：");
  });

  it("unknown column without a name falls back to columnId", () => {
    expect(build({ index: 2, columnId: "qa-extra" }).split("\n")[0]).toBe("第 3 次 · qa-extra");
  });

  it("missing column shows only the run index", () => {
    expect(build({ index: 2 })).toBe("第 3 次");
  });

  it("known columnId wins over a custom columnName", () => {
    expect(build({ index: 0, columnId: "dev", columnName: "Dev" }).split("\n")[0]).toBe("第 1 次 · 开发：按计划写代码");
  });
});

describe("buildRunTabTooltip — time line (C4, C11–C14)", () => {
  it("running without completedAt shows elapsed time against now", () => {
    const startedAt = "2026-10-23T07:35:00.000Z";
    const now = new Date(new Date(startedAt).getTime() + 25 * 60_000);
    const lines = build({ ...RUN_7, status: "running", completedAt: undefined, startedAt, now }).split("\n");
    expect(lines[1]).toBe("进行中");
    expect(lines[2]).toBe(`${hhmm(startedAt)} 开始，已进行 25 分钟`);
  });

  it("omits the time line when startedAt is missing", () => {
    const text = build({ ...RUN_7, startedAt: undefined });
    expect(text).toBe(["第 7 次 · 开发：按计划写代码", "超时：长时间没动静，系统判它卡住了", "Flight Dev Crafter"].join("\n"));
    expect(/\n\n/.test(text)).toBe(false);
  });

  it.each([
    [59, "59 秒"],
    [60, "1 分钟"],
    [89, "1 分钟"],
  ])("duration of %i seconds → %s", (seconds, expected) => {
    const startedAt = "2026-10-23T05:00:00.000Z";
    const completedAt = new Date(new Date(startedAt).getTime() + seconds * 1000).toISOString();
    expect(build({ startedAt, completedAt }).split("\n")[1].endsWith(`用时 ${expected}`)).toBe(true);
  });

  it("index 0 is shown as run 1", () => {
    expect(build({ index: 0, columnId: "dev" }).split("\n")[0]).toBe("第 1 次 · 开发：按计划写代码");
  });

  it("crosses midnight without negative numbers (C11)", () => {
    const startedAt = new Date(2026, 9, 23, 23, 50).toISOString();
    const completedAt = new Date(2026, 9, 24, 0, 10).toISOString();
    expect(build({ startedAt, completedAt })).toBe("第 1 次\n23:50–00:10，用时 20 分钟");
  });

  it("long runs stay in minutes (C12)", () => {
    const startedAt = "2026-10-23T01:00:00.000Z";
    const completedAt = "2026-10-23T03:05:00.000Z";
    expect(build({ startedAt, completedAt }).endsWith("用时 125 分钟")).toBe(true);
  });

  it("invalid or reversed times never print NaN or a minus sign (C13)", () => {
    expect(build({ ...RUN_7, startedAt: "not-a-date" }).split("\n")).toHaveLength(3);
    const reversed = build({ ...RUN_7, completedAt: "2026-10-23T02:00:00Z" });
    expect(/NaN/.test(reversed)).toBe(false);
    expect(reversed).not.toContain("-");
  });

  it("upper-case columnId still maps to the stage (C14)", () => {
    expect(build({ index: 0, columnId: "DEV" }).split("\n")[0]).toBe("第 1 次 · 开发：按计划写代码");
  });
});

describe("buildRunTabTooltip — en copy (C5)", () => {
  it("tab 7 in English", () => {
    expect(buildRunTabTooltip({ ...RUN_7, now: NOW, copy: en })).toBe([
      "Run 7 · Dev: write code per plan",
      "Timed out: no activity for a long time, judged stuck",
      `${hhmm(RUN_7.startedAt)}–${hhmm(RUN_7.completedAt)}, 59 min`,
      "Flight Dev Crafter",
    ].join("\n"));
  });

  it("every en status and stage is non-empty and has no CJK characters", () => {
    for (const value of [...Object.values(en.statuses), ...Object.values(en.lanes)]) {
      expect(value.trim().length).toBeGreaterThan(0);
      expect(/[\u3000-\u9fff\uff00-\uffef]/.test(value)).toBe(false);
    }
  });

  it("leaves no unfilled placeholders in zh or en output", () => {
    const statuses = ["completed", "running", "timed_out", "failed", "transitioned", "unknown"];
    for (const copy of [zh, en]) {
      for (const status of statuses) {
        for (const completedAt of [RUN_7.completedAt, RUN_10.completedAt, undefined]) {
          const text = buildRunTabTooltip({ ...RUN_7, status, completedAt, now: NOW, copy });
          expect(/\{[a-z]+\}/.test(text)).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// F3 random cross-check. The oracle below is written from the AC text only and
// does not import any mapping table or formatter from the module under test.
// ---------------------------------------------------------------------------

const ORACLE = {
  zh: {
    run: (n: number) => `第 ${n} 次`,
    lanes: { backlog: "梳理：弄清要做什么", todo: "计划：拆成几步", dev: "开发：按计划写代码", review: "验收：检查做得对不对", done: "收尾：推送并写完成汇报", blocked: "阻塞：卡住等处理" } as Record<string, string>,
    statuses: { completed: "已完成", running: "进行中", timed_out: "超时：长时间没动静，系统判它卡住了", failed: "出错：中途报错退出（想看原因点开这一片看右侧记录）", transitioned: "已转入下一道工序", unknown: "状态未记录" } as Record<string, string>,
    range: (s: string, e: string, d: string) => `${s}–${e}，用时 ${d}`,
    ongoing: (s: string, d: string) => `${s} 开始，已进行 ${d}`,
    min: (n: number) => `${n} 分钟`,
    sec: (n: number) => `${n} 秒`,
  },
  en: {
    run: (n: number) => `Run ${n}`,
    lanes: { backlog: "Backlog: figure out what to build", todo: "Plan: break it into steps", dev: "Dev: write code per plan", review: "Review: check the work is right", done: "Wrap-up: push and write the completion report", blocked: "Blocked: stuck, waiting for help" } as Record<string, string>,
    statuses: { completed: "Completed", running: "Running", timed_out: "Timed out: no activity for a long time, judged stuck", failed: "Failed: exited with an error (open this run to see the log on the right)", transitioned: "Moved on to the next stage", unknown: "Status not recorded" } as Record<string, string>,
    range: (s: string, e: string, d: string) => `${s}–${e}, ${d}`,
    ongoing: (s: string, d: string) => `Started ${s}, running for ${d}`,
    min: (n: number) => `${n} min`,
    sec: (n: number) => `${n} s`,
  },
};

type OracleCase = Omit<RunTabTooltipInput, "copy"> & { lang: "zh" | "en" };

function oracle(c: OracleCase, round: (x: number) => number = Math.round): string {
  const o = ORACLE[c.lang];
  const lines: string[] = [];
  const known = c.columnId ? o.lanes[c.columnId.toLowerCase()] : undefined;
  const lane = known ?? (c.columnName || c.columnId);
  lines.push(lane ? `${o.run(c.index + 1)} · ${lane}` : o.run(c.index + 1));
  if (c.status) lines.push(o.statuses[c.status] ?? c.status);
  const start = c.startedAt ? new Date(c.startedAt) : null;
  if (start && !Number.isNaN(start.getTime())) {
    const clock = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const dur = (ms: number) => (ms < 60_000 ? o.sec(Math.floor(Math.max(ms, 0) / 1000)) : o.min(round(ms / 60_000)));
    const end = c.completedAt ? new Date(c.completedAt) : null;
    lines.push(end && !Number.isNaN(end.getTime())
      ? o.range(clock(start), clock(end), dur(end.getTime() - start.getTime()))
      : o.ongoing(clock(start), dur(c.now.getTime() - start.getTime())));
  }
  if (c.stepLabel) lines.push(c.stepLabel);
  return lines.join("\n");
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCases(seed: number, count: number): OracleCase[] {
  const rand = mulberry32(seed);
  const pick = <T,>(items: T[]): T => items[Math.floor(rand() * items.length)];
  const randomWord = () => `col-${Math.floor(rand() * 1e6).toString(36)}`;
  const cases: OracleCase[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = Date.UTC(2026, 9, 23) + Math.floor(rand() * 2 * 86_400_000);
    const durationMs = Math.floor(rand() * 300 * 60_000);
    const startKind = pick(["ok", "ok", "ok", "missing", "invalid"]);
    cases.push({
      lang: i % 2 === 0 ? "zh" : "en",
      index: Math.floor(rand() * 51),
      columnId: pick(["backlog", "todo", "dev", "review", "done", "blocked", randomWord(), randomWord(), randomWord(), undefined]),
      columnName: rand() < 0.5 ? `Lane ${Math.floor(rand() * 100)}` : undefined,
      status: pick(["completed", "running", "timed_out", "failed", "transitioned", "unknown", `s-${Math.floor(rand() * 1e4)}`, undefined]),
      startedAt: startKind === "ok" ? new Date(base).toISOString() : startKind === "invalid" ? "not-a-date" : undefined,
      completedAt: rand() < 0.6 ? new Date(base + durationMs).toISOString() : undefined,
      stepLabel: rand() < 0.8 ? `Step ${Math.floor(rand() * 10)}` : undefined,
      now: new Date(base + durationMs),
    });
  }
  return cases;
}

describe("buildRunTabTooltip — random cross-check (F3)", () => {
  const seed = Number(process.env.RUN_TAB_TOOLTIP_SEED ?? 20261023);
  const cases = randomCases(seed, 10_000);
  const plantBug = process.env.RUN_TAB_TOOLTIP_PLANT_BUG === "1";

  it(`matches the AC oracle on 10,000 random inputs (seed ${seed})`, () => {
    const mismatches = cases.filter((c) => {
      const { lang, ...input } = c;
      const actual = buildRunTabTooltip({ ...input, copy: lang === "zh" ? zh : en });
      return actual !== oracle(c, plantBug ? Math.floor : Math.round);
    });
    expect(mismatches.slice(0, 3)).toEqual([]);
    expect(mismatches).toHaveLength(0);
  });

  it("the cross-check catches a planted difference (floor instead of round)", () => {
    const caught = cases.filter((c) => oracle(c, Math.floor) !== oracle(c, Math.round));
    expect(caught.length).toBeGreaterThan(0);
  });
});
