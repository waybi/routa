import { describe, expect, it } from "vitest";

import { sortSidebarWorkspaces, type SidebarWorkspace } from "../shell/use-sidebar-workspaces";

/**
 * F3: seeded random cross-check of the Projects order against a judge written
 * from the card rule only (调研结论第 5 节): current workspace first; the rest
 * by createdAt ascending; "default" last unless it is current. Missing or
 * equal dates are a stability detail the card leaves open; the judge only
 * checks the rules the card states, and the full output for valid dates.
 */

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

const SEED = 20261023;
const CASES = 10_000;

/** Judge: partition into [current] + others-by-date + [default]. */
function judgeOrder(list: SidebarWorkspace[], currentId: string | null): string[] {
  const current = list.filter((w) => w.id === currentId);
  const defaults = list.filter((w) => w.id === "default" && w.id !== currentId);
  const rest = list.filter((w) => w.id !== currentId && w.id !== "default");
  const time = (w: SidebarWorkspace) => (w.createdAt ? new Date(w.createdAt).getTime() : Infinity);
  // Insertion sort by (time, id) — deliberately a different algorithm from the implementation.
  const sorted: SidebarWorkspace[] = [];
  for (const w of rest) {
    let i = sorted.length;
    while (i > 0) {
      const prev = sorted[i - 1];
      const before = time(prev) < time(w) || (time(prev) === time(w) && prev.id <= w.id);
      if (before) break;
      i -= 1;
    }
    sorted.splice(i, 0, w);
  }
  return [...current, ...sorted, ...defaults].map((w) => w.id);
}

function randomCase(rand: () => number) {
  const count = Math.floor(rand() * 31);
  const ids = new Set<string>();
  if (rand() < 0.5) ids.add("default");
  while (ids.size < count) ids.add(`ws-${Math.floor(rand() * 1000)}`);
  const list: SidebarWorkspace[] = [...ids].map((id) => {
    const r = rand();
    // ~15% missing dates, many duplicates (only 12 distinct days)
    const createdAt = r < 0.15 ? undefined : new Date(Date.UTC(2026, 9, 1 + Math.floor(rand() * 12))).toISOString();
    return { id, title: id.toUpperCase(), createdAt };
  });
  const pick = rand();
  const currentId =
    pick < 0.2 ? null : pick < 0.35 ? "ws-outside" : list.length ? list[Math.floor(rand() * list.length)].id : null;
  return { list, currentId };
}

describe("Projects order random cross-check (F3)", () => {
  it(`matches the independent judge on ${CASES} seeded cases (seed ${SEED})`, () => {
    const rand = mulberry32(SEED);
    const mismatches: string[] = [];
    for (let i = 0; i < CASES; i += 1) {
      const { list, currentId } = randomCase(rand);
      const actual = sortSidebarWorkspaces(list, currentId).map((w) => w.id);
      const expected = judgeOrder(list, currentId);
      if (actual.join(",") !== expected.join(",")) {
        mismatches.push(`#${i} current=${currentId} got=${actual.join(",")} want=${expected.join(",")}`);
        if (mismatches.length >= 3) break;
      }
    }
    expect(mismatches, mismatches.join("\n")).toEqual([]);
  });

  it("orders the routa.db sample as in the sketch", () => {
    const sample: SidebarWorkspace[] = [
      { id: "default", title: "Default Workspace", createdAt: "2026-01-01T00:00:00Z" },
      { id: "topbi", title: "TopBI", createdAt: "2026-01-02T00:00:00Z" },
      { id: "routa", title: "Routa", createdAt: "2026-01-03T00:00:00Z" },
      { id: "dh", title: "deepseek-harness", createdAt: "2026-01-04T00:00:00Z" },
      { id: "lt", title: "local-tools", createdAt: "2026-01-05T00:00:00Z" },
      { id: "tn", title: "turnilo", createdAt: "2026-01-06T00:00:00Z" },
    ];
    expect(sortSidebarWorkspaces(sample, "routa").map((w) => w.title)).toEqual([
      "Routa",
      "TopBI",
      "deepseek-harness",
      "local-tools",
      "turnilo",
      "Default Workspace",
    ]);
    expect(sortSidebarWorkspaces(sample, "default")[0].id).toBe("default");
  });
});
