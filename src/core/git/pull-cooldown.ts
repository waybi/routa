/**
 * Cooldown for the automatic `git pull` that runs when a kanban board opens.
 *
 * Key: `<absolute repo path>@@<branch>` (current branch; the short commit id
 * when HEAD is detached). If the branch cannot be resolved the key is just the
 * absolute path. Switching branches therefore never hits the old branch's record.
 *
 * Persistence: successful pulls are written to a JSON file
 * (`~/.routa/kanban-pull-cooldown.json`, override with ROUTA_PULL_COOLDOWN_FILE)
 * so a restart keeps the cooldown. The file is a deletable cache: removing it
 * only causes one extra pull. Read/write failures never throw; they log one
 * warning per process and the cooldown continues in memory only.
 *
 * A failed pull is never recorded (memory or file), so it is retried on the next
 * request. Concurrent requests for the same key share one pull. The manual pull
 * endpoint does not use this module. All IO here is async (fs/promises).
 */

import * as os from "os";
import * as path from "path";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { getCurrentBranchAsync, getShortHeadAsync } from "./git-utils-async";

export const PULL_COOLDOWN_MS = 10 * 60 * 1000;

type PullResult = { success: boolean; error?: string };
type ResolveBranch = (repoPath: string) => Promise<string | null>;

let clock: () => number = () => Date.now();
const lastPullAt = new Map<string, number>();
const inFlight = new Map<string, Promise<PullResult>>();

let fileHook: string | null = null;
let loadPromise: Promise<void> | null = null;
let loadedFor: string | null = null;
let writeChain: Promise<void> = Promise.resolve();
let warnedRead = false;
let warnedWrite = false;

export function getPullCooldownFilePath(): string {
  if (fileHook) return fileHook;
  const override = process.env.ROUTA_PULL_COOLDOWN_FILE?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".routa", "kanban-pull-cooldown.json");
}

/** Test hook: replace the clock used for cooldown checks. */
export function setPullCooldownClock(now: (() => number) | null): void {
  clock = now ?? (() => Date.now());
}

/** Test hook: override the store file (takes priority over the env variable). */
export function setPullCooldownFile(file: string | null): void {
  fileHook = file;
}

/**
 * Test hook: forget memory records, in-flight pulls and the loaded state, and
 * reset the file hook. `keepStore: true` keeps the file hook so the next call
 * reads the same file back (simulates a restart).
 */
export function resetPullCooldown(opts?: { keepStore?: boolean }): void {
  lastPullAt.clear();
  inFlight.clear();
  loadPromise = null;
  loadedFor = null;
  warnedRead = false;
  warnedWrite = false;
  if (!opts?.keepStore) fileHook = null;
}

/** Test hook: wait until queued store writes finish. */
export async function flushPullCooldownWrites(): Promise<void> {
  await writeChain;
}

function warnRead(message: string): void {
  if (warnedRead) return;
  warnedRead = true;
  console.warn(`[pull-cooldown] ${message}`);
}

function warnWrite(message: string): void {
  if (warnedWrite) return;
  warnedWrite = true;
  console.warn(`[pull-cooldown] ${message}`);
}

async function loadFromFile(file: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") {
      warnRead(`cannot read ${file}: ${(err as Error).message}; using memory only`);
    }
    return;
  }
  if (raw.trim() === "") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnRead(`ignoring invalid JSON in ${file}`);
    return;
  }
  const obj = parsed as { version?: unknown; entries?: unknown } | null;
  if (
    !obj || typeof obj !== "object" || Array.isArray(obj) || obj.version !== 1 ||
    !obj.entries || typeof obj.entries !== "object" || Array.isArray(obj.entries)
  ) {
    warnRead(`ignoring unexpected format in ${file}`);
    return;
  }
  const now = clock();
  for (const [key, ts] of Object.entries(obj.entries as Record<string, unknown>)) {
    if (typeof ts !== "number" || !Number.isFinite(ts) || now - ts >= PULL_COOLDOWN_MS) continue;
    const mem = lastPullAt.get(key);
    if (mem === undefined || mem < ts) lastPullAt.set(key, ts);
  }
}

function ensureLoaded(): Promise<void> {
  const file = getPullCooldownFilePath();
  if (!loadPromise || loadedFor !== file) {
    loadedFor = file;
    loadPromise = loadFromFile(file).catch((err) => {
      warnRead(`load failed: ${(err as Error).message}`);
    });
  }
  return loadPromise;
}

function persist(): Promise<void> {
  const file = getPullCooldownFilePath();
  const now = clock();
  for (const [key, ts] of lastPullAt) {
    if (now - ts >= PULL_COOLDOWN_MS) lastPullAt.delete(key);
  }
  const body = JSON.stringify({ version: 1, entries: Object.fromEntries(lastPullAt) });
  writeChain = writeChain.then(async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(tmp, body, "utf8");
      await rename(tmp, file);
    } catch (err) {
      warnWrite(`cannot write ${file}: ${(err as Error).message}; using memory only`);
      await unlink(tmp).catch(() => undefined);
    }
  });
  return writeChain;
}

export interface CooldownKeyResolvers {
  resolveBranch?: ResolveBranch;
  /** Used when the branch is the literal "HEAD" (detached). */
  resolveShortHead?: ResolveBranch;
}

async function resolveCooldownKey(repoPath: string, r: CooldownKeyResolvers): Promise<string> {
  const base = path.resolve(repoPath);
  let branch: string | null;
  try {
    branch = await (r.resolveBranch ?? getCurrentBranchAsync)(base);
    if (branch === "HEAD") branch = await (r.resolveShortHead ?? getShortHeadAsync)(base);
  } catch {
    branch = null;
  }
  return branch ? `${base}@@${branch}` : base;
}

export interface CooldownPullOutcome {
  skipped: boolean;
  result?: PullResult;
}

export async function pullWithCooldown(
  repoPath: string,
  doPull: () => Promise<PullResult>,
  opts?: CooldownKeyResolvers,
): Promise<CooldownPullOutcome> {
  await ensureLoaded();
  const key = await resolveCooldownKey(repoPath, opts ?? {});

  const pending = inFlight.get(key);
  if (pending) {
    return { skipped: false, result: await pending };
  }

  const last = lastPullAt.get(key);
  if (last !== undefined && clock() - last < PULL_COOLDOWN_MS) {
    return { skipped: true };
  }

  const run = doPull().then(async (result) => {
    if (result.success) {
      lastPullAt.set(key, clock());
      await persist();
    }
    return result;
  });
  inFlight.set(key, run);
  try {
    return { skipped: false, result: await run };
  } finally {
    inFlight.delete(key);
  }
}
