// @vitest-environment node
/**
 * A provider command that fails to start must never take the Routa server
 * down. Root cause (2026-10-24): Node keeps the handle of a failed spawn
 * (ENOENT) with pid 0, so child.kill("SIGTERM") became kill(0, SIGTERM) and
 * signalled the whole process group — the next server included.
 *
 * These tests use real child processes. ChildProcess.prototype.kill is wrapped
 * so a signal aimed at a child without a pid is recorded instead of sent:
 * without that guard a regression would kill the test runner itself.
 */
import { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AcpProcess } from "../acp-process";
import { AcpProcessManager } from "../acp-process-manager";
import { getProviderConfigOptions, resetProviderConfigOptionsCache } from "../provider-config-probe";

const missingCommand = () => `routa-missing-cmd-${randomUUID().slice(0, 8)}`;

let uncaught: unknown[] = [];
let unhandled: unknown[] = [];
let killCalls: Array<{ pid: number | undefined; signal: unknown }> = [];
const onUncaught = (error: unknown) => uncaught.push(error);
const onUnhandled = (reason: unknown) => unhandled.push(reason);
const realKill = ChildProcess.prototype.kill;

function makeProcess(command: string, args: string[] = []) {
  return new AcpProcess({ command, args, cwd: tmpdir(), displayName: "SpawnProbe" }, () => {});
}

function childOf(proc: AcpProcess): ChildProcess {
  return (proc as unknown as { process: ChildProcess }).process;
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  uncaught = [];
  unhandled = [];
  killCalls = [];
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUnhandled);
  vi.spyOn(ChildProcess.prototype, "kill").mockImplementation(function (this: ChildProcess, signal?: NodeJS.Signals | number) {
    killCalls.push({ pid: this.pid, signal });
    if (!this.pid) return false; // would be kill(0, signal): the whole process group
    return realKill.call(this, signal);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.ROUTA_ACP_STARTUP_TIMEOUT_MS;
  process.off("uncaughtException", onUncaught);
  process.off("unhandledRejection", onUnhandled);
});

describe("AcpProcess start failures do not escape (C1)", () => {
  it("① command not in PATH: start rejects with the command name, kill() sends no signal", async () => {
    const command = missingCommand();
    const proc = makeProcess(command);

    const startError = await proc.start().then(() => null, (error: unknown) => error);
    expect(startError).toBeInstanceOf(Error);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    proc.kill();
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();
    await settle();

    // The crash itself: no signal may go to a child that never got a pid.
    expect(killCalls).toEqual([]);
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
    expect((startError as Error).message).toContain(`"${command}" is not installed or not in PATH (spawn ENOENT)`);
  });

  it("② command exits at once with a non-zero code: start rejects with the command name", async () => {
    const proc = makeProcess("false");

    await expect(proc.start()).rejects.toThrow(/died during startup \("false" exited with code 1\)/);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    proc.kill();
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();
    await settle();

    expect(killCalls).toEqual([]);
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  });

  it("③ command never answers: initialize times out naming the command, kill() ends it", async () => {
    process.env.ROUTA_ACP_STARTUP_TIMEOUT_MS = "300";
    const proc = makeProcess("sleep", ["30"]);
    await proc.start();
    const child = childOf(proc);

    await expect(proc.initialize()).rejects.toThrow(/Timeout waiting for initialize .*"sleep"/);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    proc.kill();
    await waitForExit(child);
    await vi.advanceTimersByTimeAsync(5_000);
    vi.useRealTimers();
    await settle();

    expect(killCalls).toEqual([{ pid: child.pid, signal: "SIGTERM" }]);
    expect(child.signalCode).toBe("SIGTERM");
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  });
});

describe("old shapes unchanged (F2 ① ②)", () => {
  it("a startable command still resolves start() with a pid", async () => {
    const proc = makeProcess("sleep", ["30"]);
    await proc.start();
    expect(proc.pid).toBeGreaterThan(0);
    expect(proc.alive).toBe(true);
    const child = childOf(proc);
    proc.kill();
    await waitForExit(child);
    expect(killCalls).toEqual([{ pid: child.pid, signal: "SIGTERM" }]);
  });

  it("a live process that ignores SIGTERM gets SIGKILL after 5 seconds", async () => {
    const proc = makeProcess("sh", ["-c", "trap '' TERM; exec sleep 30"]);
    await proc.start();
    const child = childOf(proc);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    proc.kill();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(killCalls.map((call) => call.signal)).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    await waitForExit(child);

    expect(killCalls.map((call) => call.signal)).toEqual(["SIGTERM", "SIGKILL"]);
    expect(child.signalCode).toBe("SIGKILL");
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  });
});

describe("every entry that starts a missing command reports it (F4 ① ②)", () => {
  it("config-options probe rejects naming the command and signals nothing", async () => {
    resetProviderConfigOptionsCache();
    const command = missingCommand();

    await expect(
      getProviderConfigOptions("routa-test-missing", {
        factory: async () => makeProcess(command),
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow(command);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(killCalls).toEqual([]);
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  });

  it("process manager session creation rejects naming the command and signals nothing", async () => {
    const command = missingCommand();
    const manager = new AcpProcessManager();

    await expect(
      manager.createSessionFromInline(`enoent-${randomUUID()}`, command, [], tmpdir(), "Missing", () => {}),
    ).rejects.toThrow(command);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(killCalls).toEqual([]);
    expect(uncaught).toHaveLength(0);
    expect(unhandled).toHaveLength(0);
  });
});
