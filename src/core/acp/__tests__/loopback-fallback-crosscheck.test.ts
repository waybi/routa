/**
 * @vitest-environment node
 *
 * L127 batch cross-check: random env/origin combinations for every self-call
 * fallback, judged by an independent expectation derived from the requirement:
 *   override variable set -> its origin; only HOST set -> http://HOST:PORT;
 *   nothing set -> http://127.0.0.1:PORT; acp route rewrites only loopback aliases
 *   (localhost, [::1], 127/8 — NextURL folds them all into "localhost").
 * L127_CROSSCHECK_N sets the batch size (default 10000).
 * L127_CROSSCHECK_PLANT=1 plants one wrong expectation to prove the judge catches it.
 */
import Module from "node:module";

import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleWithLoad = Module as unknown as { _load: ModuleLoad };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request, parent, isMain) {
  if (request === "@/core/mcp/mcp-server-singleton") return { getMcpServer: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
afterAll(() => {
  moduleWithLoad._load = originalLoad;
});

const { getInternalBaseUrl } = await import("@/core/background-worker");
const { getDefaultRoutaMcpConfig } = await import("../mcp-config-generator");
const { getMcpEndpointUrl } = await import("@/core/mcp/mcp-server-singleton");
const { RoutaOrchestrator } = await import("@/core/orchestration/orchestrator");
const { resolveRequestServerUrl } = await import("@/app/api/acp/acp-request-server-url");

const N = Number(process.env.L127_CROSSCHECK_N ?? 10000);
const PLANT = process.env.L127_CROSSCHECK_PLANT === "1";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x127);
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = <T,>(items: T[]): T => items[int(0, items.length - 1)];
const word = () => Array.from({ length: int(3, 8) }, () => String.fromCharCode(97 + int(0, 25))).join("");
const hostName = () => `${word()}.${pick(["test", "example", "internal"])}`;
const ipv4 = () => `${int(1, 223)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`;
const randomPort = () => String(int(1024, 65535));
const originOf = (url: string) => new URL(url).origin;

const ENV_KEYS = ["PORT", "HOST", "NEXTAUTH_URL", "VERCEL_URL", "ROUTA_SERVER_URL", "ROUTA_WORKSPACE_ID"];
function setEnv(values: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) vi.stubEnv(key, values[key]); // undefined = truly unset
}

interface Mismatch { fn: string; input: unknown; expected: string; actual: string }

function report(mismatches: Mismatch[]) {
  if (mismatches.length > 0) console.error(`[l127-crosscheck] ${mismatches.length} mismatch(es); first:`, mismatches[0]);
  return mismatches.length;
}

// Plants exactly one wrong expectation per judge: the first loopback one.
let planted = new Set<string>();
function plantedExpectation(fn: string, expected: string): string {
  if (!PLANT || planted.has(fn) || !expected.includes("127.0.0.1")) return expected;
  planted.add(fn);
  return expected.replace("127.0.0.1", "localhost");
}

