// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_REAP_INTERVAL_MS,
  listProcessesViaPs,
  parsePsEtime,
  parsePsOutput,
  reapOrphanAcpProcesses,
  resolveAcpOrphanReaperConfig,
  selectOrphanCandidates,
  startAcpOrphanReaper,
  type PsProcess,
  type ReaperSignal,
} from "../acp-orphan-reaper";

const HOUR_MS = 3_600_000;

function row(pid: number, ppid: number, etime: string, command: string): PsProcess {
  const elapsedSeconds = parsePsEtime(etime);
  if (elapsedSeconds === undefined) throw new Error(`bad etime ${etime}`);
  return { pid, ppid, elapsedSeconds, command };
}

const NODE_ACP = "node /Users/x/deepseek-harness/apps/cli/lib/bin.js --profile acp";
const DSH_ACP = "dsh --profile acp";

/** Contract C1: ten rows, selfPid 5000, tracked {6001}, threshold 3600 s. */
const C1_TABLE: PsProcess[] = [
  row(6001, 5000, "02:00:00", NODE_ACP),
  row(6002, 6001, "02:00:00", NODE_ACP),
  row(7001, 1, "01:01:00", DSH_ACP),
  row(7002, 1, "59:00", DSH_ACP),
  row(7003, 4321, "03:00:00", DSH_ACP),
  row(7004, 5000, "1-00:00:00", "node /Users/x/deepseek-harness/apps/cli/lib/bin.js --profile=acp"),
  row(7005, 1, "05:00:00", "dsh --profile desktop"),
  row(7006, 1, "05:00:00", "dsh --profile acpx"),
  row(7007, 1, "01:00:00", DSH_ACP),
  row(5000, 1, "10:00:00", "node next-server --profile acp"),
];

describe("parsePsEtime", () => {
  it("reads MM:SS, HH:MM:SS and DD-HH:MM:SS", () => {
    expect(parsePsEtime("59:00")).toBe(3_540);
    expect(parsePsEtime("01:01:00")).toBe(3_660);
    expect(parsePsEtime("1-00:00:00")).toBe(86_400);
    expect(parsePsEtime(" 12-03:04:05 ")).toBe(12 * 86_400 + 3 * 3_600 + 4 * 60 + 5);
    expect(parsePsEtime("00:03")).toBe(3);
  });

  it("rejects malformed values", () => {
    expect(parsePsEtime("abc")).toBeUndefined();
    expect(parsePsEtime("1-05:00")).toBeUndefined();
    expect(parsePsEtime("10:61")).toBeUndefined();
    expect(parsePsEtime("")).toBeUndefined();
  });

  it("parses ps output and keeps spaces in the command", () => {
    const parsed = parsePsOutput("  7001     1   01:01:00 dsh  --profile acp --cwd /tmp/a b\n bad line\n");
    expect(parsed).toEqual([{ pid: 7001, ppid: 1, elapsedSeconds: 3_660, command: "dsh  --profile acp --cwd /tmp/a b" }]);
  });
});

describe("selectOrphanCandidates (C1)", () => {
  it("selects exactly {7001, 7004} from the ten-row table", () => {
    const candidates = selectOrphanCandidates({
      processes: C1_TABLE,
      trackedPids: new Set([6001]),
      selfPid: 5000,
      minAgeMs: HOUR_MS,
    });
    expect(new Set(candidates.map((proc) => proc.pid))).toEqual(new Set([7001, 7004]));
  });

  it("F4-8: untracked dsh and node agents qualify; the node child of a tracked shell wrapper does not", () => {
    const table = [
      row(8001, 1, "02:00:00", DSH_ACP),
      row(8002, 1, "02:00:00", NODE_ACP),
      row(8100, 5000, "02:00:00", "/bin/sh /Users/x/bin/dsh-wrapper.sh --profile acp"),
      row(8101, 8100, "02:00:00", NODE_ACP),
      row(8102, 8101, "02:00:00", NODE_ACP),
    ];
    const candidates = selectOrphanCandidates({ processes: table, trackedPids: [8100], selfPid: 5000, minAgeMs: HOUR_MS });
    expect(candidates.map((proc) => proc.pid).sort()).toEqual([8001, 8002]);
  });
});

