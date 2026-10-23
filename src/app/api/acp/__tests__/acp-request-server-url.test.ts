/**
 * @vitest-environment node
 *
 * L127: the request origin becomes the MCP base URL handed to spawned CLI
 * agents; loopback aliases must be pinned to 127.0.0.1 (the only bound address).
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { resolveRequestServerUrl } from "../acp-request-server-url";

describe("resolveRequestServerUrl", () => {
  it.each([
    ["http://localhost:3999/api/acp", "http://127.0.0.1:3999"],
    ["http://[::1]:3999/api/acp", "http://127.0.0.1:3999"],
    ["https://localhost:8443/api/acp", "https://127.0.0.1:8443"],
    ["http://localhost/api/acp", "http://127.0.0.1"],
    // NextURL folds all of 127/8 into "localhost"; only 127.0.0.1 is bound.
    ["http://127.9.9.9:3999/api/acp", "http://127.0.0.1:3999"],
  ])("rewrites loopback alias %s -> %s", (url, expected) => {
    expect(resolveRequestServerUrl(new NextRequest(url))).toBe(expected);
  });

  it("pins Kanban self-calls via 127.0.0.1 (NextURL reports them as localhost)", () => {
    const request = new NextRequest("http://127.0.0.1:3999/api/acp");
    expect(request.nextUrl.origin).toBe("http://localhost:3999");
    expect(resolveRequestServerUrl(request)).toBe("http://127.0.0.1:3999");
  });

  it.each([
    ["http://127.0.0.1:3999/api/acp", "http://127.0.0.1:3999"],
    ["http://example.test:3000/api/acp", "http://example.test:3000"],
    ["https://10.0.105.206:3000/api/acp", "https://10.0.105.206:3000"],
  ])("keeps other origins unchanged %s -> %s", (url, expected) => {
    expect(resolveRequestServerUrl(new NextRequest(url))).toBe(expected);
  });
});
