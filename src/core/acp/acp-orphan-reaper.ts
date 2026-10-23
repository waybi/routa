/**
 * Orphan reaper for DSH agent processes (`dsh --profile acp`), 复盘 L145.
 *
 * A Routa restart leaves the agents the previous Routa process started
 * running with parent pid 1, and nothing ends them. This reaper ends an agent
 * process only when it can prove the process is an orphan; every condition
 * must hold:
 *   1. its command line has `--profile acp` (or `--profile=acp`) as words;
 *   2. it is not tracked by this Routa process (AcpProcessManager registered
 *      or starting processes) and not a descendant of a tracked process;
 *   3. its parent pid is 1 or this Routa process;
 *   4. it has run longer than the age threshold (default 1 hour).
 * A candidate gets SIGTERM; after the grace period the process list is read
 * again and only the same process (same command, age not shorter, so the pid
 * was not reused) gets SIGKILL. When the process list or the tracked pids
 * cannot be read, the round is skipped and nothing is signalled.
 *
 * Runs once at startup and then every 10 minutes (src/instrumentation.ts).
 * Env: ROUTA_ACP_ORPHAN_REAP_INTERVAL_MS (default 600000, 0 = off) and
 * ROUTA_ACP_ORPHAN_MIN_AGE_MS (default 3600000). Log keyword: AcpOrphanReaper.
 */

import { execFile } from "node:child_process";

export const DEFAULT_REAP_INTERVAL_MS = 10 * 60 * 1000;
export const DEFAULT_MIN_AGE_MS = 60 * 60 * 1000;
/** Not shorter than AcpProcess.kill's 5 s: DSH writes its session files on exit. */
export const DEFAULT_GRACE_MS = 10 * 1000;

const LOG_PREFIX = "[AcpOrphanReaper]";
const GLOBAL_KEY = "__routa_acp_orphan_reaper__";

export interface PsProcess {
  pid: number;
  ppid: number;
  /** Elapsed run time in seconds, from ps `etime`. */
  elapsedSeconds: number;
  command: string;
}

/** Parses ps `etime` (`[[DD-]HH:]MM:SS`) into seconds; undefined when malformed. */
export function parsePsEtime(value: string): number | undefined {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(value.trim());
  if (!match) return undefined;
  const [, days, hours, minutes, seconds] = match;
  const mm = Number(minutes);
  const ss = Number(seconds);
  if (ss >= 60 || (hours !== undefined && mm >= 60)) return undefined;
  return Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + mm * 60 + ss;
}

/** Parses `ps -o pid=,ppid=,etime=,command=` output; the command keeps its spaces. */
export function parsePsOutput(stdout: string): PsProcess[] {
  const processes: PsProcess[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const elapsedSeconds = parsePsEtime(match[3]);
    if (elapsedSeconds === undefined) continue;
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      elapsedSeconds,
      command: match[4].trimEnd(),
    });
  }
  return processes;
}

/** Lists every process with ps. macOS ps has no `etimes`, so `etime` is parsed. */
export function listProcessesViaPs(): Promise<PsProcess[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "ps",
      ["-A", "-ww", "-o", "pid=,ppid=,etime=,command="],
      { maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(parsePsOutput(String(stdout)));
      },
    );
  });
}

/** True when the command line has `--profile acp` or `--profile=acp` as whole words. */
export function isAcpProfileCommand(command: string): boolean {
  const tokens = command.trim().split(/\s+/);
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "--profile=acp") return true;
    if (tokens[index] === "--profile" && tokens[index + 1] === "acp") return true;
  }
  return false;
}

/** Tracked pids plus all their descendants (a wrapper script's node child stays protected). */
export function collectProtectedPids(processes: PsProcess[], trackedPids: Iterable<number>): Set<number> {
  const children = new Map<number, number[]>();
  for (const proc of processes) {
    const list = children.get(proc.ppid) ?? [];
    list.push(proc.pid);
    children.set(proc.ppid, list);
  }
  const protectedPids = new Set<number>();
  const pending = [...trackedPids];
  while (pending.length > 0) {
    const pid = pending.pop() as number;
    if (protectedPids.has(pid)) continue;
    protectedPids.add(pid);
    for (const child of children.get(pid) ?? []) pending.push(child);
  }
  return protectedPids;
}

export interface SelectOrphanParams {
  processes: PsProcess[];
  trackedPids: Iterable<number>;
  selfPid: number;
  minAgeMs: number;
}

/** The processes that meet all four orphan conditions (see the module comment). */
export function selectOrphanCandidates(params: SelectOrphanParams): PsProcess[] {
  const protectedPids = collectProtectedPids(params.processes, params.trackedPids);
  return params.processes.filter((proc) =>
    proc.pid !== params.selfPid
    && proc.pid > 1
    && isAcpProfileCommand(proc.command)
    && !protectedPids.has(proc.pid)
    && (proc.ppid === 1 || proc.ppid === params.selfPid)
    && proc.elapsedSeconds * 1000 > params.minAgeMs,
  );
}

export type ReaperSignal = "SIGTERM" | "SIGKILL";