type KillCall = [number, ReaperSignal];

function reapDeps(lists: Array<PsProcess[] | Error>, options?: { kill?: (pid: number, signal: ReaperSignal) => void }) {
  const calls: KillCall[] = [];
  let index = 0;
  const listProcesses = vi.fn(async () => {
    const next = lists[Math.min(index, lists.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    return next;
  });
  const kill = vi.fn((pid: number, signal: ReaperSignal) => {
    calls.push([pid, signal]);
    options?.kill?.(pid, signal);
  });
  const log = vi.fn();
  return {
    calls,
    listProcesses,
    log,
    deps: {
      listProcesses,
      getTrackedPids: () => new Set<number>(),
      selfPid: 5000,
      minAgeMs: HOUR_MS,
      graceMs: 10_000,
      kill,
      sleep: async () => undefined,
      log,
    },
  };
}

describe("reapOrphanAcpProcesses (C2)", () => {
  const orphan = row(7001, 1, "01:01:00", DSH_ACP);
  const orphan2 = row(7008, 1, "02:00:00", DSH_ACP);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("(a) SIGTERM, then SIGKILL after the grace period when the same process is still there", async () => {
    vi.useFakeTimers();
    const ctx = reapDeps([[orphan], [{ ...orphan, elapsedSeconds: orphan.elapsedSeconds + 10 }]]);
    const { sleep: _sleep, ...deps } = ctx.deps;
    const round = reapOrphanAcpProcesses(deps);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(ctx.calls).toEqual([[7001, "SIGTERM"]]);
    await vi.advanceTimersByTimeAsync(1);
    const result = await round;
    expect(ctx.calls).toEqual([[7001, "SIGTERM"], [7001, "SIGKILL"]]);
    expect(result.killed).toEqual([7001]);
  });

  it("(b) no SIGKILL when the process is gone", async () => {
    const ctx = reapDeps([[orphan], []]);
    await reapOrphanAcpProcesses(ctx.deps);
    expect(ctx.calls).toEqual([[7001, "SIGTERM"]]);
  });

  it.each([
    ["the command changed", { ...orphan, command: "vim foo" }],
    ["the age went down", { ...orphan, elapsedSeconds: 3 }],
  ])("(c) no SIGKILL when the pid was reused: %s", async (_label, reused) => {
    const ctx = reapDeps([[orphan], [reused]]);
    await reapOrphanAcpProcesses(ctx.deps);
    expect(ctx.calls).toEqual([[7001, "SIGTERM"]]);
  });

  it("(d) ESRCH is ignored and the next candidate is still handled", async () => {
    const ctx = reapDeps([[orphan, orphan2], [orphan2]], {
      kill: (pid) => {
        if (pid === 7001) throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
      },
    });
    const result = await reapOrphanAcpProcesses(ctx.deps);
    expect(ctx.calls).toEqual([[7001, "SIGTERM"], [7008, "SIGTERM"], [7008, "SIGKILL"]]);
    expect(result.terminated).toEqual([7008]);
  });

  it("skips the round when listProcesses throws", async () => {
    const ctx = reapDeps([new Error("ps: etimes: keyword not found")]);
    const result = await reapOrphanAcpProcesses(ctx.deps);
    expect(ctx.calls).toEqual([]);
    expect(result.skipped).toBe("list_failed");
  });

  it("skips the round when getTrackedPids throws", async () => {
    const ctx = reapDeps([[orphan]]);
    const result = await reapOrphanAcpProcesses({
      ...ctx.deps,
      getTrackedPids: () => {
        throw new Error("manager unavailable");
      },
    });
    expect(ctx.calls).toEqual([]);
    expect(result.skipped).toBe("list_failed");
  });

  it("no SIGKILL when the process list cannot be re-read after the grace period", async () => {
    const ctx = reapDeps([[orphan], new Error("ps failed")]);
    await reapOrphanAcpProcesses(ctx.deps);
    expect(ctx.calls).toEqual([[7001, "SIGTERM"]]);
  });

  it("C12: one log line per reaped process with pid, ppid, age and cmd", async () => {
    const ctx = reapDeps([[orphan, orphan2], []]);
    await reapOrphanAcpProcesses(ctx.deps);
    const lines = ctx.log.mock.calls.map(([line]) => String(line));
    const perPid = (pid: number) => lines.filter((line) => line.includes(`pid=${pid} `));
    expect(perPid(7001)).toEqual([`[AcpOrphanReaper] reaping pid=7001 ppid=1 age=3660s cmd=${DSH_ACP}`]);
    expect(perPid(7008)).toEqual([`[AcpOrphanReaper] reaping pid=7008 ppid=1 age=7200s cmd=${DSH_ACP}`]);
  });
});

describe("listProcessesViaPs (C13, real ps)", () => {
  it("returns this test process with its parent pid and an intact command", async () => {
    const processes = await listProcessesViaPs();
    const self = processes.find((proc) => proc.pid === process.pid);
    expect(self).toBeDefined();
    expect(self?.ppid).toBe(process.ppid);
    expect(self?.command).toContain("node");
    expect(self?.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe("startAcpOrphanReaper timing (C3)", () => {
  const stops: Array<() => void> = [];

  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.useRealTimers();
  });

  function start(options: Partial<Parameters<typeof startAcpOrphanReaper>[0]> & { listProcesses: () => Promise<PsProcess[]> }) {
    const stop = startAcpOrphanReaper({
      selfPid: 5000,
      getTrackedPids: () => [],
      log: () => undefined,
      kill: () => undefined,
      sleep: async () => undefined,
      ...options,
    });
    stops.push(stop);
    return stop;
  }

  it("(a) default config: one round at start, two after 10 minutes", async () => {
    vi.useFakeTimers();
    const listProcesses = vi.fn(async () => [] as PsProcess[]);
    start({ ...resolveAcpOrphanReaperConfig({}), listProcesses });
    await vi.advanceTimersByTimeAsync(0);
    expect(listProcesses).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_REAP_INTERVAL_MS);
    expect(listProcesses).toHaveBeenCalledTimes(2);
  });

  it("(b) interval 0 from the environment disables it", async () => {
    vi.useFakeTimers();
    const listProcesses = vi.fn(async () => [] as PsProcess[]);
    start({ ...resolveAcpOrphanReaperConfig({ ROUTA_ACP_ORPHAN_REAP_INTERVAL_MS: "0" }), listProcesses });
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(listProcesses).toHaveBeenCalledTimes(0);
  });

  it("(d) starting twice (HMR) keeps one timer", async () => {
    vi.useFakeTimers();
    const listProcesses = vi.fn(async () => [] as PsProcess[]);
    start({ intervalMs: DEFAULT_REAP_INTERVAL_MS, listProcesses });
    start({ intervalMs: DEFAULT_REAP_INTERVAL_MS, listProcesses });
    await vi.advanceTimersByTimeAsync(DEFAULT_REAP_INTERVAL_MS);
    expect(listProcesses).toHaveBeenCalledTimes(2);
  });

  it("(e) a round still running blocks the next one", async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const listProcesses = vi.fn(() => new Promise<PsProcess[]>((resolve) => {
      release = () => resolve([]);
    }));
    start({ intervalMs: 60_000, listProcesses });
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(listProcesses).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listProcesses).toHaveBeenCalledTimes(2);
  });

  it("(f) env sets interval 60000 and threshold 120000", async () => {
    vi.useFakeTimers();
    const config = resolveAcpOrphanReaperConfig({
      ROUTA_ACP_ORPHAN_REAP_INTERVAL_MS: "60000",
      ROUTA_ACP_ORPHAN_MIN_AGE_MS: "120000",
    });
    expect(config).toEqual({ intervalMs: 60_000, minAgeMs: 120_000 });
    const table = [row(7101, 1, "02:01", DSH_ACP), row(7102, 1, "01:59", DSH_ACP)];
    const terminated: number[] = [];
    const listProcesses = vi.fn(async () => table);
    start({ ...config, listProcesses, kill: (pid, signal) => { if (signal === "SIGTERM") terminated.push(pid); } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listProcesses.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(new Set(terminated)).toEqual(new Set([7101]));
    expect(selectOrphanCandidates({ processes: table, trackedPids: [], selfPid: 5000, minAgeMs: config.minAgeMs })
      .map((proc) => proc.pid)).toEqual([7101]);
  });

  it("F4-6/7: the startup round and the second round each reap an injected orphan", async () => {
    vi.useFakeTimers();
    const rounds = [[row(7201, 1, "03:00:00", DSH_ACP)], [], [row(7202, 1, "03:00:00", NODE_ACP)], []];
    let index = 0;
    const listProcesses = vi.fn(async () => rounds[Math.min(index++, rounds.length - 1)]);
    const terms: number[] = [];
    start({ intervalMs: DEFAULT_REAP_INTERVAL_MS, listProcesses, kill: (pid, signal) => { if (signal === "SIGTERM") terms.push(pid); } });
    await vi.advanceTimersByTimeAsync(0);
    expect(terms).toEqual([7201]);
    await vi.advanceTimersByTimeAsync(DEFAULT_REAP_INTERVAL_MS);
    expect(terms).toEqual([7201, 7202]);
  });
});

describe("instrumentation register() starts the reaper (C3 c)", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.clearAllTimers();
    vi.useRealTimers();
    for (const id of ["@/core/telemetry/node-otel", "@/core/scheduling/scheduler-service", "@/core/background-worker", "@/core/kanban/startup-lane-sweep", "@/core/acp/acp-orphan-reaper"]) {
      vi.doUnmock(id);
    }
    vi.resetModules();
  });

  async function runRegister(env: Record<string, string>) {
    const startMock = vi.fn(() => () => undefined);
    vi.resetModules();
    vi.doMock("@/core/telemetry/node-otel", () => ({ initializeNextRuntimeTelemetry: () => ({ enabled: false }) }));
    vi.doMock("@/core/scheduling/scheduler-service", () => ({ startSchedulerService: vi.fn() }));
    vi.doMock("@/core/background-worker", () => ({ startBackgroundWorker: vi.fn() }));
    vi.doMock("@/core/kanban/startup-lane-sweep", () => ({ endStaleRunningLaneSessionsOnStartup: vi.fn(async () => undefined) }));
    vi.doMock("@/core/acp/acp-orphan-reaper", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../acp-orphan-reaper")>()),
      startAcpOrphanReaper: startMock,
    }));
    Object.assign(process.env, { NEXT_RUNTIME: "nodejs", ROUTA_RUNTIME_SERVICES_DELAY_MS: "1000" }, env);
    vi.useFakeTimers();
    const { register } = await import("@/instrumentation");
    await register();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    return startMock;
  }

  it("does not start under ROUTA_SKIP_RUNTIME_SERVICES=1", async () => {
    const startMock = await runRegister({ ROUTA_SKIP_RUNTIME_SERVICES: "1" });
    expect(startMock).toHaveBeenCalledTimes(0);
  });

  it("starts once with the default config and this process as selfPid", async () => {
    delete process.env.ROUTA_SKIP_RUNTIME_SERVICES;
    delete process.env.ROUTA_ACP_ORPHAN_REAP_INTERVAL_MS;
    delete process.env.ROUTA_ACP_ORPHAN_MIN_AGE_MS;
    const startMock = await runRegister({});
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith(expect.objectContaining({
      intervalMs: DEFAULT_REAP_INTERVAL_MS,
      minAgeMs: HOUR_MS,
      selfPid: process.pid,
    }));
  });
});

