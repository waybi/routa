import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PULL_COOLDOWN_MS,
  flushPullCooldownWrites,
  getPullCooldownFilePath,
  pullWithCooldown as rawPullWithCooldown,
  resetPullCooldown,
  setPullCooldownClock,
  setPullCooldownFile,
} from "../pull-cooldown";
import { getShortHeadAsync } from "../git-utils-async";
import { makeRepo, runGit } from "./git-test-fixtures";
import { restoreGitEnv, scrubGitEnv } from "./git-env-scrub";

type Opts = Parameters<typeof rawPullWithCooldown>[2];
const noBranch: Opts = { resolveBranch: async () => null };
// Default for legacy tests: no real git lookup (key falls back to the path).
const pullWithCooldown = (r: string, p: () => Promise<{ success: boolean; error?: string }>, o: Opts = noBranch) =>
  rawPullWithCooldown(r, p, o);
const ok = async () => ({ success: true });

const MIN = 60 * 1000;


describe("pullWithCooldown", () => {
  let now = 0;
  let dir: string;
  let file: string;
  beforeEach(() => {
    scrubGitEnv();
    now = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pull-cooldown-"));
    file = path.join(dir, "cooldown.json");
    resetPullCooldown();
    setPullCooldownFile(file);
    setPullCooldownClock(() => now);
  });
  afterEach(() => {
    setPullCooldownClock(null);
    resetPullCooldown();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    restoreGitEnv();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const readEntries = () => JSON.parse(fs.readFileSync(file, "utf8")).entries as Record<string, number>;
  const restart = () => resetPullCooldown({ keepStore: true });
  const withBranch = (b: string | null | Error): Opts => ({
    resolveBranch: async () => { if (b instanceof Error) throw b; return b; },
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

  it("C2: key is path + branch (a, b, back to a)", async () => {
    let calls = 0;
    const pull = async () => { calls += 1; return { success: true }; };
    expect((await pullWithCooldown("/r/a", pull, withBranch("a"))).skipped).toBe(false);
    expect((await pullWithCooldown("/r/a", pull, withBranch("b"))).skipped).toBe(false);
    expect((await pullWithCooldown("/r/a", pull, withBranch("a"))).skipped).toBe(true);
    expect(calls).toBe(2);
    expect(Object.keys(readEntries()).sort()).toEqual(["/r/a@@a", "/r/a@@b"]);
  });

  it("C3: detached HEAD keys on the short commit id", async () => {
    const heads = ["abc1234", "def5678", "abc1234"];
    let i = 0;
    const opts: Opts = { resolveBranch: async () => "HEAD", resolveShortHead: async () => heads[i++] };
    const skipped: boolean[] = [];
    for (let n = 0; n < 3; n++) skipped.push((await pullWithCooldown("/r/a", ok, opts)).skipped);
    expect(skipped).toEqual([false, false, true]);
    const keys = Object.keys(readEntries());
    expect(keys).toContain("/r/a@@abc1234");
    expect(keys.some((k) => k.endsWith("@@HEAD"))).toBe(false);
  });

  it("C3: real getShortHeadAsync matches git and returns null outside a repo", async () => {
    const repo = makeRepo();
    try {
      expect(await getShortHeadAsync(repo)).toBe(runGit(repo, "rev-parse", "--short", "HEAD").trim());
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "not-git-"));
    try {
      expect(await getShortHeadAsync(plain)).toBeNull();
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it.each([
    ["null", { resolveBranch: async () => null } as Opts],
    ["throws", withBranch(new Error("git broke"))],
    ["HEAD without short id", { resolveBranch: async () => "HEAD", resolveShortHead: async () => null } as Opts],
  ])("C4: branch lookup %s falls back to the path key", async (_n, opts) => {
    expect((await pullWithCooldown("/r/a", ok, opts)).skipped).toBe(false);
    expect((await pullWithCooldown("/r/a", ok, opts)).skipped).toBe(true);
    expect(Object.keys(readEntries())).toEqual([path.resolve("/r/a")]);
  });

  it("C5: persists and survives a simulated restart; honours expiry", async () => {
    let calls = 0;
    const pull = async () => { calls += 1; return { success: true }; };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // first deployment: file absent
    expect(fs.existsSync(file)).toBe(false);
    expect((await pullWithCooldown("/r/a", pull, withBranch("a"))).skipped).toBe(false);
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(parsed.version).toBe(1);
    expect(typeof parsed.entries["/r/a@@a"]).toBe("number");

    restart();
    expect((await pullWithCooldown("/r/a", pull, withBranch("a"))).skipped).toBe(true);
    expect(calls).toBe(1);

    restart();
    now = PULL_COOLDOWN_MS - 1;
    expect((await pullWithCooldown("/r/a", pull, withBranch("a"))).skipped).toBe(true);
    restart();
    now = PULL_COOLDOWN_MS;
    expect((await pullWithCooldown("/r/a", pull, withBranch("a"))).skipped).toBe(false);
    expect(calls).toBe(2);

    // pre-written expired entry is ignored
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: { "/r/z@@a": now - PULL_COOLDOWN_MS } }));
    restart();
    expect((await pullWithCooldown("/r/z", pull, withBranch("a"))).skipped).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("C5: missing file behaves like in-memory, no warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await pullWithCooldown("/r/a", ok, withBranch("a"))).skipped).toBe(false);
    expect((await pullWithCooldown("/r/a", ok, withBranch("a"))).skipped).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("C6: corrupt file: no throw, memory cooldown works, one warning, file healed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fs.writeFileSync(file, "{not json");
    let calls = 0;
    const pull = async () => { calls += 1; return { success: true }; };
    expect((await pullWithCooldown("/r/a", pull, withBranch("a"))).skipped).toBe(false);
    expect((await pullWithCooldown("/r/a", pull, withBranch("a"))).skipped).toBe(true);
    expect(calls).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(readEntries()["/r/a@@a"]).toBeTypeOf("number");
  });

  it("C6: unwritable path: no throw, memory cooldown works, one warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const blocker = path.join(dir, "plain-file");
    fs.writeFileSync(blocker, "x");
    setPullCooldownFile(path.join(blocker, "sub", "cooldown.json"));
    let calls = 0;
    const pull = async () => { calls += 1; return { success: true }; };
    expect((await pullWithCooldown("/r/a", pull, withBranch("a"))).skipped).toBe(false);
    expect((await pullWithCooldown("/r/a", pull, withBranch("a"))).skipped).toBe(true);
    expect(calls).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("C12: corrupt + unwritable across 5 keys warns once per kind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const blocker = path.join(dir, "plain-file");
    fs.writeFileSync(blocker, "x");
    // readable-but-corrupt is the same file we cannot replace: make file a directory
    const bad = path.join(dir, "asdir");
    fs.mkdirSync(bad);
    setPullCooldownFile(bad); // read => EISDIR (warn), write rename onto dir => fails (warn)
    for (let i = 0; i < 5; i++) await pullWithCooldown("/r/a", ok, withBranch(`b${i}`));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["[]", true], ["{}", true], ['{"entries":{"k":"abc"}}', true],
    ['{"version":1,"entries":{"k":"abc"}}', false], ["", false],
  ])("C15: odd file %j is tolerated", async (content, warns) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fs.writeFileSync(file, content);
    expect((await pullWithCooldown("/r/a", ok, withBranch("a"))).skipped).toBe(false);
    expect(warn).toHaveBeenCalledTimes(warns ? 1 : 0);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).version).toBe(1);
  });

  it("C14: store path resolution", () => {
    const def = path.join(os.homedir(), ".routa", "kanban-pull-cooldown.json");
    setPullCooldownFile(null);
    vi.stubEnv("ROUTA_PULL_COOLDOWN_FILE", "");
    expect(getPullCooldownFilePath()).toBe(def);
    vi.stubEnv("ROUTA_PULL_COOLDOWN_FILE", "   ");
    expect(getPullCooldownFilePath()).toBe(def);
    vi.stubEnv("ROUTA_PULL_COOLDOWN_FILE", "/tmp/x.json");
    expect(getPullCooldownFilePath()).toBe("/tmp/x.json");
    setPullCooldownFile("/tmp/hook.json");
    expect(getPullCooldownFilePath()).toBe("/tmp/hook.json");
    resetPullCooldown();
    expect(getPullCooldownFilePath()).toBe("/tmp/x.json");
  });

  it("C8: failed pull writes nothing; concurrent same-key pulls run once", async () => {
    await pullWithCooldown("/r/a", async () => ({ success: false, error: "x" }), withBranch("a"));
    expect(fs.existsSync(file)).toBe(false);
    expect((await pullWithCooldown("/r/a", ok, withBranch("a"))).skipped).toBe(false);
    let calls = 0;
    const slow = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return { success: true }; };
    const [x, y] = await Promise.all([
      pullWithCooldown("/r/b", slow, withBranch("a")),
      pullWithCooldown("/r/b", slow, withBranch("a")),
    ]);
    expect(calls).toBe(1);
    expect(x.result).toEqual(y.result);
  });

  it("C10: concurrent different keys both land in the file, no tmp left", async () => {
    await Promise.all([
      pullWithCooldown("/r/a", ok, withBranch("a")),
      pullWithCooldown("/r/a", ok, withBranch("b")),
    ]);
    await flushPullCooldownWrites();
    expect(Object.keys(readEntries()).sort()).toEqual(["/r/a@@a", "/r/a@@b"]);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("C18: a failed rename leaves no tmp, warns once, and heals later", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await pullWithCooldown("/r/a", ok, withBranch("a"));
    // Make the final rename fail: the target becomes a non-empty directory.
    fs.rmSync(file);
    fs.mkdirSync(file);
    fs.writeFileSync(path.join(file, "keep"), "x");
    expect((await pullWithCooldown("/r/a", ok, withBranch("b"))).skipped).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect((await pullWithCooldown("/r/a", ok, withBranch("b"))).skipped).toBe(true); // memory still works
    fs.rmSync(file, { recursive: true });
    expect((await pullWithCooldown("/r/a", ok, withBranch("c"))).skipped).toBe(false);
    expect(Object.keys(readEntries()).sort()).toEqual(["/r/a@@a", "/r/a@@b", "/r/a@@c"]);
  });

  it("F3: 10,000 random steps with branches and restarts match a reference model", async () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const repos = ["/x/1", "/x/2", "/x/3"];
    const model = new Map<string, number>();
    let t = 0;
    let mismatches = 0;
    for (let i = 0; i < 10_000; i++) {
      t += Math.floor(rnd() * 15 * MIN) * (rnd() < 0.5 ? 1 : 0);
      now = t;
      if (rnd() < 0.05) restart();
      const repo = repos[Math.floor(rnd() * 3)];
      const kind = Math.floor(rnd() * 5);
      const short = `s${Math.floor(rnd() * 3)}`;
      const br = ["a", "b"][Math.floor(rnd() * 2)];
      let opts: Opts;
      let keyBranch: string | null;
      if (kind === 0) { opts = { resolveBranch: async () => "HEAD", resolveShortHead: async () => short }; keyBranch = short; }
      else if (kind === 1) { opts = { resolveBranch: async () => null }; keyBranch = null; }
      else if (kind === 2) { opts = withBranch(new Error("x")); keyBranch = null; }
      else { opts = withBranch(br); keyBranch = br; }
      const key = keyBranch ? `${repo}@@${keyBranch}` : repo;
      const success = rnd() > 0.3;
      const last = model.get(key);
      const expectSkip = last !== undefined && t - last < PULL_COOLDOWN_MS;
      const out = await rawPullWithCooldown(repo, async () => ({ success }), opts);
      if (out.skipped !== expectSkip) mismatches += 1;
      if (!expectSkip && success) model.set(key, t);
    }
    expect(mismatches).toBe(0);
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
