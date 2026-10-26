/**
 * Lane status color mapping (card 42b16b6d, AC2): a column's color follows
 * its stage, never its display name; anything unknown is grey (backlog).
 */
import { describe, expect, it } from "vitest";
import { KANBAN_LANE_TONES, laneToneVar, resolveLaneTone } from "../kanban-lane-tone";

const STAGES = ["backlog", "todo", "dev", "review", "done", "blocked"] as const;

describe("laneToneVar", () => {
  it.each(STAGES)("known stage %s maps to its own variable", (stage) => {
    expect(laneToneVar(stage)).toBe(`var(--lane-${stage})`);
    expect(resolveLaneTone(stage)).toBe(stage);
  });

  it("unknown stage, empty string, null and undefined fall back to backlog grey", () => {
    expect(laneToneVar("qa")).toBe("var(--lane-backlog)");
    expect(laneToneVar("")).toBe("var(--lane-backlog)");
    expect(laneToneVar(null)).toBe("var(--lane-backlog)");
    expect(laneToneVar(undefined)).toBe("var(--lane-backlog)");
  });

  it("a custom-named column takes its color from the stage, not the name", () => {
    const column = { id: "acceptance", name: "待验收", stage: "review" };
    expect(laneToneVar(column.stage)).toBe("var(--lane-review)");
    expect(laneToneVar(column.name)).toBe("var(--lane-backlog)");
  });

  it("exposes exactly the six board stages", () => {
    expect([...KANBAN_LANE_TONES]).toEqual([...STAGES]);
  });
});

/** Independent judge written from the requirement, not from the implementation. */
function judge(input: string, planted = false): string {
  if (planted && input === "review") return "var(--lane-dev)";
  return (STAGES as readonly string[]).includes(input) ? `var(--lane-${input})` : "var(--lane-backlog)";
}

/** Deterministic PRNG so a failure is reproducible. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateInputs(count: number, seed: number): string[] {
  const random = mulberry32(seed);
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  const inputs: string[] = [];
  for (const stage of STAGES) for (let i = 0; i < 100; i += 1) inputs.push(stage);
  while (inputs.length < count) {
    const length = Math.floor(random() * 12);
    let value = "";
    for (let i = 0; i < length; i += 1) value += alphabet[Math.floor(random() * alphabet.length)];
    if ((STAGES as readonly string[]).includes(value)) continue;
    inputs.push(value);
  }
  return inputs;
}

describe("laneToneVar random cross-check (10,000 inputs)", () => {
  const inputs = generateInputs(10_000, 42);

  it("matches the independent judge on every input", () => {
    const mismatches = inputs.filter((input) => laneToneVar(input) !== judge(input));
    expect(inputs).toHaveLength(10_000);
    expect(mismatches).toEqual([]);
  });

  it("the judge catches a planted difference (review answered as dev)", () => {
    const mismatches = inputs.filter((input) => laneToneVar(input) !== judge(input, true));
    expect(mismatches).toHaveLength(100);
  });
});
