// @vitest-environment node
import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IProcessHandle, WritableStreamLike } from "@/core/platform/interfaces";

const spawnMock = vi.hoisted(() => vi.fn());
const isAvailableMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@/core/platform", () => ({
  getServerBridge: () => ({
    process: {
      isAvailable: isAvailableMock,
      spawn: spawnMock,
      execSync: vi.fn(),
    },
  }),
}));

import { AcpProcess } from "../acp-process";

class FakeWritable implements WritableStreamLike {
  writable = true;
  writes: Array<string | Buffer> = [];

  write(data: string | Buffer): boolean {
    this.writes.push(data);
    return true;
  }
}

class FakeProcess extends EventEmitter implements IProcessHandle {
  pid: number | undefined = 1234;
  stdin: WritableStreamLike | null = new FakeWritable();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;

  kill(): void {
    this.exitCode = 0;
    this.emit("exit", 0, null);
  }
}

describe("AcpProcess codex permission handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAvailableMock.mockReturnValue(true);
    spawnMock.mockReset();
  });

  function createProcess(onNotification = vi.fn()) {
    return new AcpProcess({
      command: "codex-acp",
      args: [],
      cwd: "/tmp",
      displayName: "Codex",
    }, onNotification);
  }

  it("auto-approves codex permission requests even without explicit session auto-approval", () => {
    const onNotification = vi.fn();
    const process = createProcess(onNotification);
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 7,
      method: "session/request_permission",
      params: {
        permissions: {
          file_system: {
            write: ["/tmp/outside"],
          },
        },
      },
    });

    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 7,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved",
        },
      },
    });
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call_update",
          status: "completed",
          kind: "request-permissions",
        }),
      }),
    }));
  });

  it("selects the approved option for codex option-based permission requests", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 9,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "approved-for-session", kind: "allow_always" },
          { optionId: "approved", kind: "allow_once" },
          { optionId: "abort", kind: "reject_once" },
        ],
      },
    });

    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 9,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved",
        },
      },
    });
  });

  it("maps manual codex permission responses to option selections", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).pendingInteractiveRequests.set("request-permission-1", {
      requestId: 10,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "approved-for-session", kind: "allow_always" },
          { optionId: "approved", kind: "allow_once" },
          { optionId: "abort", kind: "reject_once" },
        ],
      },
    });

    const handled = process.respondToUserInput("request-permission-1", {
      decision: "approve",
      scope: "session",
    });

    expect(handled).toBe(true);
    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 10,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved-for-session",
        },
      },
    });
  });

  it("passes through explicit option ids for option-driven permission requests", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).pendingInteractiveRequests.set("request-permission-2", {
      requestId: 12,
      method: "session/request_permission",
      params: {
        options: [
          { optionId: "approved", kind: "allow_once" },
          { optionId: "approved-for-session", kind: "allow_always" },
          { optionId: "approved-always", kind: "allow_always" },
          { optionId: "cancel", kind: "reject_once" },
        ],
      },
    });

    const handled = process.respondToUserInput("request-permission-2", {
      optionId: "approved-always",
      decision: "approve",
      scope: "session",
    });

    expect(handled).toBe(true);
    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 12,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved-always",
        },
      },
    });
  });

  it("falls back to ACP-standard selected results when options are missing", () => {
    const process = createProcess();
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 11,
      method: "session/request_permission",
      params: {
        permissions: {
          file_system: {
            write: ["/tmp/outside"],
          },
        },
      },
    });

    expect(writeMessage).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      id: 11,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "approved",
        },
      },
    });
  });

  it("keeps non-codex permission requests interactive unless auto-approval is enabled", () => {
    const onNotification = vi.fn();
    const process = new AcpProcess({
      command: "opencode",
      args: [],
      cwd: "/tmp",
      displayName: "OpenCode",
    }, onNotification);
    const writeMessage = vi.fn();

    process.setSessionContext({
      sessionId: "session-2",
      provider: "opencode",
      role: "CRAFTER",
    });

    (process as any).writeMessage = writeMessage;
    (process as any).handleAgentRequest({
      jsonrpc: "2.0",
      id: 8,
      method: "session/request_permission",
      params: {
        permissions: {
          file_system: {
            write: ["/tmp/outside"],
          },
        },
      },
    });

    expect(writeMessage).not.toHaveBeenCalled();
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        update: expect.objectContaining({
          sessionUpdate: "tool_call",
          status: "waiting",
          kind: "request-permissions",
        }),
      }),
    }));
  });

  it("fails startup when process spawning is unavailable", async () => {
    isAvailableMock.mockReturnValue(false);

    const process = createProcess();

    await expect(process.start()).rejects.toThrow(
      'Process spawning is not available on this platform. Cannot start Codex.',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("fails startup when the spawned process has no pid", async () => {
    const fakeProcess = new FakeProcess();
    fakeProcess.pid = undefined;
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();

    await expect(process.start()).rejects.toThrow(
      'Failed to spawn Codex - is "codex-acp" installed and in PATH?',
    );
  });

  it("forwards stderr output as process_output notifications", async () => {
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess(onNotification);
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    fakeProcess.stderr.emit("data", Buffer.from("permission warning\n", "utf-8"));

    expect(onNotification).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "pending",
        update: {
          sessionUpdate: "process_output",
          source: "stderr",
          data: "permission warning\n",
          displayName: "Codex",
        },
      },
    });

    vi.useRealTimers();
  });

  it("uses structured stderr details for generic acp_status internal errors", async () => {
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess(onNotification);
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    fakeProcess.stderr.emit(
      "data",
      Buffer.from(
        'ERROR codex_acp::thread: Unhandled error during turn: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The model requires a newer version of Codex."}} Some(Other)\n',
        "utf-8",
      ),
    );
    fakeProcess.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "codex-session",
          update: {
            sessionUpdate: "acp_status",
            status: "error",
            error: "Internal error",
          },
        },
      }) + "\n", "utf-8"),
    );

    expect(onNotification).toHaveBeenLastCalledWith({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "codex-session",
        update: {
          sessionUpdate: "acp_status",
          status: "error",
          error: "The model requires a newer version of Codex.",
        },
      },
    });

    fakeProcess.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "codex-session",
          update: {
            sessionUpdate: "acp_status",
            status: "error",
            error: "Internal error",
          },
        },
      }) + "\n", "utf-8"),
    );

    expect(onNotification).toHaveBeenLastCalledWith({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "codex-session",
        update: {
          sessionUpdate: "acp_status",
          status: "error",
          error: "Internal error",
        },
      },
    });

    vi.useRealTimers();
  });

  it("rejects pending requests when the process exits", async () => {
    vi.useFakeTimers();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess();
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;

    const pending = process.sendRequest("initialize", { protocolVersion: 1 });
    fakeProcess.exitCode = 1;
    fakeProcess.emit("exit", 1, null);

    await expect(pending).rejects.toThrow("Codex process exited (code=1)");
    vi.useRealTimers();
  });

  it("reports an unexpected exit of a live session as an error update", async () => {
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess(onNotification);
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;
    (process as any)._sessionId = "provider-session-1";

    fakeProcess.exitCode = null;
    fakeProcess.emit("exit", null, "SIGTERM");

    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({
      method: "session/update",
      params: expect.objectContaining({
        sessionId: "provider-session-1",
        update: expect.objectContaining({
          sessionUpdate: "error",
          error: expect.objectContaining({ code: "process_exited" }),
        }),
      }),
    }));
    vi.useRealTimers();
  });

  it("reports an external SIGTERM that dsh turns into exit code 0", async () => {
    // Observed live: `kill -TERM` on a dsh agent → "Process exited: code=0,
    // signal=null". Exit code alone cannot tell this apart from health.
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess(onNotification);
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;
    (process as any)._sessionId = "provider-session-1";

    fakeProcess.exitCode = 0;
    fakeProcess.emit("exit", 0, null);

    const errorUpdates = onNotification.mock.calls.filter(([msg]) => (
      (msg as { params?: { update?: { sessionUpdate?: string } } }).params?.update?.sessionUpdate === "error"
    ));
    expect(errorUpdates).toHaveLength(1);
    vi.useRealTimers();
  });

  it("does not report an error when Routa itself kills the process", async () => {
    vi.useFakeTimers();
    const onNotification = vi.fn();
    const fakeProcess = new FakeProcess();
    spawnMock.mockReturnValue(fakeProcess);

    const process = createProcess(onNotification);
    const startPromise = process.start();
    await vi.advanceTimersByTimeAsync(500);
    await startPromise;
    (process as any)._sessionId = "provider-session-1";

    process.kill();

    const errorUpdates = onNotification.mock.calls.filter(([msg]) => (
      (msg as { params?: { update?: { sessionUpdate?: string } } }).params?.update?.sessionUpdate === "error"
    ));
    expect(errorUpdates).toHaveLength(0);
    vi.useRealTimers();
  });

  it("converts late stopReason responses into turn_complete notifications", () => {
    const onNotification = vi.fn();
    const process = createProcess(onNotification);

    process.setSessionContext({
      sessionId: "session-1",
      provider: "codex",
      role: "CRAFTER",
    });

    (process as any)._sessionId = "acp-session-1";
    (process as any).handleMessage({
      jsonrpc: "2.0",
      id: 3,
      result: {
        stopReason: "end_turn",
      },
    });

    expect(onNotification).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "acp-session-1",
        update: {
          sessionUpdate: "turn_complete",
          stopReason: "end_turn",
        },
      },
    });
  });
});

