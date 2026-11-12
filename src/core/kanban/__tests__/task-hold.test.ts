/**
 * Card beb29624 (C1, F3): isTaskOnHold is the only test of the "hold" label.
 * Card a00fb67b (L400, C1, F3): getTaskHold / isTaskHeldFor for "hold:<role>".
 */
import { describe, expect, it } from "vitest";
import {
  formatHoldRetryMessage,
  formatRoleHoldSyncError,
  getTaskHold,
  HOLD_LABEL,
  isRoleHoldSyncError,
  isTaskHeldFor,
  isTaskOnHold,
  listHeldSpecialists,
  ON_HOLD_ERROR,
} from "../task-hold";

describe("C1: isTaskOnHold", () => {
  it.each([
    [["hold"]],
    [["HOLD"]],
    [["Hold"]],
    [[" hold "]],
    [["req:x", "hold"]],
  ])("labels %j → true", (labels) => {
    expect(isTaskOnHold({ labels })).toBe(true);
  });

  it.each([
    [{ labels: [] }],
    [{ labels: undefined }],
    [{ labels: null }],
    [null],
    [undefined],
    [{ labels: ["hold-xxx"] }],
    [{ labels: ["onhold"] }],
    [{ labels: ["req:hold"] }],
    [{ labels: ["deploy:host"] }],
    [{ labels: [1, null, { hold: true }] as unknown[] }],
  ])("%j → false, no throw", (task) => {
    expect(() => isTaskOnHold(task as never)).not.toThrow();
    expect(isTaskOnHold(task as never)).toBe(false);
  });

  it("exports the label and the skip error", () => {
    expect(HOLD_LABEL).toBe("hold");
    expect(ON_HOLD_ERROR).toBe("on_hold");
  });
});

/** Seeded generator (mulberry32): same labels every run. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL = ["hold", "HOLD", "Hold", "hOlD", " hold", "hold ", "\thold\n", "hold-xxx", "onhold", "req:hold", "holder", "deploy:host", "req:x", ""];

function randomLabels(next: () => number): string[] | null {
  if (next() < 0.05) return null;
  const count = Math.floor(next() * 6);
  return Array.from({ length: count }, () => (next() < 0.8
    ? POOL[Math.floor(next() * POOL.length)]
    : next().toString(36).slice(2, 2 + Math.floor(next() * 6))));
}

/** The answer computed from the requirement, independent of the implementation. */
const expected = (labels: string[] | null) => (labels ?? []).some((label) => label.trim().toLowerCase() === "hold");

function countMismatches(judge: (labels: string[] | null) => boolean, groups: number): number {
  const next = rng(20261105);
  let mismatches = 0;
  for (let index = 0; index < groups; index += 1) {
    const labels = randomLabels(next);
    if (judge(labels) !== expected(labels)) mismatches += 1;
  }
  return mismatches;
}

describe("F3: 10,000 random label sets against the requirement", () => {
  it("a planted includes('hold') judge is caught (the cross-check can see a bug)", () => {
    const planted = (labels: string[] | null) => (labels ?? []).some((label) => label.toLowerCase().includes("hold"));
    expect(countMismatches(planted, 10_000)).toBeGreaterThan(0);
  });

  it("isTaskOnHold: 0 mismatches", () => {
    expect(countMismatches((labels) => isTaskOnHold({ labels }), 10_000)).toBe(0);
  });
});

/* Card a00fb67b (L400, C1, F3): "hold:<role>" holds only the named role. */
const PUSHER = "kanban-main-pusher";
const GUARD = "kanban-review-guard";

