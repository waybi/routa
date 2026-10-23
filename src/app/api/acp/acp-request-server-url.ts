import type { NextRequest } from "next/server";

/**
 * Hostnames that refer to this machine but may not resolve to the IPv4
 * loopback the production server binds to (`next start -H 127.0.0.1`).
 * `localhost` can resolve to `::1` first, and `[::1]` is never bound.
 * Note: Next.js NextURL already rewrites every 127/8 address and `[::1]` to
 * `localhost`, so even a request that arrived on 127.0.0.1 shows up here as
 * `localhost` and must be pinned back.
 */
const LOOPBACK_ALIASES = new Set(["localhost", "[::1]"]);

/**
 * Resolve the Routa server URL handed to spawned ACP agents (MCP endpoint
 * base). Keeps the request origin, but rewrites loopback aliases to
 * 127.0.0.1 so external CLI child processes can always reach the server.
 */
export function resolveRequestServerUrl(request: NextRequest): string {
  const origin = new URL(request.nextUrl.origin);
  if (LOOPBACK_ALIASES.has(origin.hostname)) {
    origin.hostname = "127.0.0.1";
  }
  return origin.origin;
}