describe("AcpProcess configOptions cache", () => {
  const modelOption = (model: string) => ({
    id: "model",
    name: "Model",
    type: "select",
    currentValue: JSON.stringify(["local-7357", model]),
    options: [{ group: "local-7357", name: "local", options: [
      { value: JSON.stringify(["local-7357", "claude-opus-4-6"]), name: "opus 4.6" },
      { value: JSON.stringify(["local-7357", "claude-opus-5-5-pool"]), name: "opus 5.5" },
    ] }],
  });
  const effortOption = (value: string) => ({
    id: "reasoning_effort",
    name: "Reasoning",
    type: "select",
    currentValue: value,
    options: [{ value: "", name: "default" }, { value: "high", name: "high" }],
  });

  function createDshProcess(onNotification = vi.fn()) {
    return new AcpProcess({ command: "dsh", args: [], cwd: "/tmp", displayName: "DSH" }, onNotification);
  }

  it("caches configOptions returned by session/new", async () => {
    const proc = createDshProcess();
    const sendRequest = vi.fn(async () => ({
      sessionId: "acp-1",
      configOptions: [modelOption("claude-opus-5-5-pool"), effortOption("")],
    }));
    (proc as any).sendRequest = sendRequest;

    await proc.newSession("/tmp");

    expect(proc.getConfigOptions()?.map((o) => o.id)).toEqual(["model", "reasoning_effort"]);
  });

  it("caches configOptions returned by session/load", async () => {
    const proc = createDshProcess();
    (proc as any).sendRequest = vi.fn(async () => ({ configOptions: [modelOption("claude-opus-4-6")] }));

    await proc.loadSession("acp-1", "/tmp");

    expect(proc.getConfigOptions()?.[0]?.currentValue).toBe(JSON.stringify(["local-7357", "claude-opus-4-6"]));
  });

  it("replaces the cache on config_option_update notifications and still forwards them", () => {
    const onNotification = vi.fn();
    const proc = createDshProcess(onNotification);
    const listener = vi.fn();
    proc.setConfigOptionsListener(listener);
    const replacement = [modelOption("claude-opus-4-6"), effortOption("high")];

    (proc as any).handleMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "acp-1", update: { sessionUpdate: "config_option_update", configOptions: replacement } },
    });

    expect(proc.getConfigOptions()).toEqual(replacement);
    expect(listener).toHaveBeenCalledWith(replacement);
    expect(onNotification).toHaveBeenCalledTimes(1);
  });

  it("sends session/set_config_option and replaces the cache with the result", async () => {
    const proc = createDshProcess();
    const after = [modelOption("claude-opus-5-5-pool"), effortOption("high")];
    const sendRequest = vi
      .fn()
      .mockResolvedValueOnce({ sessionId: "acp-1", configOptions: [modelOption("claude-opus-5-5-pool"), effortOption("")] })
      .mockResolvedValueOnce({ configOptions: after });
    (proc as any).sendRequest = sendRequest;

    await proc.newSession("/tmp");
    const result = await proc.setConfigOption("reasoning_effort", "high");

    expect(sendRequest).toHaveBeenLastCalledWith("session/set_config_option", {
      sessionId: "acp-1",
      configId: "reasoning_effort",
      value: "high",
    });
    expect(result).toEqual(after);
    expect(proc.getConfigOptions()).toEqual(after);
  });
});