// ---- F3 random cross-check, judged by an independent reading of AC3 ----

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function formatEtime(totalSeconds: number, rand: () => number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${days}-${p(hours)}:${p(minutes)}:${p(seconds)}`;
  if (hours > 0 || rand() < 0.2) return `${p(hours)}:${p(minutes)}:${p(seconds)}`;
  return `${p(minutes)}:${p(seconds)}`;
}

/** AC3 written out directly; shares no code with the module under test. */
function judgeOrphans(table: Array<{ pid: number; ppid: number; etime: string; command: string }>, tracked: Set<number>, selfPid: number, minAgeSeconds: number): Set<number> {
  const protectedPids = new Set(tracked);
  let grew = true;
  while (grew) {
    grew = false;
    for (const proc of table) {
      if (protectedPids.has(proc.ppid) && !protectedPids.has(proc.pid)) {
        protectedPids.add(proc.pid);
        grew = true;
      }
    }
  }
  const out = new Set<number>();
  for (const proc of table) {
    const parts = proc.etime.split(/[-:]/).map(Number);
    const [d, h, m, s] = parts.length === 4 ? parts : parts.length === 3 ? [0, ...parts] : [0, 0, ...parts];
    const age = d * 86_400 + h * 3_600 + m * 60 + s;
    const acp = /(^|\s)--profile(=|\s+)acp(\s|$)/.test(proc.command);
    if (acp && !protectedPids.has(proc.pid) && (proc.ppid === 1 || proc.ppid === selfPid) && age > minAgeSeconds && proc.pid !== selfPid) {
      out.add(proc.pid);
    }
  }
  return out;
}

describe("F3 random cross-check", () => {
  const SEED = 20261024;

  it("10,000 random process tables match the independent judge", () => {
    console.info(`[F3] seed=${SEED}`);
    const rand = mulberry32(SEED);
    const pick = <T,>(items: T[]) => items[Math.floor(rand() * items.length)];
    const commands = [DSH_ACP, NODE_ACP, "dsh --profile=acp", "dsh --profile acpx", "dsh --profile desktop", "node server.js", "zsh"];
    const thresholds = [3_600, 120, 7_200];
    let mismatches = 0;
    for (let tableIndex = 0; tableIndex < 10_000; tableIndex += 1) {
      const selfPid = 5_000;
      const size = 5 + Math.floor(rand() * 36);
      const pids = Array.from({ length: size }, (_, i) => 10_000 + tableIndex * 50 + i);
      if (rand() < 0.3) pids[0] = selfPid;
      const table = pids.map((pid) => {
        const ppid = pick([1, selfPid, pick(pids), 4_321]);
        const threshold = pick(thresholds);
        const age = rand() < 0.2 ? threshold + pick([-1, 0, 1]) : Math.floor(rand() * 10 * 86_400);
        return { pid, ppid: ppid === pid ? 1 : ppid, etime: formatEtime(Math.max(0, age), rand), command: pick(commands) };
      });
      const tracked = new Set(pids.filter(() => rand() < 0.15));
      const minAgeSeconds = pick(thresholds);
      const expected = judgeOrphans(table, tracked, selfPid, minAgeSeconds);
      const actual = new Set(selectOrphanCandidates({
        processes: table.map((proc) => row(proc.pid, proc.ppid, proc.etime, proc.command)),
        trackedPids: tracked,
        selfPid,
        minAgeMs: minAgeSeconds * 1000,
      }).map((proc) => proc.pid));
      const same = expected.size === actual.size && [...expected].every((pid) => actual.has(pid));
      if (!same) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });

  it("10,000 random ages round-trip through parsePsEtime", () => {
    const rand = mulberry32(SEED + 1);
    let mismatches = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const seconds = Math.floor(rand() * 10 * 86_400);
      if (parsePsEtime(formatEtime(seconds, rand)) !== seconds) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });
});
