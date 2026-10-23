/**
 * @vitest-environment node
 *
 * L127: production binds 127.0.0.1 only; the worker's self-call to /api/acp
 * must default to the IPv4 loopback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getInternalBaseUrl } from "../index";

describe("getInternalBaseUrl", () => {
  beforeEach(() => {
    vi.stubEnv("PORT", "4123");
    for (const key of ["HOST", "NEXTAUTH_URL", "VERCEL_URL", "ROUTA_SERVER_URL"]) vi.stubEnv(key, "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to http://127.0.0.1:<PORT> when no override is set", () => {
    expect(getInternalBaseUrl()).toBe("http://127.0.0.1:4123");
  });

  it("ignores HOST and still uses the loopback (HOST is not an input here)", () => {
    vi.stubEnv("HOST", "");
    expect(new URL(getInternalBaseUrl()).hostname).toBe("127.0.0.1");
    vi.stubEnv("HOST", "myhost");
    expect(getInternalBaseUrl()).toBe("http://127.0.0.1:4123");
  });

  it("keeps NEXTAUTH_URL override", () => {
    vi.stubEnv("NEXTAUTH_URL", "http://x.test:5555");
    expect(getInternalBaseUrl()).toBe("http://x.test:5555");
  });

  it("keeps VERCEL_URL override", () => {
    vi.stubEnv("VERCEL_URL", "routa.vercel.app");
    expect(getInternalBaseUrl()).toBe("https://routa.vercel.app");
  });
});
