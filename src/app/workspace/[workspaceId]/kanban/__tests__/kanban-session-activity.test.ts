import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../types";
import { formatSessionModelLabel, mergeSessionActivity, resolveCardLinkedSession } from "../kanban-session-activity";

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId: "s1",
    cwd: "/tmp",
    workspaceId: "ws",
    createdAt: "2026-10-14T01:00:00.000Z",
    acpStatus: "connecting",
    ...overrides,
  };
}

describe("mergeSessionActivity", () => {
  it("returns the same array when nothing was pushed", () => {
    const sessions = [session()];
    expect(mergeSessionActivity(sessions, {})).toBe(sessions);
  });

  it("lets a heartbeat replace the stale connecting snapshot", () => {
    const [merged] = mergeSessionActivity([session()], {
      s1: { sessionId: "s1", acpStatus: "ready", lastActivityAt: "2026-10-14T01:05:00.000Z", lastEventType: "tool_call", lastToolName: "Bash" },
    });
    expect(merged.acpStatus).toBe("ready");
    expect(merged.lastToolName).toBe("Bash");
  });

  it("keeps a refetched session that is newer than the held heartbeat", () => {
    const [merged] = mergeSessionActivity(
      [session({ acpStatus: "ready", lastActivityAt: "2026-10-14T01:10:00.000Z", lastEventType: "turn_complete" })],
      { s1: { sessionId: "s1", acpStatus: "ready", lastActivityAt: "2026-10-14T01:05:00.000Z", lastEventType: "tool_call" } },
    );
    expect(merged.lastEventType).toBe("turn_complete");
  });
});

describe("resolveCardLinkedSession", () => {
  const dead = session({ sessionId: "dead", acpStatus: "error", acpError: "process exited unexpectedly" });
  const map = new Map([["dead", dead], ["s1", session()]]);

  it("uses the trigger session when present", () => {
    expect(resolveCardLinkedSession({ triggerSessionId: "s1", columnId: "dev", laneSessions: [] }, map)?.sessionId).toBe("s1");
  });

  it("keeps the failure reason after the stale sweep clears the trigger", () => {
    const linked = resolveCardLinkedSession({
      triggerSessionId: undefined,
      columnId: "dev",
      laneSessions: [{ sessionId: "dead", columnId: "dev", status: "timed_out", startedAt: "2026-10-14T02:00:00.000Z" }],
    } as never, map);
    expect(linked?.acpError).toBe("process exited unexpectedly");
  });

  it("does not resurrect sessions from a completed lane or another column", () => {
    expect(resolveCardLinkedSession({
      triggerSessionId: undefined,
      columnId: "review",
      laneSessions: [
        { sessionId: "dead", columnId: "dev", status: "failed", startedAt: "2026-10-14T02:00:00.000Z" },
        { sessionId: "s1", columnId: "review", status: "completed", startedAt: "2026-10-14T02:05:00.000Z" },
      ],
    } as never, map)).toBeUndefined();
  });
});

describe("formatSessionModelLabel", () => {
  it("shows the session's actual model and effort", () => {
    expect(formatSessionModelLabel(
      session({ model: "claude-opus-5-5", reasoningEffort: "high" }),
      { model: "requested-model", reasoningEffort: "low" },
    )).toBe("claude-opus-5-5 / high");
  });

  it("falls back to the lane record per field, or shows only what is known", () => {
    expect(formatSessionModelLabel(session({ model: "gpt-6.1-sol" }), { reasoningEffort: "medium" }))
      .toBe("gpt-6.1-sol / medium");
    expect(formatSessionModelLabel(undefined, { model: "claude-opus-5-5" })).toBe("claude-opus-5-5");
  });

  it("returns undefined when neither side has a value, so nothing is rendered", () => {
    expect(formatSessionModelLabel(session(), undefined)).toBeUndefined();
    expect(formatSessionModelLabel(session({ model: " ", reasoningEffort: "" }), { model: "" })).toBeUndefined();
  });
});
