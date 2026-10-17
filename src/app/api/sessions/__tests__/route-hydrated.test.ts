/**
 * End-to-end through the real HttpSessionStore: sessions restored from the
 * database (after a restart) keep their model and reasoning effort in the
 * list and detail responses. Only the DB source is mocked.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hydrateSessionsFromDb } = vi.hoisted(() => ({
  hydrateSessionsFromDb: vi.fn(),
}));

vi.mock("@/core/acp/session-db-persister", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/acp/session-db-persister")>()),
  hydrateSessionsFromDb,
}));

import { GET as listSessions } from "../route";
import { GET as getSessionDetail } from "../[sessionId]/route";

const GLOBAL_KEY = "__http_session_store__";

describe("/api/sessions with sessions hydrated from the database", () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
    hydrateSessionsFromDb.mockReset();
    hydrateSessionsFromDb.mockResolvedValue([
      {
        id: "hyd-route-1",
        name: "Restored run",
        cwd: "/tmp/project",
        workspaceId: "ws-1",
        provider: "dsh",
        role: "CRAFTER",
        model: "claude-opus-5-5",
        reasoningEffort: "high",
        createdAt: new Date("2026-10-18T00:00:00.000Z"),
      },
    ]);
  });

  it("returns model and reasoningEffort in the list", async () => {
    const response = await listSessions(new NextRequest("http://localhost/api/sessions?workspaceId=ws-1"));
    const data = await response.json();

    const item = data.sessions.find((s: { sessionId: string }) => s.sessionId === "hyd-route-1");
    expect(item).toBeDefined();
    expect(item.model).toBe("claude-opus-5-5");
    expect(item.reasoningEffort).toBe("high");
  });

  it("returns model and reasoningEffort in the detail response", async () => {
    const response = await getSessionDetail(
      new NextRequest("http://localhost/api/sessions/hyd-route-1"),
      { params: Promise.resolve({ sessionId: "hyd-route-1" }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.session.model).toBe("claude-opus-5-5");
    expect(data.session.reasoningEffort).toBe("high");
  });
});