export interface ReapDeps {
  listProcesses: () => Promise<PsProcess[]>;
  getTrackedPids: () => Iterable<number> | Promise<Iterable<number>>;
  selfPid: number;
  minAgeMs: number;
  graceMs?: number;
  kill?: (pid: number, signal: ReaperSignal) => void;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export interface ReapResult {
  candidates: number[];
  terminated: number[];
  killed: number[];
  skipped?: string;
}

function defaultKill(pid: number, signal: ReaperSignal): void {
  process.kill(pid, signal);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNoSuchProcess(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "ESRCH");
}

/** One reaping round. Never throws. */
export async function reapOrphanAcpProcesses(deps: ReapDeps): Promise<ReapResult> {
  const log = deps.log ?? ((line: string) => console.info(line));
  const kill = deps.kill ?? defaultKill;
  const sleep = deps.sleep ?? defaultSleep;
  const result: ReapResult = { candidates: [], terminated: [], killed: [] };

  let processes: PsProcess[];
  let trackedPids: Iterable<number>;
  try {
    trackedPids = [...(await deps.getTrackedPids())];
    processes = await deps.listProcesses();
  } catch (error) {
    console.warn(`${LOG_PREFIX} round skipped: cannot read processes:`, error);
    result.skipped = "list_failed";
    return result;
  }

  const candidates = selectOrphanCandidates({
    processes,
    trackedPids,
    selfPid: deps.selfPid,
    minAgeMs: deps.minAgeMs,
  });
  result.candidates = candidates.map((proc) => proc.pid);
  if (candidates.length === 0) return result;

  const signal = (pid: number, name: ReaperSignal): boolean => {
    try {
      kill(pid, name);
      return true;
    } catch (error) {
      if (!isNoSuchProcess(error)) {
        console.warn(`${LOG_PREFIX} ${name} pid=${pid} failed:`, error);
      }
      return false;
    }
  };

  const terminated: PsProcess[] = [];
  for (const proc of candidates) {
    log(`${LOG_PREFIX} reaping pid=${proc.pid} ppid=${proc.ppid} age=${proc.elapsedSeconds}s cmd=${proc.command}`);
    if (signal(proc.pid, "SIGTERM")) {
      terminated.push(proc);
      result.terminated.push(proc.pid);
    }
  }

  if (terminated.length > 0) {
    await sleep(deps.graceMs ?? DEFAULT_GRACE_MS);
    let after: PsProcess[] | undefined;
    try {
      after = await deps.listProcesses();
    } catch (error) {
      // Without a fresh list the pid cannot be proven to be the same process.
      console.warn(`${LOG_PREFIX} SIGKILL skipped: cannot re-read processes:`, error);
    }
    const byPid = new Map((after ?? []).map((proc) => [proc.pid, proc]));
    for (const proc of terminated) {
      const now = byPid.get(proc.pid);
      const sameProcess = now
        && now.command === proc.command
        && now.elapsedSeconds >= proc.elapsedSeconds;
      if (sameProcess && signal(proc.pid, "SIGKILL")) {
        result.killed.push(proc.pid);
      }
    }
  }

  log(
    `${LOG_PREFIX} round done candidates=${result.candidates.length} `
    + `sigterm=${result.terminated.length} sigkill=${result.killed.length}`,
  );
  return result;
}

export interface AcpOrphanReaperConfig {
  intervalMs: number;
  minAgeMs: number;
}

function readNonNegativeMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function resolveAcpOrphanReaperConfig(env: Record<string, string | undefined> = process.env): AcpOrphanReaperConfig {
  return {
    intervalMs: readNonNegativeMs(env.ROUTA_ACP_ORPHAN_REAP_INTERVAL_MS, DEFAULT_REAP_INTERVAL_MS),
    minAgeMs: readNonNegativeMs(env.ROUTA_ACP_ORPHAN_MIN_AGE_MS, DEFAULT_MIN_AGE_MS),
  };
}

export interface StartReaperOptions extends Omit<ReapDeps, "listProcesses" | "minAgeMs">, Partial<AcpOrphanReaperConfig> {
  listProcesses?: () => Promise<PsProcess[]>;
}

interface ReaperHandle {
  stop: () => void;
}

/**
 * Runs a round now and then every `intervalMs`; `intervalMs <= 0` disables it.
 * One reaper per process (register() may run twice under HMR) and at most one
 * round at a time. Returns a stop function.
 */
export function startAcpOrphanReaper(options: StartReaperOptions): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_REAP_INTERVAL_MS;
  const minAgeMs = options.minAgeMs ?? DEFAULT_MIN_AGE_MS;
  const log = options.log ?? ((line: string) => console.info(line));
  if (!(intervalMs > 0)) {
    log(`${LOG_PREFIX} disabled (intervalMs=${intervalMs})`);
    return () => undefined;
  }
  const g = globalThis as Record<string, unknown>;
  const existing = g[GLOBAL_KEY] as ReaperHandle | undefined;
  if (existing) return existing.stop;

  const deps: ReapDeps = {
    ...options,
    listProcesses: options.listProcesses ?? listProcessesViaPs,
    minAgeMs,
    log,
  };
  let running = false;
  const runRound = async () => {
    if (running) return;
    running = true;
    try {
      await reapOrphanAcpProcesses(deps);
    } catch (error) {
      console.warn(`${LOG_PREFIX} round failed:`, error);
    } finally {
      running = false;
    }
  };

  log(`${LOG_PREFIX} started selfPid=${options.selfPid} intervalMs=${intervalMs} minAgeMs=${minAgeMs}`);
  const timer = setInterval(() => {
    void runRound();
  }, intervalMs);
  (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
  const handle: ReaperHandle = {
    stop: () => {
      clearInterval(timer);
      if (g[GLOBAL_KEY] === handle) delete g[GLOBAL_KEY];
    },
  };
  g[GLOBAL_KEY] = handle;
  void runRound();
  return handle.stop;
}
