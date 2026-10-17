/**
 * hydrateFromDb must carry model / reasoningEffort from the persisted row,
 * otherwise a restarted Routa shows runs without their model chips.
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { hydrateSessionsFromDb } = vi.hoisted(() => ({
  hydrateSessionsFromDb: vi.fn(),
}));

vi.mock("../session-db-persister", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../session-db-persister")>()),
  hydrateSessionsFromDb,
}));

import { getHttpSessionStore } from "../http-session-store";

const GLOBAL_KEY = "__http_session_store__";

describe("HttpSessionStore.hydrateFromDb", () => {
  beforeEach(() => {
    // The store is a globalThis singleton with a one-shot `hydrated` flag;
    // a fresh instance per test keeps hydration from becoming a no-op.
    delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
    hydrateSessionsFromDb.mockReset();
    hydrateSessionsFromDb.mockResolvedValue([
      {
        id: "hyd-1",
        cwd: "/tmp",
        workspaceId: "ws-1",
        provider: "dsh",
        model: "claude-opus-5-5",
        reasoningEffort: "high",
        createdAt: new Date("2026-10-18T00:00:00.000Z"),
      },
    ]);
  });

  it("restores model and reasoningEffort from the database row", async () => {
    const store = getHttpSessionStore();
    await store.hydrateFromDb();

    const session = store.getSession("hyd-1");
    expect(session?.model).toBe("claude-opus-5-5");
    expect(session?.reasoningEffort).toBe("high");
    expect(session?.createdAt).toBe("2026-10-18T00:00:00.000Z");
  });

  it("does not overwrite a session that is already in memory", async () => {
    const store = getHttpSessionStore();
    store.upsertSession({
      sessionId: "hyd-1",
      cwd: "/tmp",
      workspaceId: "ws-1",
      model: "gpt-6.1-sol",
      reasoningEffort: "low",
      createdAt: new Date().toISOString(),
    });

    await store.hydrateFromDb();

    const session = store.getSession("hyd-1");
    expect(session?.model).toBe("gpt-6.1-sol");
    expect(session?.reasoningEffort).toBe("low");
  });
});