describe(`L127 loopback fallback cross-check (N=${N}${PLANT ? ", planted" : ""})`, () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    if (PLANT) expect(planted.size).toBe(5);
    planted = new Set();
  });

  it("getInternalBaseUrl", () => {
    const mismatches: Mismatch[] = [];
    for (let i = 0; i < N; i++) {
      const port = randomPort();
      const host = rand() < 0.5 ? hostName() : undefined; // HOST is not an input of this function
      const nextAuth = rand() < 0.3 ? `http://${hostName()}:${randomPort()}` : undefined;
      setEnv({ PORT: port, HOST: host, NEXTAUTH_URL: nextAuth });
      const expected = plantedExpectation("getInternalBaseUrl", nextAuth ? originOf(nextAuth) : `http://127.0.0.1:${port}`);
      const actual = originOf(getInternalBaseUrl());
      if (actual !== expected) mismatches.push({ fn: "getInternalBaseUrl", input: { port, host, nextAuth }, expected, actual });
    }
    expect(report(mismatches)).toBe(0);
  });

  it("getDefaultRoutaMcpConfig", () => {
    const mismatches: Mismatch[] = [];
    for (let i = 0; i < N; i++) {
      const port = randomPort();
      const host = rand() < 0.5 ? hostName() : undefined;
      const which = pick(["none", "ROUTA_SERVER_URL", "serverUrlOverride"]);
      const overrideUrl = which === "none" ? undefined : `http://${hostName()}:${randomPort()}`;
      setEnv({ PORT: port, HOST: host, ROUTA_SERVER_URL: which === "ROUTA_SERVER_URL" ? overrideUrl : undefined });
      const config = getDefaultRoutaMcpConfig(undefined, undefined, undefined, undefined,
        which === "serverUrlOverride" ? overrideUrl : undefined);
      const expected = plantedExpectation("getDefaultRoutaMcpConfig", overrideUrl ? originOf(overrideUrl) : `http://${host ?? "127.0.0.1"}:${port}`);
      const actual = originOf(config.routaServerUrl);
      const endpointOk = config.mcpEndpoint === `${config.routaServerUrl}/api/mcp`;
      if (actual !== expected || !endpointOk) {
        mismatches.push({ fn: "getDefaultRoutaMcpConfig", input: { port, host, which, overrideUrl }, expected, actual });
      }
    }
    expect(report(mismatches)).toBe(0);
  });

  it("getMcpEndpointUrl", () => {
    const mismatches: Mismatch[] = [];
    for (let i = 0; i < N; i++) {
      const envPort = rand() < 0.5 ? randomPort() : undefined;
      const fallbackPort = randomPort();
      const host = rand() < 0.5 ? hostName() : undefined;
      setEnv({ PORT: envPort, HOST: host });
      const expected = plantedExpectation("getMcpEndpointUrl", `http://${host ?? "127.0.0.1"}:${envPort ?? fallbackPort}/api/mcp`);
      const actual = getMcpEndpointUrl(fallbackPort);
      if (actual !== expected) mismatches.push({ fn: "getMcpEndpointUrl", input: { envPort, fallbackPort, host }, expected, actual });
    }
    expect(report(mismatches)).toBe(0);
  });

  it("orchestrator child MCP url", async () => {
    const mismatches: Mismatch[] = [];
    const system = {
      eventBus: { on: vi.fn(), emit: vi.fn() },
      agentStore: { get: vi.fn(async () => undefined) },
      conversationStore: {},
      tools: {},
    };
    for (let i = 0; i < N; i++) {
      const port = randomPort();
      const host = rand() < 0.5 ? hostName() : undefined;
      setEnv({ PORT: "3000", HOST: host });
      let captured = "";
      const processManager = {
        createClaudeSession: async (_s: string, _c: string, _n: unknown, configs: string[]) => {
          captured = JSON.parse(configs[0]).mcpServers.routa.url;
          return "acp";
        },
        getClaudeProcess: () => undefined,
      };
      const orchestrator = new RoutaOrchestrator(system as never, processManager as never, { serverPort: port } as never);
      const internals = orchestrator as unknown as {
        watchForReportFiles: () => void;
        spawnChildAgent: (...args: string[]) => Promise<unknown>;
      };
      internals.watchForReportFiles = () => {};
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      await internals.spawnChildAgent("s", "a", "claude", "/tmp", "go", "p", "ws");
      log.mockRestore();
      const expected = plantedExpectation("orchestrator", `http://${host ?? "127.0.0.1"}:${port}/api/mcp`);
      const actual = captured.split("?")[0];
      if (actual !== expected) mismatches.push({ fn: "orchestrator", input: { port, host }, expected, actual });
    }
    expect(report(mismatches)).toBe(0);
  });

  it("resolveRequestServerUrl", () => {
    const mismatches: Mismatch[] = [];
    for (let i = 0; i < N; i++) {
      const kind = pick(["localhost", "127.0.0.1", "[::1]", "domain", "ipv4"]);
      const host = kind === "domain" ? hostName() : kind === "ipv4" ? ipv4() : kind;
      const scheme = pick(["http", "https"]);
      const port = randomPort();
      const input = `${scheme}://${host}:${port}/api/acp`;
      // Next.js NextURL already folds every 127/8 address and [::1] into "localhost",
      // so all of them are loopback aliases here; only 127.0.0.1 is bound.
      const loopbackAlias = kind !== "domain" && (kind !== "ipv4" || host.startsWith("127."));
      const expected = plantedExpectation("resolveRequestServerUrl", `${scheme}://${loopbackAlias ? "127.0.0.1" : host}:${port}`);
      const actual = resolveRequestServerUrl(new NextRequest(input));
      if (actual !== expected) mismatches.push({ fn: "resolveRequestServerUrl", input, expected, actual });
    }
    expect(report(mismatches)).toBe(0);
  });
});
