/**
 * @vitest-environment node
 *
 * L127: production binds 127.0.0.1 only; the fallback MCP endpoint must use
 * the IPv4 loopback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../routa-mcp-http-server", () => ({
  RoutaMcpHttpServer: class FakeRoutaMcpHttpServer {
    isRunning = false;
    mcpUrl = "http://127.0.0.1:54321/mcp";
    async start() {
      this.isRunning = true;
    }
    async stop() {
      this.isRunning = false;
    }
  },
}));

const { getMcpEndpointUrl, getOrStartMcpServer, stopMcpServer } = await import("../mcp-server-singleton");

describe("getMcpEndpointUrl", () => {
  beforeEach(async () => {
    await stopMcpServer();
    vi.stubEnv("PORT", "");
    vi.stubEnv("HOST", "");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await stopMcpServer();
  });

  it("falls back to http://127.0.0.1:<port>/api/mcp without a running singleton", () => {
    expect(getMcpEndpointUrl("4123")).toBe("http://127.0.0.1:4123/api/mcp");
  });

  it("prefers PORT env over the fallback port", () => {
    vi.stubEnv("PORT", "4123");
    expect(getMcpEndpointUrl("9999")).toBe("http://127.0.0.1:4123/api/mcp");
  });

  it("keeps HOST override", () => {
    vi.stubEnv("HOST", "myhost");
    expect(getMcpEndpointUrl("4123")).toBe("http://myhost:4123/api/mcp");
  });

  it("returns the running singleton's own URL", async () => {
    await getOrStartMcpServer("ws-1");
    expect(getMcpEndpointUrl("4123")).toBe("http://127.0.0.1:54321/mcp");
  });
});
