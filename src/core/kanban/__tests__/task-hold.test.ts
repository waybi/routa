/**
 * Card beb29624 (C1, F3): isTaskOnHold is the only test of the "hold" label.
 */
import { describe, expect, it } from "vitest";
import { HOLD_LABEL, isTaskOnHold, ON_HOLD_ERROR } from "../task-hold";

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
