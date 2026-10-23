/**
 * @vitest-environment node
 *
 * L127: production binds 127.0.0.1 only, so every self-call fallback that is
 * handed to spawned agents must use the IPv4 loopback, not `localhost`.
 */
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import Module from "node:module";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMcpServerMock = vi.hoisted(() => vi.fn());

// mcp-config-generator loads the singleton with a CommonJS `require` (to dodge a
// circular import), which vi.mock cannot intercept. Hook Node's loader for that
// one module id instead.
type ModuleLoad = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleWithLoad = Module as unknown as { _load: ModuleLoad };
const originalLoad = moduleWithLoad._load;
moduleWithLoad._load = function patchedLoad(request, parent, isMain) {
  if (request === "@/core/mcp/mcp-server-singleton") {
    return { getMcpServer: getMcpServerMock };
  }
  return originalLoad.call(this, request, parent, isMain);
};
afterAll(() => {
  moduleWithLoad._load = originalLoad;
});

vi.mock("@/core/store/custom-mcp-server-store", () => ({
  getCustomMcpServerStore: () => null,
  mergeCustomMcpServers: (builtIn: Record<string, unknown>) => builtIn,
}));

const { getDefaultRoutaMcpConfig } = await import("../mcp-config-generator");

const OVERRIDE_VARS = ["HOST", "ROUTA_SERVER_URL", "NEXTAUTH_URL", "VERCEL_URL", "ROUTA_WORKSPACE_ID"];

function clearOverrides() {
  vi.stubEnv("PORT", "4123");
  for (const key of OVERRIDE_VARS) vi.stubEnv(key, "");
}

describe("getDefaultRoutaMcpConfig loopback fallback", () => {
  beforeEach(() => {
    clearOverrides();
    getMcpServerMock.mockReset();
    getMcpServerMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    { branch: "a: standalone MCP server not running", running: false },
    { branch: "b: standalone MCP server running", running: true },
  ])("$branch falls back to http://127.0.0.1:<PORT>", ({ running }) => {
    if (running) {
      getMcpServerMock.mockReturnValue({ isRunning: true, mcpUrl: "http://127.0.0.1:54321/mcp" });
    }

    const config = getDefaultRoutaMcpConfig("ws-1", "sess-1");

    expect(getMcpServerMock).toHaveBeenCalled();
    const serverUrl = new URL(config.routaServerUrl);
    expect(serverUrl.hostname).toBe("127.0.0.1");
    expect(serverUrl.port).toBe("4123");
    expect(config.routaServerUrl).toBe("http://127.0.0.1:4123");
    if (running) {
      expect(config.mcpEndpoint).toBe("http://127.0.0.1:54321/mcp?wsId=ws-1&sid=sess-1");
    } else {
      const endpoint = new URL(config.mcpEndpoint!);
      expect(endpoint.hostname).toBe("127.0.0.1");
      expect(endpoint.port).toBe("4123");
      expect(config.mcpEndpoint).toBe("http://127.0.0.1:4123/api/mcp?wsId=ws-1&sid=sess-1");
    }
    expect(JSON.stringify(config)).not.toContain("localhost");
  });

  it.each([false, true])("keeps HOST override (singleton running=%s)", (running) => {
    if (running) {
      getMcpServerMock.mockReturnValue({ isRunning: true, mcpUrl: "http://127.0.0.1:54321/mcp" });
    }
    vi.stubEnv("HOST", "myhost");
    const config = getDefaultRoutaMcpConfig();
    expect(getMcpServerMock).toHaveBeenCalled();
    expect(config.routaServerUrl).toBe("http://myhost:4123");
    expect(config.mcpEndpoint).toBe(running ? "http://127.0.0.1:54321/mcp" : "http://myhost:4123/api/mcp");
  });

  it("keeps ROUTA_SERVER_URL override", () => {
    vi.stubEnv("ROUTA_SERVER_URL", "http://routa.test:7777");
    const config = getDefaultRoutaMcpConfig();
    expect(config.routaServerUrl).toBe("http://routa.test:7777");
    expect(config.mcpEndpoint).toBe("http://routa.test:7777/api/mcp");
  });

  it("keeps serverUrlOverride", () => {
    const config = getDefaultRoutaMcpConfig(undefined, undefined, undefined, undefined, "http://override.test:8888");
    expect(config.routaServerUrl).toBe("http://override.test:8888");
    expect(config.mcpEndpoint).toBe("http://override.test:8888/api/mcp");
  });

  it("treats HOST=\"\" as unset (no host-less URL)", () => {
    vi.stubEnv("HOST", "");
    const config = getDefaultRoutaMcpConfig();
    expect(new URL(config.routaServerUrl).hostname).toBe("127.0.0.1");
  });
});

describe("ensureMcpForProvider consumes the loopback default", () => {
  let tmpHome: string;

  beforeEach(async () => {
    clearOverrides();
    getMcpServerMock.mockReset();
    getMcpServerMock.mockReturnValue(null);
    tmpHome = await fsp.mkdtemp(path.join(os.tmpdir(), "l127-mcp-setup-home-"));
    vi.stubEnv("HOME", tmpHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fsp.rm(tmpHome, { recursive: true, force: true });
  });

  it("hands the CLI agent a Routa MCP URL on 127.0.0.1", async () => {
    const { ensureMcpForProvider, parseMcpServersFromConfigs } = await import("../mcp-setup");

    const result = await ensureMcpForProvider("claude");

    const parsed = parseMcpServersFromConfigs(result.mcpConfigs) as Record<string, { args?: string[] }>;
    const routaUrl = parsed?.["routa-coordination"]?.args?.find((arg) => arg.startsWith("http"));
    expect(routaUrl).toBeDefined();
    expect(new URL(routaUrl!).hostname).toBe("127.0.0.1");
    expect(routaUrl).toBe("http://127.0.0.1:4123/api/mcp");
  });
});
