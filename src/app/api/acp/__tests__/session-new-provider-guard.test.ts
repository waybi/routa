/**
 * @vitest-environment node
 *
 * session/new refuses a static preset whose command is missing, synchronously,
 * before any session exists (card f1bc30c7 / retro L298). The provider lists
 * (`_providers/list`, GET /api/providers?check=true) report the same reason.
 *
 * Pre-existing behaviour (customCommand, sdk/docker/workspace branches,
 * registry ids, idempotency replay, list fields) is pinned in the same file so
 * one run on the parent commit shows which cases are new.
 */
import { NextRequest } from "next/server";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const store = {
    upsertSession: vi.fn((record: Record<string, unknown>) => {
      const sessionId = record.sessionId as string;
      sessions.set(sessionId, { ...sessions.get(sessionId), ...record });
    }),
    getSession: vi.fn((sessionId: string) => sessions.get(sessionId)),
    updateSessionAcpStatus: vi.fn(),
    pushNotification: vi.fn(),
    pushUserMessage: vi.fn(),
  };
  const manager = {
    createSession: vi.fn(),
    createSessionFromInline: vi.fn(),
    createClaudeSession: vi.fn(),
    createClaudeCodeSdkSession: vi.fn(),
    createOpencodeSdkSession: vi.fn(),
    createDockerSession: vi.fn(),
    createWorkspaceAgentSession: vi.fn(),
    getProcess: vi.fn(),
    getConfigOptions: vi.fn(),
    setConfigOption: vi.fn(),
  };
  return {
    sessions,
    store,
    manager,
    which: vi.fn<(command: string) => Promise<string | null>>(),
    actualWhich: { fn: null as null | ((command: string) => Promise<string | null>) },
    dockerCheck: vi.fn(),
    fetchRegistry: vi.fn(),
    claudeSdkConfigured: vi.fn(() => false),
    opencodeSdkConfigured: vi.fn(() => false),
  };
});

vi.mock("@/core/acp/http-session-store", () => ({ getHttpSessionStore: () => h.store }));
vi.mock("@/core/acp/processer", () => ({ getAcpProcessManager: () => h.manager }));
vi.mock("../acp-session-history", () => ({
  getSessionWriteBuffer: () => ({ add: vi.fn(), replace: vi.fn(), flush: vi.fn(async () => undefined) }),
}));
vi.mock("@/core/acp/runner-routing", () => ({
  getSessionRoutingRecord: vi.fn(async () => undefined),
  getRequiredRunnerUrl: vi.fn(() => null),
  isForwardedAcpRequest: vi.fn(() => false),
  proxyRequestToRunner: vi.fn(),
  runnerUnavailableResponse: vi.fn(),
}));
vi.mock("@/core/acp/session-db-persister", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/acp/session-db-persister")>()),
  persistSessionToDb: vi.fn(async () => undefined),
  updateSessionExecutionBindingInDb: vi.fn(async () => undefined),
}));
vi.mock("@/core/trace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/trace")>()),
  recordTrace: vi.fn(),
}));
vi.mock("@/core/sandbox/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/sandbox/permissions")>()),
  createWorkspaceSessionSandbox: vi.fn(async () => undefined),
}));
vi.mock("@/core/acp/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/acp/utils")>();
  h.actualWhich.fn = actual.which;
  return { ...actual, which: h.which };
});
// resolveCommand loads the platform bridge with a runtime require("@/core/platform"),
// which Node cannot resolve under vitest. Keep its env-override → bare-command order.
vi.mock("@/core/acp/acp-presets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/acp/acp-presets")>();
  return {
    ...actual,
    resolveCommand: vi.fn((preset: { command: string; envBinOverride?: string }) =>
      (preset.envBinOverride && process.env[preset.envBinOverride]) || preset.command),
  };
});
vi.mock("@/core/acp/acp-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/acp/acp-registry")>()),
  fetchRegistry: h.fetchRegistry,
}));
vi.mock("@/core/acp/docker", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/acp/docker")>()),
  getDockerDetector: () => ({ checkAvailability: h.dockerCheck }),
}));
vi.mock("@/core/acp/claude-code-sdk-adapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/acp/claude-code-sdk-adapter")>()),
  isClaudeCodeSdkConfigured: h.claudeSdkConfigured,
}));
vi.mock("@/core/acp/opencode-sdk-adapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/acp/opencode-sdk-adapter")>()),
  isOpencodeServerConfigured: h.opencodeSdkConfigured,
}));

