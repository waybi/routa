import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PULL_COOLDOWN_MS,
  pullWithCooldown,
  resetPullCooldown,
  setPullCooldownClock,
} from "../pull-cooldown";

const MIN = 60 * 1000;

describe("pullWithCooldown", () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    resetPullCooldown();
    setPullCooldownClock(() => now);
  });
  afterEach(() => {
    setPullCooldownClock(null);
    resetPullCooldown();
  });

  it("skips inside 10 minutes and pulls again after", async () => {
    let calls = 0;
    const pull = async () => { calls += 1; return { success: true }; };

    expect((await pullWithCooldown("/r/a", pull)).skipped).toBe(false);
    now = 9 * MIN + 59_000;
    expect((await pullWithCooldown("/r/a", pull)).skipped).toBe(true);
    expect(calls).toBe(1);
    now = 10 * MIN + 1_000;
    expect((await pullWithCooldown("/r/a", pull)).skipped).toBe(false);
    expect(calls).toBe(2);
  });

  it("does not record failed pulls, and repos are independent", async () => {
    let calls = 0;
    const fail = async () => { calls += 1; return { success: false, error: "offline" }; };
    await pullWithCooldown("/r/a", fail);
    await pullWithCooldown("/r/a", fail);
    expect(calls).toBe(2);

    let ok = 0;
    const pass = async () => { ok += 1; return { success: true }; };
    await pullWithCooldown("/r/b", pass);
    await pullWithCooldown("/r/a", pass);
    expect(ok).toBe(2);
  });

  it("merges concurrent pulls for the same repo", async () => {
    let calls = 0;
    const slow = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { success: true };
    };
    const [x, y] = await Promise.all([pullWithCooldown("/r/a", slow), pullWithCooldown("/r/a", slow)]);
    expect(calls).toBe(1);
    expect(x.result?.success).toBe(true);
    expect(y.result?.success).toBe(true);
  });

  // F3: random events against an independently written reference model.
  async function runRandom(seed: number, windowMs: number): Promise<number> {
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    const repos = ["/x/1", "/x/2", "/x/3"];
    const events = Array.from({ length: 10_000 }, () => ({
      repo: repos[Math.floor(rnd() * 3)],
      at: Math.floor(rnd() * 30 * MIN),
      ok: rnd() > 0.3,
    })).sort((a, b) => a.at - b.at);

    const lastOk = new Map<string, number>();
    let mismatches = 0;
    {
      resetPullCooldown();
      for (const e of events) {
        now = e.at;
        const last = lastOk.get(e.repo);
        const expectSkip = last !== undefined && e.at - last < windowMs;
        const outcome = await pullWithCooldown(e.repo, async () => ({ success: e.ok }));
        if (outcome.skipped !== expectSkip) mismatches += 1;
        if (!expectSkip && e.ok) lastOk.set(e.repo, e.at);
      }
      return mismatches;
    }
  }

  it("F3: 10,000 random events match the reference model", async () => {
    expect(await runRandom(42, PULL_COOLDOWN_MS)).toBe(0);
  });

  it("F3: the judge notices a reference model with a 9 minute window", async () => {
    expect(await runRandom(42, 9 * MIN)).toBeGreaterThan(0);
  });
});