describe("C1: getTaskHold / isTaskHeldFor case by case", () => {
  it.each([
    ["role label, asked for that role", ["hold:kanban-main-pusher"], PUSHER, { held: true, scope: "role", specialistId: PUSHER }],
    ["role label, asked for another role", ["hold:kanban-main-pusher"], GUARD, { held: false }],
    ["role label, no role given", ["hold:kanban-main-pusher"], undefined, { held: false }],
    ["role label, empty role given", ["hold:kanban-main-pusher"], "  ", { held: false }],
    ["whole-card hold, any role", ["hold"], GUARD, { held: true, scope: "card" }],
    ["whole-card hold, no role", ["hold"], undefined, { held: true, scope: "card" }],
    ["whole-card hold wins over a role label", ["hold:kanban-main-pusher", "HOLD"], PUSHER, { held: true, scope: "card" }],
    ["case and spaces ignored", [" HOLD:Kanban-Main-Pusher "], PUSHER, { held: true, scope: "role", specialistId: PUSHER }],
    ["asked role in other case", ["hold:kanban-main-pusher"], " Kanban-Main-Pusher ", { held: true, scope: "role", specialistId: PUSHER }],
    ["spaces after the colon", ["hold:  kanban-main-pusher"], PUSHER, { held: true, scope: "role", specialistId: PUSHER }],
    ["empty role holds nothing", ["hold:"], PUSHER, { held: false }],
    ["empty role (spaces) holds nothing", ["hold:   "], undefined, { held: false }],
    ["two roles, first", ["hold:a", "hold:b"], "a", { held: true, scope: "role", specialistId: "a" }],
    ["two roles, second", ["hold:a", "hold:b"], "b", { held: true, scope: "role", specialistId: "b" }],
    ["two roles, third role passes", ["hold:a", "hold:b"], "c", { held: false }],
    ["empty labels", [], PUSHER, { held: false }],
    ["role prefix only as substring", ["req:hold:kanban-main-pusher", "holdkanban-main-pusher"], PUSHER, { held: false }],
  ] as const)("%s", (_label, labels, role, expected) => {
    const task = { labels: labels as readonly string[] };
    expect(getTaskHold(task, role)).toEqual(expected);
    expect(isTaskHeldFor(task, role)).toBe(expected.held);
  });

  it.each([[{}], [{ labels: null }], [{ labels: undefined }], [null], [undefined], [{ labels: [1, null, { hold: true }] as unknown[] }]])(
    "%j: never held, no throw",
    (task) => {
      expect(getTaskHold(task as never, PUSHER)).toEqual({ held: false });
      expect(isTaskHeldFor(task as never)).toBe(false);
    },
  );

  it("isTaskOnHold keeps its meaning: a card with only hold:x is not on hold", () => {
    expect(isTaskOnHold({ labels: ["hold:x"] })).toBe(false);
    expect(isTaskOnHold({ labels: ["hold:x", "hold"] })).toBe(true);
  });

  it("listHeldSpecialists: trimmed, lower case, no duplicates, empty roles dropped", () => {
    expect(listHeldSpecialists({ labels: ["hold:B", " hold:a ", "hold:b", "hold:", "hold", "req:x"] })).toEqual(["b", "a"]);
  });

  it("texts: the lastSyncError says 'hold:<role> 拦下' and the 409 message names the role", () => {
    const text = formatRoleHoldSyncError(PUSHER);
    expect(text).toContain("hold:kanban-main-pusher 拦下");
    expect(isRoleHoldSyncError(text)).toBe(true);
    expect(isRoleHoldSyncError("旧的失败")).toBe(false);
    expect(isRoleHoldSyncError(undefined)).toBe(false);
    expect(formatHoldRetryMessage({ held: true, scope: "role", specialistId: PUSHER })).toContain("hold:kanban-main-pusher");
    expect(formatHoldRetryMessage({ held: true, scope: "card" })).toBe("卡片带 hold 标签（暂不派），去掉标签后再重跑");
    expect(formatHoldRetryMessage({ held: false })).toBe("卡片带 hold 标签（暂不派），去掉标签后再重跑");
  });
});

const ROLES = ["kanban-main-pusher", "kanban-review-guard", "kanban-done-reporter", "a", "b"];
const ROLE_POOL = [
  "hold", "HOLD", " hold ", "hold:", "hold: ", "hold-xxx", "req:hold", "deploy:host", "req:x", "",
  ...ROLES.flatMap((role) => [`hold:${role}`, `HOLD:${role.toUpperCase()}`, ` hold:${role} `, `hold: ${role}`, `hold:${role}x`]),
];

function randomRoleLabels(next: () => number): string[] | null {
  if (next() < 0.05) return null;
  const count = Math.floor(next() * 6);
  return Array.from({ length: count }, () => ROLE_POOL[Math.floor(next() * ROLE_POOL.length)]);
}

/**
 * Judge written from the requirement text (no import of the module under
 * test): plain "hold" holds every role; "hold:<role>" holds that role;
 * case-insensitive, outer spaces ignored, empty role holds nothing.
 */
function requirementJudge(labels: string[] | null, role: string | undefined, caseSensitive = false): boolean {
  const norm = (value: string) => (caseSensitive ? value.trim() : value.trim().toLowerCase());
  const list = (labels ?? []).map(norm);
  if (list.includes("hold")) return true;
  if (!role || !norm(role)) return false;
  return list.some((label) => label.startsWith("hold:") && label.slice(5).trim() !== "" && label.slice(5).trim() === norm(role));
}

function countRoleMismatches(judge: typeof requirementJudge, groups: number): number {
  const next = rng(20261110);
  let mismatches = 0;
  for (let index = 0; index < groups; index += 1) {
    const labels = randomRoleLabels(next);
    const pick = Math.floor(next() * (ROLES.length + 2));
    const role = pick < ROLES.length ? ROLES[pick] : pick === ROLES.length ? undefined : ROLES[0].toUpperCase();
    if (judge(labels, role) !== isTaskHeldFor({ labels }, role)) mismatches += 1;
  }
  return mismatches;
}

describe("F3: 10,000 random label sets × roles against the requirement", () => {
  it("a planted case-sensitive judge is caught (the cross-check can see a bug)", () => {
    expect(countRoleMismatches((labels, role) => requirementJudge(labels, role, true), 10_000)).toBeGreaterThan(0);
  });

  it("isTaskHeldFor: 0 mismatches in 10,000 groups", () => {
    expect(countRoleMismatches((labels, role) => requirementJudge(labels, role), 10_000)).toBe(0);
  });
});