import { POST } from "../route";
import { idempotencyCache, pendingAcpCreations } from "../acp-session-create";
import { ACP_AGENT_PRESETS, getStandardPresets } from "@/core/acp/acp-presets";
import { buildConfigFromPreset } from "@/core/acp/process-config";
import { buildClaudeCodeConfig } from "@/core/acp/claude-code-process";

const MISSING = "routa-missing-cmd-test";
const NOT_INSTALLED = "is not installed or not in PATH";
const CWD = "/tmp/routa-f1bc30c7-guard-cwd";

type RpcBody = {
  result?: Record<string, unknown> & { sessionId?: string };
  error?: { code: number; message: string };
};

let rpcId = 1;
async function rpc(method: string, params: Record<string, unknown>): Promise<RpcBody> {
  const response = await POST(
    new NextRequest("http://localhost/api/acp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
    }),
  );
  const body = (await response.json()) as RpcBody;
  await Promise.allSettled([...pendingAcpCreations.values()]);
  return body;
}

function sessionNew(params: Record<string, unknown>) {
  return rpc("session/new", { workspaceId: "default", cwd: CWD, ...params });
}

async function getProvidersChecked() {
  vi.resetModules();
  const { GET } = await import("@/app/api/providers/route");
  const response = await GET(new NextRequest("http://localhost/api/providers?check=true"));
  return (await response.json()) as { providers: Array<Record<string, unknown>> };
}

async function listProviders() {
  const body = await rpc("_providers/list", {});
  return (body.result as { providers: Array<Record<string, unknown>> }).providers;
}

function allCreateCalls(): number {
  return Object.entries(h.manager)
    .filter(([name]) => name.startsWith("create"))
    .reduce((sum, [, fn]) => sum + fn.mock.calls.length, 0);
}

/** which: every command resolves except the ones listed. */
function whichMissing(...missing: string[]) {
  h.which.mockImplementation(async (command: string) =>
    missing.includes(command) ? null : `/usr/local/bin/${command}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.sessions.clear();
  idempotencyCache.clear();
  vi.stubEnv("CODEX_ACP_BIN", MISSING);
  whichMissing();
  h.dockerCheck.mockResolvedValue({ available: false });
  h.fetchRegistry.mockResolvedValue({ agents: [] });
  h.claudeSdkConfigured.mockReturnValue(false);
  h.opencodeSdkConfigured.mockReturnValue(false);
  h.manager.getProcess.mockReturnValue(undefined);
  h.manager.createSession.mockResolvedValue("acp-session");
  h.manager.createSessionFromInline.mockResolvedValue("acp-inline");
  h.manager.createClaudeSession.mockResolvedValue("acp-claude");
  h.manager.createWorkspaceAgentSession.mockResolvedValue("acp-workspace");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("session/new provider guard (new behaviour)", () => {
  it("C2/AC2/AC4: missing codex command → -32002 three times, nothing created, no process-level errors", async () => {
    whichMissing(MISSING);
    let uncaught = 0;
    let unhandled = 0;
    const onUncaught = () => { uncaught += 1; };
    const onUnhandled = () => { unhandled += 1; };
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUnhandled);
    const cacheSizeBefore = idempotencyCache.size;
    const sessionsBefore = h.sessions.size;

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const body = await sessionNew({ provider: "codex", idempotencyKey: "guard-key" });
        expect(body.result).toBeUndefined();
        expect(body.error?.code).toBe(-32002);
        expect(body.error?.message).toContain("codex");
        expect(body.error?.message).toContain(MISSING);
        expect(body.error?.message).toContain(NOT_INSTALLED);
      }
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off("uncaughtException", onUncaught);
      process.off("unhandledRejection", onUnhandled);
    }

    expect(h.sessions.size).toBe(sessionsBefore);
    expect(h.store.upsertSession).not.toHaveBeenCalled();
    expect(h.manager.createSession).toHaveBeenCalledTimes(0);
    expect(h.manager.createSessionFromInline).toHaveBeenCalledTimes(0);
    expect(allCreateCalls()).toBe(0);
    expect(idempotencyCache.size).toBe(cacheSizeBefore);
    expect(idempotencyCache.has("guard-key")).toBe(false);
    expect(uncaught).toBe(0);
    expect(unhandled).toBe(0);
  });

  it("C3: the error is not cached — after installing the CLI the same idempotencyKey creates a session", async () => {
    whichMissing(MISSING);
    const first = await sessionNew({ provider: "codex", idempotencyKey: "install-later" });
    expect(first.error?.code).toBe(-32002);

    whichMissing();
    const second = await sessionNew({ provider: "codex", idempotencyKey: "install-later" });

    expect(second.error).toBeUndefined();
    expect(typeof second.result?.sessionId).toBe("string");
    expect(second.result?.cached).toBeUndefined();
    expect(h.manager.createSession).toHaveBeenCalledTimes(1);
  });

  describe("C4: dsh via DSH_BIN absolute path (real which, temp file)", () => {
    let dir = "";
    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), "routa-f1bc30c7-dsh-"));
      h.which.mockImplementation((command: string) => h.actualWhich.fn!(command));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("checks and spawns the same DSH_BIN path; an existing file passes", async () => {
      const fakeDsh = path.join(dir, "dsh");
      writeFileSync(fakeDsh, "#!/bin/sh\nexit 0\n");
      chmodSync(fakeDsh, 0o755);
      vi.stubEnv("DSH_BIN", fakeDsh);

      const body = await sessionNew({ provider: "dsh" });

      expect(body.error).toBeUndefined();
      expect(typeof body.result?.sessionId).toBe("string");
      expect(h.manager.createSession).toHaveBeenCalledTimes(1);
      expect(h.manager.createSession.mock.calls[0][3]).toBe("dsh");
      expect(h.which).toHaveBeenCalledWith(fakeDsh);
      const spawnConfig = await buildConfigFromPreset("dsh", CWD);
      expect(spawnConfig.command).toBe(fakeDsh);
    });

    it("a DSH_BIN path that does not exist → -32002 naming that path", async () => {
      const missingDsh = path.join(dir, "no-such-dsh");
      vi.stubEnv("DSH_BIN", missingDsh);

      const body = await sessionNew({ provider: "dsh" });

      expect(body.error?.code).toBe(-32002);
      expect(body.error?.message).toContain(`${missingDsh} ${NOT_INSTALLED}`);
      expect((await buildConfigFromPreset("dsh", CWD)).command).toBe(missingDsh);
      expect(allCreateCalls()).toBe(0);
    });
  });

  it("F4: every standard preset and every claude stream-json id is refused when its command is missing", async () => {
    const standardIds = getStandardPresets().map((preset) => preset.id);
    const streamJsonIds = ["claude", "cc-haha", "claude-code"];
    expect(standardIds).toEqual(expect.arrayContaining(["codex", "dsh", "opencode"]));
    h.which.mockResolvedValue(null);

    for (const provider of [...standardIds, ...streamJsonIds]) {
      const body = await sessionNew({ provider });
      expect(body.error?.code, provider).toBe(-32002);
      expect(body.error?.message, provider).toContain(`"${provider}"`);
      expect(body.error?.message, provider).toContain(NOT_INSTALLED);
    }
    expect(allCreateCalls()).toBe(0);
    expect(h.sessions.size).toBe(0);
  });

  it("C5/AC5: _providers/list and /api/providers?check=true both carry unavailableReason for missing static presets", async () => {
    whichMissing(MISSING);
    const expectedReason = `${MISSING} ${NOT_INSTALLED}`;

    const listed = await listProviders();
    const checked = (await getProvidersChecked()).providers;

    for (const providers of [listed, checked]) {
      const codex = providers.find((provider) => provider.id === "codex");
      const opencode = providers.find((provider) => provider.id === "opencode");
      expect(codex).toMatchObject({ status: "unavailable", unavailableReason: expectedReason });
      expect(opencode?.status).toBe("available");
      expect(opencode).not.toHaveProperty("unavailableReason");
    }
    const docker = checked.find((provider) => provider.id === "docker-opencode");
    expect(docker?.unavailableReason).toBe("Docker daemon unavailable. Start Docker Desktop or Colima.");
    expect(allCreateCalls()).toBe(0);
  });
});

describe("session/new pre-existing behaviour (F2: same result before and after)", () => {
  it("F2a: customCommand skips the preset check even when nothing resolves", async () => {
    h.which.mockResolvedValue(null);

    const body = await sessionNew({ provider: "codex", customCommand: "my-agent", customArgs: ["--acp"] });

    expect(typeof body.result?.sessionId).toBe("string");
    expect(h.which).not.toHaveBeenCalled();
    expect(h.manager.createSessionFromInline).toHaveBeenCalledTimes(1);
    expect(h.manager.createSessionFromInline.mock.calls[0][1]).toBe("my-agent");
  });

  it("F2b: workspace provider keeps its branch", async () => {
    h.which.mockResolvedValue(null);

    const body = await sessionNew({ provider: "workspace" });

    expect(body.error?.code).not.toBe(-32002);
    expect(typeof body.result?.sessionId).toBe("string");
    expect(h.which).not.toHaveBeenCalled();
  });

  it("F2c: claude-code-sdk not configured keeps code and message", async () => {
    h.which.mockResolvedValue(null);
    const body = await sessionNew({ provider: "claude-code-sdk" });
    expect(body.error).toEqual({
      code: -32002,
      message: "Claude Code SDK not configured. Set ANTHROPIC_AUTH_TOKEN environment variable.",
    });
  });

  it("F2d: opencode-sdk not configured keeps code and message", async () => {
    h.which.mockResolvedValue(null);
    const body = await sessionNew({ provider: "opencode-sdk" });
    expect(body.error).toEqual({
      code: -32002,
      message: "OpenCode SDK not configured. Set OPENCODE_SERVER_URL or OPENCODE_API_KEY (or ANTHROPIC_AUTH_TOKEN) environment variable.",
    });
  });

  it("F2e: docker-opencode not ready keeps code and message", async () => {
    h.which.mockResolvedValue(null);
    h.dockerCheck.mockResolvedValue({ available: false, error: "colima stopped" });
    const first = await sessionNew({ provider: "docker-opencode" });
    expect(first.error).toEqual({ code: -32003, message: "Docker unavailable: colima stopped" });

    h.dockerCheck.mockResolvedValue({ available: false });
    const second = await sessionNew({ provider: "docker-opencode" });
    expect(second.error).toEqual({
      code: -32003,
      message: "Docker daemon is unavailable. Please start Docker or Colima first.",
    });
  });

  it("F2f: registry-only codex-acp passes through", async () => {
    h.which.mockResolvedValue(null);
    const body = await sessionNew({ provider: "codex-acp" });
    expect(body.result).toMatchObject({ provider: "codex-acp", acpStatus: "connecting" });
    expect(h.manager.createSession.mock.calls[0][3]).toBe("codex-acp");
  });

  it("F2g: dsh, claude and opencode create sessions with the same provider/model/effort when available", async () => {
    const dsh = await sessionNew({ provider: "dsh", model: "claude-opus-4-6", reasoningEffort: "high" });
    expect(dsh.result).toMatchObject({ provider: "dsh", model: "claude-opus-4-6" });
    expect(h.manager.createSession.mock.calls[0][3]).toBe("dsh");
    expect(h.manager.createSession.mock.calls[0][6]).toEqual({ DSH_ACP_MODEL: "claude-opus-4-6" });

    const opencode = await sessionNew({ provider: "opencode", model: "m1" });
    expect(opencode.result).toMatchObject({ provider: "opencode", model: "m1" });
    expect(h.manager.createSession.mock.calls[1][3]).toBe("opencode");
    expect(h.manager.createSession.mock.calls[1][5]).toEqual(["-m", "m1"]);

    const claude = await sessionNew({ provider: "claude", model: "sonnet" });
    expect(claude.result).toMatchObject({ provider: "claude" });
    expect(h.manager.createClaudeSession).toHaveBeenCalledTimes(1);
    expect(h.manager.createClaudeSession.mock.calls[0][8]).toBe("claude");
  });

  it("F2h: a cached idempotent success is replayed even if the provider became unavailable", async () => {
    const first = await sessionNew({ provider: "codex", idempotencyKey: "cached-key" });
    expect(typeof first.result?.sessionId).toBe("string");

    whichMissing(MISSING);
    const replay = await sessionNew({ provider: "codex", idempotencyKey: "cached-key" });

    expect(replay.error).toBeUndefined();
    expect(replay.result).toMatchObject({ sessionId: first.result?.sessionId, cached: true });
    expect(h.manager.createSession).toHaveBeenCalledTimes(1);
  });

  it("F2i: provider lists are read-only and keep the available-entry field set", async () => {
    const fields = ["command", "description", "id", "name", "source", "status"];
    for (let round = 0; round < 2; round += 1) {
      const listed = await listProviders();
      const checked = (await getProvidersChecked()).providers;
      for (const providers of [listed, checked]) {
        const opencode = providers.find((provider) => provider.id === "opencode");
        expect(Object.keys(opencode ?? {}).sort()).toEqual(fields);
      }
    }
    expect(allCreateCalls()).toBe(0);
    expect(h.sessions.size).toBe(0);
  });
});

describe("F3: batch cross-check against a judge written from the requirement", () => {
  // Judge: written from the card, not from the implementation.
  const plantServerBug = process.env.ROUTA_F3_PLANT === "server";
  const skipIds = new Set([
    "opencode-sdk",
    "docker-opencode",
    "workspace",
    ...(plantServerBug ? [] : ["claude-code-sdk"]),
  ]);
  const streamJsonIds = new Set(["claude", "cc-haha", "claude-code"]);

  async function spawnCommand(provider: string): Promise<string> {
    if (streamJsonIds.has(provider)) return buildClaudeCodeConfig(CWD, [], undefined, undefined, undefined, provider).command;
    try {
      return (await buildConfigFromPreset(provider, CWD)).command;
    } catch {
      return `(no spawn command for ${provider})`;
    }
  }

  it("session/new and both lists agree with the judge for every preset × which × customCommand", async () => {
    const ids = [...ACP_AGENT_PRESETS.map((preset) => preset.id), "claude-code", "claude-code-sdk", "opencode-sdk"];
    const listIds = [...getStandardPresets().map((preset) => preset.id), "claude", "cc-haha"];
    const mismatches: string[] = [];
    let total = 0;

    for (const whichMode of ["path", "null"] as const) {
      h.which.mockImplementation(async (command: string) => (whichMode === "null" ? null : `/usr/local/bin/${command}`));
      const listed = await listProviders();
      const checked = (await getProvidersChecked()).providers;

      for (const customCommand of [undefined, "my-agent"]) {
        for (const provider of ids) {
          total += 1;
          const body = await sessionNew({ provider, ...(customCommand ? { customCommand } : {}) });
          const newCheckFired = body.error?.code === -32002 && body.error.message.includes(NOT_INSTALLED);
          const label = `${provider}/which=${whichMode}/custom=${customCommand ?? "none"}`;

          if (customCommand || skipIds.has(provider)) {
            if (newCheckFired) mismatches.push(`${label}: guard fired on a skipped branch`);
            continue;
          }
          if (whichMode === "path") {
            if (typeof body.result?.sessionId !== "string") mismatches.push(`${label}: expected sessionId, got ${JSON.stringify(body)}`);
            continue;
          }
          const command = await spawnCommand(provider);
          const ok = newCheckFired
            && body.error!.message.includes(provider)
            && body.error!.message.includes(`${command} ${NOT_INSTALLED}`);
          if (!ok) mismatches.push(`${label}: expected -32002 naming ${command}, got ${JSON.stringify(body)}`);
        }
      }

      for (const provider of listIds) {
        for (const [name, providers] of [["_providers/list", listed], ["/api/providers", checked]] as const) {
          total += 1;
          const entry = providers.find((candidate) => candidate.id === provider);
          const command = await spawnCommand(provider);
          const expected = whichMode === "null"
            ? { status: "unavailable", unavailableReason: `${command} ${NOT_INSTALLED}` }
            : { status: "available", unavailableReason: undefined };
          if (entry?.status !== expected.status || entry?.unavailableReason !== expected.unavailableReason) {
            mismatches.push(`${name} ${provider}/which=${whichMode}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(entry)}`);
          }
        }
      }
    }

    process.stdout.write(`F3 server cross-check: total=${total} pass=${total - mismatches.length} mismatches=${mismatches.length}${plantServerBug ? " (planted judge bug)" : ""}\n${mismatches.join("\n")}\n`);
    expect(mismatches).toEqual([]);
  });
});
